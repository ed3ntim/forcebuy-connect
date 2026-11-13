import { isDeliveryCode, type DeliveryCode } from "../../../packages/shared/src/extension-delivery";
import type { StatusReply } from "./background-logic";

type Entry = StatusReply["lastSent"]["renew"];

const TRANSIENT = "Steam could not be reached for the renewal, will try later";

/** What each code ForceBuy answers means, in a sentence; the transient Steam failures share one (same wording as the web app). */
export const DELIVERY_TEXT: Record<DeliveryCode, string> = {
  stored: "stored in ForceBuy",
  unchanged: "already up to date",
  not_needed: "not needed, renewal is working",
  no_inventory: "no inventory for that Steam account",
  busy: "ForceBuy is busy, will retry",
  consent_outdated: "connect again to confirm the new notice",
  credentials_unavailable: "the server cannot store logins right now",
  inventory_not_found: "that inventory no longer exists",
  renew_token_missing: "no renewal token in the browser",
  renew_token_is_session: "that is a session, not a renewal token",
  renew_token_wrong_account: "the token belongs to another Steam account",
  renew_token_expired: "the token had already expired",
  renew_token_expires_soon: "the token runs out in less than three days",
  renew_token_rejected: "Steam does not accept the token",
  renew_session_invalid: "Steam handed out a session that does not work",
  renew_unavailable: TRANSIENT,
  renew_unreachable: TRANSIENT,
  renew_unexpected_response: TRANSIENT,
  renew_no_session: TRANSIENT,
  renew_session_expired: TRANSIENT,
  renew_rate_limited: TRANSIENT,
  steam_cookie_missing: "no session in the browser",
  steam_cookie_wrong_account: "the session belongs to another Steam account",
  steam_session_expired: "the session had already expired",
  buff_not_enabled: "Buff163 is switched off in ForceBuy",
  buff_cookie_invalid: "the Buff163 cookie has an unexpected form",
  buff_login_required: "Buff163 does not accept the login, sign in there again",
  access_failed: "failed, the server could not use it",
};

/** Notes the extension makes itself, before or instead of asking the server. */
const LOCAL_TEXT: Record<string, string> = {
  network: "ForceBuy could not be reached, will retry",
  session_invalid: "the session in the browser has an unexpected form",
  session_expires_soon: "the session runs out too soon to be worth sending",
  ext_rate_limited: "too many deliveries this hour, will retry",
  invalid_request: "ForceBuy could not read the request",
};

/** A code as a sentence. A word this version does not know (an older or newer server) is neutral, never a success. */
export function deliveryCodeText(code: string): string {
  if (isDeliveryCode(code)) return DELIVERY_TEXT[code];
  return LOCAL_TEXT[code] ?? "unexpected answer, see ForceBuy for details";
}

/** One line per cookie kind, from the last delivery note. Pure, so it can be tested. */
export function describeDelivery(label: string, entry: Entry, hint: string): string {
  if (!entry) return `${label}: not sent yet`;
  if (entry.code === "missing") return `${label}: not found in this browser - ${hint}`;
  return `${label}: ${deliveryCodeText(entry.code)} (${new Date(entry.at).toLocaleString()})`;
}

/** Renewal token codes that mean ForceBuy holds a working token. */
const RENEW_IN_USE = new Set(["stored", "unchanged"]);

/**
 * The session line. The session is only read when no renewal token can be
 * delivered, so a note from such a moment (signing out, a browser start before
 * the cookies are loaded) goes stale once the token arrives: while the token is
 * in use, the line says so instead of showing that old note.
 */
export function describeSession(lastSent: StatusReply["lastSent"]): string {
  if (lastSent.renew && RENEW_IN_USE.has(lastSent.renew.code)) return "Session: not needed, the renewal token is in use";
  return describeDelivery("Session", lastSent.session, SESSION_HINT);
}

export const RENEW_HINT = "sign in to Steam with Remember me";
export const SESSION_HINT = "open Steam in this browser";

export const BUFF_HINT = "sign in at buff.163.com";

/**
 * The Buff163 line, and whether the popup offers the button that asks the
 * browser for access to buff.163.com. Off in ForceBuy comes first: nothing is
 * read and nothing is asked until the user turned it on there.
 */
export function describeBuff(status: StatusReply): { text: string; allow: boolean } {
  if (!status.buffWanted) return { text: "Buff163: off (turn it on in ForceBuy settings)", allow: false };
  if (!status.buffPermission) return { text: "Buff163: turned on, but this browser has not allowed buff.163.com yet", allow: true };
  return { text: describeDelivery("Buff163", status.lastSent.buff, BUFF_HINT), allow: false };
}

/** The warning shown above everything else, or null. */
export function noticeFor(status: StatusReply): string | null {
  if (status.updateNeeded) return "Update the extension";
  const codes = [status.lastSent.renew?.code, status.lastSent.session?.code, status.lastSent.buff?.code];
  if (codes.includes("consent_outdated")) return "Open ForceBuy to confirm the new notice";
  return null;
}
