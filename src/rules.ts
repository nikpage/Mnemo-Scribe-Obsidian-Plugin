// [Smith]

/**
 * What the plugin decides, kept apart from Obsidian so it can be tested.
 *
 * Nothing here imports `obsidian`: every rule about where a file goes, what
 * a push sends, what a delete does and whether a paid tap may run is a plain
 * function of plain data, and `tests/smith.test.ts` holds each one.
 */

export type NoteState = {
  /** Where the file sits, vault-relative. Follows renames and moves. */
  file: string;
  /** The revision this vault last agreed with the server on. */
  rev: number;
  /** The text as last written or pushed, to tell a real edit from a re-write. */
  hash: string;
  /** The folder the file sat in when last agreed: a different one is a move. */
  folder: string;
};

export type SyncState = {
  cursor: string | null;
  notes: Record<string, NoteState>;
  /** The nearest notes to each note, by id, as the server last reported them. */
  related: Record<string, string[]>;
  /** Notes deleted here but kept in Scribe: never written to this vault again. */
  detached: string[];
};

export function emptyState(): SyncState {
  return { cursor: null, notes: {}, related: {}, detached: [] };
}

/** Cheap, stable, and only ever compared against itself. */
export function hashOf(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return String(h);
}

/** The folder a vault path sits in, "" for the vault's top level. */
export function parentOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

/** "/" stands for the whole vault. */
export const WHOLE_VAULT = "/";

export function underFolder(path: string, folder: string): boolean {
  if (folder === WHOLE_VAULT || folder === "") return true;
  return path === folder || path.startsWith(`${folder}/`);
}

/** A Markdown file in a synced folder or the inbox is this plugin's to sync. */
export function owns(path: string, synced: string[], inbox: string): boolean {
  if (!path.endsWith(".md")) return false;
  return synced.some((folder) => underFolder(path, folder)) || (inbox !== "" && underFolder(path, inbox));
}

