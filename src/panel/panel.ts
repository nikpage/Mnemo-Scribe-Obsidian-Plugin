// [Guru, Librarian]

import { forgetScreens, mountScreen, type Screen } from "../app/screens";
import { connectScreens } from "../app/http";
import { OutOfCredits } from "../api";
import type { Billing } from "../rules";
import type { Host, Shown } from "./host";
import { type Key, type Lang, type Vars, t as say } from "./strings";
import { addStyle } from "./style";
import { installTips, tipOf } from "@/lib/tooltip";
import { OPEN_BRAIN } from "@/components/home-dashboard";

/**
 * Scribe beside the notes, the same in every app that holds them. Brain,
 * Search and This note are the app's own screens (`../app/screens.tsx`), so
 * they change when the app's do; Sync is the plugins' own.
 *
 * Reading back what Scribe already wrote is free. A paid press carries its
 * price, quoted by Scribe before the press and taken exactly, and goes
 * through the app's own routes: the panel has no AI of its own, so the
 * app's never-pay-twice rules hold.
 */

const TABS = ["home", "brain", "search", "note", "sync"] as const;
type Tab = (typeof TABS)[number];
const TAB_TIP: Record<Tab, Key> = { home: "tipTabHome", brain: "tipBrain", search: "tipTabSearch", note: "tipTabNote", sync: "tipTabSync" };
const TAB_LABEL: Record<Tab, Key> = { home: "tabHome", brain: "brainTitle", search: "tabSearch", note: "tabNote", sync: "tabSync" };

type Rates = Billing & { rates: { operation: string; credits: number | string; per: number | string }[] };

/** One element, made and placed. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  into: HTMLElement | null,
  options: { cls?: string; text?: string; attrs?: Record<string, string> } = {}
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.cls) node.className = options.cls;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [key, value] of Object.entries(options.attrs || {})) node.setAttribute(key, value);
  into?.appendChild(node);
  return node;
}

/** The app's coin, drawn as Lucide draws it. */
function coin(into: HTMLElement) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ["M18.09 10.37A6 6 0 1 1 10.34 18", "M7 6h1v4", "m16.71 13.88.7.71-2.82 2.82"]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "8");
  circle.setAttribute("cy", "8");
  circle.setAttribute("r", "6");
  svg.appendChild(circle);
  into.appendChild(svg);
}

export class Panel {
  private tab: Tab = "home";
  private shown: Shown | null = null;
  private billingAt = 0;
  private billingCache: Rates | null = null;
  private drawn = 0;
  private unmount: (() => void) | null = null;

  private head: HTMLElement;
  private balance: HTMLElement;
  private recordButton: HTMLButtonElement;
  private status: HTMLElement;
  private tabs: HTMLElement;
  private body: HTMLElement;

  constructor(
    private root: HTMLElement,
    private host: Host,
    private lang: Lang
  ) {
    addStyle(root.ownerDocument);
    installTips(root.ownerDocument);
    root.replaceChildren();
    root.classList.add("scribe-panel");
    // One line at any width: name, credits, Record. A narrow panel drops
    // "Mnemo"; the sync line sits under the tabs, where it has the width.
    this.head = el("div", root, { cls: "scribe-head" });
    const name = el("strong", this.head, { cls: "scribe-name" });
    el("span", name, { cls: "scribe-long", text: "Mnemo " });
    name.append("Scribe");
    this.balance = el("span", this.head, { cls: "scribe-balance" });
    this.recordButton = el("button", this.head, { cls: "scribe-btn is-record", text: `● ${this.t("record")}`, attrs: { "data-tip": this.t("tipPanelRecord") } });
    this.recordButton.onclick = () => this.host.record(this.recordButton);
    this.tabs = el("div", root, { cls: "scribe-tabs", attrs: { role: "tablist" } });
    this.status = el("span", root, { cls: "scribe-status" });
    this.body = el("div", root);
    // The home screen's "Open Your Brain".
    root.addEventListener(OPEN_BRAIN, () => void this.show("brain"));
  }

  private t(key: Key, vars?: Vars) {
    return say(this.lang, key, vars);
  }

  /** Draws the panel; again whenever the connection changes. */
  async start() {
    this.billingCache = null;
    const api = this.host.api();
    forgetScreens();
    // The screens' paid presses spend credits: the balance follows them.
    connectScreens(api ? { ...api.connection(), wrote: () => void this.showBalance(true) } : null);
    this.shown = await this.host.note();
    this.showStatus();
    await this.show(this.tab);
  }

  /** The note open in the app changed: the screens that start from it start again. */
  async noteChanged() {
    const before = this.shown?.scribeId;
    this.shown = await this.host.note();
    if (this.shown?.scribeId !== before && (this.tab === "note" || this.tab === "brain")) await this.show(this.tab);
  }

  showStatus() {
    const status = this.host.status();
    this.status.replaceChildren();
    if (status.choose) {
      const go = el("button", this.status, { text: this.t("chooseToSync"), attrs: { "data-tip": this.t("tipChooseToSync") } });
      go.onclick = () => void this.show("sync");
    } else {
      this.status.textContent = status.text;
      this.status.setAttribute("data-tip", tipOf(status.text, this.t("tipPanelStatus")));
    }
  }

