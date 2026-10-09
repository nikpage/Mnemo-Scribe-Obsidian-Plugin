// [Librarian]

import { noteName } from "@/lib/note/filing";

/**
 * What a note has to offer a search that is only matching words.
 *
 * Exactly the list fields: the notes in the browser carry no text at all, so
 * a word that appears only inside a summary or a transcript is found by the
 * server's own search instead. See SearchProvider.
 */
type Searchable = {
  id: string;
  label: string;
  recorded_at: string;
  path: string | null;
  tags: string[] | null;
  status: string;
};

export type Found<T> = { note: T; excerpt: string };

/**
 * Where a word was found, and how much that counts for. A name in the title
 * is a better answer than the same word halfway through a transcript.
 */
const FIELDS = [
  { weight: 8, of: (n: Searchable) => noteName(n.path || "", n.label) },
  { weight: 6, of: (n: Searchable) => (n.tags || []).join(" ") },
];

/**
 * Case and accents are how a search box gets in the way: "nápady" has to be
 * findable by typing "napady", and a Czech note has to be findable at all by
 * someone whose keyboard is set to English.
 */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Every word counts, and the last one is still being typed, so it matches
 * from its beginning: "sta" finds "starter" before the rest arrives.
 */
function scoreField(text: string, terms: string[]): number {
  const folded = fold(text);
  let score = 0;
  for (const term of terms) {
    // Word starts only: "van" finds "van filters", not "advance".
    const at = new RegExp(`(^|[^\\p{L}\\p{N}])${escape(term)}`, "u").test(folded);
    if (!at) return 0; // every word must be somewhere in the note
    score += 1;
  }
  return score;
}

function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * What to show under the name. There is no text here to quote from, so it is
 * the note's tags — which is what tells two notes of the same name apart.
 */
function excerptFor(note: Searchable): string {
  return (note.tags || []).map((tag) => `#${tag}`).join(" ");
}

/**
 * Search as you type, over the notes the browser already has.
 *
 * There is no request here and nothing to wait for: names and tags
 * are already loaded, and matching words against them is work a phone does
 * between one keystroke and the next. The words inside a note are the
 * server's search, which runs a moment behind; finding a note by meaning is
 * the other search again, and it is a button.
 */
export function findNotes<T extends Searchable>(notes: T[], query: string): Found<T>[] {
  const terms = fold(query)
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) return [];

  const hits: { note: T; score: number }[] = [];

  for (const note of notes) {
    if (note.status !== "done") continue;
    let score = 0;
    for (const field of FIELDS) {
      score += field.weight * scoreField(field.of(note), terms);
    }
    if (score > 0) hits.push({ note, score });
  }

  return hits
    .sort((a, b) => b.score - a.score || (a.note.recorded_at < b.note.recorded_at ? 1 : -1))
    .map(({ note }) => ({ note, excerpt: excerptFor(note) }));
}
