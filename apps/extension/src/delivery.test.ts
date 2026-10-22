import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, createDelivery, type Deps } from "./delivery";
import type { ExtState } from "./state";

const ID = "76561198000000001";
const NOW = Date.parse("2026-10-22T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
/** `<id>||<jwt>` with the given audience and lifetime. */
function cookie(aud: string, expiresInMs: number, id = ID): string {
  const payload = { sub: id, aud: [aud], iat: Math.floor(NOW / 1000), exp: Math.floor((NOW + expiresInMs) / 1000) };
  return `${id}%7C%7C${b64({ alg: "none" })}.${b64(payload)}.sig`;
}
const renew = (ms = 100 * DAY) => cookie("renew", ms);
const session = (ms = 20 * 60 * 60 * 1000) => cookie("web", ms);

type Reply = { status: number; data: unknown } | Error;

function setup(opts: { renew?: string | null; session?: string | null; replies?: Reply[]; state?: ExtState }) {
  let state: ExtState = { token: "tok", linkId: "l1", ...opts.state };
  const posts: Array<{ path: string; body: unknown; token?: string }> = [];
  const replies = [...(opts.replies ?? [])];
  const cookies = { renew: opts.renew === undefined ? renew() : opts.renew, session: opts.session === undefined ? null : opts.session };
  const read = (value: string | null) => (value ? { value } : { missing: "not_found" as const });
  const deps: Deps = {
    readRenewToken: async () => read(cookies.renew),
    readSession: async () => read(cookies.session),
    post: (async (path: string, body: unknown, token?: string) => {
      posts.push({ path, body, token });
      const next = replies.shift() ?? { status: 200, data: { result: "stored" } };
      if (next instanceof Error) throw next;
      return next;
    }) as Deps["post"],
    readState: async () => structuredClone(state),
    writeState: async (patch) => {
      state = { ...state, ...structuredClone(patch) };
    },
    clearState: async () => {
      state = {};
    },
    now: () => NOW,
    sha256Hex: async (value) => `h${[...value].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 1000000007, 7)}`,
  };
  return { delivery: createDelivery(deps), posts, cookies, getState: () => state };
}

const ok = { status: 200, data: { result: "stored" } };
const err = (status: number, error: string) => ({ status, data: { error } });

describe("deliver", () => {
  it("sends an unchanged value only once", async () => {
    const t = setup({});
    await t.delivery.deliverAll("a");
    await t.delivery.deliverAll("b");
    expect(t.posts).toHaveLength(1);
    expect(t.posts[0]).toMatchObject({ path: "/api/ext/steam-renew", token: "tok" });
    expect(t.getState().lastSent?.renew).toMatchObject({ steamId: ID, code: "stored" });
  });

  it("sends again when the value changed", async () => {
    const t = setup({});
    await t.delivery.deliverAll("a");
    t.cookies.renew = renew(120 * DAY);
    await t.delivery.deliverAll("b");
    expect(t.posts).toHaveLength(2);
  });

  it("sends again after a failed attempt with the same value", async () => {
    const t = setup({ replies: [err(400, "renew_session_invalid"), ok] });
    await t.delivery.deliver("renew", "a");
    expect(t.getState().lastSent?.renew?.sha256).toBe("");
    await t.delivery.deliver("renew", "b");
    expect(t.posts).toHaveLength(2);
    expect(t.getState().lastSent?.renew?.sha256).not.toBe("");
  });

  it("does not send an expired, soon expiring or foreign token", async () => {
    for (const value of [renew(-DAY), renew(DAY), cookie("web", 100 * DAY), "garbage"]) {
      const t = setup({ renew: value, session: null });
      await t.delivery.deliver("renew", "a");
      expect(t.posts).toHaveLength(0);
    }
  });

  it("does not send a session with less than 2 hours left", async () => {
    const t = setup({ renew: null, session: session(60 * 60 * 1000) });
    await t.delivery.deliverAll("a");
    expect(t.posts).toHaveLength(0);
    expect(t.getState().lastSent?.session?.code).toBe("session_expires_soon");
  });

  it("falls back to the session when no renewal token is in the browser", async () => {
    const t = setup({ renew: null, session: session() });
    await t.delivery.deliverAll("a");
    expect(t.posts.map((post) => post.path)).toEqual(["/api/ext/steam-session"]);
  });

  it("falls back to the session when the server rejects the token", async () => {
    const t = setup({ session: session(), replies: [err(400, "renew_token_rejected"), ok] });
    await t.delivery.deliverAll("a");
    expect(t.posts.map((post) => post.path)).toEqual(["/api/ext/steam-renew", "/api/ext/steam-session"]);
  });

  it("falls back to the session when the local check refuses the token", async () => {
    const t = setup({ renew: renew(DAY), session: session() });
    await t.delivery.deliverAll("a");
    expect(t.posts.map((post) => post.path)).toEqual(["/api/ext/steam-session"]);
  });

  it("skips the session when the renewal token was stored", async () => {
    const t = setup({ session: session() });
    await t.delivery.deliverAll("a");
    expect(t.posts.map((post) => post.path)).toEqual(["/api/ext/steam-renew"]);
  });

  it("clears the state on a revoked coupling", async () => {
    const t = setup({ replies: [err(401, "ext_token_revoked")] });
    expect(await t.delivery.deliverAll("a")).toEqual({ retry: false, disconnected: true });
    expect(t.getState()).toEqual({});
  });

  it("asks for a retry on busy, 429, 503 and network errors", async () => {
    for (const reply of [err(409, "busy"), err(429, "ext_rate_limited"), err(503, "credentials_unavailable"), new Error("offline")]) {
      const t = setup({ replies: [reply] });
      expect(await t.delivery.deliverAll("a")).toEqual({ retry: true });
      expect(t.getState().retries).toBe(1);
    }
  });

  it("gives up after 6 attempts and starts over later", async () => {
    const t = setup({ replies: Array.from({ length: 12 }, () => err(409, "busy")) });
    for (let i = 1; i < MAX_ATTEMPTS; i++) expect(await t.delivery.deliverAll("r")).toEqual({ retry: true });
    expect(await t.delivery.deliverAll("r")).toEqual({ retry: false });
    expect(t.getState().retries).toBe(0);
    expect(MAX_ATTEMPTS).toBe(6);
  });

  it("resets the counter on success", async () => {
    const t = setup({ replies: [err(409, "busy"), ok] });
    await t.delivery.deliverAll("a");
    expect(t.getState().retries).toBe(1);
    await t.delivery.deliverAll("b");
    expect(t.getState().retries).toBe(0);
  });

  it("does not retry consent_outdated and keeps the code", async () => {
    const t = setup({ session: session(), replies: [err(409, "consent_outdated")] });
    expect(await t.delivery.deliverAll("a")).toEqual({ retry: false });
    expect(t.posts).toHaveLength(1);
    expect(t.getState().lastSent?.renew?.code).toBe("consent_outdated");
  });

  it("sends nothing without a coupling", async () => {
    const t = setup({ state: { token: undefined } });
    await t.delivery.deliverAll("a");
    expect(t.posts).toHaveLength(0);
  });

  it("never keeps the cookie value in the state", async () => {
    const r = renew();
    const s = session();
    const t = setup({ renew: r, session: s, replies: [err(400, "renew_token_rejected"), ok] });
    await t.delivery.deliverAll("a");
    const text = JSON.stringify(t.getState());
    for (const value of [r, s, decodeURIComponent(r), decodeURIComponent(s)]) expect(text).not.toContain(value);
  });
});

describe("pair, hello, disconnect", () => {
  const paired = { status: 200, data: { linkId: "l9", token: "t9", account: { steamId64: ID, personaName: "Pat" }, minVersion: "0.25.0" } };

  it("stores the coupling, cuts the one it replaces, then delivers", async () => {
    const t = setup({ state: { lastSent: { renew: { steamId: ID, sha256: "x", at: 1, code: "stored" } } }, replies: [paired, { status: 200, data: { ok: true } }, ok] });
    const result = await t.delivery.pair("code", "edge", "0.25.0");
    expect(result).toMatchObject({ ok: true, account: { personaName: "Pat" } });
    expect(t.posts[0]).toMatchObject({ path: "/api/ext/pair", body: { code: "code", browser: "edge", extVersion: "0.25.0", proto: 1 } });
    expect(t.posts[0]!.token).toBeUndefined();
    expect(t.posts[1]).toMatchObject({ path: "/api/ext/disconnect", body: { tokens: "keep" }, token: "tok" });
    expect(t.posts[2]).toMatchObject({ path: "/api/ext/steam-renew", token: "t9" });
    expect(t.getState()).toMatchObject({ token: "t9", linkId: "l9" });
  });

  it("reports a bad code and stores nothing new", async () => {
    const t = setup({ state: { token: undefined }, replies: [err(400, "pair_code_invalid")] });
    expect(await t.delivery.pair("x", "chrome", "1")).toEqual({ ok: false, error: "pair_code_invalid" });
    expect(t.getState().token).toBeUndefined();
  });

  it("hello: 401 clears, 426 flags an update", async () => {
    const a = setup({ replies: [err(401, "ext_token_revoked")] });
    await a.delivery.hello("1");
    expect(a.getState()).toEqual({});
    const b = setup({ replies: [err(426, "ext_update_required")] });
    await b.delivery.hello("1");
    expect(b.getState().updateNeeded).toBe(true);
  });

  it("disconnect clears locally even when the server is unreachable", async () => {
    const t = setup({ replies: [new Error("offline")] });
    expect(await t.delivery.disconnect("delete")).toEqual({ ok: true, serverReached: false });
    expect(t.getState()).toEqual({});
    expect(t.posts[0]).toMatchObject({ path: "/api/ext/disconnect", body: { tokens: "delete" } });
  });
});
