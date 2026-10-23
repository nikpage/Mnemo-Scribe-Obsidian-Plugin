// [Librarian]

import type { SupabaseClient } from "@supabase/supabase-js";
import { LIST_COLUMNS } from "@/lib/note/list-columns";
import { decodeSegment, normalizePath, normalizeTags, splitPath } from "@/lib/note/filing";
import { findNotes } from "@/lib/note/find";
import { type Kind, type KindPassage, inAStory, kindMatch, readKinds } from "@/lib/note/kinds";
import { READ, SHELVES, type Shelf } from "@/lib/note/shelf";
import { HIDDEN } from "@/lib/note/switches";

/**
 * The notes, from the server, a page at a time.
 *
 * Every note used to come to the browser on every open, so a store's size was
 * every screen's wait. Now a list asks for the 50 it shows and the next 50 on
 * the way down; the sidebar's numbers, a note's address and as-you-type names
 * are each worked out here and sent as the answer alone.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

/** How many notes a list adds at a time. */
export const NOTES_PAGE = 50;

/** Which notes a list shows: finished ones, on one shelf (or the two search reads), narrowed by tags. */
export type NoteView = {
  shelf: Shelf | "read";
  /** Notes carrying every one. */
  tags?: string[];
  /** Notes with no tag. */
  untagged?: boolean;
  /** Notes with a passage of every one of these Kinds, holding the tags too (`kindMatch()`). */
  kinds?: Kind[];
};

/** A page of a list, and where the next one starts (null at the end). */
export type NotesPage<T> = { recordings: T[]; next: string | null };

/** Where the page after `row` starts: newest first, the id settling a tie. */
export function cursorOf(row: { recorded_at: string; id: string }): string {
  return `${row.recorded_at}~${row.id}`;
}

/** The address a page of a view is asked at; also its key in the screens' copy. */
export function pageUrl(view: NoteView, before: string | null = null): string {
  const p = new URLSearchParams({ shelf: view.shelf });
  if (view.tags?.length) p.set("tags", view.tags.join(","));
  if (view.untagged) p.set("untagged", "1");
  if (view.kinds?.length) p.set("kinds", view.kinds.join(","));
  if (before) p.set("before", before);
  return `/api/recordings?${p}`;
}

/** Whether a kept answer is a page of a list (and so may hold a note that changed). */
export function isPageUrl(key: unknown): key is string {
  return typeof key === "string" && key.startsWith("/api/recordings?shelf=");
}

/** The view and cursor an address asks for; null when it asks for none. */
export function readView(params: URLSearchParams): { view: NoteView; before: string | null } | null {
  const shelf = params.get("shelf");
  if (shelf !== "read" && !SHELVES.includes(shelf as Shelf)) return null;
  return {
    view: {
      shelf: shelf as NoteView["shelf"],
      tags: normalizeTags((params.get("tags") || "").split(",")),
      untagged: params.get("untagged") === "1",
      kinds: readKinds(params.get("kinds")),
    },
    before: params.get("before"),
  };
}

/** The date and id in a cursor, or null when it is not one this code wrote. */
function readCursor(cursor: string): { at: string; id: string } | null {
  const cut = cursor.lastIndexOf("~");
  const at = cursor.slice(0, cut);
  const id = cursor.slice(cut + 1);
  if (cut < 1 || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { at, id };
}

/** A list's row: in a tag view, whether a tag it was opened by reaches the note only through a story. */
export type ListRow = { in_story?: boolean };

/** The finished notes a view shows, before any cursor: a query to add to. */
function viewQuery(admin: Db, userId: string, view: NoteView, columns: string) {
  // A note a switch hides is on no list (`lib/note/switches.ts`).
  let q = admin.from("recordings").select(columns).eq("user_id", userId).eq("status", "done").neq(HIDDEN, true);
  q = view.shelf === "read" ? q.in("shelf", READ) : q.eq("shelf", view.shelf);
  if (view.untagged) q = q.eq("tags", "{}");
  else if (view.tags?.length) q = q.contains("tags", view.tags);
  return q;
}

/** These notes' passages, labels and topics only, by note. */
export async function passagesByNote(admin: Db, userId: string, ids: string[] | null): Promise<Map<string, (KindPassage & { recording_id: string })[]>> {
  const out = new Map<string, (KindPassage & { recording_id: string })[]>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = admin.from("passages").select("recording_id, kind, truth, words, topics, position").eq("user_id", userId);
    if (ids) q = q.in("recording_id", ids);
    const { data, error } = await q.order("recording_id").order("position").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as (KindPassage & { recording_id: string })[]) {
      out.set(row.recording_id, [...(out.get(row.recording_id) ?? []), { ...row, topics: row.topics ?? [] }]);
    }
    if (!data || data.length < PAGE || ids) return out;
  }
}

