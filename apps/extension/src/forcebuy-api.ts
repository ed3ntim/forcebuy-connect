/**
 * The only file that calls the network. The base is fixed; a dev build may swap
 * it through a build constant, there is no runtime option.
 */
declare const __FORCEBUY_BASE__: string | undefined;

const BASE: string = typeof __FORCEBUY_BASE__ === "string" ? __FORCEBUY_BASE__ : "https://forcebuy.net";

export type ApiPath =
  | "/api/ext/pair"
  | "/api/ext/hello"
  | "/api/ext/steam-renew"
  | "/api/ext/steam-session"
  | "/api/ext/buff-session"
  | "/api/ext/disconnect";

export async function post<T>(path: ApiPath, body: unknown, token?: string): Promise<{ status: number; data: T | null }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    credentials: "omit",
    body: JSON.stringify(body),
  });
  let data: T | null;
  try {
    data = (await response.json()) as T;
  } catch {
    data = null;
  }
  return { status: response.status, data };
}
