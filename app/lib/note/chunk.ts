// [Librarian]
// Splitting a note for search. A note is usually short — a sentence or two —
// and a short note is one chunk, embedded as it was said. Padding it with a
// generated summary would only put words in it that the speaker never used.
//
// The note's path and tags are deliberately NOT embedded: "book3/chap12" is a
// filing label, not meaning, and mixing it in makes everything under one book
// look alike. They are filters applied alongside the search instead.

const WORDS_BEFORE_SPLITTING = 200;
const TARGET_WORDS = 150;
/** How much of the previous chunk is repeated at the start of the next. */
const OVERLAP_WORDS = 40;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * The closing words of a chunk, taken back to a sentence boundary so the
 * overlap starts somewhere a reader would start, rather than mid-clause.
 * A single sentence longer than the budget is carried whole — cutting it is
 * what the boundary was supposed to avoid.
 */
function overlapTail(chunk: string): string {
  const sentences = chunk.split(/(?<=[.!?])\s+/).filter(Boolean);
  const tail: string[] = [];
  let words = 0;
  for (let i = sentences.length - 1; i >= 0; i -= 1) {
    const count = wordCount(sentences[i]);
    if (tail.length > 0 && words + count > OVERLAP_WORDS) break;
    tail.unshift(sentences[i]);
    words += count;
    if (words >= OVERLAP_WORDS) break;
  }
  return tail.join(" ");
}

/** A stretch of the note under one heading, from its heading line to the next heading of any level. */
export interface Section {
  /** The headings above it and its own, outermost first; none for text before the first heading. */
  path: string[];
  start: number;
  end: number;
}

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t#]*$/gm;

/** The note's text cut at its Markdown headings, in order, covering all of it. */
export function noteSections(text: string): Section[] {
  const sections: Section[] = [];
  const open: { level: number; title: string }[] = [];
  let start = 0;
  let path: string[] = [];
  for (const found of text.matchAll(HEADING)) {
    if (found.index > start || sections.length > 0 || path.length > 0) sections.push({ path, start, end: found.index });
    const level = found[1].length;
    while (open.length > 0 && open[open.length - 1].level >= level) open.pop();
    open.push({ level, title: found[2].trim() });
    path = open.map((h) => h.title);
    start = found.index;
  }
  sections.push({ path, start, end: text.length });
  return sections.filter((s) => s.path.length > 0 || text.slice(s.start, s.end).trim());
}

/** One piece to embed, with where it sits: its headings, and the start and end of its own text in the note's text. */
export interface Chunk {
  content: string;
  headings: string[];
  start: number;
  end: number;
}

/** The paragraphs of `text` between `from` and `to`, each with its place. */
function paragraphsIn(text: string, from: number, to: number): { text: string; start: number; end: number }[] {
  const slice = text.slice(from, to);
  const out: { text: string; start: number; end: number }[] = [];
  let at = 0;
  for (const piece of slice.split(/(\n\s*\n)/)) {
    const trimmed = piece.trim();
    if (trimmed && !/^\n\s*\n$/.test(piece)) {
      const start = from + at + piece.indexOf(trimmed);
      out.push({ text: trimmed, start, end: start + trimmed.length });
    }
    at += piece.length;
  }
  return out;
}

type Piece = { text: string; start: number; end: number };

/** Runs of `found` matches in `p`, each run as long as fits in `limit` words, cut from `p`'s own text. */
function grouped(p: Piece, found: RegExpMatchArray[], limit: number): Piece[] {
  const out: Piece[] = [];
  let first = -1;
  let last = -1;
  let words = 0;
  const close = () => out.push({ text: p.text.slice(first, last).trim(), start: p.start + first, end: p.start + last });
  for (const m of found) {
    const count = wordCount(m[0]);
    if (first >= 0 && words + count > limit) {
      close();
      first = -1;
      words = 0;
    }
    if (first < 0) first = m.index!;
    last = m.index! + m[0].trimEnd().length;
    words += count;
  }
  if (first >= 0) close();
  return out;
}

/**
 * A paragraph longer than a chunk, cut at its sentences; a sentence longer
 * than a chunk, at its words. A voice transcript is one paragraph however
 * long it runs, and the embedder reads only its first 2,048 tokens: uncut,
 * the end of a long recording could never be found.
 */
function splitLong(p: Piece): Piece[] {
  if (wordCount(p.text) <= TARGET_WORDS) return [p];
  const sentences = grouped(p, [...p.text.matchAll(/\S[\s\S]*?(?:[.!?]+(?=\s)|$)/g)], TARGET_WORDS);
  return sentences.flatMap((s) =>
    wordCount(s.text) <= TARGET_WORDS ? [s] : grouped(s, [...s.text.matchAll(/\S+/g)], TARGET_WORDS)
  );
}

/**
 * The note as pieces to embed. The subject line leads each chunk so a fragment
 * still carries what the note was about; on a long note the summary follows it,
 * because that is the one line saying what the whole note covered.
 */
export function chunkNote(note: { title: string; summary?: string; text: string }): string[] {
  return chunkSpans(note).map((c) => c.content);
}

/**
 * `chunkNote()` with each chunk's place. A chunk never crosses a heading, and
 * the overlap carried into a chunk comes from its own section: a passage cut
 * from the note is then always under the heading it was found under. A note
 * without headings or overlong paragraphs chunks exactly as it did before.
 */
export function chunkSpans(note: { title: string; summary?: string; text: string }): Chunk[] {
  const body = note.text.trim();
  if (!body) return [];

  const sections = noteSections(note.text);
  const headed = sections.some((s) => s.path.length > 0);
  const bodyStart = note.text.indexOf(body);

  const lead = [note.title.trim(), body].filter(Boolean).join("\n\n");
  if (!headed && wordCount(body) <= WORDS_BEFORE_SPLITTING) {
    return [{ content: lead, headings: [], start: bodyStart, end: bodyStart + body.length }];
  }

  const header = [note.title.trim(), note.summary?.trim()].filter(Boolean).join(" — ");
  const chunks: Chunk[] = [];

  for (const section of sections) {
    // Paragraphs first, so a chunk boundary lands where the speaker paused.
    const paragraphs = paragraphsIn(note.text, section.start, section.end).flatMap(splitLong);
    let current: string[] = [];
    let currentWords = 0;
    let start = -1;
    let end = -1;
    const close = () => chunks.push({ content: current.join("\n\n"), headings: section.path, start, end });

    for (const paragraph of paragraphs) {
      const words = wordCount(paragraph.text);
      if (currentWords > 0 && currentWords + words > TARGET_WORDS) {
        close();
        // Overlap, so a thought split across the boundary is still found whole
        // from either side. It is measured in words and not in sentences: the
        // last sentence of a paragraph is as often three words as thirty, and a
        // three-word tail carries no meaning across.
        const tail = overlapTail(chunks[chunks.length - 1].content);
        current = tail ? [tail] : [];
        currentWords = wordCount(tail);
        start = -1;
      }
      current.push(paragraph.text);
      currentWords += words;
      if (start < 0) start = paragraph.start;
      end = paragraph.end;
    }
    if (current.length > 0) close();
  }

  return chunks.map((chunk) => ({ ...chunk, content: header ? `${header}\n\n${chunk.content}` : chunk.content }));
}
