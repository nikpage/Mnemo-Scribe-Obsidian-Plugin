// [Smith]

import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  WorkspaceLeaf,
  debounce,
  normalizePath,
} from "obsidian";
import { type BillingInfo, OutOfCredits, ScribeApi } from "./api";
import { SyncEngine } from "./sync";
import {
  type SyncState,
  WHOLE_VAULT,
  afterDelete,
  costLabel,
  emptyState,
  parentOf,
  refusal,
} from "./rules";
import { MnemoSearchModal } from "./search";
import { MNEMO_VIEW, MnemoSearchView } from "./view";
import { RecordModal, Recordings } from "./record";
import { obsidianHttp } from "./http";

/**
 * Mnemo — Scribe in Obsidian, desktop and phone.
 *
 * The folders the person ticks sync both ways with Scribe. Where a file sits
 * is theirs: a note is rewritten where it stands, a new one lands where its
 * tags fit, and nothing is deleted on either side without asking.
 */

type ScribeSettings = {
  baseUrl: string;
  token: string;
  /** Vault folders that sync with Scribe; "/" is the whole vault. */
  synced: string[];
  /** Where a new note goes when no folder is a clear fit. */
  inbox: string;
  /** Shared tags a folder needs to take a new note. */
  minShared: number;
  /** How far ahead of the runner-up it must be. */
  ratio: number;
  /** Minutes between pulls. */
  interval: number;
  /** Seconds of quiet after typing before an edit is sent. */
  quiet: number;
  /** Whether the panel has been put in front of this person once already. */
  panelShown: boolean;
};

type PersistedData = ScribeSettings & { state: SyncState; root?: string };

/** Scribe's own address: a person pastes a token and nothing else. */
const SCRIBE = "https://scribe02.netlify.app";

const DEFAULTS: ScribeSettings = {
  baseUrl: SCRIBE,
  token: "",
  synced: [],
  inbox: "From Mnemo Scribe",
  minShared: 2,
  ratio: 1.5,
  interval: 5,
  quiet: 10,
  panelShown: false,
};

/** A vault folder as typed: slashes tidied, no climbing out. */
function cleanFolder(input: string): string {
  return input
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

/** Two buttons and a question. Closing it any other way is the safe answer. */
class AskModal extends Modal {
  private answered = false;

  constructor(
    app: App,
    private question: string,
    private detail: string,
    private yes: string,
    private no: string,
    private done: (yes: boolean) => void
  ) {
    super(app);
  }

  onOpen() {
    this.contentEl.createEl("h3", { text: this.question });
    if (this.detail) this.contentEl.createEl("p", { text: this.detail });
    const row = this.contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: this.no }).onclick = () => this.answer(false);
    row.createEl("button", { text: this.yes, cls: "mod-cta" }).onclick = () => this.answer(true);
  }

  private answer(yes: boolean) {
    this.answered = true;
    this.close();
    this.done(yes);
  }

  onClose() {
    if (!this.answered) this.done(false);
  }
}

export default class MnemoPlugin extends Plugin {
  settings: ScribeSettings = { ...DEFAULTS };
  private state: SyncState = emptyState();
  private engine: SyncEngine | null = null;
  private status: HTMLElement | null = null;
  private running = false;
  private billingAt = 0;
  private billingCache: BillingInfo | null = null;
  private recordings!: Recordings;
  private pushSoon = debounce(() => void this.run("push"), DEFAULTS.quiet * 1000, true);

