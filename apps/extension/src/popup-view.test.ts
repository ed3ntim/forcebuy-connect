import { describe, expect, it } from "vitest";
import type { StatusReply } from "./background-logic";
import { describeBuff, describeSession, noticeFor } from "./popup-view";

const at = Date.parse("2026-10-23T10:00:13Z");

describe("describeSession", () => {
  it("hides an old session note while the renewal token is in use", () => {
    for (const code of ["stored", "unchanged"]) {
      expect(describeSession({ renew: { steamId: "1", at, code }, session: { steamId: "", at, code: "missing" } })).toBe(
        "Session: not needed, the renewal token is in use",
      );
    }
  });

  it("shows the session note when the token is missing or refused", () => {
    expect(describeSession({ renew: { steamId: "", at, code: "missing" }, session: { steamId: "", at, code: "missing" } })).toContain(
      "not found in this browser",
    );
    expect(describeSession({ renew: { steamId: "1", at, code: "renew_token_rejected" }, session: undefined })).toBe("Session: not sent yet");
  });
});

describe("describeBuff", () => {
  const status = (over: Partial<StatusReply>): StatusReply => ({
    connected: true,
    linkId: "l1",
    account: null,
    version: "1",
    lastSent: {},
    updateNeeded: false,
    buffWanted: true,
    buffPermission: true,
    ...over,
  });

  it("says it is off, without a button, while ForceBuy has it off", () => {
    expect(describeBuff(status({ buffWanted: false, buffPermission: false }))).toEqual({
      text: "Buff163: off (turn it on in ForceBuy settings)",
      allow: false,
    });
  });

  it("offers the button when it is wanted but the browser has not allowed the site", () => {
    const line = describeBuff(status({ buffPermission: false }));
    expect(line.allow).toBe(true);
    expect(line.text).toContain("has not allowed buff.163.com");
  });

  it("says the cookie is not in this browser", () => {
    expect(describeBuff(status({ lastSent: { buff: { steamId: "", at, code: "missing" } } }))).toEqual({
      text: "Buff163: not found in this browser - sign in at buff.163.com",
      allow: false,
    });
  });

  it("says nothing was sent yet, or when it was", () => {
    expect(describeBuff(status({})).text).toBe("Buff163: not sent yet");
    const sent = describeBuff(status({ lastSent: { buff: { steamId: "", at, code: "stored" } } }));
    expect(sent.text).toMatch(/^Buff163: sent .* \(stored\)$/);
    expect(sent.allow).toBe(false);
  });

  it("raises the consent notice for a Buff163 note too", () => {
    expect(noticeFor(status({ lastSent: { buff: { steamId: "", at, code: "consent_outdated" } } }))).toBe(
      "Open ForceBuy to confirm the new notice",
    );
  });
});
