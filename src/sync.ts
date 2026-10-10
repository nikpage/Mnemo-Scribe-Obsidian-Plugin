// [Smith]

import { MetadataCache, Notice, TFile, TFolder, Vault, normalizePath } from "obsidian";
import type { NoteApp, RemoteNote, ScribeApi } from "./api";
import {
  type Placement,
  type SyncState,
  WHOLE_VAULT,
  afterGone,
  hashOf,
  owns,
  parentOf,
  placeNote,
  pullAction,
  pushOf,
} from "./rules";

/** This app, as Scribe names it. */
export const APP: NoteApp = "obsidian";

/**
 * Keeping the vault and Scribe in step.
 *
 * Where a file sits is the vault's: a note is rewritten where it stands and
 * never moved. Scribe decides what a note says; the revision each side last
 * agreed on is what tells a normal edit from two people editing at once.
 */

export type Failure = { file: string; error: string };

/** Files per import request. The server takes 20; this stays under it. */
const BATCH = 10;

/** What the engine needs to know about this vault's choices. */
export type Scope = Placement & { synced: string[] };

/**
 * Related notes are links, not text.
 *
 * Obsidian counts a wikilink in front matter as a real link, so writing them
 * there gives the graph and the backlinks pane the meaning Scribe already
 * knows — without putting a generated line inside the body, which is the
 * user's own writing and the one thing this plugin never touches.
 *
 * It is also why the server does not render this: `buildNote()` renders a
 * note from the note, and which relatives can be linked to depends on what
 * this particular vault happens to hold. That is a fact about the vault.
 */
const RELATED_LINE = /^related:[^\n]*\r?\n(?:[ \t]*-[ \t]+[^\n]*\r?\n)*/m;

function frontmatterEnd(markdown: string): number {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  return match ? match[0].length : -1;
}

/** The same file with its related line replaced, added, or taken away. */
export function withRelated(markdown: string, links: string[]): string {
  const end = frontmatterEnd(markdown);
  // No front matter is not a note this plugin wrote; leave it exactly as is.
  if (end < 0) return markdown;

  const head = markdown.slice(0, end).replace(RELATED_LINE, "");
  const body = markdown.slice(end);
  if (links.length === 0) return head + body;

  const line = `related: [${links.map((l) => JSON.stringify(l)).join(", ")}]\n`;
  // Last line of the block, so it sits below what buildNote wrote.
  return head.replace(/---\r?\n?$/, `${line}---\n`) + body;
}

