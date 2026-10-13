// [Guru, Librarian]

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SWRConfig } from "swr";
import { useCounts } from "@/hooks/use-notes-page";
import { SearchProvider } from "@/hooks/use-search";
import { BrainOf } from "@/components/what-next";
import { SearchPane } from "@/components/panes/search";
import { NoteAbout } from "@/components/note-about";
import { HomeDashboard } from "@/components/home-dashboard";
import { ShellContext } from "./shell";

/**
 * The app's own screens in the panel: Home is the app's home dashboard, Brain its Brain panel, Search
 * its Search pane (Ask included), This note what its note screen shows
 * beside a note. Built from the app's files; only the parts, the requests
 * and the links are this app's (`./ui`, `./http`, `./link`), so a change to
 * a screen in the app is the same change here.
 */

export type Screen = "home" | "brain" | "search" | "note";

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
  // The tags in use and the pinned notes, asked first as the app's shell does.
  const counts = useCounts();
  const [problem, setProblem] = useState<string | null>(null);
  // A screen draws once, whole: nothing until the numbers are here.
  if (!counts.data) return null;
  const open = (id: string) => void host.open(id).then(setProblem);
  return (
    <ShellContext.Provider value={{ open }}>
      {problem && <p className="scribe-error">{problem}</p>}
      {screen === "home" ? (
        <HomeDashboard links={false} />
      ) : screen === "brain" ? (
        <BrainOf key={host.noteId ?? ""} centreId={host.noteId ?? undefined} />
      ) : screen === "search" ? (
        <SearchProvider>
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
