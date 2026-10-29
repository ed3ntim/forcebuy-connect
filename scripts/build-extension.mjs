#!/usr/bin/env node
/**
 * Builds the browser extension "ForceBuy Connect" (docs/plans/browser-extension.md 4).
 *
 * Per target one folder that Chrome/Edge load unpacked ("Load unpacked") or
 * Firefox loads temporarily, plus a zip of it. The bundle is tiny on purpose:
 * an extension that reads a sign-in cookie has to be readable in one sitting,
 * so the build refuses anything that pulls in server code, Node built-ins or
 * more than 50 KB of script.
 *
 * Usage:
 *   node scripts/build-extension.mjs                       # chrome and firefox
 *   node scripts/build-extension.mjs --target chrome|firefox|all
 *   node scripts/build-extension.mjs --dev [--base <port>] # also talks to http://127.0.0.1:<port>
 *
 * Output: dist/extension/<target>/ and dist/extension/forcebuy-extension-<target>.zip;
 * a --dev build goes to dist/extension-dev/ so it never lands where build-web picks up the zip.
 * A --dev build must never be published: it carries loopback rights.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(ROOT, "apps", "extension");
const OUT_ROOT = join(ROOT, "dist", process.argv.includes("--dev") ? "extension-dev" : "extension");
const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

const DEV = args.includes("--dev");
const targetArg = option("--target") ?? "all";
if (!["chrome", "firefox", "all"].includes(targetArg)) {
  process.stderr.write(`unknown --target ${targetArg} (chrome, firefox or all)\n`);
  process.exit(1);
}
const TARGETS = targetArg === "all" ? ["chrome", "firefox"] : [targetArg];
// The API port of the local web variant (FORCEBUY_API_PORT, default 8787).
const DEV_PORT = Number(option("--base") ?? process.env.FORCEBUY_API_PORT ?? 8787);

const MAX_BYTES = 50 * 1024;
// Inputs that must never end up in the extension.
const FORBIDDEN_INPUT = /(^|\/)node_modules\/cheerio\/|(^|\/)packages\/(steam|db)\/|(^|\/)apps\/api\//;

const pkg = JSON.parse(readFileSync(join(EXT, "package.json"), "utf8"));
const VERSION_NAME = pkg.version;
// Browsers accept only dotted numbers: "0.25.0-dev" becomes "0.25.0".
const VERSION = VERSION_NAME.replace(/[-+].*$/, "");

function log(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`\n  EXTENSION BUILD FAILED: ${message}\n\n`);
  process.exit(1);
}

function run(command, argv, cwd = ROOT) {
  // No shell: both tools are called by name or full path, and file names stay arguments.
  return execFileSync(command, argv, { cwd, stdio: "inherit" });
}

if (DEV && !(Number.isInteger(DEV_PORT) && DEV_PORT > 0 && DEV_PORT < 65536)) fail(`--base is not a port: ${DEV_PORT}`);

function manifestFor(target) {
  const manifest = JSON.parse(readFileSync(join(EXT, "manifest.base.json"), "utf8"));
  manifest.version = VERSION;
  manifest.version_name = VERSION_NAME;
  if (DEV) {
    const loopback = ["http://127.0.0.1/*", "http://localhost/*"];
    manifest.host_permissions.push(...loopback);
    manifest.content_scripts[0].matches.push(...loopback);
  }
  if (target === "chrome") {
    manifest.background = { service_worker: "background.js", type: "module" };
  } else {
    manifest.background = { scripts: ["background.js"] };
    // Firefox knows no version_name and warns about it on addons.mozilla.org.
    delete manifest.version_name;
    // AMO requires data_collection_permissions for every new extension since
    // 2025-11-03: the sign-in cookies are authentication info sent to forcebuy.net.
    // Firefox asks for that consent itself from 140 on, hence the minimum.
    manifest.browser_specific_settings = {
      gecko: {
        id: "connect@forcebuy.net",
        strict_min_version: "140.0",
        data_collection_permissions: { required: ["authenticationInfo"] },
      },
    };
  }
  return manifest;
}

/** Fails on forbidden inputs and Node imports; returns the JS bytes written. */
function checkMetafile(metafile, target) {
  for (const input of Object.keys(metafile.inputs)) {
    if (FORBIDDEN_INPUT.test(input)) fail(`${target}: forbidden input in the bundle: ${input}`);
  }
  let total = 0;
  for (const [file, output] of Object.entries(metafile.outputs)) {
    for (const imported of output.imports) {
      if (imported.path.startsWith("node:")) fail(`${target}: ${file} imports ${imported.path}`);
    }
    if (file.endsWith(".js")) total += output.bytes;
  }
  if (total > MAX_BYTES) fail(`${target}: scripts are ${total} bytes, the limit is ${MAX_BYTES}`);
  return total;
}