  async onload() {
    // What the person sees — settings and commands — is registered before
    // anything that reads disk or the network, so a failure further down
    // leaves a usable plugin rather than an invisible one.
    this.addSettingTab(new MnemoSettingTab(this.app, this));
    this.status = this.addStatusBarItem();
    this.status.addClass("mod-clickable");
    this.status.onClickEvent(() => void this.run("both", true));
    this.setStatus("starting…");
    this.recordings = new Recordings(this.app.vault.adapter, normalizePath(this.manifest.dir ?? `${this.app.vault.configDir}/plugins/mnemo-scribe`));

    this.addCommand({ id: "sync-now", name: "Sync now", callback: () => void this.run("both", true) });
    this.addCommand({ id: "import-new", name: "Import new files into Mnemo Scribe", callback: () => void this.importNew() });
    this.addCommand({
      id: "search",
      name: "Search notes",
      // No default keystroke: the plugin store asks plugins not to claim
      // one. A person sets their own under Settings → Hotkeys.
      callback: () => this.openSearch(),
    });
    this.addCommand({ id: "open-panel", name: "Open the Mnemo Scribe panel", callback: () => void this.showPanel() });
    this.addCommand({ id: "record", name: "Record a note", callback: () => void this.record() });

    this.registerView(
      MNEMO_VIEW,
      (leaf) =>
        new MnemoSearchView(leaf, {
          api: () => this.api(),
          sync: () => this.engineNow(),
          connect: async (token) => {
            this.settings.token = token.trim();
            this.resetEngine();
            await this.save();
            void this.run("both");
          },
          status: () => ({ text: this.statusText, choose: Boolean(this.settings.token) && this.settings.synced.length === 0 }),
          syncNow: () => this.run("both", true),
          record: () => void this.record(),
          folders: () => this.vaultFolders(),
          synced: () => this.settings.synced,
          tick: (folder, on) => this.tick(folder, on),
          importNew: () => this.importNew(),
          afterChange: () => this.save(),
        })
    );

    this.addRibbonIcon("brain", "Mnemo Scribe: panel", () => void this.showPanel());
    this.addRibbonIcon("mic", "Mnemo Scribe: record a note", () => void this.record());

    // An edit in a synced folder is a note to send back, once the typing
    // stops. Every other file in the vault is none of this plugin's business.
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && this.engineNow()?.owns(file.path)) this.pushSoon();
      })
    );

    // A file dragged to another folder is sent even though its text did not
    // change: the folder's words become tags. A renamed folder moves every
    // note inside it.
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFolder) {
          for (const note of Object.values(this.state.notes)) {
            if (note.file.startsWith(`${oldPath}/`)) note.file = file.path + note.file.slice(oldPath.length);
          }
        } else {
          for (const note of Object.values(this.state.notes)) if (note.file === oldPath) note.file = file.path;
        }
        void this.save();
        this.pushSoon();
      })
    );

    // Nothing is deleted without asking.
    this.registerEvent(this.app.vault.on("delete", (file) => void this.deleted(file.path)));

    // Settings live on disk and the first pull talks to the network. Neither
    // is allowed to take the plugin down with it.
    try {
      await this.loadSettings();
      this.setStatus(this.settings.token ? "ready" : "not connected");
      this.registerInterval(window.setInterval(() => void this.run("both"), Math.max(1, this.settings.interval) * 60_000));
      // Obsidian is slow to start; asking immediately competes with it.
      this.app.workspace.onLayoutReady(() => {
        void this.run("both");
        void this.sendRecordings();
        // First run in this vault: put the panel where it can be seen. After
        // that, wherever the person left it is where it belongs.
        if (!this.settings.panelShown) {
          this.settings.panelShown = true;
          void this.showPanel(false).then(() => this.save());
        }
      });
    } catch (err) {
      console.error("Mnemo Scribe: startup failed", err);
      this.setStatus("settings not loaded");
    }
  }

  /** The account's credits, asked at most once a minute: reading it is free but not instant. */
  async billing(fresh = false): Promise<BillingInfo | null> {
    const api = this.api();
    if (!api) return null;
    if (!fresh && this.billingCache && Date.now() - this.billingAt < 60_000) return this.billingCache;
    this.billingCache = await api.billing();
    this.billingAt = Date.now();
    return this.billingCache;
  }

  /**
   * A synced file was deleted here. Scribe's copy goes only on a yes; a no
   * keeps it there and stops it coming back to this vault.
   */
  private async deleted(path: string) {
    const engine = this.engineNow();
    if (!engine) return;
    if (engine.trashing.delete(path)) return;
    const id = Object.keys(this.state.notes).find((key) => this.state.notes[key].file === path);
    if (!id || !engine.owns(path)) return;

    const title = path.split("/").pop()!.replace(/\.md$/, "");
    new AskModal(
      this.app,
      `Also delete "${title}" from Mnemo Scribe?`,
      "Yes deletes the note, its audio and its transcript in Mnemo Scribe. No keeps it there and stops syncing it to this vault.",
      "Delete in Mnemo Scribe",
      "Keep in Mnemo Scribe",
      async (yes) => {
        try {
          if (yes) await this.api()?.deleteNote(id);
          afterDelete(this.state, id, yes);
        } catch (err) {
          // Not deleted there: kept, and not written back here either.
          afterDelete(this.state, id, false);
          new Notice(`Mnemo Scribe: not deleted in Mnemo Scribe — ${(err as Error).message}`);
        }
        await this.save();
      }
    ).open();
  }

  /** Record, after saying what it costs. Refused at zero credits. */
  async record() {
    const api = this.api();
    if (!api) {
      new Notice("Mnemo Scribe: paste your device token in settings first.");
      return;
    }
    const billing = await this.billing(true).catch(() => null);
    const no = refusal(billing);
    if (no) {
      new Notice(`Mnemo Scribe: ${no}`);
      return;
    }
    const rate = billing?.rates.find((r) => r.operation === "record");
    const costNote =
      billing?.paysInCredits && rate ? `Costs ${rate.credits} credit${Number(rate.credits) === 1 ? "" : "s"} a minute.` : "";
    new RecordModal(this.app, this.recordings, costNote, () => void this.sendRecordings()).open();
  }

  /** Every recording held on this device, sent. A failure keeps it for next time. */
  private async sendRecordings() {
    const api = this.api();
    if (!api) return;
    try {
      const sent = await this.recordings.sendAll(api);
      if (sent) new Notice(`Mnemo Scribe: ${sent === 1 ? "recording" : `${sent} recordings`} sent. The note arrives once it is transcribed.`);
    } catch (err) {
      if (err instanceof OutOfCredits) new Notice(`Mnemo Scribe: ${err.message} The recording is kept on this device.`);
      else new Notice(`Mnemo Scribe: recording kept on this device, not sent yet — ${(err as Error).message}`);
    }
  }

  /**
   * Import, on a yes. The server prices each file by what the AI will read,
   * and that price is said before anything is sent; the import takes it.
   */
  async importNew(within?: string) {
    const api = this.api();
    const engine = this.engineNow();
    if (!api || !engine) {
      new Notice("Mnemo Scribe: paste your device token in settings first.");
      return;
    }
    if (this.running) return;

    const files = await engine.unclaimed(within);
    if (files.length === 0) {
      if (!within) new Notice("Mnemo Scribe: no new files in the synced folders.");
      return;
    }

    const billing = await this.billing(true).catch(() => null);
    let quote: { credits: number; balance: number; each: number[] };
    try {
      quote = await engine.quoteImport(files);
    } catch (err) {
      new Notice(`Mnemo Scribe: could not price the import — ${(err as Error).message}`);
      return;
    }
    const cost = quote.credits;
    const no = refusal(billing);
    const detail = billing?.paysInCredits ? `${cost} credit${cost === 1 ? "" : "s"}; you have ${quote.balance}.` : "";

    const yes = await new Promise<boolean>((resolve) =>
      new AskModal(
        this.app,
        `Import ${files.length} file${files.length === 1 ? "" : "s"} into Mnemo Scribe?`,
        no ? no : detail,
        no ? "OK" : `Import${costLabel(billing, cost)}`,
        "Not now",
        resolve
      ).open()
    );
    if (!yes || no) return;

    this.running = true;
    this.setStatus(`importing ${files.length}…`);
    try {
      const { imported, failed } = await engine.importFiles(files, quote.each);
      await this.save();
      new Notice(
        `Mnemo Scribe: imported ${imported} file${imported === 1 ? "" : "s"}` +
          (failed.length ? `, ${failed.length} could not be read` : "")
      );
      for (const failure of failed) console.error(`Mnemo Scribe: ${failure.file} — ${failure.error}`);
      this.setStatus(`${Object.keys(this.state.notes).length} notes`);
    } catch (err) {
      this.setStatus("offline");
      new Notice(`Mnemo Scribe: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * The search modal, from wherever it was asked for. The sync engine is made
   * on demand: searching before the first sync is a perfectly normal thing to
   * do, and a hit still has to be written into the vault before it opens.
   */
  private openSearch() {
    const api = this.api();
    const engine = this.engineNow();
    if (!api || !engine) {
      new Notice("Mnemo Scribe: paste your device token in settings first.");
      return;
    }
    new MnemoSearchModal(this.app, api, engine, () => this.save()).open();
  }

  /** The panel, made if this is the first time and revealed either way. */
  async showPanel(focus = true) {
    const existing = this.app.workspace.getLeavesOfType(MNEMO_VIEW);
    for (const stale of existing.slice(1)) stale.detach();

    let leaf: WorkspaceLeaf | null = existing[0] ?? null;
    if (!leaf) {
      // Beside Obsidian's own search, where a person looks for it.
      leaf = this.app.workspace.getLeftLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: MNEMO_VIEW, active: true });
    }

    await this.app.workspace.revealLeaf(leaf);
    if (focus && leaf.view instanceof MnemoSearchView) leaf.view.focusSearch();
  }

  /** The sync engine, made on demand — searching may come before any sync. */
  private engineNow(): SyncEngine | null {
    const api = this.api();
    if (!api) return null;
    this.engine ??= new SyncEngine(
      this.app.vault,
      this.app.metadataCache,
      api,
      () => ({
        synced: this.settings.synced,
        inbox: this.settings.inbox,
        min: this.settings.minShared,
        ratio: this.settings.ratio,
      }),
      this.state
    );
    return this.engine;
  }

  private api(): ScribeApi | null {
    if (!this.settings.baseUrl || !this.settings.token) return null;
    return new ScribeApi(this.settings.baseUrl, this.settings.token, obsidianHttp);
  }

  /** A changed address, token or state starts a fresh engine. */
  resetEngine() {
    this.engine = null;
    this.billingCache = null;
  }

  private statusText = "";

  private setStatus(text: string) {
    this.statusText = text;
    this.status?.setText(`Mnemo Scribe: ${text}`);
    for (const leaf of this.app.workspace.getLeavesOfType(MNEMO_VIEW)) {
      if (leaf.view instanceof MnemoSearchView) leaf.view.refreshStatus();
    }
  }

  /** The panels start again: a new token or address changes everything they show. */
  restartPanels() {
    for (const leaf of this.app.workspace.getLeavesOfType(MNEMO_VIEW)) {
      if (leaf.view instanceof MnemoSearchView) void leaf.view.restart();
    }
  }

  /**
   * One sync at a time. Two overlapping runs would each write the same files
   * and each think the other's write was a user edit.
   */
  async run(what: "pull" | "push" | "both", loud = false) {
    const engine = this.engineNow();
    if (!engine) {
      if (loud) new Notice("Mnemo Scribe: paste your device token in settings first.");
      return;
    }
    if (this.running) return;
    if (this.settings.synced.length === 0) {
      if (loud) new Notice("Mnemo Scribe: choose which folders sync in Mnemo Scribe's settings first.");
      this.setStatus("no folders chosen");
      return;
    }

    this.running = true;
    this.setStatus("syncing…");

    try {
      // Push first: a local edit that has not gone up yet would otherwise be
      // overwritten by the pull that follows it.
      const pushed = what === "pull" ? { saved: 0, conflicts: 0 } : await engine.push();
      const pulled = what === "push" ? 0 : await engine.pull();
      const gone = what === "push" ? 0 : await engine.removeGone();
      await this.save();

      const when = new Date().toTimeString().slice(0, 5);
      const held = Object.keys(this.state.notes).length;
      this.setStatus(`${held} note${held === 1 ? "" : "s"}, synced ${when}`);
      if (loud) {
        // "0 in, 0 out" is true and says nothing. A sync that moved nothing
        // still has an answer: how many notes this vault holds.
        const moved = pulled || pushed.saved || pushed.conflicts || gone;
        new Notice(
          moved
            ? `Mnemo Scribe: ${pulled} in, ${pushed.saved} out` +
                (pushed.conflicts ? `, ${pushed.conflicts} conflicted` : "") +
                (gone ? `, ${gone} deleted in Mnemo Scribe moved to trash` : "")
            : `Mnemo Scribe: up to date — ${held} note${held === 1 ? "" : "s"}`
        );
      }
    } catch (err) {
      const message = (err as Error).message;
      this.setStatus("offline");
      if (loud) new Notice(`Mnemo Scribe: ${message}`);
      else console.error("Mnemo Scribe sync failed:", message);
    } finally {
      this.running = false;
    }
  }

  /**
   * Settings off disk. Deliberately not called `load()` — that is Component's
   * own method, the one Obsidian calls to start a plugin, and overriding it
   * means onload() never runs.
   */
  async loadSettings() {
    const data = (await this.loadData()) as PersistedData | null;
    this.settings = { ...DEFAULTS, ...(data || {}) };
    // A setting left blank by an older version means Scribe itself.
    this.settings.baseUrl ||= SCRIBE;
    // A vault from before folders were chosen synced one folder; it still does.
    if (data?.root && !data.synced) this.settings.synced = [cleanFolder(data.root) || WHOLE_VAULT];
    delete (this.settings as Partial<PersistedData>).root;

    // An older state has no detached list and no agreed folder per note. A
    // note's agreed folder is where it sits now, so the upgrade moves nothing
    // and sends nothing.
    this.state = { ...emptyState(), ...(data?.state || {}) };
    for (const note of Object.values(this.state.notes)) note.folder ??= parentOf(note.file);
    delete (this.state as { folders?: string }).folders;

    this.pushSoon = debounce(() => void this.run("push"), Math.max(2, this.settings.quiet) * 1000, true);
    this.resetEngine();
  }

  async save() {
    await this.saveData({ ...this.settings, state: this.state } satisfies PersistedData);
  }

  /** Forget every agreement; files are matched again by `scribe_id` on the next sync. */
  async forgetState() {
    this.state = emptyState();
    this.resetEngine();
    await this.save();
  }

  /** A folder ticked: it syncs from now on, and its new files are offered for import. */
  async tick(folder: string, on: boolean) {
    const synced = new Set(this.settings.synced);
    if (on) synced.add(folder);
    else synced.delete(folder);
    this.settings.synced = [...synced].sort();
    await this.save();
    if (on) await this.importNew(folder);
  }

  vaultFolders(): string[] {
    return this.engineNow()?.folders() ?? [];
  }
}

class MnemoSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: MnemoPlugin
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const settings = this.plugin.settings;

    new Setting(containerEl)
      .setName("Device token")
      .setDesc("From Mnemo Scribe → Settings → Connect a device. Shown there only once.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("scribe_…")
          .setValue(settings.token)
          .onChange(async (value) => {
            settings.token = value.trim();
            this.plugin.resetEngine();
            await this.plugin.save();
            this.plugin.restartPanels();
          });
      });

    new Setting(containerEl).setName("Folders that sync").setHeading();
    containerEl.createDiv({
      cls: "setting-item-description",
      text: "Ticked folders sync both ways, folders inside them included. Ticking one offers its new files for import and says the cost first. Unticking stops syncing; nothing is deleted either side.",
    });

    const folders = [WHOLE_VAULT, ...this.plugin.vaultFolders()];
    for (const folder of folders) {
      const depth = folder === WHOLE_VAULT ? 0 : folder.split("/").length - 1;
      const row = new Setting(containerEl)
        .setName(folder === WHOLE_VAULT ? "Whole vault" : folder.split("/").pop()!)
        .addToggle((toggle) =>
          toggle.setValue(settings.synced.includes(folder)).onChange(async (on) => {
            await this.plugin.tick(folder, on);
          })
        );
      row.settingEl.addClass(`mnemo-depth-${Math.min(depth, 4)}`);
    }

    new Setting(containerEl)
      .setName("Inbox")
      .setDesc("Where a note recorded elsewhere lands when no synced folder clearly fits it.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULTS.inbox)
          .setValue(settings.inbox)
          .onChange(async (value) => {
            settings.inbox = cleanFolder(value) || DEFAULTS.inbox;
            await this.plugin.save();
          })
      );

    new Setting(containerEl)
      .setName("A folder takes a new note at")
      .setDesc("Shared tags it needs, and how far ahead of the next folder it must be.")
      .addText((text) =>
        text.setValue(String(settings.minShared)).onChange(async (value) => {
          const n = Number(value);
          settings.minShared = Number.isInteger(n) && n >= 1 ? n : DEFAULTS.minShared;
          await this.plugin.save();
        })
      )
      .addText((text) =>
        text.setValue(String(settings.ratio)).onChange(async (value) => {
          const n = Number(value);
          settings.ratio = Number.isFinite(n) && n >= 1 ? n : DEFAULTS.ratio;
          await this.plugin.save();
        })
      );

    new Setting(containerEl)
      .setName("Check every")
      .setDesc("Minutes between pulls. Edits are sent as soon as typing stops, whatever this says.")
      .addText((text) =>
        text.setValue(String(settings.interval)).onChange(async (value) => {
          const minutes = Number(value);
          settings.interval = Number.isFinite(minutes) && minutes > 0 ? minutes : 5;
          await this.plugin.save();
        })
      );

    new Setting(containerEl)
      .setName("Send edits after")
      .setDesc("Seconds of quiet before an edit goes back. Each edit re-indexes the note.")
      .addText((text) =>
        text.setValue(String(settings.quiet)).onChange(async (value) => {
          const seconds = Number(value);
          settings.quiet = Number.isFinite(seconds) && seconds >= 2 ? seconds : 10;
          await this.plugin.save();
        })
      );

    new Setting(containerEl)
      .setName("Sync now")
      .setDesc("Sends edits, fetches anything new and reports what moved.")
      .addButton((button) => button.setButtonText("Sync now").setCta().onClick(() => void this.plugin.run("both", true)));

    new Setting(containerEl)
      .setName("Import new files")
      .setDesc("Files in the synced folders that Mnemo Scribe has never seen. Shows the cost before anything is sent.")
      .addButton((button) => button.setButtonText("Import").onClick(() => void this.plugin.importNew()));

    new Setting(containerEl)
      .setName("Start again")
      .setDesc("Forget what this vault has agreed with Mnemo Scribe. Files are matched again by their Mnemo Scribe id; nothing moves.")
      .addButton((button) =>
        button.setButtonText("Reset").onClick(async () => {
          await this.plugin.forgetState();
          new Notice("Mnemo Scribe: next sync matches every file again.");
        })
      );
  }
}
