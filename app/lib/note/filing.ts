// [Filer]
// What a note is called and what it is tagged with. Scribe keeps no folders:
// a note's path is its own name, one level, and everything it is about is a
// flat tag — a journal entry about sociology carries both, and is found
// under either. Where a note sits in another app (a vault folder) is that
// app's business. The tag limit is soft: the UI hints past it, and nothing
// here or in the database refuses an extra tag.

export const SOFT_MAX_TAGS = 3;

/** One level of a path, or one tag: lowercase, no slashes, spaces to dashes. */
export function normalizeSegment(raw: string): string {
  return raw
    // A URL can spell a diacritic either way; the store always holds NFC.
    // Composing first also keeps the strip below from eating a combining
    // mark and silently turning "příjezd" into "prijezd".
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * One level as it arrives from a URL. A browser writes a diacritic
 * percent-encoded, and a decode can fail on a stray `%` typed by hand — in
 * which case the raw text is the best guess there is.
 */
export function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * How a path level is written on screen. Levels are stored lowercase so that
 * one concept has one label, but a name reads as a name, not as a slug:
 * "kombucha" shows as "Kombucha", "knee-pain" as "Knee-Pain".
 * Display only — nothing capitalised here is ever saved.
 */
export function displayLevel(segment: string): string {
  return segment.replace(/(^|-)(\p{L})/gu, (_m, sep, letter) => sep + letter.toUpperCase());
}

/**
 * What a note is called: its path written as a filename —
 * `Knee-pain-after-sunday.md`. The `.md` is there because that is what the
 * note is. Only a note with no path at all falls back to the name typed when
 * recording.
 */
export function noteName(path: string, label: string): string {
  const levels = splitPath(path);
  return `${levels.length ? displayLevel(levels[levels.length - 1]) : label}.md`;
}

/** Splits a path into its levels, dropping empties. Never throws on depth. */
export function splitPath(path: string): string[] {
  return path.split("/").map(normalizeSegment).filter(Boolean);
}

/** The canonical stored form of a path. Empty string means unfiled. */
export function normalizePath(path: string): string {
  return splitPath(path).join("/");
}

export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  for (const tag of tags) {
    const t = normalizeSegment(tag);
    if (t) seen.add(t);
  }
  return [...seen];
}

/** Where journal entries are tagged: `journal`, `deník`. */
export const JOURNAL = { en: "journal", cs: "deník" } as const;

/**
 * A title as a path: normalised, and cut at a word boundary so a long title
 * still makes a usable filename.
 */
export function titleLevel(title: string, max = 60): string {
  const level = normalizeSegment(title);
  if (level.length <= max) return level;
  const cut = level.slice(0, max);
  return cut.slice(0, cut.lastIndexOf("-") > 0 ? cut.lastIndexOf("-") : max);
}

/**
 * Names the app answers on itself. Notes live at the root of the site, so a
 * note spelt like one of these would sit behind a screen and be unreachable;
 * `safePath` renames it instead of losing the note.
 */
export const RESERVED_LEVELS = new Set([
  "record",
  "recent",
  "search",
  "settings",
  "admin",
  "queue",
  "transcript",
  "subject",
  "subjects",
  "insights",
  "integrations",
  "setup",
  "auth",
  "api",
  "_next",
]);

/** A stored path that is also a reachable address. */
export function safePath(path: string): string {
  const levels = splitPath(path);
  if (levels.length && RESERVED_LEVELS.has(levels[0])) levels[0] = `${levels[0]}-notes`;
  return levels.join("/");
}

/**
 * Where a note lives. A filed note is its path with a `.md` on the end —
 * the same name as the file an export writes — so the URL and the document
 * agree. A note with no path has no such address and is reached by id.
 */
export function noteHref(path: string, id: string): string {
  const p = normalizePath(path);
  return p ? `/${p}.md` : `/transcript/${id}`;
}

/** A level that only says when — `2026`, `2026-09`, `2026-09-18`. */
const DATED = /^\d{4}(-\d{2}){0,2}$/;

/**
 * A path as Scribe keeps it: the note's own name, nothing above it.
 *
 * A path can still arrive with folders — an imported file's front matter, a
 * vault folder, a note filed before folders went. Its last level stays the
 * name, and the folders above become tags, so a note once under
 * `politics/israel` is found by both words. A level that only gives a date
 * is dropped: the note's own date already says it, and a date is not what a
 * note is about.
 */
export function flatten(path: string): { path: string; tags: string[] } {
  const levels = splitPath(path);
  return { path: levels.at(-1) || "", tags: folderTags(levels.slice(0, -1).join("/")) };
}

/** A folder's words as tags, without the levels that only give a date. */
export function folderTags(folder: string): string[] {
  return normalizeTags(splitPath(folder).filter((level) => !DATED.test(level)));
}

/** Enough to see that "recipe" and "recipes" are the same word. */
export function singular(segment: string): string {
  return segment.replace(/s$/, "");
}

/**
 * Tags with more added, never a second spelling of one already there:
 * "recipes" does not join a note tagged "recipe".
 */
export function withTags(tags: string[], more: string[]): string[] {
  const out = normalizeTags(tags);
  for (const tag of normalizeTags(more)) {
    if (!out.some((t) => singular(t) === singular(tag))) out.push(tag);
  }
  return out;
}

/**
 * The note an address names (`/<title>.md`), if it names one. Notes have no
 * folders now, so an old link into one (`/recipes/kombucha/batch.md`) finds
 * the note by its name. Segments arrive percent-encoded from the browser.
 */
export function noteAtPath<T extends { path: string | null; status: string }>(rawSegments: string[], notes: T[]): T | undefined {
  const raw = rawSegments.map(decodeSegment);
  if (!/\.md$/i.test(raw[raw.length - 1] || "")) return undefined;
  const here = normalizePath([...raw.slice(0, -1), raw[raw.length - 1].replace(/\.md$/i, "")].join("/"));
  if (!here) return undefined;
  return notes.find((n) => n.status === "done" && (normalizePath(n.path || "") === here || n.path === splitPath(here).at(-1)));
}
