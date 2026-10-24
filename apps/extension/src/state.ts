import { ext } from "./browser";

/** What was last delivered for one cookie. The hash, never the value. */
export type LastSent = { steamId: string; sha256: string; at: number; code: string };

export type PairedAccount = { steamId64: string; personaName: string };

/** The `storage.local` schema. Never holds a cookie value. */
export type ExtState = {
  token?: string;
  linkId?: string;
  account?: PairedAccount;
  lastSent?: { renew?: LastSent; session?: LastSent; buff?: LastSent };
  /** Whether ForceBuy has Buff163 turned on for this coupling (from hello); the browser permission is asked separately. */
  buffWanted?: boolean;
  retries?: number;
  updateNeeded?: boolean;
};

export async function readState(): Promise<ExtState> {
  return (await ext.storage.local.get(null)) as ExtState;
}

export async function writeState(patch: Partial<ExtState>): Promise<void> {
  await ext.storage.local.set(patch);
}

export async function clearState(): Promise<void> {
  await ext.storage.local.clear();
}
