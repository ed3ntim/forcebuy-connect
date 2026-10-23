import type { StatusReply } from "./background-logic";

type Entry = StatusReply["lastSent"]["renew"];

/** One line per cookie kind, from the last delivery note. Pure, so it can be tested. */
export function describeDelivery(label: string, entry: Entry, hint: string): string {
  if (!entry) return `${label}: not sent yet`;
  if (entry.code === "missing") return `${label}: not found in this browser - ${hint}`;
  return `${label}: sent ${new Date(entry.at).toLocaleString()} (${entry.code})`;
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

/** The warning shown above everything else, or null. */
export function noticeFor(status: StatusReply): string | null {
  if (status.updateNeeded) return "Update the extension";
  const codes = [status.lastSent.renew?.code, status.lastSent.session?.code];
  if (codes.includes("consent_outdated")) return "Open ForceBuy to confirm the new notice";
  return null;
}
