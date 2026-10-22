/**
 * The page side of the coupling. Only messages the page window itself posted
 * from the ForceBuy origin are accepted; replies go back to that origin only.
 */
const PROD_ORIGIN = "https://forcebuy.net";

/** `loopback` lists extra origin prefixes of a dev build (any port); empty in a release build. */
export function isForceBuyOrigin(origin: string, loopback: readonly string[] = []): boolean {
  return origin === PROD_ORIGIN || loopback.some((prefix) => origin === prefix || origin.startsWith(`${prefix}:`));
}

export type PageEvent = { source: unknown; origin: string; data: unknown };

export type ContentDeps = {
  page: unknown;
  origin: string;
  loopback?: readonly string[];
  version: string;
  /** Sends one message to the background and resolves with its reply. */
  ask: (message: unknown) => Promise<unknown>;
  reply: (message: unknown) => void;
};

export function createContentHandler(deps: ContentDeps) {
  const trusted = isForceBuyOrigin(deps.origin, deps.loopback);

  async function onMessage(event: PageEvent): Promise<void> {
    if (!trusted || event.source !== deps.page || event.origin !== deps.origin) return;
    const data = event.data as { type?: unknown; code?: unknown } | null;
    if (!data || typeof data !== "object") return;

    if (data.type === "forcebuy:pair" && typeof data.code === "string") {
      try {
        const result = (await deps.ask({ type: "pair", code: data.code })) as { ok?: boolean; error?: string; account?: unknown };
        deps.reply({ type: "forcebuy:pair-result", ok: result.ok === true, error: result.error, account: result.account });
      } catch {
        deps.reply({ type: "forcebuy:pair-result", ok: false, error: "failed" });
      }
    } else if (data.type === "forcebuy:ext-status") {
      const status = (await deps.ask({ type: "status" }).catch(() => null)) as { connected?: boolean; linkId?: string | null } | null;
      // Presence, version and the link id only: no token, no delivery state.
      deps.reply({
        type: "forcebuy:ext-status-result",
        present: true,
        version: deps.version,
        connected: status?.connected === true,
        linkId: status?.linkId ?? null,
      });
    } else if (data.type === "forcebuy:wake") {
      await deps.ask({ type: "send-now" }).catch(() => null);
    }
  }

  function announce(): void {
    if (trusted) deps.reply({ type: "forcebuy:ext-present", version: deps.version });
  }

  return { onMessage, announce };
}
