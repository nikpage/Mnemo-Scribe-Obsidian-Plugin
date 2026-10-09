// [utils]

/**
 * The app's `lib/busy.ts` as the plugins run it. The app guards its page
 * against its own reloads; here the page is Obsidian's or Joplin's, and a
 * guard on it would stop the whole app from closing.
 */
export function busyUntilDone(): () => void {
  return () => {};
}
