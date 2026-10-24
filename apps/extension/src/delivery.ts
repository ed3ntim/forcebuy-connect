import { checkRenewToken, jwtClaims, steamIdFromCookie } from "../../../packages/shared/src/steam-cookie";
import type { CookieRead } from "./cookie-read";
import type { ApiPath } from "./forcebuy-api";
import type { ExtState, LastSent, PairedAccount } from "./state";

export type Kind = "renew" | "session" | "buff";
export type Browser = "chrome" | "edge" | "firefox" | "other";

/** Attempts per delivery chain (first try included) before the extension waits for the next trigger. */
export const MAX_ATTEMPTS = 6;
/** A session with less left than this is not worth sending. */
export const SESSION_MIN_LEFT_MS = 2 * 60 * 60 * 1000;
const PROTO = 1;
/** Server answers that mean the value is stored or needs no storing. */
const DONE = new Set(["stored", "unchanged", "no_inventory", "not_needed"]);
/** The Buff163 cookie is the bare value of one cookie: no leading `session=`, no `;`, no whitespace (`=` may be in it). The server checks the same. */
const BUFF_VALUE = /^(?!session=)[^\s;]{1,4096}$/;
const PATHS: Record<Kind, ApiPath> = {
  renew: "/api/ext/steam-renew",
  session: "/api/ext/steam-session",
  buff: "/api/ext/buff-session",
};

export type Deps = {
  readRenewToken: () => Promise<CookieRead>;
  readSession: () => Promise<CookieRead>;
  readBuffSession: () => Promise<CookieRead>;
  /** Whether the browser has allowed buff.163.com (an optional host). */
  hasBuffPermission: () => Promise<boolean>;
  post: <T>(path: ApiPath, body: unknown, token?: string) => Promise<{ status: number; data: T | null }>;
  readState: () => Promise<ExtState>;
  writeState: (patch: Partial<ExtState>) => Promise<void>;
  clearState: () => Promise<void>;
  now: () => number;
  sha256Hex: (value: string) => Promise<string>;
};

export type Outcome = {
  status: "done" | "skipped" | "missing" | "rejected" | "consent" | "retry" | "disconnected";
  code: string;
};

type ErrorBody = { error?: string };
type ResultBody = { result?: string };

