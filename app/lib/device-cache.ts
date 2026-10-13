// [utils]

import { openDB } from "idb";
import type { State } from "swr";

/**
 * This device's copy of what the screens last read from the server.
 *
 * Every load of the app started with nothing in hand, so each screen drew
 * in pieces as its answers came back: summaries under the notes, related
 * notes above a note's body, groups in the sidebar. The answers are now kept
 * here, read back before the app draws, and the screens draw whole from
 * them at once; the server is still asked, behind, and its answer replaces
 * the copy. One copy per account, wiped on sign-out (`forgetPages()`).
 */

const PREFIX = "scribe-kept-";
const STORE = "answers";
/** The newest answers kept; a note's text is the largest, and few are reopened. */
export const KEEP_MAX = 300;
const SAVE_AFTER_MS = 500;

type Kept = { data: unknown; at: number };

/**
 * Whether an answer is worth keeping. A note and the server's lists are;
 * searches are not (many, large, typed once), nor anything that expires
 * (signed audio links) or belongs to signing in.
 */
export function keepAnswer(key: string): boolean {
  if (key.startsWith('@"note"')) return true;
  if (!key.startsWith("/api/")) return false;
  return !/^\/api\/(auth|notes\/search|recordings\/audio)\b/.test(key) && !/[?&]q=/.test(key);
}

/** The newest `max` of the kept answers, and the keys of the rest. */
export function newest(rows: [string, Kept][], max = KEEP_MAX): { keep: [string, Kept][]; drop: string[] } {
  const sorted = [...rows].sort((a, b) => b[1].at - a[1].at);
  return { keep: sorted.slice(0, max), drop: sorted.slice(max).map(([key]) => key) };
}

const open = (userId: string) =>
  openDB(PREFIX + userId, 1, {
    upgrade(db) {
      db.createObjectStore(STORE);
    },
  });

/** The answers this device kept for this account. Empty when it kept none or cannot. */
export async function readKept(userId: string): Promise<[string, unknown][]> {
  try {
    const db = await open(userId);
    const tx = db.transaction(STORE, "readwrite");
    const [keys, values] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()]);
    const { keep, drop } = newest(keys.map((key, i) => [String(key), values[i] as Kept]));
    await Promise.all(drop.map((key) => tx.store.delete(key)));
    await tx.done;
    db.close();
    return keep.map(([key, row]) => [key, row.data]);
  } catch {
    return [];
  }
}

/**
 * SWR's cache, started from the kept answers. Every new answer worth keeping
 * is written back shortly after it arrives; the screens never wait on that.
 */
export function keptCache(userId: string, kept: [string, unknown][]): Map<string, State> {
  const cache = new Map<string, State>(kept.map(([key, data]) => [key, { data }]));
  const dirty = new Map<string, unknown>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function save() {
    timer = null;
    const rows = [...dirty];
    dirty.clear();
    try {
      const db = await open(userId);
      const tx = db.transaction(STORE, "readwrite");
      const at = Date.now();
      await Promise.all(
        rows.map(([key, data]) => (data === undefined ? tx.store.delete(key) : tx.store.put({ data, at } satisfies Kept, key)))
      );
      await tx.done;
      db.close();
    } catch {
      // Not kept this time; the screen already has it.
    }
  }

  function mark(key: string, data: unknown) {
    if (!keepAnswer(key)) return;
    dirty.set(key, data);
    timer ??= setTimeout(save, SAVE_AFTER_MS);
  }

  const set = cache.set.bind(cache);
  const remove = cache.delete.bind(cache);
  cache.set = (key, state) => {
    if (state?.data !== cache.get(key)?.data) mark(key, state?.data);
    return set(key, state);
  };
  cache.delete = (key) => {
    mark(key, undefined);
    return remove(key);
  };
  return cache;
}

/** Forgets every account's kept answers: on sign-out, so the next person sees none of it. */
export async function forgetKept(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const all = await indexedDB.databases();
    await Promise.all(
      all
        .filter((db) => db.name?.startsWith(PREFIX))
        .map(
          (db) =>
            new Promise<void>((done) => {
              const req = indexedDB.deleteDatabase(db.name!);
              req.onsuccess = req.onerror = req.onblocked = () => done();
            })
        )
    );
  } catch {
    // Nothing kept, or nothing this browser can list.
  }
}
