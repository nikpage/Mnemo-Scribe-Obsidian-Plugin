// [Librarian]

import { App, Notice, SuggestModal, TFile } from "obsidian";
import type { ScribeApi, SearchHit } from "./api";
import type { SyncEngine } from "./sync";

/**
 * Searching without leaving Obsidian.
 *
 * Typing runs the word search, which is a database lookup and costs nothing.
 * Meaning costs a model call, so it is one deliberate keystroke — Ctrl/Cmd +
 * Enter — and never something that fires while a phrase is half typed.
 *
 * A result that is not in this vault yet is fetched and written before it is
 * opened, so a hit always opens as a note and never as a web page.
 */
export class MnemoSearchModal extends SuggestModal<SearchHit> {
  private byMeaning = false;
  private lastQuery = "";

  constructor(
    app: App,
    private api: ScribeApi,
    private sync: SyncEngine,
    private afterChange: () => Promise<void>
  ) {
    super(app);
    this.setPlaceholder("Search Scribe notes…");
    this.setInstructions([
      { command: "↑↓", purpose: "navigate" },
      { command: "↵", purpose: "open" },
      { command: "ctrl ↵", purpose: "search by meaning" },
    ]);

    this.scope.register(["Mod"], "Enter", (event) => {
      event.preventDefault();
      this.byMeaning = true;
      // Re-running the same text is what turns a word search into a meaning
      // search; the modal only re-asks when the input changes.
      const input = this.inputEl;
      const text = input.value;
      input.value = text + " ";
      input.dispatchEvent(new Event("input"));
      input.value = text;
      input.dispatchEvent(new Event("input"));
      return false;
    });
  }

  async getSuggestions(query: string): Promise<SearchHit[]> {
    const text = query.trim();
    if (text.length < 2) return [];

    // A new phrase is a new question, and questions start as words.
    if (text !== this.lastQuery) {
      if (this.lastQuery && !text.startsWith(this.lastQuery.slice(0, 2))) this.byMeaning = false;
      this.lastQuery = text;
    }

    try {
      return await this.api.search(text, this.byMeaning);
    } catch (err) {
      new Notice(`Mnemo: ${(err as Error).message}`);
      return [];
    }
  }

  renderSuggestion(hit: SearchHit, el: HTMLElement) {
    el.createEl("div", { text: hit.note.label, cls: "mnemo-result-title" });
    const meta = [hit.note.path, ...(hit.note.tags || []).map((t) => `#${t}`)]
      .filter(Boolean)
      .join("  ");
    if (meta) el.createEl("small", { text: meta, cls: "mnemo-result-meta" });
    el.createEl("div", { text: hit.excerpt.slice(0, 160), cls: "mnemo-result-excerpt" });
  }

  async onChooseSuggestion(hit: SearchHit) {
    try {
      const path = await this.sync.pullOne(hit.note.id);
      await this.afterChange();
      if (!path) {
        new Notice("Mnemo: that note could not be fetched.");
        return;
      }
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
    } catch (err) {
      new Notice(`Mnemo: ${(err as Error).message}`);
    }
  }
}
