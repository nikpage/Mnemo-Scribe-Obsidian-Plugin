// [Smith]
// The canonical note document. Everything a finished recording becomes — a file
// you save, a page in a notes app, text on the clipboard — is rendered from
// here, so a new destination is a reader of this shape and never a new format.
//
// The rendered form is Markdown with a YAML front-matter block, because that is
// what Obsidian reads natively and what every other notes app can ingest.

import { noteName } from "@/lib/note/filing";
import { formatDuration } from "@/lib/format";
import { Document } from "yaml";
import type { Shelf } from "@/lib/note/shelf";
import { KIND_WORD, type Kind, noteKinds } from "@/lib/note/kinds";
import type { Label } from "@/lib/note/passage-labels";

export type NoteAnalysis = {
  summary?: string;
  actionItems?: string[];
  /** Its speaker called it a journal entry: Kind journal in every passage. */
  journal?: boolean;
};

export type NoteSource = {
  id: string;
  /** What the note is about — its subject line and filename. */
  title: string;
  /**
   * Where the note lives: one primary path, "/"-separated, one choice per
   * level (`business/ideas`). Empty means unfiled. Depth is a soft limit the
   * UI nudges; nothing here rejects a deeper path.
   */
  path?: string;
  /** Labels as written, plain: `recipe`. Any number; the UI nudges toward few. */
  tags?: string[];
  /** Its Kinds, the note line's order (`noteKinds()`); the app's, never read back from a file. */
  kinds?: Kind[];
  recordedAt: string;
  durationSeconds?: number | null;
  transcript?: string;
  analysis?: NoteAnalysis | null;
  /** The worker who recorded it. */
  author?: string;
  /**
   * The body as somebody edited it, in a notes app. When present it replaces
   * the summary/actions/transcript sections entirely — what an editor added
   * that does not fit those three fields would be lost by rebuilding them.
   */
  bodyMarkdown?: string | null;
  /** Where its owner put it; written only when not `normal`, so a note app can filter by it. */
  shelf?: Shelf;
  /** Action items ticked off (`lib/note/todos.ts`), each with the note it led to, if any. */
  actionsDone?: { text: string; title?: string | null }[] | null;
};

export type NoteDocument = {
  /** Front-matter subject line, also the suggested filename. */
  title: string;
  frontmatter: Record<string, string | string[]>;
  body: string;
  /** Front-matter + body, ready to write to a file or a clipboard. */
  markdown: string;
};

/** A stored note row, as every reader of the document selects it. */
export type NoteRow = {
  id: string;
  label: string | null;
  path: string | null;
  tags: string[] | null;
  recorded_at: string;
  duration_seconds: number | null;
  transcript: { utterances?: { text: string }[] } | null;
  analysis: NoteAnalysis | null;
  body_md?: string | null;
  shelf?: Shelf | null;
  actions_done?: { text: string; title?: string | null }[] | null;
};

/**
 * A row as the document's source. The one mapping every destination uses:
 * the export once made its own and left the body out, so every imported or
 * vault-edited note exported empty. Tags are written plain: which tags sit
 * under which lives only in the app's own views, never in another app.
 */
export function noteSource(row: NoteRow, author?: string, passages: Pick<Label, "kind" | "truth" | "words">[] = []): NoteSource {
  return {
    id: row.id,
    title: noteName(row.path || "", row.label || ""),
    path: row.path || "",
    tags: row.tags || [],
    kinds: noteKinds(passages, row.analysis?.journal === true),
    recordedAt: row.recorded_at,
    durationSeconds: row.duration_seconds,
    transcript: (row.transcript?.utterances || []).map((u) => u.text).join("\n"),
    analysis: row.analysis,
    author,
    bodyMarkdown: row.body_md ?? null,
    shelf: row.shelf ?? undefined,
    actionsDone: row.actions_done ?? null,
  };
}

/**
 * What a note says, as one text: its own words where it has them (an
 * imported or edited note), the transcript where it was spoken, and the
 * summary only as a fallback.
 */
export function noteText(row: {
  body_md?: string | null;
  transcript?: { utterances?: { text?: string }[] } | null;
  analysis?: { summary?: string } | null;
}): string {
  const spoken = (row.transcript?.utterances || [])
    .map((u) => u.text || "")
    .join(" ")
    .trim();
  return (row.body_md || "").trim() || spoken || row.analysis?.summary || "";
}

/**
 * The front-matter block, written by the YAML library so any vault can read
 * it back. Lists stay on one line (`tags: [gift, brew]`) as they always
 * were, and nothing is ever wrapped onto a second line.
 */
function renderFrontmatter(fm: Record<string, string | string[]>): string {
  const doc = new Document();
  for (const [key, value] of Object.entries(fm)) {
    if (Array.isArray(value) ? value.length === 0 : !value) continue;
    if (Array.isArray(value)) {
      const list = doc.createNode(value);
      list.flow = true;
      doc.set(key, list);
    } else {
      // Anything beyond plain words is quoted, as it always was: an older
      // reader takes a bare 12:05 for a number and a bare date for a date.
      const scalar = doc.createNode(value);
      if (!/^[A-Za-z0-9 ._-]+$/.test(value)) scalar.type = "QUOTE_DOUBLE";
      doc.set(key, scalar);
    }
  }
  return `---\n${doc.toString({ lineWidth: 0, flowCollectionPadding: false })}---`;
}

/**
 * Safe for a filename on every platform, and stable for the same note:
 * knee-pain-after-sunday.md.
 */
export function noteFilename(doc: NoteDocument): string {
  const slug = doc.title
    .replace(/\.md$/i, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${slug || "note"}.md`;
}

/** A shelf as a note app's property shows it. */
const SHELF_WORDS: Record<Shelf, string> = { normal: "", archived: "archived", cold: "cold storage", trash: "trash" };

export function buildNote(source: NoteSource): NoteDocument {
  const date = new Date(source.recordedAt);
  const title = source.title;

  const frontmatter: Record<string, string | string[]> = {
    title,
    date: date.toISOString(),
  };
  if (source.tags?.length) frontmatter.tags = source.tags;
  if (source.kinds?.length) frontmatter.kind = source.kinds.map((k) => KIND_WORD[k]);
  if (source.author) frontmatter.author = source.author;
  if (source.durationSeconds) frontmatter.duration = formatDuration(source.durationSeconds);
  frontmatter.scribe_id = source.id;
  if (source.shelf && source.shelf !== "normal") frontmatter.shelf = SHELF_WORDS[source.shelf];

  if (source.bodyMarkdown?.trim()) {
    const body = source.bodyMarkdown.trim();
    return { title, frontmatter, body, markdown: `${renderFrontmatter(frontmatter)}\n\n${body}\n` };
  }

  const sections: string[] = [`# ${title}`];

  if (source.analysis?.summary) {
    sections.push(`## Summary\n\n${source.analysis.summary}`);
  }

  const actions = source.analysis?.actionItems ?? [];
  if (actions.length > 0) {
    const line = (a: string) => {
      const done = source.actionsDone?.some((d) => d.text === a);
      return done ? `- [x] ${a}` : `- [ ] ${a}`;
    };
    sections.push(`## Action items\n\n${actions.map(line).join("\n")}`);
  }

  if (source.transcript?.trim()) {
    sections.push(`## Transcript\n\n${source.transcript.trim()}`);
  }

  const body = sections.join("\n\n");
  return { title, frontmatter, body, markdown: `${renderFrontmatter(frontmatter)}\n\n${body}\n` };
}