/**
 * The ids of a Kind view's page, newest first, below `before`: every note the
 * tags allow read with its passages, as a Kind lives on a passage, not a note.
 */
async function kindPageIds(admin: Db, userId: string, view: NoteView, before: string | null): Promise<{ id: string; recorded_at: string }[]> {
  type Candidate = { id: string; recorded_at: string; tags: string[] | null; journal: boolean | null };
  const notes: Candidate[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await viewQuery(admin, userId, view, "id, recorded_at, tags, journal:analysis->journal")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    notes.push(...((data ?? []) as unknown as Candidate[]));
    if (!data || data.length < 1000) break;
  }
  const passages = await passagesByNote(admin, userId, null);
  const at = before ? readCursor(before) : null;
  return notes
    .filter((n) => kindMatch({ tags: n.tags ?? [], journal: n.journal === true }, passages.get(n.id) ?? [], view.kinds ?? [], view.tags ?? []))
    .filter((n) => !at || Date.parse(n.recorded_at) < Date.parse(at.at) || (Date.parse(n.recorded_at) === Date.parse(at.at) && n.id < at.id))
    .sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at) || (a.id < b.id ? 1 : -1))
    .slice(0, NOTES_PAGE + 1);
}

/** One page of a view, newest first, starting below `before`. */
export async function notesPage<T>(admin: Db, userId: string, view: NoteView, before: string | null): Promise<NotesPage<T & ListRow>> {
  let rows: (T & ListRow & { recorded_at: string; id: string })[];
  if (view.kinds?.length) {
    const ids = await kindPageIds(admin, userId, view, before);
    const { data, error } = ids.length
      ? await admin.from("recordings").select(LIST_COLUMNS).eq("user_id", userId).in("id", ids.map((n) => n.id))
      : { data: [], error: null };
    if (error) throw new Error(error.message);
    const byId = new Map(((data ?? []) as unknown as typeof rows).map((r) => [r.id, r]));
    rows = ids.flatMap((n) => byId.get(n.id) ?? []);
  } else {
    let q = viewQuery(admin, userId, view, LIST_COLUMNS);
    const from = before ? readCursor(before) : null;
    if (from) q = q.or(`recorded_at.lt."${from.at}",and(recorded_at.eq."${from.at}",id.lt.${from.id})`);
    // One more than a page says whether there is a next one.
    const { data, error } = await q.order("recorded_at", { ascending: false }).order("id", { ascending: false }).limit(NOTES_PAGE + 1);
    if (error) throw new Error(error.message);
    rows = (data ?? []) as unknown as typeof rows;
  }
  const recordings = rows.slice(0, NOTES_PAGE);
  if (view.tags?.length && recordings.length) await markStories(admin, userId, recordings, view.tags);
  return { recordings, next: rows.length > NOTES_PAGE ? cursorOf(recordings[recordings.length - 1]) : null };
}

/**
 * A tag view's rows marked "in a story" (`inAStory()`) for any tag it was
 * opened by: one boolean a row, worked out here so the list carries no text.
 */
async function markStories(admin: Db, userId: string, rows: (ListRow & { id: string })[], tags: string[]): Promise<void> {
  const ids = rows.map((r) => r.id);
  const [passages, { data, error }] = await Promise.all([
    passagesByNote(admin, userId, ids),
    admin.from("recordings").select("id, tag_why").eq("user_id", userId).in("id", ids),
  ]);
  if (error) throw new Error(error.message);
  const why = new Map(((data ?? []) as { id: string; tag_why: Record<string, string> | null }[]).map((r) => [r.id, r.tag_why ?? {}]));
  for (const row of rows) row.in_story = tags.some((tag) => inAStory(why.get(row.id) ?? {}, passages.get(row.id) ?? [], tag));
}

/**
 * The note an address names (`/<title>.md`), as the one level it is stored
 * under; null when the address names no note. An old link into a folder
 * (`/recipes/kombucha/batch.md`) still finds the note by its name.
 */
export function noteAddress(rawSegments: string[]): string | null {
  const raw = rawSegments.map(decodeSegment);
  if (!/\.md$/i.test(raw[raw.length - 1] || "")) return null;
  return normalizePath([...raw.slice(0, -1), raw[raw.length - 1].replace(/\.md$/i, "")].join("/")) || null;
}