log(`ForceBuy extension ${VERSION_NAME} (manifest ${VERSION})${DEV ? ` - DEV build, base http://127.0.0.1:${DEV_PORT}` : ""}`);

for (const target of TARGETS) {
  const out = join(OUT_ROOT, target);
  const zip = join(OUT_ROOT, `forcebuy-extension-${target}.zip`);
  log(`\n${target}:`);

  try {
    rmSync(out, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    rmSync(zip, { force: true });
  } catch (error) {
    fail(`could not clear ${out}: ${error.code ?? error.message}`);
  }
  mkdirSync(out, { recursive: true });

  // background is a module worker in Chrome; content and popup are classic scripts.
  // absWorkingDir is fixed, so the bundle is the same byte for byte from any folder
  // (pnpm --filter runs in apps/extension, the public mirror from its root): esbuild
  // names the inputs in its path comments relative to it.
  const common = {
    bundle: true,
    platform: "browser",
    target: "es2022",
    logLevel: "warning",
    metafile: true,
    legalComments: "none",
    absWorkingDir: ROOT,
  };
  const define = DEV
    ? {
        __FORCEBUY_BASE__: JSON.stringify(`http://127.0.0.1:${DEV_PORT}`),
        // Page origins the content script trusts besides forcebuy.net (any port).
        __FORCEBUY_LOOPBACK__: JSON.stringify(["http://127.0.0.1", "http://localhost"]),
      }
    : {};
  const results = [
    await build({
      ...common,
      entryPoints: [join(EXT, "src", "background.ts")],
      outfile: join(out, "background.js"),
      format: "esm",
      define,
    }),
    await build({
      ...common,
      entryPoints: [join(EXT, "src", "content.ts"), join(EXT, "src", "popup.ts")],
      outdir: out,
      format: "iife",
      define,
    }),
  ];

  let total = 0;
  for (const result of results) total += checkMetafile(result.metafile, target);

  cpSync(join(EXT, "src", "popup.html"), join(out, "popup.html"));
  cpSync(join(EXT, "icons"), join(out, "icons"), { recursive: true });
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifestFor(target), null, 2) + "\n");

  for (const required of ["manifest.json", "background.js", "content.js", "popup.js", "popup.html", "icons/48.png"]) {
    if (!existsSync(join(out, required))) fail(`${target}: ${required} is missing from the build`);
  }
  log(`  scripts: ${total} bytes of ${MAX_BYTES}`);

  if (process.platform === "win32") {
    // bsdtar ships with Windows and writes forward slashes; Compress-Archive in
    // Windows PowerShell 5.1 writes "icons\16.png", which other unzip tools take
    // as a file name. Full path: a stray tar.exe on PATH could be GNU tar.
    const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    rmSync(zip, { force: true });
    run(tar, ["-a", "-c", "-f", zip, ...readdirSync(out)], out);
  } else {
    run("zip", ["-rq", zip, "."], out);
  }
  log(`  ${out}`);
  log(`  ${zip} (${(statSync(zip).size / 1024).toFixed(1)} KB)`);
}

log("\nDone.");
