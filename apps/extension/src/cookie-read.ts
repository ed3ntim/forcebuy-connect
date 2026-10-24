import { ext } from "./browser";

/**
 * The only file that touches the cookie API: three fixed reads, nothing else.
 * No write, no removal, no listing of other cookies.
 *
 * The third, Buff163's `session`, is read only after the user turned it on and
 * allowed `buff.163.com` in this browser (buff-permission.ts). Its sibling
 * `csrf_token` is deliberately not read: it only matters for POST requests,
 * and ForceBuy sends none.
 */
const RENEW = { url: "https://login.steampowered.com/", name: "steamRefresh_steam", domain: "login.steampowered.com" } as const;
const SESSION = { url: "https://steamcommunity.com/", name: "steamLoginSecure", domain: "steamcommunity.com" } as const;
// Measured on the operator's account (2026-10-24): host-only on buff.163.com, HttpOnly, a browser-session cookie whose value changes with every sign-in.
const BUFF_SESSION_DOMAIN = "buff.163.com";
const BUFF = { url: "https://buff.163.com/", name: "session", domain: BUFF_SESSION_DOMAIN } as const;

export type CookieRead = { value: string } | { missing: "not_found" | "empty" | "error" };

/** The watched cookies: Steam's renewal token and session, Buff163's session. */
export type WatchedKind = "renew" | "session" | "buff";

async function read(pair: { url: string; name: string }): Promise<CookieRead> {
  try {
    const cookie = await ext.cookies.get({ url: pair.url, name: pair.name });
    if (!cookie) return { missing: "not_found" };
    if (!cookie.value) return { missing: "empty" };
    return { value: cookie.value };
  } catch {
    return { missing: "error" };
  }
}

export const readRenewToken = (): Promise<CookieRead> => read(RENEW);
export const readSession = (): Promise<CookieRead> => read(SESSION);
export const readBuffSession = (): Promise<CookieRead> => read(BUFF);

/** Filter for the change event: exactly one of the three pairs, host-only (no leading dot). */
export function isWatchedCookie(cookie: { name: string; domain: string }): boolean {
  return watchedKind(cookie) !== null;
}

/** Which of the watched cookies a change event is about, or null for anything else. Name and domain must both match. */
export function watchedKind(cookie: { name: string; domain: string }): WatchedKind | null {
  if (cookie.name === RENEW.name && cookie.domain === RENEW.domain) return "renew";
  if (cookie.name === SESSION.name && cookie.domain === SESSION.domain) return "session";
  if (cookie.name === BUFF.name && cookie.domain === BUFF.domain) return "buff";
  return null;
}

/** Calls `handler` for a new or changed value of a watched cookie; removals and all other cookies are ignored. */
export function onWatchedCookie(handler: (kind: WatchedKind) => void): void {
  ext.cookies.onChanged.addListener(({ cookie, removed }) => {
    const kind = watchedKind(cookie);
    if (!removed && kind) handler(kind);
  });
}
