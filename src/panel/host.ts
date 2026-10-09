// [Smith]

import type { ScribeApi } from "../api";

/**
 * What the panel needs from the app it sits in. The panel is the same in
 * every app that holds Scribe notes (Obsidian, Joplin); only these differ —
 * where notes live, how one is opened, how the app records and syncs.
 */

/** The note open in the app, as the panel reads it. */
export type Shown = { scribeId: string | null; title: string; folder: string };

/** A folder (Obsidian) or notebook (Joplin) that can be ticked to sync; "/" is all of them. */
export type Place = { id: string; path: string };

export type Status = { text: string; choose: boolean };

export interface Host {
  /** "folders" in Obsidian, "notebooks" in Joplin. */
  readonly places: "folders" | "notebooks";
  api(): ScribeApi | null;
  connect(token: string): Promise<void>;
  /** The note open now, if any. */
  note(): Promise<Shown | null>;
  /** Opens a Scribe note in the app, fetching it first; an error in words, or null. */
  open(id: string): Promise<string | null>;
  link(url: string): void;
  /** Starts or stops a recording; `button` shows its state. */
  record(button: HTMLButtonElement): void;
  status(): Status;
  syncNow(): Promise<void>;
  syncPlaces(): Promise<{ all: Place[]; synced: string[] }>;
  tick(id: string, on: boolean): Promise<void>;
  importNew(): Promise<void>;
}