  private async billing(fresh = false): Promise<Rates | null> {
    const api = this.host.api();
    if (!api) return null;
    if (!fresh && this.billingCache && Date.now() - this.billingAt < 60_000) return this.billingCache;
    this.billingCache = (await api.billing().catch(() => null)) as Rates | null;
    this.billingAt = Date.now();
    return this.billingCache;
  }

  private async showBalance(fresh = false) {
    const billing = await this.billing(fresh);
    this.balance.replaceChildren();
    if (!billing?.paysInCredits) return;
    coin(this.balance);
    this.balance.append(String(billing.credits));
    this.balance.setAttribute("data-tip", tipOf(this.t("brainBalance", { n: billing.credits }), this.t("tipPanelBalance")));
    if (billing.credits <= 0) this.topUp(this.balance);
  }

  private topUp(into: HTMLElement) {
    const api = this.host.api();
    if (!api) return;
    const link = el("button", into, { cls: "scribe-link", text: this.t("topUp"), attrs: { "data-tip": this.t("tipTopUp") } });
    link.onclick = () => this.host.link(api.topUpUrl);
  }

  private error(text: string, into: HTMLElement = this.body) {
    return el("p", into, { cls: "scribe-error", text });
  }

  private muted(text: string, into: HTMLElement = this.body) {
    return el("p", into, { cls: "scribe-muted", text });
  }

  private drawTabs() {
    this.tabs.replaceChildren();
    for (const tab of TABS) {
      const button = el("button", this.tabs, { text: this.t(TAB_LABEL[tab]), attrs: { role: "tab", "aria-selected": String(tab === this.tab), "data-tip": this.t(TAB_TIP[tab]) } });
      button.onclick = () => void this.show(tab);
    }
  }

  async show(tab: Tab) {
    this.tab = tab;
    this.drawTabs();
    const api = this.host.api();
    // A slow tab must not paint over the one asked for after it.
    const turn = ++this.drawn;
    const next = el("div", null);
    let screen: Screen | null = null;
    if (!api) {
      this.connect(next);
    } else {
      void this.showBalance();
      if (tab === "sync") {
        try {
          await this.sync(next);
        } catch (err) {
          this.error(err instanceof OutOfCredits ? this.t("outOfCredits") : err instanceof TypeError ? this.t("offline") : (err as Error).message, next);
        }
      } else if (tab === "note" && !this.shown?.scribeId) {
        this.muted(this.t("openANote"), next);
      } else {
        screen = tab;
      }
    }
    if (turn !== this.drawn) return;
    this.unmount?.();
    this.unmount = null;
    this.body.replaceChildren(next);
    if (screen) this.unmount = mountScreen(next, screen, { noteId: this.shown?.scribeId ?? null, open: (id) => this.host.open(id) });
  }

  // — Connect ——————————————————————————————————————————————————

  private connect(into: HTMLElement) {
    this.balance.replaceChildren();
    const section = el("div", into, { cls: "scribe-section" });
    this.muted(this.t("connectHint"), section);
    const input = el("input", section, { cls: "scribe-input", attrs: { type: "password", placeholder: "scribe_…", "data-tip": this.t("tipConnectKey") } });
    const row = el("div", section, { cls: "scribe-row" });
    const button = el("button", row, { cls: "scribe-btn is-primary", text: this.t("connect"), attrs: { "data-tip": this.t("tipConnect") } });
    button.onclick = async () => {
      if (!input.value.trim()) return;
      button.disabled = true;
      await this.host.connect(input.value.trim());
      await this.start();
    };
  }

  // — Sync —————————————————————————————————————————————————————

  /** Which folders or notebooks sync, and the presses that run it now. */
  private async sync(into: HTMLElement) {
    const row = el("div", into, { cls: "scribe-row" });
    const now = el("button", row, { cls: "scribe-btn is-primary", text: this.t("syncNow"), attrs: { "data-tip": this.t("tipSyncNow") } });
    now.onclick = async () => {
      now.disabled = true;
      await this.host.syncNow();
      this.showStatus();
      now.disabled = false;
    };
    const more = el("button", row, { cls: "scribe-btn", text: this.t("importNew"), attrs: { "data-tip": this.t("tipImportNew") } });
    more.onclick = () => void this.host.importNew();

    const section = el("div", into, { cls: "scribe-section" });
    section.style.marginTop = "16px";
    el("h3", section, { text: this.t(this.host.places === "folders" ? "placesFolders" : "placesNotebooks") });
    this.muted(this.t("placesHint"), section);
    const { all, synced } = await this.host.syncPlaces();
    const rows = [{ id: "/", path: this.t(this.host.places === "folders" ? "wholeVault" : "allNotebooks") }, ...all];
    for (const place of rows) {
      const label = el("label", section, { cls: "scribe-tick", attrs: { "data-tip": this.t("tipPlace") } });
      label.style.paddingLeft = `${place.id === "/" ? 0 : (place.path.split("/").length - 1) * 14}px`;
      const box = el("input", label, { attrs: { type: "checkbox", "data-tip": this.t("tipPlace") } });
      box.checked = synced.includes(place.id);
      label.append(place.id === "/" ? place.path : place.path.split("/").pop()!);
      box.onchange = async () => {
        box.disabled = true;
        await this.host.tick(place.id, box.checked);
        this.showStatus();
        box.disabled = false;
      };
    }
  }
}
