// [Librarian]

import { normalizeTags } from "@/lib/note/filing";

/**
 * The set of tags a person defines in the Web and hands to the Brain, spelled
 * in the address: `/web?set=food,shoes&off=history`. `set` are the tags in
 * play, `off` the ones struck through (kept in view, read as nothing). One
 * spelling per set: tags normalised and sorted, a tag in both is struck.
 */
export interface WebSet {
  live: string[];
  struck: string[];
}

const list = (raw: string | null) => normalizeTags((raw || "").split(",")).sort();

export function readWebSet(set: string | null, off: string | null): WebSet {
  const struck = list(off);
  return { live: list(set).filter((tag) => !struck.includes(tag)), struck };
}

/** The address's query for a set, empty when it holds nothing. */
export function webSetQuery(s: WebSet): string {
  const p = new URLSearchParams();
  const struck = list(s.struck.join(","));
  const live = list(s.live.join(",")).filter((tag) => !struck.includes(tag));
  if (live.length) p.set("set", live.join(","));
  if (struck.length) p.set("off", struck.join(","));
  return p.toString().replace(/%2C/g, ",");
}

/** A tag tapped in the left list: out of the set (live or struck) if it is in it, else in as a live anchor. */
export function toggleInSet(s: WebSet, tag: string): WebSet {
  return s.live.includes(tag) || s.struck.includes(tag)
    ? { live: s.live.filter((x) => x !== tag), struck: s.struck.filter((x) => x !== tag) }
    : { live: [...s.live, tag], struck: s.struck };
}

/** Where the Web opens for a set; an emptied set is `?set=`, not a bare address, which would bring the remembered set back. */
export function webSetHref(s: WebSet): string {
  const q = webSetQuery(s);
  return `/web?${q || "set="}`;
}

const KEPT = "scribe-web-set";

/** This device's last set, as an address query; empty when none or storage is unavailable. */
export function rememberedWebSet(): string {
  try {
    const p = new URLSearchParams(localStorage.getItem(KEPT) || "");
    return webSetQuery(readWebSet(p.get("set"), p.get("off")));
  } catch {
    return "";
  }
}

export function rememberWebSet(query: string): void {
  try {
    localStorage.setItem(KEPT, query);
  } catch {
    // Private window or blocked storage: the set still lives in the address.
  }
}

/**
 * A set chosen in the Web, changed where it is: the address moves and the page redraws from it (Next keeps
 * `useSearchParams` in step with `history`), asking the server nothing. Followed as a link, every new set was
 * an address never seen before, fetched from the server for seconds before the picture moved. A click with a
 * key held (a new tab, a new window) stays a link.
 */
export function goInPlace(ev: { preventDefault(): void; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number }, href: string): void {
  if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
  ev.preventDefault();
  window.history.pushState(null, "", href);
}
