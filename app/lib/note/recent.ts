"use client";

// [Librarian]
/**
 * The notes opened on this device, newest first. Retrieval is mostly
 * re-retrieval, and the last few are the cheapest possible answer — no
 * query, no model, no round trip. Kept local because it is a property of the
 * device in your hand, not of the account.
 */
const KEY = "scribe-recent-notes";
const LIMIT = 8;

export interface RecentNote {
  id: string;
  path: string;
  label: string;
  openedAt: string;
}

export const NO_RECENT_NOTES: RecentNote[] = [];

// The parsed list is cached because React compares snapshots by identity:
// handing it a fresh array on every read would never settle.
let cache: RecentNote[] | null = null;

export function recentNotes(): RecentNote[] {
  if (typeof window === "undefined") return NO_RECENT_NOTES;
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    cache = Array.isArray(parsed) ? parsed : NO_RECENT_NOTES;
  } catch {
    cache = NO_RECENT_NOTES;
  }
  return cache;
}

export function rememberNote(note: { id: string; path: string; label: string }) {
  if (typeof window === "undefined") return;
  const rest = recentNotes().filter((n) => n.id !== note.id);
  const next = [{ ...note, openedAt: new Date().toISOString() }, ...rest].slice(0, LIMIT);
  localStorage.setItem(KEY, JSON.stringify(next));
  cache = next;
}