export function idFrom(markdown: string): string | null {
  const match = /^---\r?\n[\s\S]*?^scribe_id:\s*(\S+)\s*$[\s\S]*?^---/m.exec(markdown);
  return match ? match[1].replace(/^["']|["']$/g, "") : null;
}

export class SyncEngine {
  /** Files this engine is about to trash itself, so the delete question is not asked about them. */
  readonly trashing = new Set<string>();

  constructor(
    private vault: Vault,
    private cache: MetadataCache,
    private api: ScribeApi,
    private scope: () => Scope,
    private state: SyncState
  ) {}

  get current(): SyncState {
    return this.state;
  }

  owns(path: string): boolean {
    const { synced, inbox } = this.scope();
    return owns(path, synced, inbox);
  }

  /**
   * The note a vault file is, by the id in its front matter. Obsidian's index
   * answers for free; a file it has not indexed yet (just after start-up) is
   * read, because missing an id here is how a note gets written twice.
   */
  async idOf(file: TFile): Promise<string | null> {
    const cached = this.cache.getFileCache(file);
    const id = cached ? cached.frontmatter?.scribe_id : idFrom(await this.vault.cachedRead(file));
    return typeof id === "string" && id ? id : null;
  }

  /**
   * Links to the relatives this vault actually holds.
   *
   * A wikilink to a file that was never pulled is a broken link, and pulling
   * a note just because something points at it would drag in notes nobody
   * asked for. So an unheld neighbour is left out; it appears by itself once
   * its own note arrives.
   */
  private linksFor(id: string): string[] {
    const links: string[] = [];
    for (const other of this.state.related[id] || []) {
      const known = this.state.notes[other];
      if (!known) continue;
      if (!this.vault.getAbstractFileByPath(known.file)) continue;
      links.push(`[[${known.file.split("/").pop()!.replace(/\.md$/, "")}]]`);
    }
    return links;
  }

  private async ensureFolder(folder: string): Promise<void> {
    if (!folder || this.vault.getAbstractFileByPath(folder)) return;
    await this.vault.createFolder(folder).catch(() => {
      // Created by something else between the check and here; nothing to do.
    });
  }

  /** A free path in `folder` for `filename`: "Name.md", then "Name 2.md". */
  private freePath(folder: string, filename: string): string {
    const base = filename.replace(/\.md$/, "");
    for (let n = 1; ; n++) {
      const name = n === 1 ? `${base}.md` : `${base} ${n}.md`;
      const path = normalizePath(folder ? `${folder}/${name}` : name);
      if (!this.vault.getAbstractFileByPath(path)) return path;
    }
  }

  /**
   * Every file here that already is a Scribe note, matched by `scribe_id`
   * rather than by name, so a first sync, a re-install or a copied vault
   * writes nothing twice.
   */
  async adopt(): Promise<number> {
    const held = new Set(Object.values(this.state.notes).map((note) => note.file));
    let found = 0;
    for (const file of this.vault.getMarkdownFiles()) {
      if (held.has(file.path) || !this.owns(file.path)) continue;
      const id = await this.idOf(file);
      if (!id || this.state.notes[id] || this.state.detached.includes(id)) continue;
      // rev 0 is behind the server, so the next pull rewrites the file in place.
      this.state.notes[id] = { file: file.path, rev: 0, hash: "", folder: parentOf(file.path) };
      found++;
    }
    return found;
  }

  /** Each synced folder and the tags its notes carry, from Obsidian's own index: free. */
  private folderTags(): Record<string, string[]> {
    const folders: Record<string, string[]> = {};
    for (const file of this.vault.getMarkdownFiles()) {
      if (!this.owns(file.path)) continue;
      const raw = this.cache.getFileCache(file)?.frontmatter?.tags;
      const tags = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(/[,\s]+/) : [];
      const folder = parentOf(file.path);
      (folders[folder] ??= []).push(...tags);
    }
    return folders;
  }

  /**
   * One note written down. Returns the path, or null when this vault does
   * not sync it. `placed` collects where new notes landed, for one Notice.
   */
  async write(note: RemoteNote, placed?: { title: string; folder: string }[]): Promise<string | null> {
    const known = this.state.notes[note.id];
    const existing = known ? this.vault.getAbstractFileByPath(known.file) : null;
    const action = pullAction(
      note.id,
      this.state,
      known ? { exists: existing instanceof TFile, owned: this.owns(known.file) } : null
    );
    if (action === "skip") return null;

    const markdown = withRelated(note.markdown, this.linksFor(note.id));
    let path: string;

    if (action === "rewrite" && existing instanceof TFile) {
      path = existing.path;
      // A file that already says this is left alone: a pointless write is a
      // modify event, a push, and a file changed for every sync tool below us.
      if ((await this.vault.read(existing)) !== markdown) await this.vault.modify(existing, markdown);
    } else {
      // Back where it last was, or, new here, where its tags fit.
      const folder =
        action === "restore" && known
          ? known.folder
          : placeNote(note.tags, this.folderTags(), this.scope());
      const name = action === "restore" && known ? known.file.split("/").pop()! : note.filename;
      await this.ensureFolder(folder);
      path = this.freePath(folder, name);
      await this.vault.create(path, markdown);
      if (action === "place" && placed) placed.push({ title: name.replace(/\.md$/, ""), folder: folder || "the vault's top level" });
    }

    this.state.notes[note.id] = { file: path, rev: note.rev, hash: hashOf(markdown), folder: parentOf(path) };
    return path;
  }

  /** Everything the server has that this vault has not seen. */
  async pull(): Promise<number> {
    await this.adopt();
    let written = 0;
    let more = true;
    const touched = new Set<string>();
    const placed: { title: string; folder: string }[] = [];

    while (more) {
      const result = await this.api.pull(this.state.cursor, APP);
      for (const note of result.notes) {
        if (await this.write(note, placed)) {
          written++;
          touched.add(note.id);
        }
      }
      this.state.cursor = result.cursor;
      more = result.more;
    }

    if (placed.length === 1) {
      new Notice(`Mnemo Scribe: filed "${placed[0].title}" in ${placed[0].folder} — move the file to change it.`, 8000);
    } else if (placed.length > 1) {
      const where = [...new Set(placed.map((p) => p.folder))].join(", ");
      new Notice(`Mnemo Scribe: filed ${placed.length} new notes in ${where} — move a file to change it.`, 8000);
    }

    await this.refreshRelated(touched);
    return written;
  }

  /**
   * Notes in Scribe's Trash, or removed from Obsidian on another device. Their
   * files go to the vault's trash, never deleted outright, so a mistake there
   * is recoverable here. Returns how many files went.
   */
  async removeGone(): Promise<number> {
    const ids = [...Object.keys(this.state.notes), ...this.state.detached];
    if (ids.length === 0) return 0;
    const gone = await this.api.gone(ids, APP);
    // Removed here while offline, or before Scribe kept the list itself: said now.
    const told = new Set(gone);
    for (const id of this.state.detached.filter((id) => !told.has(id))) await this.api.detach(id, APP).catch(() => {});
    let trashed = 0;
    for (const id of gone) {
      const known = this.state.notes[id];
      const file = known ? this.vault.getAbstractFileByPath(known.file) : null;
      if (file instanceof TFile && known && this.owns(known.file)) {
        this.trashing.add(file.path);
        await this.vault.trash(file, false);
        trashed++;
      }
      afterGone(this.state, id);
    }
    return trashed;
  }

  /**
   * Re-ask for the relatives of the notes that just changed, and of the notes
   * they point at.
   *
   * A new note changes what its neighbours are related to, so both ends are
   * refreshed. Every other note in the store is left alone: asking for all of
   * them on every pull would be one request per note forever, to rewrite
   * files whose links did not move.
   */
  private async refreshRelated(ids: Set<string>): Promise<void> {
    if (ids.size === 0) return;

    // One note whose request fails is one note without links. Letting it
    // throw would abandon every note after it in the pass, which is how a
    // whole vault ends up with no links at all because of a single timeout.
    const relatives = async (id: string): Promise<string[]> => {
      try {
        const related = await this.api.related(id);
        this.state.related[id] = related.map((r) => r.id);
        return this.state.related[id];
      } catch {
        return this.state.related[id] || [];
      }
    };

    const reciprocal = new Set<string>();
    for (const id of ids) {
      for (const other of await relatives(id)) {
        if (!ids.has(other)) reciprocal.add(other);
      }
    }

    for (const id of reciprocal) await relatives(id);

    for (const id of [...ids, ...reciprocal]) await this.rewriteLinks(id);
  }

  /**
   * Put the current links on a file that is already written, without touching
   * anything else in it.
   *
   * A file the user has edited since the last sync stays dirty afterwards —
   * its agreed hash is left where it was — so the edit still goes up on the
   * next push and the rev check still decides any conflict. A clean file
   * stays clean, so a link that moved never looks like something somebody
   * typed.
   */
  private async rewriteLinks(id: string): Promise<void> {
    const known = this.state.notes[id];
    if (!known || !this.owns(known.file)) return;
    const file = this.vault.getAbstractFileByPath(known.file);
    if (!(file instanceof TFile)) return;

    const current = await this.vault.read(file);
    const updated = withRelated(current, this.linksFor(id));
    if (updated === current) return;

    const wasClean = hashOf(current) === known.hash;
    await this.vault.modify(file, updated);
    if (wasClean) known.hash = hashOf(updated);
  }

  /** One note the vault has never held, fetched so it can be opened. */
  async pullOne(id: string): Promise<string | null> {
    const known = this.state.notes[id];
    if (known && this.vault.getAbstractFileByPath(known.file)) return known.file;

    const note = await this.api.pullOne(id);
    if (!note) return null;
    const file = await this.write(note);
    if (file) await this.refreshRelated(new Set([id]));
    return file;
  }

  /** Every synced file Scribe has never seen. */
  async unclaimed(within?: string): Promise<TFile[]> {
    const held = new Set(Object.values(this.state.notes).map((note) => note.file));
    const candidates = this.vault
      .getMarkdownFiles()
      .filter(
        (file) =>
          this.owns(file.path) &&
          (!within || within === WHOLE_VAULT || file.path.startsWith(`${within}/`)) &&
          !held.has(file.path)
      );
    const out: TFile[] = [];
    for (const file of candidates) if (!(await this.idOf(file))) out.push(file);
    return out;
  }

  /**
   * What importing `files` will cost, batch by batch exactly as
   * `importFiles()` sends them, so each batch takes its own quote.
   */
  async quoteImport(files: TFile[]): Promise<{ credits: number; balance: number; each: number[] }> {
    const each: number[] = [];
    let balance = 0;
    for (const { batch } of this.batches(files)) {
      const quoted = await this.api.importQuote(await this.payload(batch));
      each.push(quoted.credits);
      balance = quoted.balance;
    }
    return { credits: each.reduce((sum, credits) => sum + credits, 0), balance, each };
  }

  /** The import's requests, in order: one folder each, at most `BATCH` files. */
  private batches(files: TFile[]): { folder: string; batch: TFile[] }[] {
    const byFolder = new Map<string, TFile[]>();
    for (const file of files) {
      const folder = parentOf(file.path);
      const group = byFolder.get(folder);
      if (group) group.push(file);
      else byFolder.set(folder, [file]);
    }
    const out: { folder: string; batch: TFile[] }[] = [];
    for (const [folder, group] of byFolder) {
      for (let at = 0; at < group.length; at += BATCH) out.push({ folder, batch: group.slice(at, at + BATCH) });
    }
    return out;
  }

  private payload(batch: TFile[]): Promise<{ name: string; data: ArrayBuffer }[]> {
    return Promise.all(batch.map(async (file) => ({ name: file.name, data: await this.vault.readBinary(file) })));
  }

  /**
   * Files written in the vault, made into notes.
   *
   * The folder a file sits in goes up with it, so its words become the
   * note's tags. The note is pulled straight back and written over the same
   * file, where it stands, so an import never leaves two copies.
   */
  async importFiles(files: TFile[], prices: number[]): Promise<{ imported: number; failed: Failure[] }> {
    const added = new Set<string>();
    const failed: Failure[] = [];

    for (const [at, { folder, batch }] of this.batches(files).entries()) {
      const payload = await this.payload(batch);

      const result = await this.api.ingest(payload, folder, prices[at] ?? 0);
      if (result.priceChanged !== undefined) {
        for (const file of batch) failed.push({ file: file.name, error: `price changed to ${result.priceChanged} credits; import again` });
      }
      failed.push(...result.failed);

      for (const note of result.imported) {
        // The server echoes the name it was sent, but a name is a weak key:
        // an encoding difference in one filename must not cost the note its
        // file, or the next pull writes it fresh and the vault holds two.
        const original =
          batch.find((file) => file.name === note.file) ||
          batch.find((file) => file.name.normalize("NFC") === note.file.normalize("NFC"));

        // Claimed at rev 0 — behind the server, so the pull below rewrites
        // this very file rather than writing a second one.
        if (original) this.state.notes[note.id] = { file: original.path, rev: 0, hash: "", folder: folder };

        const fresh = await this.api.pullOne(note.id);
        if (fresh) await this.write(fresh);
        added.add(note.id);
      }
    }

    // A note that has just arrived changes what its neighbours relate to, so
    // both ends get their links rewritten — the same pass a pull runs.
    await this.refreshRelated(added);

    return { imported: added.size, failed };
  }

  /**
   * Send back every note whose file was edited or moved since it was last
   * agreed. A conflict is not resolved here: the server's copy is written to
   * the file and the local edit is kept beside it, which is the only outcome
   * that cannot lose what somebody wrote.
   */
  async push(): Promise<{ saved: number; conflicts: number }> {
    const changed: { id: string; rev: number; folder?: string; markdown: string }[] = [];
    const sent = new Map<string, { markdown: string; path: string }>();

    for (const [id, note] of Object.entries(this.state.notes)) {
      if (!this.owns(note.file)) continue;
      const file = this.vault.getAbstractFileByPath(note.file);
      if (!(file instanceof TFile)) continue;

      const markdown = await this.vault.read(file);
      const what = pushOf(note, { folder: parentOf(file.path), hash: hashOf(markdown) });
      if (!what) continue;

      changed.push({ id, rev: note.rev, markdown, ...what });
      sent.set(id, { markdown, path: file.path });
    }

    if (changed.length === 0) return { saved: 0, conflicts: 0 };

    const result = await this.api.push(changed);

    for (const ok of result.saved) {
      const note = this.state.notes[ok.id];
      const was = sent.get(ok.id);
      if (!note || !was) continue;
      note.rev = ok.rev;
      note.hash = hashOf(was.markdown);
      note.folder = parentOf(was.path);
    }

    for (const conflict of result.conflicts) {
      await this.keepBoth(conflict, sent.get(conflict.id)?.markdown || "");
    }

    // A note the server has never heard of cannot be pushed again; forgetting
    // it stops the vault retrying the same rejected file every minute.
    for (const id of result.missing) delete this.state.notes[id];

    return { saved: result.saved.length, conflicts: result.conflicts.length };
  }

  private async keepBoth(note: RemoteNote, localMarkdown: string): Promise<void> {
    const target = await this.write(note);
    if (!target) return;
    const day = new Date().toISOString().slice(0, 10);
    const conflictPath = target.replace(/\.md$/, ` (conflict ${day}).md`);

    const existing = this.vault.getAbstractFileByPath(conflictPath);
    if (existing instanceof TFile) {
      await this.vault.modify(existing, localMarkdown);
    } else {
      await this.vault.create(conflictPath, localMarkdown);
    }

    new Notice(`Mnemo Scribe: "${note.filename}" changed in both places. Your copy is beside it.`);
  }

  /** Every folder in the vault, for choosing what syncs. */
  folders(): string[] {
    return this.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder && f.path !== "/")
      .map((f) => f.path)
      .sort();
  }
}
