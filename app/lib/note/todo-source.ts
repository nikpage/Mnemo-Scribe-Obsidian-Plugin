// [Guru]

/**
 * Where in a note a to-do was said. The model wrote the item in its own
 * words and kept no pointer, so the sentence is found by the words the two
 * share, a rare word counting for more than one the note uses everywhere. No
 * model, nothing paid. Words are compared by their first letters, so a
 * Czech ending does not hide a match.
 */

export type TodoSource = {
  /** The sentence's place among the note's utterances; null for a written note, which has none. */
  line: number | null;
  /** That sentence and the one after it. */
  text: string;
};

const STEM = 5;
const SHOWN = 240;

const stems = (text: string): string[] =>
  (text.match(/[\p{L}\p{N}]{3,}/gu) || []).map((w) => w.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").slice(0, STEM));

function cut(text: string): string {
  const plain = text.replace(/\s+/g, " ").trim();
  if (plain.length <= SHOWN) return plain;
  const head = plain.slice(0, SHOWN);
  return `${head.slice(0, Math.max(head.lastIndexOf(" "), 0) || SHOWN)}…`;
}

/** The part of `parts` that says most of `item`, or null when none shares a word with it. */
function best(item: string, parts: string[]): number | null {
  const wanted = new Set(stems(item));
  if (wanted.size === 0) return null;
  const inPart = parts.map((p) => new Set(stems(p)));
  const holding = new Map<string, number>();
  for (const words of inPart) for (const w of words) holding.set(w, (holding.get(w) || 0) + 1);

  let at: number | null = null;
  let top = 0;
  inPart.forEach((words, i) => {
    let score = 0;
    for (const w of wanted) {
      const n = holding.get(w) || 0;
      // A word most of the note uses ("the", "and") says where nothing.
      if (words.has(w) && n <= Math.max(1, parts.length / 2)) score += 1 / n;
    }
    if (score > top) {
      top = score;
      at = i;
    }
  });
  return at;
}

export function sourceOf(item: string, note: { utterances: string[]; body: string | null }): TodoSource | null {
  const spoken = note.utterances.filter((u) => u.trim());
  if (spoken.length > 0) {
    const i = best(item, spoken);
    // The index is into the utterances as the note screen lists them, blanks and all.
    if (i === null) return null;
    const line = note.utterances.indexOf(spoken[i]);
    return { line, text: cut([note.utterances[line], note.utterances[line + 1] || ""].join(" ")) };
  }
  const paragraphs = (note.body || "").split(/\n\s*\n|\n/).filter((p) => p.trim());
  const i = best(item, paragraphs);
  return i === null ? null : { line: null, text: cut(paragraphs[i]) };
}
