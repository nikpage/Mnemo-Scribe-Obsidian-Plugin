// [utils]

import type { Http } from "../api";

/**
 * The app's `lib/http.ts` as the plugins run it: the app's screens make the
 * same requests, sent here with the device token to the Scribe this app is
 * connected to, through the app's own `Http` (Obsidian's `requestUrl`,
 * Joplin's fetch).
 */

let connection: { baseUrl: string; token: string; http: Http; wrote?: () => void } | null = null;

/** Who the screens talk to, null when this app is not connected; `wrote` hears every write, a paid press among them. */
export function connectScreens(next: typeof connection) {
  connection = next;
}

export async function request(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: unknown }> {
  if (!connection) return { ok: false, status: 401, json: { error: "Not connected to Mnemo Scribe." } };
  const headers = { ...((init?.headers as Record<string, string> | undefined) ?? {}), Authorization: `Bearer ${connection.token}` };
  const res = await connection.http({
    url: `${connection.baseUrl.replace(/\/+$/, "")}${url}`,
    method: init?.method || "GET",
    headers,
    body: typeof init?.body === "string" ? init.body : undefined,
  });
  if (init?.method && init.method !== "GET") connection.wrote?.();
  return { ok: res.status < 400, status: res.status, json: res.json ?? {} };
}
