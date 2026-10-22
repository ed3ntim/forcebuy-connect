import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
vi.mock("./browser", () => ({ ext: { cookies: { get } } }));

import { isWatchedCookie, readRenewToken, readSession } from "./cookie-read";

beforeEach(() => { get.mockReset(); });

describe("cookie reads", () => {
  it("reads the renewal token from login.steampowered.com only", async () => {
    get.mockResolvedValue({ value: "abc" });
    expect(await readRenewToken()).toEqual({ value: "abc" });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith({ url: "https://login.steampowered.com/", name: "steamRefresh_steam" });
  });

  it("reads the session from steamcommunity.com only", async () => {
    get.mockResolvedValue({ value: "xyz" });
    expect(await readSession()).toEqual({ value: "xyz" });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith({ url: "https://steamcommunity.com/", name: "steamLoginSecure" });
  });

  it("reports a missing cookie", async () => {
    get.mockResolvedValue(null);
    expect(await readRenewToken()).toEqual({ missing: "not_found" });
  });

  it("reports an empty value", async () => {
    get.mockResolvedValue({ value: "" });
    expect(await readSession()).toEqual({ missing: "empty" });
  });

  it("reports an error", async () => {
    get.mockRejectedValue(new Error("boom"));
    expect(await readRenewToken()).toEqual({ missing: "error" });
  });
});

describe("isWatchedCookie", () => {
  it("accepts the two pairs", () => {
    expect(isWatchedCookie({ name: "steamRefresh_steam", domain: "login.steampowered.com" })).toBe(true);
    expect(isWatchedCookie({ name: "steamLoginSecure", domain: "steamcommunity.com" })).toBe(true);
  });

  it("rejects other names and domains", () => {
    expect(isWatchedCookie({ name: "sessionid", domain: "steamcommunity.com" })).toBe(false);
    expect(isWatchedCookie({ name: "steamLoginSecure", domain: "login.steampowered.com" })).toBe(false);
    expect(isWatchedCookie({ name: "steamLoginSecure", domain: ".steamcommunity.com" })).toBe(false);
    expect(isWatchedCookie({ name: "steamLoginSecure", domain: "store.steampowered.com" })).toBe(false);
    expect(isWatchedCookie({ name: "steamRefresh_steam", domain: ".login.steampowered.com" })).toBe(false);
  });
});
