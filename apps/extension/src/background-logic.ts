import type { WatchedKind } from "./cookie-read";
import type { Browser, Delivery } from "./delivery";
import type { ExtState, LastSent } from "./state";

export const DEBOUNCE_MS = 5000;
const RETRY_MINUTES = 5;

export type AlarmsApi = {
  create: (name: string, info: { delayInMinutes?: number; periodInMinutes?: number }) => void | Promise<void>;
  get: (name: string) => Promise<unknown>;
};

export type BackgroundDeps = {
  delivery: Delivery;
  readState: () => Promise<ExtState>;
  hasBuffPermission: () => Promise<boolean>;
  alarms: AlarmsApi;
  version: string;
  userAgent: string;
};

export function detectBrowser(userAgent: string): Browser {
  if (userAgent.includes("Edg/")) return "edge";
  if (/firefox/i.test(userAgent)) return "firefox";
  return "chrome";
}

/** What the popup and the page may learn: never the token, never a hash. */
export type StatusReply = {
  connected: boolean;
  linkId: string | null;
  account: ExtState["account"] | null;
  version: string;
  lastSent: { renew?: Omit<LastSent, "sha256">; session?: Omit<LastSent, "sha256">; buff?: Omit<LastSent, "sha256"> };
  updateNeeded: boolean;
  /** ForceBuy has Buff163 turned on for this coupling. */
  buffWanted: boolean;
  /** The browser has allowed buff.163.com. */
  buffPermission: boolean;
};

function withoutHash(entry: LastSent | undefined): Omit<LastSent, "sha256"> | undefined {
  return entry ? { steamId: entry.steamId, at: entry.at, code: entry.code } : undefined;
}

export function createBackground(deps: BackgroundDeps) {
  const { delivery, alarms } = deps;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Delivers and asks for a retry alarm when the chain wants one. */
  async function run(reason: string): Promise<void> {
    const result = await delivery.deliverAll(reason);
    if (result.retry) await alarms.create("retry-delivery", { delayInMinutes: RETRY_MINUTES });
  }

  async function ensureDailyAlarm(): Promise<void> {
    if (!(await alarms.get("daily-hello"))) await alarms.create("daily-hello", { periodInMinutes: 1440 });
  }

  /** A watched cookie got a new value: wait 5 s per kind, then deliver. The alarm covers a worker that ends first. */
  function onCookie(kind: WatchedKind): void {
    clearTimeout(timers.get(kind));
    void alarms.create("pending-change", { delayInMinutes: 1 });
    timers.set(
      kind,
      setTimeout(() => {
        timers.delete(kind);
        void run("changed");
      }, DEBOUNCE_MS),
    );
  }

  async function onAlarm(name: string): Promise<void> {
    if (name === "daily-hello") {
      await delivery.hello(deps.version);
      await run("daily");
    } else if (name === "retry-delivery") await run("retry");
    else if (name === "pending-change") await run("changed");
  }

  async function status(): Promise<StatusReply> {
    const state = await deps.readState();
    return {
      connected: Boolean(state.token),
      linkId: state.linkId ?? null,
      account: state.account ?? null,
      version: deps.version,
      lastSent: {
        renew: withoutHash(state.lastSent?.renew),
        session: withoutHash(state.lastSent?.session),
        buff: withoutHash(state.lastSent?.buff),
      },
      updateNeeded: state.updateNeeded === true,
      buffWanted: state.buffWanted === true,
      buffPermission: await deps.hasBuffPermission(),
    };
  }

  async function handle(message: unknown): Promise<unknown> {
    const msg = (message ?? {}) as { type?: unknown; code?: unknown; tokens?: unknown };
    switch (msg.type) {
      case "pair": {
        if (typeof msg.code !== "string" || !msg.code || msg.code.length > 200) return { ok: false, error: "invalid_request" };
        const result = await delivery.pair(msg.code, detectBrowser(deps.userAgent), deps.version);
        if (result.ok && result.retry) await alarms.create("retry-delivery", { delayInMinutes: RETRY_MINUTES });
        return result.ok ? { ok: true, account: result.account } : result;
      }
      case "status":
        return status();
      case "send-now":
        // Hello first: it brings the Buff163 switch of ForceBuy, which the user may have turned on a moment ago.
        await delivery.hello(deps.version);
        await run("manual");
        return status();
      case "disconnect":
        return delivery.disconnect(msg.tokens === "keep" ? "keep" : "delete");
      default:
        return { ok: false, error: "unknown_message" };
    }
  }

  /** `runtime.onMessage` listener: answers asynchronously, hence the `true`. */
  function onMessage(message: unknown, _sender: unknown, sendResponse: (reply: unknown) => void): boolean {
    handle(message).then(sendResponse, () => sendResponse({ ok: false, error: "failed" }));
    return true;
  }

  return { onCookie, onAlarm, onMessage, handle, status, ensureDailyAlarm };
}
