// [utils]

import { createContext, useContext } from "react";

/**
 * The app's `components/app-shell.tsx` as the plugins run it: how a note
 * opens — in this app, not in the browser. The notes themselves are asked
 * for by each screen, a page or a number at a time, as in the app.
 */

export type Shell = { open: (id: string) => void };

export const ShellContext = createContext<Shell>({ open: () => {} });

export function useNotes(): Shell {
  return useContext(ShellContext);
}
