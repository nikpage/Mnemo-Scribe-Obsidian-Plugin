// [utils]

import { createContext, useContext } from "react";

/**
 * The app's `components/app-shell.tsx` as the plugins run it: the notes
 * list (no text in it, as the app's), read once by the panel and handed to
 * every screen, and how a note opens — in this app, not in the browser.
 */

/** One row of the notes list, as `GET /api/recordings` sends it. */
export type ListNote = {
  id: string;
  label: string;
  path: string;
  tags: string[];
  status: string;
  pinned: boolean;
  /** Where its owner put it (`lib/note/shelf.ts`); only `normal` is in the lists. */
  shelf: string;
  recorded_at: string;
  subject_id: string | null;
};

export type Shell = { recordings: ListNote[]; open: (id: string) => void };

export const ShellContext = createContext<Shell>({ recordings: [], open: () => {} });

export function useNotes(): Shell {
  return useContext(ShellContext);
}
