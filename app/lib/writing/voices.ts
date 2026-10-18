// [Writer]

import { noteText } from "@/lib/note/build";
import type { Measures } from "@/lib/writing/measure";

type Source = {
  body_md?: string | null;
  transcript?: { utterances?: { text?: string }[] } | null;
};

/**
 * A note said aloud and transcribed. Speech is not writing: picked as an
 * example of how someone writes, it is a weaker one, and the screen says so.
 */
export function isSpoken(note: Source): boolean {
  return !note.body_md && (note.transcript?.utterances?.length ?? 0) > 0;
}

/** The person's own words in a note: its text, never the app's summary. */
export function wordsOf(note: Source): number {
  const text = noteText({ body_md: note.body_md, transcript: note.transcript });
  return text ? text.split(/\s+/).length : 0;
}

/** A voice as the list returns it; `has` only when asked about one note. */
export interface VoiceRow {
  id: string;
  name: string;
  examples: number;
  has?: boolean;
}

/** One example on a voice's page: the note, how many words, whether spoken. */
export interface VoiceExample {
  id: string;
  path: string | null;
  label: string | null;
  recorded_at: string;
  added_at: string;
  words: number;
  spoken: boolean;
}

/** One voice on its page: its examples, their words together, its voice notes, its last learning press, its measures. */
export interface VoicePage {
  voice: { id: string; name: string; notes: string | null };
  examples: VoiceExample[];
  words: number;
  /** `changed`: examples added or taken out since the notes were learned. */
  learn: { status: "running" | "done" | "failed" | null; error: string | null; at: string | null; changed: boolean };
  measures: Measures | null;
}

/** A name: trimmed, collapsed, never empty. */
export function cleanName(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** A longer text: trimmed, cut at `max`, null when blank. */
export function cleanText(value: unknown, max: number): string | null {
  return typeof value === "string" ? value.trim().slice(0, max) || null : null;
}
