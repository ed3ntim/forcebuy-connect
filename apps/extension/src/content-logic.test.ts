import { describe, expect, it, vi } from "vitest";
import { createContentHandler, isForceBuyOrigin } from "./content-logic";

const page = {};
function setup(origin = "https://forcebuy.net", ask = vi.fn().mockResolvedValue({ ok: true, account: { steamId64: "1", personaName: "P" } })) {
  const reply = vi.fn();
  return { handler: createContentHandler({ page, origin, version: "0.25.0", ask, reply }), ask, reply };
}

describe("content messages", () => {
  it("ignores a message from another source", async () => {
    const { handler, ask, reply } = setup();
    await handler.onMessage({ source: {}, origin: "https://forcebuy.net", data: { type: "forcebuy:pair", code: "c" } });
    expect(ask).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it("ignores a message from another origin", async () => {
    const { handler, ask } = setup();
    await handler.onMessage({ source: page, origin: "https://evil.example", data: { type: "forcebuy:pair", code: "c" } });
    expect(ask).not.toHaveBeenCalled();
  });

  it("does nothing on a page that is not forcebuy.net", async () => {
    const { handler, ask, reply } = setup("https://evil.example");
    handler.announce();
    await handler.onMessage({ source: page, origin: "https://evil.example", data: { type: "forcebuy:pair", code: "c" } });
    expect(ask).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it("passes a pair code on and answers with the result", async () => {
    const { handler, ask, reply } = setup();
    await handler.onMessage({ source: page, origin: "https://forcebuy.net", data: { type: "forcebuy:pair", code: "c" } });
    expect(ask).toHaveBeenCalledWith({ type: "pair", code: "c" });
    expect(reply).toHaveBeenCalledWith({ type: "forcebuy:pair-result", ok: true, error: undefined, account: { steamId64: "1", personaName: "P" } });
  });

  it("answers a status request without token or delivery state", async () => {
    const ask = vi.fn().mockResolvedValue({ connected: true, linkId: "l1", token: "secret", lastSent: { renew: { code: "stored" } } });
    const { handler, reply } = setup(undefined, ask);
    await handler.onMessage({ source: page, origin: "https://forcebuy.net", data: { type: "forcebuy:ext-status" } });
    expect(reply).toHaveBeenCalledWith({ type: "forcebuy:ext-status-result", present: true, version: "0.25.0", connected: true, linkId: "l1" });
    expect(JSON.stringify(reply.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(reply.mock.calls)).not.toContain("lastSent");
  });

  it("wakes the delivery", async () => {
    const { handler, ask } = setup();
    await handler.onMessage({ source: page, origin: "https://forcebuy.net", data: { type: "forcebuy:wake" } });
    expect(ask).toHaveBeenCalledWith({ type: "send-now" });
  });

  it("announces itself", () => {
    const { handler, reply } = setup();
    handler.announce();
    expect(reply).toHaveBeenCalledWith({ type: "forcebuy:ext-present", version: "0.25.0" });
  });

  it("accepts loopback only when the build lists it", () => {
    expect(isForceBuyOrigin("http://127.0.0.1:5173")).toBe(false);
    expect(isForceBuyOrigin("http://127.0.0.1:5173", ["http://127.0.0.1"])).toBe(true);
    expect(isForceBuyOrigin("http://127.0.0.1.evil.example", ["http://127.0.0.1"])).toBe(false);
  });
});
