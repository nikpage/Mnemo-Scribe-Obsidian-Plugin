// [Guru, Librarian]

import { Component, ItemView, MarkdownRenderer, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { OutOfCredits, PriceChanged, type Quote, type ScribeApi, type SearchHit, type WhatNextScope } from "./api";
import { type Billing, JOBS, type Job, costLabel, parentOf, refusal, spentLine, subjectTarget, tagKey } from "./rules";
import type { SyncEngine } from "./sync";

export const MNEMO_VIEW = "mnemo-search";

const TABS = ["Topic", "Next", "Ask", "Details", "Related", "Search", "Themes", "Clients"] as const;
type Tab = (typeof TABS)[number];

/** Words are free and run as you type; meaning is a model call and is asked for. */
const HINT =
  "Typing finds the words you type. Semantic search finds notes that mean the same thing — a model call, so it runs only when you press it.";

/** A reading cut at its headings, as the app cuts it (`lib/note/reading-sections.ts`). */
export function readingSections(text: string): { heading: string | null; body: string }[] {
  const sections: { heading: string | null; body: string[] }[] = [];
  for (const line of text.split("\n")) {
    const heading = /^\s*(?:#{1,6}\s+(.+?)\s*#*|\*\*(.+?)\*\*:?(\s*\([^)]*\))?)\s*$/.exec(line);
    if (heading) sections.push({ heading: (heading[1] ?? `${heading[2]}${heading[3] ?? ""}`).replace(/\*\*/g, "").trim(), body: [] });
    else if (sections.length) sections[sections.length - 1].body.push(line);
    else sections.push({ heading: null, body: [line] });
  }
  return sections
    .map((s) => ({ heading: s.heading, body: s.body.join("\n").trim() }))
    .filter((s) => s.heading || s.body);
}

export type PanelDeps = {
  api: ScribeApi | null;
  sync: SyncEngine | null;
  billing: () => Promise<Billing & { rates: { operation: string; credits: number | string; per: number | string }[] } | null>;
};

/**
 * Scribe in the sidebar: everything the app can do with the notes, on the
 * note that is open, its folder, or the whole vault.
 *
 * Reading back what Scribe already wrote is free. A paid press names its
 * price on the button, quoted by Scribe before the press and taken exactly, is refused here at zero credits with a way to top up,
 * and goes through the same routes as the app, so the app's never-pay-twice
 * rules hold: the plugin has no AI of its own.
 */
export class MnemoSearchView extends ItemView {
  private tab: Tab = "Topic";
  private body!: HTMLElement;
  private balance!: HTMLElement;
  private tabBar!: HTMLElement;
  private renderers = new Component();
  private poll: number | null = null;
  private readingScope: WhatNextScope = "item";

  // Search keeps its box between tabs.
  private input: HTMLInputElement | null = null;
  private timer: number | null = null;
  private lastQuery = "";

  constructor(
    leaf: WorkspaceLeaf,
    private deps: () => PanelDeps,
    private afterChange: () => Promise<void>,
    private syncNow: () => void
  ) {
    super(leaf);
  }

  getViewType() {
    return MNEMO_VIEW;
  }

  getDisplayText() {
    return "Mnemo";
  }

  getIcon() {
    return "brain";
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("mnemo-view");

    const head = root.createDiv({ cls: "mnemo-bar" });
    this.balance = head.createDiv({ cls: "mnemo-balance" });
    const sync = head.createEl("button", { cls: "mnemo-icon-button", attr: { "aria-label": "Sync now" } });
    setIcon(sync, "refresh-cw");
    sync.onclick = () => this.syncNow();

    this.tabBar = root.createDiv({ cls: "mnemo-tabs" });
    this.body = root.createDiv({ cls: "mnemo-body" });
    this.addChild(this.renderers);

    // The note-bound tabs follow whichever note is open.
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        if (this.tab === "Next" || this.tab === "Details" || this.tab === "Related") void this.show(this.tab);
      })
    );

    this.drawTabs();
    await this.show(this.tab);
  }

  async onClose() {
    this.stopPolling();
  }

  private drawTabs() {
    this.tabBar.empty();
    for (const tab of TABS) {
      const button = this.tabBar.createEl("button", { text: tab, cls: tab === this.tab ? "is-active" : "" });
      button.onclick = () => void this.show(tab);
    }
  }

  private async show(tab: Tab) {
    this.tab = tab;
    this.stopPolling();
    this.drawTabs();
    this.body.empty();
    this.renderers.unload();
    this.renderers = this.addChild(new Component());

    const { api } = this.deps();
    if (!api) {
      this.say("Paste your device token in Mnemo's settings first.");
      return;
    }
    void this.showBalance();

    try {
      if (tab === "Topic") await this.topic(api);
      else if (tab === "Next") await this.whatNext(api);
      else if (tab === "Ask") this.ask(api);
      else if (tab === "Details") await this.details(api);
      else if (tab === "Related") await this.related(api);
      else if (tab === "Search") this.search();
      else if (tab === "Themes") await this.themes(api);
      else await this.clients(api);
    } catch (err) {
      this.say((err as Error).message);
    }
  }

  private say(text: string, into: HTMLElement = this.body) {
    into.createDiv({ cls: "mnemo-note", text });
  }

  private async showBalance() {
    const billing = await this.deps().billing().catch(() => null);
    this.balance.empty();
    if (!billing?.paysInCredits) return;
    this.balance.setText(`${billing.credits} credit${billing.credits === 1 ? "" : "s"}`);
    if (billing.credits <= 0) this.topUp(this.balance);
  }

  private topUp(into: HTMLElement) {
    const api = this.deps().api;
    if (!api) return;
    into.createEl("a", { text: " Top up", href: api.topUpUrl });
  }

  /** Paid work refused plainly, with where to top up. */
  private refused(into: HTMLElement, message: string) {
    const line = into.createDiv({ cls: "mnemo-note mnemo-refused", text: message });
    this.topUp(line);
  }

  private async markdown(text: string, into: HTMLElement) {
    const source = this.app.workspace.getActiveFile()?.path ?? "";
    await MarkdownRenderer.render(this.app, text, into, source, this.renderers);
  }

  /** The note open now, if it is one Scribe holds. */
  private async openNote(): Promise<{ file: TFile; id: string } | null> {
    const file = this.app.workspace.getActiveFile();
    const sync = this.deps().sync;
    if (!file || !sync) return null;
    const id = await sync.idOf(file);
    return id ? { file, id } : null;
  }

  private async openById(id: string) {
    const { sync } = this.deps();
    if (!sync) return;
    try {
      const path = await sync.pullOne(id);
      await this.afterChange();
      const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
      if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
      else new Notice("Mnemo: that note is not synced to this vault.");
    } catch (err) {
      new Notice(`Mnemo: ${(err as Error).message}`);
    }
  }

  // — Topic ———————————————————————————————————————————————————

  /**
   * Work on a topic, as the app's home screen offers it: a job, a topic
   * (typed, or one of the day's three, which offer only the jobs their notes
   * support), and a narrowing by tags and dates. The price is on the button.
   */
  private async topic(api: ScribeApi) {
    const form = this.body.createDiv();
    const jobs = form.createDiv({ cls: "mnemo-row mnemo-scope" });
    const input = form.createEl("input", { type: "text", cls: "mnemo-input", attr: { placeholder: "A topic, e.g. my kombucha batches", maxlength: "200" } });
    const picks = form.createDiv({ cls: "mnemo-row mnemo-scope" });
    const only = form.createEl("input", { type: "text", cls: "mnemo-input", attr: { placeholder: "Only notes tagged… (comma-separated)" } });
    const not = form.createEl("input", { type: "text", cls: "mnemo-input", attr: { placeholder: "Leave out notes tagged…" } });
    const dates = form.createDiv({ cls: "mnemo-row" });
    dates.createSpan({ text: "From" });
    const from = dates.createEl("input", { type: "date" });
    dates.createSpan({ text: "to" });
    const to = dates.createEl("input", { type: "date" });
    const press = form.createEl("button", { cls: "mod-cta mnemo-wide", text: "Read" });
    const why = form.createDiv({ cls: "mnemo-note" });
    const area = this.body.createDiv();

    let job: Job = "inspiration";
    let allowed: readonly string[] | null = null;
    let quote: Quote | null = null;
    const list = (box: HTMLInputElement) => box.value.split(",").map((t) => t.trim()).filter(Boolean);
    const narrow = () => ({ only: list(only), not: list(not), from: from.value, to: to.value });

    const drawJobs = () => {
      jobs.empty();
      for (const [key, name] of JOBS) {
        if (allowed && !allowed.includes(key)) continue;
        const button = jobs.createEl("button", { text: name, cls: key === job ? "is-active" : "" });
        button.onclick = () => {
          job = key;
          drawJobs();
          void price();
        };
      }
    };
    // Priced on a stand-in topic: the wording never changes the price.
    const price = async () => {
      quote = await api.quoteReading("subject", subjectTarget(job, "topic", narrow())).catch(() => null);
      press.setText(`Read${quote?.credits ? ` · ${quote.credits} credit${quote.credits === 1 ? "" : "s"}` : ""}`);
      press.disabled = quote?.credits === null;
      why.setText(
        quote?.credits === null
          ? "No notes are left after narrowing."
          : quote?.credits
            ? `${quote.credits} credits: one AI reading of ${quote.notes ?? 0} notes. You have ${quote.balance ?? 0}.`
            : ""
      );
    };

    input.addEventListener("input", () => {
      allowed = null;
      drawJobs();
    });
    for (const box of [only, not, from, to]) box.addEventListener("change", () => void price());
    for (const pick of await api.suggestions().catch(() => [])) {
      const button = picks.createEl("button", { text: pick.label });
      button.onclick = () => {
        input.value = pick.subject;
        allowed = pick.jobs;
        if (pick.jobs.length && !pick.jobs.includes(job)) job = pick.jobs[0] as Job;
        drawJobs();
        void price();
      };
    }

    // The newest topic reading until one is asked.
    let asked = "";
    const show = () => this.reading(api, area, "subject", asked);
    press.onclick = async () => {
      const topic = input.value.trim();
      if (!topic) return;
      const no = refusal(await this.deps().billing().catch(() => null));
      if (no) return this.refused(area, no);
      asked = subjectTarget(job, topic, narrow());
      try {
        await api.pressWhatNext("subject", asked, quote?.credits ?? null);
      } catch (err) {
        if (err instanceof OutOfCredits) return this.refused(area, err.message);
        if (err instanceof PriceChanged) void price();
        new Notice(`Mnemo: ${(err as Error).message}`);
      }
      await show();
      void this.showBalance();
    };

    drawJobs();
    await price();
    await show();
  }

  // — What next ————————————————————————————————————————————————

  private async whatNextTarget(): Promise<{ scope: WhatNextScope; target: string; label: string } | null> {
    if (this.readingScope === "overview") return { scope: "overview", target: "", label: "everything" };
    const file = this.app.workspace.getActiveFile();
    if (this.readingScope === "tags") {
      // A folder read as its tags: its words, as a move into it would add.
      const folder = file ? parentOf(file.path) : "";
      const tags = folder.split(/[/\s]+/).map(tagKey).filter(Boolean);
      return tags.length ? { scope: "tags", target: tags.join(","), label: `notes tagged ${tags.join(", ")}` } : null;
    }
    const note = await this.openNote();
    return note ? { scope: "item", target: note.id, label: note.file.basename } : null;
  }

  private async whatNext(api: ScribeApi) {
    const picker = this.body.createDiv({ cls: "mnemo-row mnemo-scope" });
    for (const [scope, text] of [["item", "This note"], ["tags", "This folder"], ["overview", "Everything"]] as const) {
      const button = picker.createEl("button", { text, cls: this.readingScope === scope ? "is-active" : "" });
      button.onclick = () => {
        this.readingScope = scope;
        void this.show("Next");
      };
    }

    const target = await this.whatNextTarget();
    if (!target) {
      this.say(this.readingScope === "item" ? "Open a Scribe note to read it against the notes before it." : "This note sits in no folder.");
      return;
    }
    await this.reading(api, this.body.createDiv(), target.scope, target.target, target.label);
  }

  /**
   * The reading last written for `scope` and `target`, each heading with its
   * Elaborate at its quoted price; with `label`, the press for a new one too.
   */
  private async reading(api: ScribeApi, area: HTMLElement, scope: WhatNextScope, target: string, label?: string) {
    const billing = await this.deps().billing().catch(() => null);
    const cost = (quote: Quote | null) => costLabel(billing, quote?.credits ?? null);
    const why = (quote: Quote | null, into: HTMLElement) => {
      if (quote?.credits) this.say(`${quote.credits} credits: one AI reading of ${quote.notes ?? 0} notes. You have ${quote.balance ?? 0}.`, into);
    };

    const draw = async () => {
      area.empty();
      const state = await api.whatNext(scope, target);
      const running = state.reading?.status === "running" || state.more.some((m) => m.status === "running");
      const done = state.reading?.status === "done" ? state.reading : null;

      if (state.failed) this.say(state.failed === "declined" ? "Google declined to read these notes." : "The last reading failed; nothing was charged.", area);

      if (label !== undefined) {
        const quote = await api.quoteReading(scope, target).catch(() => null);
        const press = area.createEl("button", {
          cls: "mod-cta mnemo-wide",
          text: running ? "Reading…" : `${state.reading ? "Read again" : "Read"} ${label}${cost(quote)}`,
        });
        press.disabled = running || quote?.credits === null;
        press.onclick = () => void pressed(quote, undefined);
        why(quote, area);
      }

      if (done?.reading) {
        const spent = spentLine(done.spent);
        if (spent) this.say(spent, area);
        const elaborateQuote = await api.quoteReading(scope, done.target ?? target, done.id).catch(() => null);
        for (const section of readingSections(done.reading)) {
          const block = area.createDiv({ cls: "mnemo-section" });
          await this.markdown([section.heading ? `### ${section.heading}` : "", section.body].filter(Boolean).join("\n\n"), block);
          if (!section.heading) continue;
          const more = state.more.find((m) => m.part === section.heading && m.status !== "failed");
          if (more?.status === "done" && more.reading) {
            const box = block.createDiv({ cls: "mnemo-more" });
            await this.markdown(more.reading, box);
            const spent = spentLine(more.spent);
            if (spent) this.say(spent, box);
          } else {
            const elaborate = block.createEl("button", {
              text: more?.status === "running" ? "Reading…" : `Elaborate${cost(elaborateQuote)}`,
            });
            elaborate.disabled = more?.status === "running" || running;
            elaborate.onclick = () => void pressed(elaborateQuote, { parentId: done.id, part: section.heading! }, done.target ?? target);
          }
        }
      } else if (!running) {
        this.say("No reading yet.", area);
      }

      if (running) this.startPolling(draw);
      else this.stopPolling();
    };

    const pressed = async (quote: Quote | null, more?: { parentId: string; part: string }, on = target) => {
      const no = refusal(await this.deps().billing().catch(() => null));
      if (no) return this.refused(area, no);
      try {
        await api.pressWhatNext(scope, on, quote?.credits ?? null, more);
      } catch (err) {
        if (err instanceof OutOfCredits) return this.refused(area, err.message);
        new Notice(`Mnemo: ${(err as Error).message}`);
      }
      await draw();
      void this.showBalance();
    };

    await draw();
  }

  private startPolling(again: () => Promise<void>) {
    if (this.poll) return;
    this.poll = window.setInterval(() => void again(), 3000);
  }

  private stopPolling() {
    if (this.poll) window.clearInterval(this.poll);
    this.poll = null;
  }

  // — Ask ———————————————————————————————————————————————————————

  private ask(api: ScribeApi) {
    const box = this.body.createEl("textarea", { cls: "mnemo-ask", attr: { placeholder: "Ask your notes…", rows: "3" } });
    const button = this.body.createEl("button", { cls: "mod-cta mnemo-wide", text: "Ask" });
    const out = this.body.createDiv();

    // The price moves with the store, never with the question.
    let quote: Quote | null = null;
    const price = async () => {
      const billing = await this.deps().billing().catch(() => null);
      quote = await api.quoteAsk().catch(() => null);
      button.setText(`Ask${costLabel(billing, quote?.credits ?? null)}`);
      button.setAttr("title", quote?.credits ? `${quote.credits} credits: one AI answer written from your notes. You have ${quote.balance ?? 0}.` : "");
    };
    void price();

    button.onclick = async () => {
      const question = box.value.trim();
      if (question.length < 3) return;
      out.empty();
      const no = refusal(await this.deps().billing().catch(() => null));
      if (no) return this.refused(out, no);

      button.disabled = true;
      this.say("Reading your notes…", out);
      try {
        const result = await api.ask(question, quote?.credits ?? null);
        out.empty();
        if (!result.answer) {
          this.say(result.declined ? "Google declined to answer from these notes." : "No answer: nothing in the notes matched.", out);
          return;
        }
        // Each [n] opens the note it cites.
        const para = out.createDiv({ cls: "mnemo-answer" });
        for (const part of result.answer.split(/(\[\d+\])/)) {
          const n = /^\[(\d+)\]$/.exec(part);
          const cited = n ? result.cited[Number(n[1]) - 1] : null;
          if (!cited) {
            para.appendText(part);
            continue;
          }
          const link = para.createEl("a", { text: part, attr: { "aria-label": cited.label } });
          link.onclick = () => void this.openById(cited.id);
        }
        const spent = spentLine(result.spent);
        if (spent) this.say(spent, out);
        void this.showBalance();
      } catch (err) {
        out.empty();
        if (err instanceof OutOfCredits) this.refused(out, err.message);
        else this.say((err as Error).message, out);
        if (err instanceof PriceChanged) void price();
      } finally {
        button.disabled = false;
      }
    };
  }

  // — Key details ————————————————————————————————————————————————

  private async details(api: ScribeApi) {
    const note = await this.openNote();
    if (!note) return this.say("Open a Scribe note to see its key details.");
    const facts = (await api.facts(note.id)).filter((f) => f.confidence >= 0.5);
    if (!facts.length) return this.say("No key details in this note.");
    for (const fact of facts) {
      const row = this.body.createDiv({ cls: "mnemo-hit" });
      row.createDiv({
        cls: "mnemo-result-title",
        text: `${fact.subject} · ${fact.variable}: ${fact.valueText}${fact.unit ? ` ${fact.unit}` : ""}`,
      });
      const when = fact.happenedOn || fact.saidOn;
      if (when) row.createEl("small", { cls: "mnemo-result-meta", text: when });
      if (fact.quote) row.createDiv({ cls: "mnemo-result-excerpt", text: `“${fact.quote}”` });
    }
  }

  // — Related ———————————————————————————————————————————————————

  private async related(api: ScribeApi) {
    const note = await this.openNote();
    if (!note) return this.say("Open a Scribe note to see the notes nearest it.");
    const related = await api.related(note.id);
    if (!related.length) return this.say("Nothing close to this note yet.");
    for (const other of related) {
      const row = this.body.createDiv({ cls: "mnemo-hit" });
      row.createDiv({ cls: "mnemo-result-title", text: other.title });
      row.onclick = () => void this.openById(other.id);
    }
  }

  // — Search ————————————————————————————————————————————————————

  private search() {
    const bar = this.body.createDiv({ cls: "mnemo-bar" });
    const previous = this.input?.value ?? "";
    this.input = bar.createEl("input", {
      type: "search",
      cls: "mnemo-input",
      attr: { placeholder: "Search your notes…", spellcheck: "false" },
    });
    this.input.value = previous;

    // Meaning is one deliberate press, in both places it can be asked for.
    const meaning = this.body.createEl("button", { text: "Semantic search", cls: "mnemo-meaning mnemo-wide" });
    const note = this.body.createDiv();
    const list = this.body.createDiv({ cls: "mnemo-list" });
    const input = this.input;
    meaning.onclick = () => void this.runSearch(input.value, true, note, list);

    input.addEventListener("input", () => {
      if (this.timer) window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => void this.runSearch(input.value, false, note, list), 250);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      void this.runSearch(input.value, event.ctrlKey || event.metaKey, note, list);
    });

    if (previous) void this.runSearch(previous, false, note, list);
    else this.say(HINT, note);
  }

  private async runSearch(raw: string, byMeaning: boolean, note: HTMLElement, list: HTMLElement) {
    const query = raw.trim();
    this.lastQuery = query;
    note.empty();
    if (query.length < 2) {
      list.empty();
      this.say(HINT, note);
      return;
    }
    const { api } = this.deps();
    if (!api) return;

    this.say(byMeaning ? "Searching by meaning…" : "Searching…", note);
    try {
      const hits = await api.search(query, byMeaning);
      // A slower search that has been overtaken must not paint over the newer one.
      if (this.lastQuery !== query) return;
      this.renderHits(hits, byMeaning, note, list);
    } catch (err) {
      list.empty();
      note.empty();
      this.say((err as Error).message, note);
    }
  }

  private renderHits(hits: SearchHit[], byMeaning: boolean, note: HTMLElement, list: HTMLElement) {
    list.empty();
    note.empty();
    if (!hits.length) {
      this.say(byMeaning ? "Nothing close to that." : "No words matched. Try semantic search.", note);
      return;
    }
    this.say(`${hits.length} result${hits.length === 1 ? "" : "s"}${byMeaning ? ", by meaning" : ""}`, note);

    for (const hit of hits) {
      const item = list.createDiv({ cls: "mnemo-hit" });
      item.createDiv({ text: hit.note.label, cls: "mnemo-result-title" });
      const tags = (hit.note.tags || []).map((t) => `#${t}`).join("  ");
      if (tags) item.createEl("small", { text: tags, cls: "mnemo-result-meta" });
      if (hit.excerpt) item.createDiv({ text: hit.excerpt.slice(0, 200), cls: "mnemo-result-excerpt" });
      item.onclick = () => void this.openById(hit.note.id);
    }
  }

  focusSearch() {
    if (this.tab !== "Search") void this.show("Search").then(() => this.input?.focus());
    else this.input?.focus();
  }

  // — Themes ————————————————————————————————————————————————————

  private async themes(api: ScribeApi) {
    const themes = await api.themes();
    if (!themes.length) return this.say("No themes yet. Scribe finds them once there are enough notes.");
    for (const theme of themes) {
      const block = this.body.createDiv({ cls: "mnemo-section" });
      await this.markdown(`### ${theme.name}\n\n${theme.body}`, block);
    }
    this.say("The weekly report arrives as a note of its own.");
  }

  // — Clients ———————————————————————————————————————————————————

  private async clients(api: ScribeApi) {
    const subjects = await api.subjects();
    if (!subjects.length) return this.say("No clients. They appear when a trade pack is on in Scribe's settings.");
    for (const subject of subjects) {
      const row = this.body.createDiv({ cls: "mnemo-hit" });
      row.createDiv({ cls: "mnemo-result-title", text: subject.name });
      row.createEl("small", { cls: "mnemo-result-meta", text: `${subject.notes} note${subject.notes === 1 ? "" : "s"}` });
      row.onclick = async () => {
        this.body.empty();
        const back = this.body.createEl("button", { text: "← Clients" });
        back.onclick = () => void this.show("Clients");
        this.body.createEl("h4", { text: subject.name });
        const notes = await api.subjectNotes(subject.id);
        if (!notes.length) return this.say("No notes yet.");
        for (const note of notes) {
          const item = this.body.createDiv({ cls: "mnemo-hit" });
          item.createDiv({ cls: "mnemo-result-title", text: note.label });
          item.createEl("small", { cls: "mnemo-result-meta", text: note.recorded_at.slice(0, 10) });
          item.onclick = () => void this.openById(note.id);
        }
      };
    }
  }
}
