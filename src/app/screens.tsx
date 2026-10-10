// [Guru, Librarian]

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SWRConfig } from "swr";
import { useApi } from "@/lib/api";
import { SearchProvider } from "@/hooks/use-search";
import { BrainOf } from "@/components/what-next";
import { SearchPane } from "@/components/panes/search";
import { NoteAbout } from "@/components/note-about";
import { type ListNote, ShellContext } from "./shell";

/**
 * The app's own screens in the panel: Brain is the app's Brain panel, Search
 * its Search pane (Ask included), This note what its note screen shows
 * beside a note. Built from the app's files; only the parts, the requests
 * and the links are this app's (`./ui`, `./http`, `./link`), so a change to
 * a screen in the app is the same change here.
 */

export type Screen = "brain" | "search" | "note";

export type ScreenHost = {
  /** The Scribe note open in this app, if any. */
  noteId: string | null;
  /** Opens a Scribe note in this app; an error in words, or null. */
  open(id: string): Promise<string | null>;
};

// Answers are kept between tabs, as the app keeps them between screens; a
// new connection starts a new store.
let kept = new Map();

export function forgetScreens() {
  kept = new Map();
}

function Screens({ screen, host }: { screen: Screen; host: ScreenHost }) {
  const { data } = useApi<{ recordings: ListNote[] }>("/api/recordings");
  const [problem, setProblem] = useState<string | null>(null);
  // A screen draws once, whole: nothing until the notes are here.
  if (!data) return null;
  // As in the app: the lists hold the notes in use; search sees every shelf
  // and keeps to the one asked for.
  const all = data.recordings;
  const notes = all.filter((note) => (note.shelf ?? "normal") === "normal");
  const open = (id: string) => void host.open(id).then(setProblem);
  return (
    <ShellContext.Provider value={{ recordings: notes, open }}>
      {problem && <p className="scribe-error">{problem}</p>}
      {screen === "brain" ? (
        <BrainOf key={host.noteId ?? ""} notes={notes} centreId={host.noteId ?? undefined} />
      ) : screen === "search" ? (
        <SearchProvider notes={all}>
          <SearchPane />
        </SearchProvider>
      ) : (
        host.noteId && <NoteAbout key={host.noteId} id={host.noteId} />
      )}
    </ShellContext.Provider>
  );
}

/** Draws `screen` into `into`; the returned function takes it away again. */
export function mountScreen(into: HTMLElement, screen: Screen, host: ScreenHost): () => void {
  const root = createRoot(into);
  root.render(
    <SWRConfig value={{ provider: () => kept }}>
      <Screens screen={screen} host={host} />
    </SWRConfig>
  );
  return () => root.unmount();
}
