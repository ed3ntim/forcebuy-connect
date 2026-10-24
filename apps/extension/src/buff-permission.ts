import { ext } from "./browser";

/**
 * The only file that touches the permissions API. `buff.163.com` is an optional
 * host: it is not in the manifest's required hosts, so an installation that
 * never turns Buff163 on never has it, and a required new host would switch
 * existing installations off until the user accepted it.
 */
const BUFF_ORIGINS = ["https://buff.163.com/*"];

/** Whether this browser has allowed access to buff.163.com. */
export async function hasBuffPermission(): Promise<boolean> {
  try {
    return await ext.permissions.contains({ origins: BUFF_ORIGINS });
  } catch {
    return false;
  }
}

/** Asks the user to allow buff.163.com. Only works from a user gesture, so only the popup calls it. */
export async function requestBuffPermission(): Promise<boolean> {
  try {
    return await ext.permissions.request({ origins: BUFF_ORIGINS });
  } catch {
    return false;
  }
}
