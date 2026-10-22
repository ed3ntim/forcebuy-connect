import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackground, detectBrowser } from "./background-logic";
import type { Delivery } from "./delivery";
import type { ExtState } from "./state";

const get = vi.hoisted(() => vi.fn());
const onChanged = vi.hoisted(() => ({ addListener: vi.fn() }));
vi.mock("./browser", () => ({ ext: { cookies: { get, onChanged } } }));

import { onWatchedCookie } from "./cookie-read";

function setup(state: ExtState = { token: "tok", linkId: "l1" }) {
  const pair = vi.fn().mockResolvedValue({ ok: true, account: { steamId64: "1", personaName: "P" }, retry: false });
  const deliverAll = vi.fn().mockResolvedValue({ retry: false });
  const hello = vi.fn().mockResolvedValue(undefined);
  const delivery = { deliverAll, pair, hello, disconnect: vi.fn().mockResolvedValue({ ok: true, serverReached: true }) } as unknown as Delivery;
  const alarms = { create: vi.fn(), get: vi.fn().mockResolvedValue(undefined) };
  const background = createBackground({ delivery, readState: async () => state, alarms, version: "0.25.0", userAgent: "Chrome" });
  return { background, pair, deliverAll, hello, alarms };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("cookie changes", () => {
  const listener = () => onChanged.addListener.mock.calls.at(-1)![0] as (info: unknown) => void;

  it("only reacts to the two watched cookies and ignores removals", () => {
    const handler = vi.fn();
    onWatchedCookie(handler);
    const fire = listener();
    fire({ cookie: { name: "steamRefresh_steam", domain: "login.steampowered.com" }, removed: false });
    fire({ cookie: { name: "steamLoginSecure", domain: "steamcommunity.com" }, removed: false });
    fire({ cookie: { name: "steamRefresh_steam", domain: "login.steampowered.com" }, removed: true });
    fire({ cookie: { name: "sessionid", domain: "steamcommunity.com" }, removed: false });
    fire({ cookie: { name: "steamRefresh_steam", domain: "evil.example" }, removed: false });
    expect(handler.mock.calls).toEqual([["renew"], ["session"]]);
  });

  it("debounces by 5 seconds per kind", async () => {
    const { background, deliverAll } = setup();
    background.onCookie("renew");
    background.onCookie("renew");
    await vi.advanceTimersByTimeAsync(4000);
    expect(deliverAll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(deliverAll).toHaveBeenCalledTimes(1);
    expect(deliverAll).toHaveBeenCalledWith("changed");
  });
});

describe("messages and alarms", () => {
  it("pair calls pair with the detected browser and answers asynchronously", async () => {
    const { background, pair } = setup();
    const reply = vi.fn();
    expect(background.onMessage({ type: "pair", code: "abc" }, {}, reply)).toBe(true);
    await vi.waitFor(() => expect(reply).toHaveBeenCalled());
    expect(pair).toHaveBeenCalledWith("abc", "chrome", "0.25.0");
    expect(reply).toHaveBeenCalledWith({ ok: true, account: { steamId64: "1", personaName: "P" } });
  });

  it("status carries no token and no hash", async () => {
    const lastSent = { renew: { steamId: "1", sha256: "deadbeef", at: 5, code: "stored" } };
    const { background } = setup({ token: "tok", linkId: "l1", lastSent });
    const status = await background.status();
    expect(status.connected).toBe(true);
    const text = JSON.stringify(status);
    expect(text).not.toContain("deadbeef");
    expect(text).not.toContain("tok");
  });

  it("daily-hello says hello, delivers and keeps the alarm", async () => {
    const { background, hello, deliverAll, alarms } = setup();
    await background.onAlarm("daily-hello");
    expect(hello).toHaveBeenCalledWith("0.25.0");
    expect(deliverAll).toHaveBeenCalledWith("daily");
    await background.ensureDailyAlarm();
    expect(alarms.create).toHaveBeenCalledWith("daily-hello", { periodInMinutes: 1440 });
  });

  it("sets the retry alarm when delivery asks for it", async () => {
    const { background, deliverAll, alarms } = setup();
    deliverAll.mockResolvedValue({ retry: true });
    await background.handle({ type: "send-now" });
    expect(alarms.create).toHaveBeenCalledWith("retry-delivery", { delayInMinutes: 5 });
  });

  it("detects Edge and Firefox", () => {
    expect(detectBrowser("Mozilla/5.0 Chrome/130 Safari/537 Edg/130")).toBe("edge");
    expect(detectBrowser("Mozilla/5.0 Gecko/20100101 Firefox/130.0")).toBe("firefox");
    expect(detectBrowser("Mozilla/5.0 Chrome/130 Safari/537")).toBe("chrome");
  });
});