export function tagKey(tag: string): string {
  return tag.replace(/^#/, "").trim().toLowerCase();
}

export type Placement = { min: number; ratio: number; inbox: string };

/**
 * Where a note new to this vault lands.
 *
 * Each folder scores how many of the note's tags its notes already carry.
 * One clear winner takes it: at least `min` shared tags and `ratio` times the
 * runner-up. Anything less sure goes to the inbox, where the person decides —
 * a wrong guess hidden in a deep folder is worse than an honest "not sure".
 */
export function placeNote(tags: string[], folders: Record<string, string[]>, rule: Placement): string {
  const wanted = new Set(tags.map(tagKey).filter(Boolean));

  const scores = Object.entries(folders)
    .filter(([folder]) => folder !== rule.inbox)
    .map(([folder, held]) => {
      const carried = new Set(held.map(tagKey));
      return { folder, score: [...wanted].filter((tag) => carried.has(tag)).length };
    })
    .sort((a, b) => b.score - a.score || a.folder.localeCompare(b.folder));

  const [best, next] = scores;
  if (!best || best.score < rule.min) return rule.inbox;
  if (next && best.score < next.score * rule.ratio) return rule.inbox;
  return best.folder;
}

/**
 * What a push sends for one note, or null for nothing.
 *
 * An edit sends the text. A move sends the text and the folder it moved
 * into, once, so that folder's words become tags; a tag removed afterwards
 * then stays removed, because no later push carries the folder again.
 */
export function pushOf(known: NoteState, now: { path: string; hash: string }): { folder?: string } | null {
  const folder = parentOf(now.path);
  const moved = folder !== known.folder;
  if (!moved && now.hash === known.hash) return null;
  return moved ? { folder } : {};
}

export type PullAction = "skip" | "rewrite" | "restore" | "place";

/**
 * What a pulled note does to this vault.
 *
 * - `rewrite`: its file is here and synced; rewritten where it stands.
 * - `restore`: its file is gone without a delete being asked; it comes back
 *   where it last was.
 * - `place`: never held here; it lands by `placeNote()`.
 * - `skip`: deleted here and kept in Scribe, or moved out of every synced
 *   folder. Either way the person took it out of this sync.
 */
export function pullAction(
  id: string,
  state: SyncState,
  file: { exists: boolean; owned: boolean } | null
): PullAction {
  if (state.detached.includes(id)) return "skip";
  if (!state.notes[id]) return "place";
  if (!file || !file.exists) return "restore";
  return file.owned ? "rewrite" : "skip";
}

/**
 * The answer to "Also delete it from Scribe?".
 *
 * Yes: the note is deleted there by the caller, and forgotten here. No: kept
 * in Scribe and never written to this vault again.
 */
export function afterDelete(state: SyncState, id: string, alsoInScribe: boolean): void {
  delete state.notes[id];
  delete state.related[id];
  if (!alsoInScribe && !state.detached.includes(id)) state.detached.push(id);
}

/** A note deleted in Scribe: its file goes to the vault's trash, its state with it. */
export function afterGone(state: SyncState, id: string): void {
  delete state.notes[id];
  delete state.related[id];
  state.detached = state.detached.filter((other) => other !== id);
}

export type Billing = { credits: number; paysInCredits: boolean };

/**
 * Whether a paid tap may run, as the server will decide it: an account that
 * pays in credits is refused at zero. Said here first, so the person reads
 * why instead of a failed request.
 */
export function refusal(billing: Billing | null): string | null {
  if (!billing || !billing.paysInCredits) return null;
  return billing.credits <= 0 ? "Out of credits. Top up in Scribe to keep going." : null;
}

/** How a cost reads on a button: nothing for an account that does not pay in credits. */
export function costLabel(billing: Billing | null, credits: number | null): string {
  if (!billing?.paysInCredits || !credits) return "";
  return ` · ${credits} credit${credits === 1 ? "" : "s"}`;
}

/** What a call really cost, as the owner reads it under a reading or an answer. */
export function spentLine(spent?: { costUsd: number; readTokens: number; wroteTokens: number }): string | null {
  return spent ? `Real: $${spent.costUsd.toFixed(4)} · read ${spent.readTokens} · wrote ${spent.wroteTokens} tokens` : null;
}

/**
 * What a person can do on a topic, as the app offers them, each the stored
 * job key and its name.
 */
export const JOBS = [
  ["inspiration", "Write more"],
  ["next-best", "Improve"],
  ["study", "Learn"],
  ["log", "Review progress"],
] as const;
export type Job = (typeof JOBS)[number][0];

/** One tag as the app stores it (`normalizeSegment()` in the app's `filing.ts`). */
export function tagSpelling(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/^#/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The topics typed in the topic box, comma-separated, each once, in the order added. */
export function topicsOf(typed: string): string[] {
  return [...new Set(typed.split(",").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean))];
}

/** The topic box with one more topic added after those already there. */
export function withTopic(typed: string, topic: string): string {
  return topicsOf(`${typed},${topic}`).join(", ");
}

/** Several topics read as one subject, joined as the app joins them (`readingOf()`). */
export function topicOf(typed: string): string {
  return topicsOf(typed).join(", ");
}

export type Narrow = { only?: string[]; not?: string[]; from?: string; to?: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A topic reading's target, spelled as the app spells it (`subjectTarget()`
 * in its `what-next-target.ts`): "<job>:<topic>", then the narrowing on a
 * second line when there is any.
 */
export function subjectTarget(job: Job, topic: string, narrow: Narrow = {}): string {
  const head = `${job}:${topic.replace(/\s+/g, " ").trim()}`;
  const tags = (list: string[] = []) => [...new Set(list.map(tagSpelling).filter(Boolean))];
  const only = tags(narrow.only).sort();
  const not = tags(narrow.not).filter((tag) => !only.includes(tag)).sort();
  const p = new URLSearchParams();
  if (only.length) p.set("only", only.join(","));
  if (not.length) p.set("not", not.join(","));
  if (narrow.from && DATE.test(narrow.from)) p.set("from", narrow.from);
  if (narrow.to && DATE.test(narrow.to)) p.set("to", narrow.to);
  const tail = p.toString();
  return tail ? `${head}\n${tail}` : head;
}
