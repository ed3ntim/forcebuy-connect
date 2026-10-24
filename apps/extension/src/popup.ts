import type { StatusReply } from "./background-logic";
import { ext } from "./browser";
import { requestBuffPermission } from "./buff-permission";
import { RENEW_HINT, describeBuff, describeDelivery, describeSession, noticeFor } from "./popup-view";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

async function ask<T>(message: unknown): Promise<T> {
  return (await ext.runtime.sendMessage(message)) as T;
}

function render(status: StatusReply): void {
  const notice = noticeFor(status);
  $("notice").hidden = !notice;
  $("notice").textContent = notice ?? "";
  $("connected").hidden = !status.connected;
  $("disconnected").hidden = status.connected;
  if (!status.connected) return;
  const account = status.account;
  $("account").textContent = account ? `Connected to ForceBuy account ${account.personaName} (${account.steamId64})` : "Connected to ForceBuy";
  $("renew").textContent = describeDelivery("Renewal token", status.lastSent.renew, RENEW_HINT);
  $("session").textContent = describeSession(status.lastSent);
  const buff = describeBuff(status);
  $("buff").textContent = buff.text;
  $("allow-buff").hidden = !buff.allow;
}

async function refresh(): Promise<void> {
  render(await ask<StatusReply>({ type: "status" }));
}

$("send").addEventListener("click", async () => {
  const button = $<HTMLButtonElement>("send");
  button.disabled = true;
  try {
    render(await ask<StatusReply>({ type: "send-now" }));
  } finally {
    button.disabled = false;
  }
});

// The permission prompt needs the click itself, so nothing is awaited before it.
$("allow-buff").addEventListener("click", async () => {
  if (await requestBuffPermission()) render(await ask<StatusReply>({ type: "send-now" }));
  else await refresh();
});

$("disconnect").addEventListener("click", async () => {
  const tokens = $<HTMLInputElement>("delete").checked ? "delete" : "keep";
  await ask({ type: "disconnect", tokens });
  await refresh();
});

void refresh();
