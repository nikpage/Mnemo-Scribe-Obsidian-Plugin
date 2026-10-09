// [Guru, Librarian]

import { ItemView, Notice, TFile, type WorkspaceLeaf } from "obsidian";
import type { ScribeApi } from "./api";
import { WHOLE_VAULT, parentOf } from "./rules";
import type { SyncEngine } from "./sync";
import type { Host, Place, Shown, Status } from "./panel/host";
import { Panel } from "./panel/panel";
import { langOf } from "./panel/strings";

export const MNEMO_VIEW = "mnemo-search";

/** What the panel needs from the plugin, asked fresh each time: the token or the folders may have changed. */
export type PanelDeps = {
  api(): ScribeApi | null;
  sync(): SyncEngine | null;
  connect(token: string): Promise<void>;
  status(): Status;
  syncNow(): Promise<void>;
  record(): void;
  folders(): string[];
  synced(): string[];
  tick(folder: string, on: boolean): Promise<void>;
  importNew(): Promise<void>;
  afterChange(): Promise<void>;
};

/**
 * Scribe in the sidebar: the panel every app that holds Scribe notes shows
 * (`panel/panel.ts`), here fed by the vault.
 */
export class MnemoSearchView extends ItemView {
  private panel: Panel | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private deps: PanelDeps
  ) {
    super(leaf);
  }

  getViewType() {
    return MNEMO_VIEW;
  }

  getDisplayText() {
    return "Mnemo Scribe";
  }

  getIcon() {
    return "brain";
  }

  async onOpen() {
    const deps = this.deps;
    const app = this.app;
    const host: Host = {
      places: "folders",
      api: () => deps.api(),
      connect: (token) => deps.connect(token),
      note: async (): Promise<Shown | null> => {
        const file = app.workspace.getActiveFile();
        const sync = deps.sync();
        if (!file) return null;
        return { scribeId: sync ? await sync.idOf(file) : null, title: file.basename, folder: parentOf(file.path) };
      },
      open: async (id) => {
        const sync = deps.sync();
        if (!sync) return null;
        try {
          const path = await sync.pullOne(id);
          await deps.afterChange();
          const file = path ? app.vault.getAbstractFileByPath(path) : null;
          if (!(file instanceof TFile)) return "That note is not synced to this vault: tick its folder, or the whole vault, in Sync.";
          await app.workspace.getLeaf(false).openFile(file);
          return null;
        } catch (err) {
          return (err as Error).message;
        }
      },
      link: (url) => window.open(url),
      record: () => deps.record(),
      status: () => deps.status(),
      syncNow: () => deps.syncNow(),
      syncPlaces: async () => ({
        all: deps.folders().map((folder): Place => ({ id: folder, path: folder })),
        synced: deps.synced(),
      }),
      tick: (id, on) => deps.tick(id === "/" ? WHOLE_VAULT : id, on),
      importNew: () => deps.importNew(),
    };

    this.panel = new Panel(this.contentEl, host, langOf());
    // The note-bound parts follow whichever note is open.
    this.registerEvent(this.app.workspace.on("file-open", () => void this.panel?.noteChanged()));
    await this.panel.start().catch((err) => new Notice(`Mnemo Scribe: ${(err as Error).message}`));
  }

  /** The token or the address changed: everything is asked again. */
  async restart() {
    await this.panel?.start();
  }

  /** The status line, after a sync. */
  refreshStatus() {
    this.panel?.showStatus();
  }

  focusSearch() {
    void this.panel?.show("search");
  }
}
