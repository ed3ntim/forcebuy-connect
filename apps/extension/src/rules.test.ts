import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Source rules of the extension (CLAUDE.md): cookies are read in one file, the
 * network is touched in one file, nothing is written to a cookie.
 */
const dir = fileURLToPath(new URL(".", import.meta.url));

const files = readdirSync(dir)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .map((name) => ({ name, lines: readFileSync(join(dir, name), "utf8").split(/\r?\n/) }));

/** Code lines only, comments skipped. */
function codeLines(file: { lines: string[] }): string[] {
  return file.lines.filter((line) => {
    const t = line.trim();
    return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
  });
}

function filesMatching(pattern: RegExp): string[] {
  return files.filter((file) => codeLines(file).some((line) => pattern.test(line))).map((file) => file.name);
}

describe("extension source rules", () => {
  it("reads the sources", () => {
    expect(files.map((file) => file.name)).toContain("cookie-read.ts");
    expect(files.map((file) => file.name)).toContain("forcebuy-api.ts");
  });

  it("touches cookies only in cookie-read.ts", () => {
    expect(filesMatching(/\bcookies\.\w/)).toEqual(["cookie-read.ts"]);
  });

  it("touches the permissions API only in buff-permission.ts", () => {
    expect(filesMatching(/\bpermissions\.\w/)).toEqual(["buff-permission.ts"]);
  });

  it("never sets, removes or lists cookies", () => {
    expect(filesMatching(/\bcookies\.(set|remove|getAll|getAllCookieStores)\b/)).toEqual([]);
  });

  it("calls fetch only in forcebuy-api.ts", () => {
    expect(filesMatching(/(^|[^\w.])fetch\(/)).toEqual(["forcebuy-api.ts"]);
  });

  it("uses no other transport", () => {
    expect(filesMatching(/XMLHttpRequest|WebSocket|sendBeacon/)).toEqual([]);
  });

  it("fixes the base to https://forcebuy.net", () => {
    const api = files.find((file) => file.name === "forcebuy-api.ts")!;
    const urls = api.lines.join("\n").match(/https?:\/\/[^\s"'`]+/g) ?? [];
    expect(urls).toEqual(["https://forcebuy.net"]);
  });

  describe("manifest", () => {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../manifest.base.json", import.meta.url)), "utf8")) as {
      permissions: string[];
      host_permissions: string[];
      optional_host_permissions?: string[];
      content_scripts: Array<{ matches: string[] }>;
      externally_connectable?: unknown;
    };

    it("asks for exactly the planned permissions", () => {
      expect(manifest.permissions).toEqual(["cookies", "storage", "alarms"]);
      expect(manifest.host_permissions).toEqual([
        "https://login.steampowered.com/*",
        "https://steamcommunity.com/*",
        "https://forcebuy.net/*",
      ]);
    });

    // A required new host would switch existing installations off until the user accepts it.
    it("asks for buff.163.com only as an optional host", () => {
      expect(manifest.optional_host_permissions).toEqual(["https://buff.163.com/*"]);
      expect(manifest.host_permissions.join(" ")).not.toContain("163.com");
      expect(manifest.permissions).not.toContain("permissions");
    });

    it("asks for none of the broad permissions", () => {
      const text = JSON.stringify(manifest);
      for (const banned of ["tabs", "scripting", "webRequest", "activeTab", "<all_urls>"]) {
        expect(text).not.toContain(JSON.stringify(banned));
      }
      expect(manifest.externally_connectable).toBeUndefined();
    });

    it("injects only into forcebuy.net", () => {
      expect(manifest.content_scripts.map((script) => script.matches)).toEqual([["https://forcebuy.net/*"]]);
    });
  });
});
