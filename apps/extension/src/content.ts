// Content script, injected on forcebuy.net only (manifest). Logic in content-logic.ts.
import { ext } from "./browser";
import { createContentHandler } from "./content-logic";

/** Extra origins of a dev build (loopback); undefined in a release build. */
declare const __FORCEBUY_LOOPBACK__: string[] | undefined;

const manifest = ext.runtime.getManifest();
const handler = createContentHandler({
  page: window,
  origin: location.origin,
  loopback: typeof __FORCEBUY_LOOPBACK__ === "undefined" ? [] : __FORCEBUY_LOOPBACK__,
  version: manifest.version_name ?? manifest.version,
  ask: (message) => ext.runtime.sendMessage(message),
  reply: (message) => window.postMessage(message, location.origin),
});

window.addEventListener("message", (event) => void handler.onMessage(event));
handler.announce();
