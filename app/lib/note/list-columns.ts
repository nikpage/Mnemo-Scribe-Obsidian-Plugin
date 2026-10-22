// [utils]

/**
 * The fields the notes list shows — and nothing else.
 *
 * The list is sent with every page, so it must not carry text: not the
 * transcript, not imported text, and not the model's summary, topics or
 * actions either. At a few hundred notes that was megabytes on every open of
 * the app, growing with every note recorded. What is left is what browsing
 * needs — where a note sits, what it is called, when, how long, its tags and
 * its state — about 150 bytes a note, so thousands of notes still arrive with
 * the page. The summary of a note actually on screen is fetched by
 * `useSummaries()`; a note's full body by the note screen when it is opened.
 */
export const LIST_COLUMNS =
  "id, user_id, label, filename, recorded_at, duration_seconds, file_size_bytes, status, drive_audio_id, path, tags, pinned, shelf, subject_id, superseded_by, language, error, created_at, updated_at, hidden";

const LIST_FIELDS = LIST_COLUMNS.split(",").map((c) => c.trim());

/**
 * Just the list fields of a row that arrived in full — a Realtime message
 * carries the whole note, and the list must not start holding its text.
 */
export function listFieldsOf<T extends object>(row: Partial<T>): T {
  const from = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of LIST_FIELDS) out[f] = from[f];
  return out as T;
}
