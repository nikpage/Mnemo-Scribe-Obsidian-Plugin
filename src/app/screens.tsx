// [Guru, Librarian, Writer]

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SWRConfig } from "swr";
import { useCounts } from "@/hooks/use-notes-page";
import { SearchProvider } from "@/hooks/use-search";
import { type AskStart, BrainOf } from "@/components/what-next";
import { SearchPane } from "@/components/panes/search";
import { NoteAbout } from "@/components/note-about";
import { HomeDashboard } from "@/components/home-dashboard";
import { WebView } from "@/components/web-view";
import { NewPiece, PiecePage, WriteHome } from "@/components/writing-piece";
import { ConfirmProvider } from "@/components/ui";
import { ShellContext } from "./shell";

/**
 * The app's own screens in the panel: Home is the app's home dashboard, Brain its Brain panel, Write
 * its `/write` pages, Search its Search pane (Ask opening Brain), Web its web of tags, This note what its
 * note screen shows beside a note. Built from the app's files; only the parts, the requests
 * and the links are this app's (`./ui`, `./http`, `./link`), so a change to
 * a screen in the app is the same change here.
 */

export type Screen = "home" | "brain" | "write" | "search" | "web" | "note";

export type ScreenHost = {
  /** The Scribe note open in this app, if any. */
  noteId: string | null;
  /** A question brought from Search's Ask, which the Brain opens on. */
  ask?: AskStart;
  /** Opens a Scribe note in this app; an error in words, or null. */
  open(id: string): Promise<string | null>;
  /** Opens one of the app's pages (Settings) in the browser. */
  away(path: string): void;
};

// Answers are kept between tabs, as the app keeps them between screens; a
// new connection starts a new store.
let kept = new Map();

export function forgetScreens() {
  kept = new Map();
}

/** Write as the app's `/write` pages draw it, at `at`, the address its links and presses move to. */
function Write({ at }: { at: string }) {
  const [path, query] = at.split("?");
  const id = /^\/write\/([^/]+)$/.exec(path)?.[1];
  if (path === "/write/new") return <NewPiece of={new URLSearchParams(query).get("of") ?? undefined} />;
  if (id) return <PiecePage key={id} id={id} />;
  return <WriteHome />;
}

function Screens({ screen, host }: { screen: Screen; host: ScreenHost }) {
  // The tags in use and the pinned notes, asked first as the app's shell does.
  const counts = useCounts();
  const [problem, setProblem] = useState<string | null>(null);
  const [write, setWrite] = useState("/write");
  // A screen draws once, whole: nothing until the numbers are here.
  if (!counts.data) return null;
  const open = (id: string) => void host.open(id).then(setProblem);
  return (
    <ShellContext.Provider value={{ open, go: setWrite, away: host.away }}>
      {problem && <p className="scribe-error">{problem}</p>}
      {screen === "home" ? (
        <HomeDashboard links={false} />
      ) : screen === "brain" ? (
        <BrainOf key={`${host.noteId ?? ""}|${host.ask?.q ?? ""}`} centreId={host.noteId ?? undefined} ask={host.ask} links={false} />
      ) : screen === "write" ? (
        <Write at={write} />
      ) : screen === "search" ? (
        <SearchProvider>
          <SearchPane />
        </SearchProvider>
      ) : screen === "web" ? (
        <WebView links={false} />
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
      <ConfirmProvider>
        <Screens screen={screen} host={host} />
      </ConfirmProvider>
    </SWRConfig>
  );
  return () => root.unmount();
}
