// [utils]

import { forgetKept } from "@/lib/device-cache";

/**
 * Which screens open from the phone's own copy.
 *
 * Every open used to wait for the server to draw the page, and a server
 * waking up took most of half a minute. A screen this device has shown
 * before now opens at once from the copy the offline helper (`sw.ts`) kept,
 * and a fresh one is fetched behind it for next time; the notes on it are
 * refreshed the moment the app runs (`useRecordings`). The rules live here,
 * apart from the helper, so a test can hold them.
 */

/** The cache the copies live in. Emptied on sign-out and on every new version. */
export const PAGES_CACHE = "pages";

/**
 * Never kept: sign-in and landing (no account yet), owner pages (behind a
 * PIN that expires — a copy would outlive it), device linking, and every
 * API answer, which is live data.
 */
const NEVER = ["/api", "/setup", "/welcome", "/invite", "/admin", "/link"];

/** A signed-in screen opened in the browser: served from the copy. */
export function isAppPage(request: Request, url: URL, sameOrigin: boolean): boolean {
  return (
    sameOrigin &&
    request.method === "GET" &&
    request.mode === "navigate" &&
    !NEVER.some((prefix) => url.pathname === prefix || url.pathname.startsWith(prefix + "/"))
  );
}

/**
 * Whether a fresh page is worth keeping. A redirect means the server sent
 * this device elsewhere — signed out, no profile — and keeping what it
 * landed on would open the wrong screen under this address next time.
 */
export function keepPage(response: Response): boolean {
  return response.ok && !response.redirected && response.type === "basic";
}

/**
 * Forgets every kept screen and the answers drawn on them
 * (`lib/device-cache.ts`): on sign-out, so the next person sees none of it.
 */
export async function forgetPages(): Promise<void> {
  await forgetKept();
  if (typeof caches === "undefined") return;
  await caches.delete(PAGES_CACHE).catch(() => false);
}
