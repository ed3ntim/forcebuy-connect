import { ext } from "./browser";

/**
 * The only file that touches the cookie API: two fixed reads, nothing else. No
 * write, no removal, no listing of other cookies.
 */
const RENEW = { url: "https://login.steampowered.com/", name: "steamRefresh_steam", domain: "login.steampowered.com" } as const;
const SESSION = { url: "https://steamcommunity.com/", name: "steamLoginSecure", domain: "steamcommunity.com" } as const;

export type CookieRead = { value: string } | { missing: "not_found" | "empty" | "error" };

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

/** Filter for the change event: exactly one of the two pairs, host-only (no leading dot). */
export function isWatchedCookie(cookie: { name: string; domain: string }): boolean {
  return [RENEW, SESSION].some((pair) => cookie.name === pair.name && cookie.domain === pair.domain);
}

/** Which of the two watched cookies a change event is about, or null for anything else. */
export function watchedKind(cookie: { name: string; domain: string }): "renew" | "session" | null {
  if (cookie.name === RENEW.name && cookie.domain === RENEW.domain) return "renew";
  if (cookie.name === SESSION.name && cookie.domain === SESSION.domain) return "session";
  return null;
}

/** Calls `handler` for a new or changed value of a watched cookie; removals and all other cookies are ignored. */
export function onWatchedCookie(handler: (kind: "renew" | "session") => void): void {
  ext.cookies.onChanged.addListener(({ cookie, removed }) => {
    const kind = watchedKind(cookie);
    if (!removed && kind) handler(kind);
  });
}
