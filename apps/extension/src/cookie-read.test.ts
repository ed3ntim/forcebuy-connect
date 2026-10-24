import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
vi.mock("./browser", () => ({ ext: { cookies: { get } } }));

import { isWatchedCookie, readBuffSession, readRenewToken, readSession, watchedKind } from "./cookie-read";

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

  it("reads the Buff163 session, and only that one, from buff.163.com", async () => {
    get.mockResolvedValue({ value: "1-buff" });
    expect(await readBuffSession()).toEqual({ value: "1-buff" });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith({ url: "https://buff.163.com/", name: "session" });
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

  it("accepts the Buff163 session, by exact name and domain", () => {
    expect(isWatchedCookie({ name: "session", domain: "buff.163.com" })).toBe(true);
    expect(watchedKind({ name: "session", domain: "buff.163.com" })).toBe("buff");
  });

  it("does not take a cookie named session from any other site, nor another Buff cookie", () => {
    expect(isWatchedCookie({ name: "session", domain: "steamcommunity.com" })).toBe(false);
    expect(isWatchedCookie({ name: "session", domain: "login.steampowered.com" })).toBe(false);
    expect(isWatchedCookie({ name: "session", domain: ".163.com" })).toBe(false);
    expect(isWatchedCookie({ name: "session", domain: "buff.163.com.evil.example" })).toBe(false);
    expect(isWatchedCookie({ name: "csrf_token", domain: "buff.163.com" })).toBe(false);
    expect(isWatchedCookie({ name: "steamLoginSecure", domain: "buff.163.com" })).toBe(false);
  });

  it("rejects other names and domains", () => {
    expect(isWatchedCookie({ name: "sessionid", domain: "steamcommunity.com" })).toBe(false);
    expect(isWatchedCookie({ name: "steamLoginSecure", domain: "login.steampowered.com" })).toBe(false);
    expect(isWatchedCookie({ name: "steamLoginSecure", domain: ".steamcommunity.com" })).toBe(false);
    expect(isWatchedCookie({ name: "steamLoginSecure", domain: "store.steampowered.com" })).toBe(false);
    expect(isWatchedCookie({ name: "steamRefresh_steam", domain: ".login.steampowered.com" })).toBe(false);
  });
});