/** Where the note at an address is asked for; also its key in the screens' copy. */
export function noteAtUrl(address: string): string {
  return `/api/recordings?at=${encodeURIComponent(address)}`;
}

/** The finished note at an address, on any shelf, or null. */
export async function noteAt<T>(admin: Db, userId: string, address: string): Promise<T | null> {
  const here = normalizePath(address);
  if (!here) return null;
  const { data } = await admin
    .from("recordings")
    .select(LIST_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "done")
    .in("path", [...new Set([here, splitPath(here).at(-1)!])])
    .order("created_at", { ascending: false })
    .limit(1);
  return ((data ?? [])[0] as T | undefined) ?? null;
}

/** Every row of the caller's notes in these columns — a query returns at most 1,000 at a time. */
async function everyNote<T>(admin: Db, userId: string, columns: string, shelves: readonly Shelf[] = SHELVES): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("recordings")
      .select(columns)
      .eq("user_id", userId)
      .in("shelf", shelves)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

/** Notes that carry exactly these tags, and how many: the sidebar's numbers without the notes. */
export type TagSet = { tags: string[]; n: number };

/** A pinned note, as Search's shortcuts name it. */
export type PinnedNote = { id: string; path: string; label: string; recorded_at: string };

export type NoteCounts = {
  /** Finished notes in use, grouped by their tags. */
  sets: TagSet[];
  /** Finished notes on each shelf. */
  shelves: Record<Shelf, number>;
  /** Finished notes in use that are pinned, newest first. */
  pinned: PinnedNote[];
  /** Finished notes a switch hides, counted nowhere else (`lib/note/switches.ts`). */
  hidden: number;
  /** Their ids: what this device's own lists (recently opened) leave out. */
  hiddenIds: string[];
  /** Finished notes a switch keeps out of the Brain. */
  kept: number;
};

type CountRow = { id: string; tags: string[] | null; status: string; shelf: Shelf | null; pinned: boolean; path: string; label: string; recorded_at: string; hidden?: boolean; brain_off?: boolean };

/** The numbers every list and the sidebar show, without sending a note. */
export async function noteCounts(admin: Db, userId: string): Promise<NoteCounts> {
  const rows = await everyNote<CountRow>(admin, userId, "id, tags, status, shelf, pinned, path, label, recorded_at, hidden, brain_off");
  const shelves = Object.fromEntries(SHELVES.map((s) => [s, 0])) as Record<Shelf, number>;
  const sets = new Map<string, TagSet>();
  const pinned: PinnedNote[] = [];
  const hiddenIds: string[] = [];
  let kept = 0;
  for (const row of rows) {
    if (row.status !== "done") continue;
    if (row.brain_off && row.shelf !== "trash") kept++;
    if (row.hidden) {
      if (row.shelf !== "trash") hiddenIds.push(row.id);
      continue;
    }
    const shelf = SHELVES.includes(row.shelf as Shelf) ? (row.shelf as Shelf) : "normal";
    shelves[shelf]++;
    if (shelf !== "normal") continue;
    const tags = [...(row.tags || [])].sort();
    const key = tags.join("\n");
    const set = sets.get(key) ?? { tags, n: 0 };
    set.n++;
    sets.set(key, set);
    if (row.pinned) pinned.push({ id: row.id, path: row.path, label: row.label, recorded_at: row.recorded_at });
  }
  pinned.sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1));
  return { sets: [...sets.values()], shelves, pinned, hidden: hiddenIds.length, hiddenIds, kept };
}

/** The tags in use, most used first, as many as `max`. */
export function tagsByUse(sets: TagSet[], max = 30): string[] {
  const counts = new Map<string, number>();
  for (const set of sets) for (const tag of set.tags) counts.set(tag, (counts.get(tag) || 0) + set.n);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([tag]) => tag);
}

type NameRow = { id: string; label: string; recorded_at: string; path: string; tags: string[]; status: string; hidden?: boolean };

/**
 * Notes whose name or tags match what was typed (`findNotes()`), on these
 * shelves: the first `limit`, and whether more match. A note a switch hides
 * never matches.
 */
export async function nameHits(
  admin: Db,
  userId: string,
  query: string,
  shelves: Shelf[],
  limit: number
): Promise<{ results: { note: NameRow; excerpt: string }[]; more: boolean }> {
  const rows = await everyNote<NameRow>(admin, userId, "id, label, recorded_at, path, tags, status, hidden", shelves);
  const found = findNotes(rows.filter((n) => !n.hidden), query);
  return { results: found.slice(0, limit), more: found.length > limit };
}
