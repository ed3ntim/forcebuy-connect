/**
 * What can be read out of a `steamLoginSecure` value without a network call.
 * Shared so the browser (checking a paste) and the server (storing it) read the
 * same thing from it.
 */

/**
 * Accepts a bare cookie value, a pasted `Cookie:` request header, or any
 * semicolon-separated cookie string, and returns the value of one cookie.
 *
 * Note that `steamLoginSecure` is HttpOnly, so it never appears in
 * `document.cookie`. Users copy it out of the browser's cookie storage or out
 * of a request header, and both of those forms land here.
 */
export function extractCookieValue(input: string, name: string): string | null {
  // Users paste from DevTools, from a Cookie: header, or from a "Copy value"
  // context menu that wraps the value in quotes. Strip the wrapper.
  const trimmed = stripSurroundingQuotes(input.trim());
  if (!trimmed) return null;
  // The value may itself be quoted: `steamLoginSecure="76561...%7C%7C..."`.
  const match = trimmed.match(new RegExp(`(?:^|;\\s*)${name}=(?:"([^"]+)"|([^;\\s]+))`));
  const value = match?.[1] ?? match?.[2];
  if (value) return decodeURIComponent(value);
  // A bare value was pasted. Only the two Steam tokens have a shape distinctive
  // enough to accept without a name: they start with the SteamID64 and carry
  // the `||` separator. Other names must be explicit to avoid returning random
  // input as if it were a session id.
  if ((name === "steamLoginSecure" || name === "steamRefresh_steam") && !trimmed.includes("=") && !trimmed.includes(";")) {
    const decoded = decodeURIComponent(trimmed);
    if (/^\d{17}\|\|/.test(decoded)) return decoded;
  }
  return null;
}

function stripSurroundingQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * The steamLoginSecure cookie is `<steamid64>||<token>`. Reading the id back out
 * lets us refuse a cookie that belongs to a different account than the
 * inventory it was pasted into.
 */
export function steamIdFromCookie(cookieValue: string): string | null {
  const match = cookieValue.match(/^(\d{17})(?:%7C%7C|\|\|)/);
  return match?.[1] ?? null;
}

/** What the JWT inside a Steam cookie value says. Times in ms. */
export type JwtClaims = { sub: string | null; aud: string[]; issuedAt: number; expiresAt: number };

/**
 * The claims of the JWT after the `||` separator of a `steamLoginSecure` or
 * `steamRefresh_steam` value (`iat` and `exp` are seconds in the token, ms here).
 *
 * Display and early checks only: the signature is not checked, and whether
 * Steam still accepts the value is decided by Steam. Null for anything that is
 * not that shape. Plain `atob`, no `Buffer`, so it can run in a browser.
 */
export function jwtClaims(cookieValue: string): JwtClaims | null {
  const token = cookieValue.split(/%7C%7C|\|\|/i)[1];
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as { sub?: unknown; aud?: unknown; iat?: unknown; exp?: unknown };
    const { iat, exp } = claims;
    if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
    if (typeof iat !== "number" || !Number.isFinite(iat)) return null;
    const aud =
      typeof claims.aud === "string"
        ? [claims.aud]
        : Array.isArray(claims.aud)
          ? claims.aud.filter((entry): entry is string => typeof entry === "string")
          : [];
    return {
      sub: typeof claims.sub === "string" ? claims.sub : null,
      aud,
      issuedAt: iat * 1000,
      expiresAt: exp * 1000,
    };
  } catch {
    return null;
  }
}

/**
 * When a `steamLoginSecure` value was issued and when it stops working.
 * Display and early demotion only, see `jwtClaims`.
 */
export function sessionLifetime(cookieValue: string): { issuedAt: number; expiresAt: number } | null {
  const claims = jwtClaims(cookieValue);
  return claims ? { issuedAt: claims.issuedAt, expiresAt: claims.expiresAt } : null;
}

export type RenewTokenError =
  | "renew_token_missing"
  | "renew_token_is_session"
  | "renew_token_wrong_account"
  | "renew_token_expired"
  | "renew_token_expires_soon";

/** A renewal token with fewer ms left than this is refused: not worth storing. */
export const RENEW_TOKEN_MIN_LEFT_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Checks a pasted `steamRefresh_steam` (bare value or a whole cookie line)
 * against the inventory's SteamID64, without a network call.
 */
export function checkRenewToken(
  input: string,
  expectedSteamId: string,
  now: number,
): { ok: true; value: string; steamId: string; expiresAt: number } | { ok: false; error: RenewTokenError } {
  const value = extractCookieValue(input, "steamRefresh_steam");
  if (!value) {
    // A session pasted into the renewal field is the likeliest mistake.
    const session = extractCookieValue(input, "steamLoginSecure");
    return { ok: false, error: session ? "renew_token_is_session" : "renew_token_missing" };
  }
  const claims = jwtClaims(value);
  if (!claims) return { ok: false, error: "renew_token_missing" };
  if (!claims.aud.includes("renew")) return { ok: false, error: "renew_token_is_session" };
  const prefix = steamIdFromCookie(value);
  if (!prefix || prefix !== expectedSteamId || claims.sub !== prefix) {
    return { ok: false, error: "renew_token_wrong_account" };
  }
  if (claims.expiresAt <= now) return { ok: false, error: "renew_token_expired" };
  if (claims.expiresAt - now < RENEW_TOKEN_MIN_LEFT_MS) return { ok: false, error: "renew_token_expires_soon" };
  return { ok: true, value, steamId: prefix, expiresAt: claims.expiresAt };
}

/**
 * The value of cookie `name` out of `Set-Cookie` header lines, decoded, or null
 * when it is absent or was deleted (empty, `deleted`, `Max-Age<=0`, `Expires`
 * in the past). The last line naming the cookie wins, as in a browser.
 */
export function cookieFromSetCookie(lines: string[], name: string, now = Date.now()): string | null {
  let result: string | null = null;
  for (const line of lines) {
    const [pair = "", ...attributes] = line.split(";").map((part) => part.trim());
    const eq = pair.indexOf("=");
    if (eq < 0 || pair.slice(0, eq).trim() !== name) continue;
    let raw = pair.slice(eq + 1).trim();
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
    let gone = raw === "" || raw === "deleted";
    for (const attribute of attributes) {
      const [key = "", ...rest] = attribute.split("=");
      const attrValue = rest.join("=").trim();
      if (/^max-age$/i.test(key.trim())) {
        const seconds = Number(attrValue);
        if (Number.isFinite(seconds) && seconds <= 0) gone = true;
      } else if (/^expires$/i.test(key.trim())) {
        const at = Date.parse(attrValue);
        if (Number.isFinite(at) && at <= now) gone = true;
      }
    }
    if (gone) {
      result = null;
      continue;
    }
    try {
      result = decodeURIComponent(raw);
    } catch {
      result = raw;
    }
  }
  return result;
}
