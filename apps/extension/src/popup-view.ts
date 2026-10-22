import type { StatusReply } from "./background-logic";

type Entry = StatusReply["lastSent"]["renew"];

/** One line per cookie kind, from the last delivery note. Pure, so it can be tested. */
export function describeDelivery(label: string, entry: Entry, hint: string): string {
  if (!entry) return `${label}: not sent yet`;
  if (entry.code === "missing") return `${label}: not found in this browser - ${hint}`;
  return `${label}: sent ${new Date(entry.at).toLocaleString()} (${entry.code})`;
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
