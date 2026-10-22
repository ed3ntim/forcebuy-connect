// Service worker (Chrome/Edge) / event page (Firefox). Listeners are registered synchronously at load.
import { ext } from "./browser";
import { createBackground } from "./background-logic";
import { onWatchedCookie, readRenewToken, readSession } from "./cookie-read";
import { createDelivery } from "./delivery";
import { post } from "./forcebuy-api";
import { sha256Hex } from "./hash";
import { clearState, readState, writeState } from "./state";

const manifest = ext.runtime.getManifest();
const delivery = createDelivery({
  readRenewToken,
  readSession,
  post,
  readState,
  writeState,
  clearState,
  now: () => Date.now(),
  sha256Hex,
});
const background = createBackground({
  delivery,
  readState,
  alarms: {
    create: (name, info) => ext.alarms.create(name, info as chrome.alarms.AlarmCreateInfo),
    get: (name) => ext.alarms.get(name),
  },
  version: manifest.version_name ?? manifest.version,
  userAgent: navigator.userAgent,
});

onWatchedCookie(background.onCookie);
ext.alarms.onAlarm.addListener((alarm) => void background.onAlarm(alarm.name));
ext.runtime.onInstalled.addListener(() => void background.ensureDailyAlarm());
ext.runtime.onStartup.addListener(() => void background.ensureDailyAlarm());
ext.runtime.onMessage.addListener(background.onMessage);
