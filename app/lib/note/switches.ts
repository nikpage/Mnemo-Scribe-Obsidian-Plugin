// [Librarian]

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A tag's or client's two switches (`tag_vocabulary`, `subjects`, `089`),
 * saved, the same on every device:
 *
 * - `hidden`: its notes leave every list, search, Home and the Web
 *   (`recordings.hidden`);
 * - `brain_off`: no Brain call reads its notes (`recordings.brain_off`).
 *
 * A note is out wherever any of its tags or its client puts it out. The
 * database works both columns out itself, on a note's tags or client changing
 * and on a switch changing; the app only reads them.
 *
 * A Brain output follows the notes it drew on (`outputOut()`): out of sight
 * when it shows a hidden note, set aside when it read an excluded one.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export type Switches = { hidden: boolean; brainOff: boolean };

/** The column that keeps a note out of what the person sees. */
export const HIDDEN = "hidden";
/** The column that keeps a note out of every Brain call. */
export const BRAIN_OFF = "brain_off";

/**
 * A note's two switches from its tags' and its client's, by tag name and
 * client id: the same rule the database keeps (`note_switches`).
 */
export function flagsOf(
  tags: Record<string, Switches>,
  clients: Record<string, Switches>,
  note: { tags?: string[] | null; subjectId?: string | null }
): Switches {
  const on = [...(note.tags || []).map((tag) => tags[tag]), note.subjectId ? clients[note.subjectId] : undefined].filter((s): s is Switches => !!s);
  return { hidden: on.some((s) => s.hidden), brainOff: on.some((s) => s.brainOff) };
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

/** Where the switches are set: the lists' notice opens it. */
export const SWITCHES_PAGE = "/tags";
