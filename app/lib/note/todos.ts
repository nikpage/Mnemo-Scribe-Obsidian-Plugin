// [Guru]

import type { SupabaseClient } from "@supabase/supabase-js";
import { noteName } from "@/lib/note/filing";
import { READ } from "@/lib/note/shelf";
import { sourceOf, type TodoSource } from "@/lib/note/todo-source";

/**
 * To-dos are a note's action items. The items stay where the model wrote
 * them (`analysis.actionItems`); what is ticked off is `recordings.actions_done`,
 * one entry per item, keyed by its text.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

export type DoneItem = { text: string; at: string };

export type Todo = {
  noteId: string;
  title: string;
  text: string;
  recordedAt: string;
  /** The sentence it was said in; null when none can be found, or past the notes read for it. */
  source: TodoSource | null;
};

/** How many notes back the open to-dos are looked for: newest first. */
const NOTES = 150;

/** How many notes have their text read to find where their to-dos were said: the newest. */
const SOURCED = 12;

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
  const todos = rows.flatMap((row) =>
    (Array.isArray(row.items) ? row.items : [])
      .filter((text) => !doneOf(row.actions_done, text))
      .map((text) => ({ noteId: row.id, title: noteName(row.path || "", row.label || ""), text, recordedAt: row.recorded_at, source: null as TodoSource | null }))
  );

  // The text of the newest notes that have something open, not of all 150.
  const ids = [...new Set(todos.map((todo) => todo.noteId))].slice(0, SOURCED);
  if (ids.length === 0) return todos;
  const { data: texts } = await admin.from("recordings").select("id, transcript, body_md").eq("user_id", userId).in("id", ids);
  const byId = new Map(
    ((texts || []) as { id: string; transcript: { utterances?: { text?: string }[] } | null; body_md: string | null }[]).map((n) => [
      n.id,
      { utterances: (n.transcript?.utterances || []).map((u) => u.text || ""), body: n.body_md },
    ])
  );
  for (const todo of todos) {
    const note = byId.get(todo.noteId);
    if (note) todo.source = sourceOf(todo.text, note);
  }
  return todos;
}

/**
 * Ticks an item off, or puts it back.
 * Only the caller's own notes are touched, and an item the note does not
 * have is refused rather than invented.
 */
export async function setDone(
  admin: Admin,
  userId: string,
  noteId: string,
  text: string,
  done: boolean
): Promise<"ok" | "note" | "item"> {
  const { data: note } = await admin
    .from("recordings")
    .select("id, items:analysis->actionItems, actions_done")
    .eq("user_id", userId)
    .eq("id", noteId)
    .maybeSingle();
  if (!note) return "note";
  const items = Array.isArray(note.items) ? (note.items as string[]) : [];
  if (!items.includes(text)) return "item";

  const kept = ((note.actions_done as DoneItem[] | null) || []).filter((d) => d.text !== text);
  const next = done ? [...kept, { text, at: new Date().toISOString() }] : kept;
  // updated_at by hand, as every write here does: a note app pulls the ticked line.
  await admin
    .from("recordings")
    .update({ actions_done: next, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", noteId);
  return "ok";
}
