// [Filer]

/** The labels a passage carries, each a closed list (`passages.ts`); here so a screen can read them. */

export const KINDS = ["journal", "points", "log", "draft"] as const;
export const TRUTHS = ["real", "fiction"] as const;
export const WORDS = ["mine", "borrowed", "quote", "inspired"] as const;
export type Kind = (typeof KINDS)[number];
export type Truth = (typeof TRUTHS)[number];
export type Words = (typeof WORDS)[number];

/** One sentence's labels. */
export interface Label {
  kind: Kind;
  truth: Truth;
  words: Words;
  topics: string[];
}

/** Sentences `from` to `to` (1-based, inclusive), labelled alike. */
export interface Passage extends Label {
  from: number;
  to: number;
}

/** A passage as the note screen shows it. */
export interface SavedPassage extends Passage {
  id: string;
  text: string;
  start: number | null;
  corrected: boolean;
}
