import { describe, expect, it } from "vitest";
import { describeSession } from "./popup-view";

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
