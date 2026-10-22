// [Librarian]

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeTags } from "@/lib/note/filing";

/**
 * Groups: the person's own named sets of notes (`note_groups`, `088`). A group
 * catches every note carrying any of its tags or belonging to any of its
 * clients, and holds two saved switches, the same on every device:
 *
 * - `shown`: off, its notes leave every list, search, Home and the Web
 *   (`recordings.hidden`);
 * - `brain`: "exclude", no Brain call reads them (`recordings.brain_off`).
 *
 * A note in several groups is out wherever any of them puts it out. The
 * database works both columns out itself, on a note's tags or client changing
 * and on any group changing; the app only reads them.
 *
 * A Brain output follows the notes it drew on (`outputOut()`): out of sight
 * when it shows a hidden note, set aside when it read an excluded one.
 *
 * "Only these groups" is never saved: it narrows one search or Brain run
 * (`Narrow.groups`, `SearchFilters.groups`), and Exclude still wins inside it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export const BRAIN = ["include", "exclude"] as const;
export type Brain = (typeof BRAIN)[number];

export interface Group {
  id: string;
  name: string;
  tags: string[];
  subjectIds: string[];
  shown: boolean;
  brain: Brain;
}

/** The column that keeps a note out of what the person sees. */
export const HIDDEN = "hidden";
/** The column that keeps a note out of every Brain call. */
export const BRAIN_OFF = "brain_off";

/** Whether a group catches a note: any of its tags, or its client. */
export function catches(group: Pick<Group, "tags" | "subjectIds">, note: { tags?: string[] | null; subjectId?: string | null }): boolean {
  return (note.tags || []).some((tag) => group.tags.includes(tag)) || (!!note.subjectId && group.subjectIds.includes(note.subjectId));
}

/** A note's two switches from every group it is in: the same rule the database keeps (`note_group_flags`). */
export function flagsOf(groups: Group[], note: { tags?: string[] | null; subjectId?: string | null }): { hidden: boolean; brainOff: boolean } {
  const mine = groups.filter((g) => catches(g, note));
  return { hidden: mine.some((g) => !g.shown), brainOff: mine.some((g) => g.brain === "exclude") };
}

/**
 * Whether a note is in a run narrowed to some groups: in at least one of them.
 * No group named keeps every note.
 */
export function inGroups(groups: Group[], only: string[] | undefined, note: { tags?: string[] | null; subjectId?: string | null }): boolean {
  if (!only?.length) return true;
  return groups.some((g) => only.includes(g.id) && catches(g, note));
}

/** The ids of the caller's notes in at least one of these groups. */
export async function groupNoteIds(admin: Db, userId: string, only: string[]): Promise<Set<string>> {
  const groups = (await loadGroups(admin, userId)).filter((g) => only.includes(g.id));
  const ids = new Set<string>();
  if (!groups.length) return ids;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("recordings").select("id, tags, subject_id").eq("user_id", userId).order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const n of (data ?? []) as { id: string; tags: string[] | null; subject_id: string | null }[]) {
      if (groups.some((g) => catches(g, { tags: n.tags, subjectId: n.subject_id }))) ids.add(n.id);
    }
    if (!data || data.length < 1000) return ids;
  }
}

type Row = { id: string; name: string; tags: string[] | null; subject_ids: string[] | null; shown: boolean; brain: string };

const COLUMNS = "id, name, tags, subject_ids, shown, brain";

export function groupOf(row: Row): Group {
  return {
    id: row.id,
    name: row.name,
    tags: normalizeTags(row.tags || []),
    subjectIds: [...new Set(row.subject_ids || [])],
    shown: row.shown !== false,
    brain: row.brain === "exclude" ? "exclude" : "include",
  };
}

/** The caller's groups, by name. */
export async function loadGroups(admin: Db, userId: string): Promise<Group[]> {
  const { data, error } = await admin.from("note_groups").select(COLUMNS).eq("user_id", userId).order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(groupOf);
}

/**
 * The ids of the caller's notes that are out: hidden, and kept out of the
 * Brain. Small sets; what the Brain outputs are checked against.
 */
export async function outNotes(admin: Db, userId: string): Promise<{ hidden: Set<string>; brainOff: Set<string> }> {
  const [hidden, brainOff] = await Promise.all(
    [HIDDEN, BRAIN_OFF].map(async (column) => {
      const ids = new Set<string>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await admin.from("recordings").select(`id, ${column}`).eq("user_id", userId).eq(column, true).order("id").range(from, from + 999);
        if (error) throw new Error(error.message);
        for (const row of (data ?? []) as unknown as Record<string, unknown>[]) if (row[column] === true) ids.add(row.id as string);
        if (!data || data.length < 1000) break;
      }
      return ids;
    })
  );
  return { hidden, brainOff };
}

/**
 * What a Brain output drew on: the notes it shows (quotes, cites, its
 * evidence) and the notes it read (every note sent to its call). An output
 * written before it kept what it read counts what it shows.
 */
export type Drew = { shows: string[]; read?: string[] | null };

/**
 * Whether an output is out: it shows a hidden note (so it would show what the
 * person put out of sight), or it read a note kept out of the Brain (so it is
 * set aside until written again without it).
 */
export function outputOut(drew: Drew, out: { hidden: Set<string>; brainOff: Set<string> }): false | "hidden" | "set-aside" {
  if (drew.shows.some((id) => out.hidden.has(id))) return "hidden";
  if ([...(drew.read ?? []), ...drew.shows].some((id) => out.brainOff.has(id))) return "set-aside";
  return false;
}

/** The Groups screen's own address and the one the lists' notice opens. */
export const GROUPS_URL = "/api/groups";
export const GROUPS_PAGE = "/settings/groups";
