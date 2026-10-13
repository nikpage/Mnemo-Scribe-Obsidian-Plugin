"use client";

// [Librarian]
import { useMemo } from "react";
import { useApi } from "@/lib/api";
import { type NoteCounts, type NoteView, type NotesPage, noteAtUrl, pageUrl } from "@/lib/note/notes-page";
import type { Recording } from "@/hooks/use-recordings";

/** Where the numbers are asked for; also its key, so a change can ask again. */
export const COUNTS_URL = "/api/notes/counts";

/** How many notes carry each set of tags, sit on each shelf, and which are pinned. */
export function useCounts() {
  return useApi<NoteCounts>(COUNTS_URL);
}

/** One page of a list, from the server. Null asks for nothing. */
export function useNotePage(view: NoteView | null, before: string | null = null) {
  return useApi<NotesPage<Recording>>(view ? pageUrl(view, before) : null);
}

/** The note at an address (`noteAddress()`); null asks for nothing. */
export function useNoteAt(address: string | null) {
  return useApi<{ recording: Recording | null }>(address ? noteAtUrl(address) : null);
}

/**
 * The summaries of the notes a list is about to draw.
 *
 * The notes list itself carries no text — see LIST_FIELDS — so a screen that
 * shows a line of each note's summary asks for those summaries and no others.
 * Ids are sorted into the address, so the same screen twice is one request,
 * and a summary already fetched is not fetched again.
 */
export function useSummaries(ids: string[]): {
  summaries: Record<string, string>;
  /** The request, for the screen's `allAnswered()`; an empty list is answered. */
  request: { data?: unknown; error?: unknown };
} {
  const key = useMemo(() => [...ids].sort().join(","), [ids]);
  // The last lines stay while a narrowed list asks for its own, so typing a
  // filter never blanks the screen.
  const res = useApi<{ summaries: Record<string, string> }>(
    key ? `/api/recordings/summaries?ids=${encodeURIComponent(key)}` : null,
    { revalidateOnFocus: false, revalidateIfStale: false, keepPreviousData: true }
  );
  return { summaries: res.data?.summaries ?? {}, request: key ? res : { data: {} } };
}
