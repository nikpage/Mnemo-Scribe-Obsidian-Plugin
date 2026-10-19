// [utils]

import { createContext, useContext } from "react";

/**
 * The app's `components/app-shell.tsx` as the plugins run it: how a note
 * opens — in this app, not in the browser; how Write moves between its pages
 * (`go`, an app address, kept by the Write tab); and how one of the app's
 * other pages opens (`away`, in the browser). The notes themselves are asked
 * for by each screen, a page or a number at a time, as in the app.
 */

export type Shell = { open: (id: string) => void; go: (href: string) => void; away: (path: string) => void };

export const ShellContext = createContext<Shell>({ open: () => {}, go: () => {}, away: () => {} });

export function useNotes(): Shell {
  return useContext(ShellContext);
}
