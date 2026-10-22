import { afterEach, describe, expect, it, vi } from "vitest";
import { post } from "./forcebuy-api";

afterEach(() => vi.unstubAllGlobals());

function stub(response: Response) {
  const fake = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fake);
  return fake;
}

describe("post", () => {
  it("sends a JSON POST to forcebuy.net without credentials or token", async () => {
    const fake = stub(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const result = await post<{ ok: boolean }>("/api/ext/hello", { a: 1 });
    expect(result).toEqual({ status: 200, data: { ok: true } });
    const [url, init] = fake.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://forcebuy.net/api/ext/hello");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ a: 1 });
  });

  it("adds the bearer token only when given", async () => {
    const fake = stub(new Response("{}", { status: 200 }));
    await post("/api/ext/steam-renew", {}, "tok");
    const [, init] = fake.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer tok" });
  });

  it("returns null data when the body is not JSON", async () => {
    stub(new Response("nope", { status: 502 }));
    expect(await post("/api/ext/pair", {})).toEqual({ status: 502, data: null });
  });
});
