// [Guru]

import type { SupabaseClient } from "@supabase/supabase-js";
import { noteName } from "@/lib/note/filing";
import { READ } from "@/lib/note/shelf";

/**
 * To-dos are a note's action items. The items stay where the model wrote
 * them (`analysis.actionItems`); what is ticked off is `recordings.actions_done`,
 * one entry per item, keyed by its text. A to-do can name the note it led to,
 * which `buildNote()` writes beside the ticked line.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

export type DoneItem = { text: string; at: string; result: string | null; title: string | null };

export type Todo = { noteId: string; title: string; text: string; recordedAt: string };

/** How many notes back the open to-dos are looked for: newest first. */
const NOTES = 150;

/** An item's entry, if it is ticked off. */
export const doneOf = (done: DoneItem[] | null | undefined, text: string): DoneItem | undefined =>
  (done || []).find((d) => d.text === text);

/** The caller's open to-dos, newest note first, items in the order they were said. */
export async function openTodos(admin: Admin, userId: string): Promise<Todo[]> {
  const { data } = await admin
    .from("recordings")
    .select("id, path, label, recorded_at, items:analysis->actionItems, actions_done")
    .eq("user_id", userId)
    .eq("status", "done")
    .eq("report", false)
    .in("shelf", READ)
    .order("recorded_at", { ascending: false })
    .limit(NOTES);
  const rows = (data || []) as {
    id: string;
    path: string | null;
    label: string | null;
    recorded_at: string;
    items: string[] | null;
    actions_done: DoneItem[] | null;
  }[];
  return rows.flatMap((row) =>
    (Array.isArray(row.items) ? row.items : [])
      .filter((text) => !doneOf(row.actions_done, text))
      .map((text) => ({ noteId: row.id, title: noteName(row.path || "", row.label || ""), text, recordedAt: row.recorded_at }))
  );
}

/**
 * Ticks an item off (with the note it led to, or none), or puts it back.
 * Only the caller's own notes are touched, and an item the note does not
 * have is refused rather than invented.
 */
export async function setDone(
  admin: Admin,
  userId: string,
  noteId: string,
  text: string,
  done: boolean,
  result: string | null
): Promise<"ok" | "note" | "item" | "result"> {
  const { data: note } = await admin
    .from("recordings")
    .select("id, items:analysis->actionItems, actions_done")
    .eq("user_id", userId)
    .eq("id", noteId)
    .maybeSingle();
  if (!note) return "note";
  const items = Array.isArray(note.items) ? (note.items as string[]) : [];
  if (!items.includes(text)) return "item";

  let title: string | null = null;
  if (done && result) {
    if (result === noteId) return "result";
    const { data: target } = await admin.from("recordings").select("path, label").eq("user_id", userId).eq("id", result).maybeSingle();
    if (!target) return "result";
    title = noteName(target.path || "", target.label || "");
  }

  const kept = ((note.actions_done as DoneItem[] | null) || []).filter((d) => d.text !== text);
  const next = done ? [...kept, { text, at: new Date().toISOString(), result: done && result ? result : null, title }] : kept;
  // updated_at by hand, as every write here does: a note app pulls the ticked line.
  await admin
    .from("recordings")
    .update({ actions_done: next, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", noteId);
  return "ok";
}