export function createDelivery(deps: Deps) {
  /** Notes the outcome of an attempt; the hash moves only with `sha256`. */
  async function note(kind: Kind, patch: { code: string; steamId?: string; sha256?: string }): Promise<void> {
    const state = await deps.readState();
    const prev = state.lastSent?.[kind];
    const entry: LastSent = {
      steamId: patch.steamId ?? prev?.steamId ?? "",
      sha256: patch.sha256 ?? prev?.sha256 ?? "",
      at: deps.now(),
      code: patch.code,
    };
    await deps.writeState({ lastSent: { ...state.lastSent, [kind]: entry } });
  }

  /** Local check before anything leaves the browser: an error code, or null when the value may be sent. */
  function localError(kind: Kind, value: string): string | null {
    if (kind === "buff") return BUFF_VALUE.test(value) ? null : "buff_cookie_invalid";
    if (kind === "renew") {
      const checked = checkRenewToken(value, steamIdFromCookie(value) ?? "", deps.now());
      return checked.ok ? null : checked.error;
    }
    if (!steamIdFromCookie(value)) return "steam_cookie_missing";
    const claims = jwtClaims(value);
    if (!claims) return "session_invalid";
    return claims.expiresAt - deps.now() < SESSION_MIN_LEFT_MS ? "session_expires_soon" : null;
  }

  async function deliver(kind: Kind, _reason: string): Promise<Outcome> {
    const state = await deps.readState();
    if (!state.token) return { status: "disconnected", code: "not_paired" };

    const read = await (kind === "renew" ? deps.readRenewToken() : kind === "session" ? deps.readSession() : deps.readBuffSession());
    if (!("value" in read)) {
      await note(kind, { code: "missing" });
      return { status: "missing", code: "missing" };
    }
    const value = read.value;
    const bad = localError(kind, value);
    if (bad) {
      await note(kind, { code: bad });
      return { status: "rejected", code: bad };
    }

    const sha256 = await deps.sha256Hex(value);
    const prev = state.lastSent?.[kind];
    if (prev && prev.sha256 === sha256 && DONE.has(prev.code)) return { status: "skipped", code: prev.code };

    const steamId = kind === "buff" ? "" : (steamIdFromCookie(value) ?? "");
    let response: { status: number; data: unknown };
    try {
      response = await deps.post(PATHS[kind], { value }, state.token);
    } catch {
      await note(kind, { code: "network" });
      return { status: "retry", code: "network" };
    }

    const { status, data } = response;
    const errorCode = (data as ErrorBody | null)?.error ?? `http_${status}`;
    if (status === 200) {
      const code = (data as ResultBody | null)?.result ?? "stored";
      await note(kind, { code, steamId, sha256 });
      return { status: "done", code };
    }
    if (status === 401 && errorCode === "ext_token_revoked") {
      await deps.clearState();
      return { status: "disconnected", code: errorCode };
    }
    if (kind === "buff" && status === 409 && errorCode === "buff_not_enabled") {
      // Turned off in ForceBuy: stop trying, forget the hash so that turning it on again delivers the cookie anew.
      await deps.writeState({ buffWanted: false });
      await note(kind, { code: errorCode, sha256: "" });
      return { status: "rejected", code: errorCode };
    }
    await note(kind, { code: errorCode });
    if (status === 409 && errorCode === "consent_outdated") return { status: "consent", code: errorCode };
    if (status === 409 || status === 429 || status >= 500) return { status: "retry", code: errorCode };
    return { status: "rejected", code: errorCode };
  }

  const renewFailed = (outcome: Outcome): boolean =>
    outcome.status === "missing" ||
    (outcome.status === "rejected" && (outcome.code.startsWith("renew_token_") || outcome.code === "renew_session_invalid"));

  /**
   * Renewal token first; the session only when that cannot be delivered. Then,
   * on its own and whatever Steam said, the Buff163 cookie when ForceBuy has it
   * turned on and the browser allowed buff.163.com. `retry` asks for a new
   * attempt later.
   */
  async function deliverAll(reason: string): Promise<{ retry: boolean; disconnected?: boolean }> {
    let outcome = await deliver("renew", reason);
    if (renewFailed(outcome)) outcome = await deliver("session", reason);
    if (outcome.status === "disconnected") return { retry: false, disconnected: true };
    let retryWanted = outcome.status === "retry";
    if ((await deps.readState()).buffWanted && (await deps.hasBuffPermission())) {
      const buff = await deliver("buff", reason);
      if (buff.status === "disconnected") return { retry: false, disconnected: true };
      if (buff.status === "retry") retryWanted = true;
    }
    if (retryWanted) {
      const attempts = ((await deps.readState()).retries ?? 0) + 1;
      if (attempts < MAX_ATTEMPTS) {
        await deps.writeState({ retries: attempts });
        return { retry: true };
      }
    }
    await deps.writeState({ retries: 0 });
    return { retry: false };
  }

  async function pair(
    code: string,
    browser: Browser,
    version: string,
  ): Promise<{ ok: true; account: PairedAccount; retry: boolean } | { ok: false; error: string }> {
    let response: { status: number; data: unknown };
    try {
      response = await deps.post("/api/ext/pair", { code, browser, extVersion: version, proto: PROTO });
    } catch {
      return { ok: false, error: "network" };
    }
    if (response.status === 426) {
      await deps.writeState({ updateNeeded: true });
      return { ok: false, error: "ext_update_required" };
    }
    const data = response.data as { linkId?: string; token?: string; account?: PairedAccount } | null;
    if (response.status !== 200 || !data?.token || !data.linkId || !data.account) {
      return { ok: false, error: (response.data as ErrorBody | null)?.error ?? `http_${response.status}` };
    }
    // A coupling replaced by this one is cut on the server too; what it delivered
    // stays, the new coupling delivers the same cookies.
    const previous = (await deps.readState()).token;
    if (previous) {
      try {
        await deps.post("/api/ext/disconnect", { tokens: "keep" }, previous);
      } catch {
        // Unreachable: the old coupling runs out with the idle expiry.
      }
    }
    await deps.clearState();
    await deps.writeState({ token: data.token, linkId: data.linkId, account: data.account, lastSent: {}, retries: 0 });
    const result = await deliverAll("paired");
    return { ok: true, account: data.account, retry: result.retry };
  }

  async function hello(version: string): Promise<void> {
    const state = await deps.readState();
    if (!state.token) return;
    try {
      const { status, data } = await deps.post("/api/ext/hello", { extVersion: version, proto: PROTO }, state.token);
      if (status === 401) await deps.clearState();
      else if (status === 426) await deps.writeState({ updateNeeded: true });
      else if (status === 200) {
        const buffWanted = (data as { buff?: boolean } | null)?.buff === true;
        await deps.writeState({ updateNeeded: false, buffWanted });
        // Off in ForceBuy: what was delivered may be gone from there, so the next turn-on must deliver again.
        if (!buffWanted && state.lastSent?.buff) {
          const { buff: _gone, ...rest } = state.lastSent;
          await deps.writeState({ lastSent: rest });
        }
      }
    } catch {
      // Offline: the next daily hello tries again.
    }
  }

  /** Cuts the coupling here even when the server cannot be reached; reports whether it was. */
  async function disconnect(tokens: "delete" | "keep"): Promise<{ ok: true; serverReached: boolean }> {
    const state = await deps.readState();
    let serverReached = false;
    if (state.token) {
      try {
        const { status } = await deps.post("/api/ext/disconnect", { tokens }, state.token);
        serverReached = status === 200 || status === 401;
      } catch {
        serverReached = false;
      }
    }
    await deps.clearState();
    return { ok: true, serverReached };
  }

  return { deliver, deliverAll, pair, hello, disconnect };
}

export type Delivery = ReturnType<typeof createDelivery>;
