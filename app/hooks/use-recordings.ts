"use client";

// [utils]
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSWRConfig } from "swr";
import { ApiError, send, useApi } from "@/lib/api";
import { forgetPages } from "@/lib/offline-pages";
import { createClient } from "@/lib/supabase/client";
import { listFieldsOf } from "@/lib/note/list-columns";
import { type NotesPage, isPageUrl } from "@/lib/note/notes-page";
import { WALK_STORE_URL } from "@/lib/note/walk";
import { COUNTS_URL } from "@/hooks/use-notes-page";
import type { Shelf } from "@/lib/note/shelf";

export interface Recording {
  id: string;
  user_id: string;
  label: string;
  filename: string;
  recorded_at: string;
  duration_seconds: number | null;
  file_size_bytes: number | null;
  status: string;
  drive_audio_id: string | null;
  path: string;
  tags: string[];
  pinned: boolean;
  /** Where its owner put it (`lib/note/shelf.ts`); only `normal` is in the lists. */
  shelf: Shelf;
  /** The client or site this note is about, when it is about one. */
  subject_id: string | null;
  /** A tag or client hides it (`lib/note/switches.ts`): on no list. */
  hidden?: boolean;
  /** In a tag view: a tag it was opened by reaches it only through fiction (`onlyInFiction()`). */
  in_fiction?: boolean;
  /** The published note that replaces this one (`lib/note/publish.ts`), or null. */
  superseded_by?: string | null;
  /** The language the transcriber heard. Null on notes recorded before detection. */
  language: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** What a change to a note must touch to move it onto or off a list, or change the numbers. */
const LISTED = ["status", "shelf", "tags", "recorded_at", "pinned", "hidden"] as const;

/**
 * The notes still on their way — sending, being written up, failed — and
 * the way every list and number stays current.
 *
 * Mounted exactly once, by AppShell, which hands it down — see useNotes().
 * The finished notes are never all here: each list asks the server for the
 * page it shows (`useNotePage()`), the sidebar for its numbers
 * (`useCounts()`). Realtime reports every write to this account's notes
 * within the second; a note on screen changes in place, and one that joins
 * or leaves a list has the pages on screen and the numbers asked for again.
 */
export function useRecordings(userId?: string) {
  const { cache, mutate: mutateKeys } = useSWRConfig();
  // Nothing in progress, nothing to watch: the fallback poll runs only while a
  // note is still being worked on (a failed one waits for the person).
  const { data, error, isLoading, mutate } = useApi<{ recordings: Recording[] }>(userId ? "/api/recordings" : null, {
    revalidateOnMount: true,
    revalidateOnFocus: false,
    revalidateIfStale: false,
    refreshInterval: (latest) => (latest?.recordings.some((r) => r.status !== "failed") ? 10000 : 0),
  });
  const working = useMemo(() => data?.recordings ?? [], [data]);

  // A kept page opened after the session ended: nothing on it is still this
  // device's to show.
  const signedOut = error instanceof ApiError && error.status === 401;
  useEffect(() => {
    if (!signedOut) return;
    void forgetPages().then(() => window.location.replace("/welcome"));
  }, [signedOut]);

  // The lists and numbers, asked again. Several writes to one note arrive
  // together, so they are asked once for all of them.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const relist = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void mutateKeys(isPageUrl);
      void mutateKeys(COUNTS_URL);
    }, 300);
  }, [mutateKeys]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  // The Web's copy of the store (`lib/note/walk.ts`), asked again after the writes to a note settle.
  const walkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshWalk = useCallback(() => {
    if (walkTimer.current) clearTimeout(walkTimer.current);
    walkTimer.current = setTimeout(() => void mutateKeys(WALK_STORE_URL), 1500);
  }, [mutateKeys]);
  useEffect(() => () => void (walkTimer.current && clearTimeout(walkTimer.current)), []);

  const refetch = useCallback(() => {
    void mutate();
    relist();
  }, [mutate, relist]);

  // A note that was on its way and no longer is has finished (or moved): the lists gain it.
  const workingIds = working.map((n) => n.id).join(",");
  const lastWorking = useRef(workingIds);
  useEffect(() => {
    const was = lastWorking.current.split(",").filter(Boolean);
    lastWorking.current = workingIds;
    if (was.some((id) => !workingIds.split(",").includes(id))) relist();
  }, [workingIds, relist]);

  useEffect(() => {
    if (!userId) return;
    /** The note as a list on this device holds it, if any does. */
    const listed = (id: string): Recording | undefined => {
      for (const key of cache.keys()) {
        if (!isPageUrl(key)) continue;
        const found = (cache.get(key)?.data as NotesPage<Recording> | undefined)?.recordings.find((n) => n.id === id);
        if (found) return found;
      }
      return undefined;
    };
    // Realtime subscription for instant status updates. Only this account's
    // rows: anyone else's note finishing is not news here.
    const supabase = createClient();
    const channel = supabase
      .channel("recordings-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "recordings", filter: `user_id=eq.${userId}` },
        (payload) => {
          // The row that changed is in the message, so it is put straight
          // where it is shown. Its text is cut off first: no list holds text.
          const raw = payload.new as Partial<Recording> | null;
          const row = raw?.id ? listFieldsOf<Recording>(raw) : null;
          const id = row?.id ?? (payload.old as { id?: string } | null)?.id;
          if (!id) return;
          refreshWalk();
          const onItsWay = row !== null && row.status !== "done" && row.shelf === "normal";
          void mutate(
            (held) => {
              const list = held?.recordings ?? [];
              if (!onItsWay) return { recordings: list.filter((n) => n.id !== id) };
              const at = list.findIndex((n) => n.id === id);
              return { recordings: at === -1 ? [row, ...list] : list.map((n) => (n.id === id ? { ...n, ...row } : n)) };
            },
            { revalidate: false }
          );
          const before = listed(id);
          if (row && before && LISTED.every((f) => JSON.stringify(before[f]) === JSON.stringify(row[f]))) {
            void mutateKeys(
              isPageUrl,
              (page?: NotesPage<Recording>) => page && { ...page, recordings: page.recordings.map((n) => (n.id === id ? { ...n, ...row } : n)) },
              { revalidate: false }
            );
          } else if (before || row?.status === "done") {
            relist();
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, mutate, mutateKeys, cache, relist, refreshWalk]);

  // A transcript is finished by the provider calling us back. Where it can't
  // reach us we ask instead, on the same cadence, until nothing is in flight.
  const awaitingTranscript = working.some((r) => r.status === "transcribing");

  useEffect(() => {
    if (!awaitingTranscript) return;
    const check = () =>
      send<{ completed: number }>("/api/transcribe/poll", "POST")
        .then(({ completed }) => {
          if (completed > 0) void mutate();
        })
        .catch(() => {
          // Next tick tries again.
        });
    void check();
    const id = setInterval(check, 10000);
    return () => clearInterval(id);
  }, [awaitingTranscript, mutate]);

  /**
   * Moves notes to another shelf: off every list at once, saved in the
   * background, and the lists asked again either way — so a failed save
   * puts them back. `null` is every finished note in use ("Archive all").
   */
  const move = useCallback(
    async (ids: string[] | null, shelf: Shelf, save: () => Promise<unknown>) => {
      const moving = (n: Recording) => (ids ? ids.includes(n.id) : n.status === "done" && n.shelf === "normal");
      const off = (list: Recording[]) => list.filter((n) => !moving(n) || n.shelf === shelf);
      void mutateKeys(isPageUrl, (page?: NotesPage<Recording>) => page && { ...page, recordings: off(page.recordings) }, { revalidate: false });
      void mutate((held) => held && { recordings: shelf === "normal" ? held.recordings : off(held.recordings) }, { revalidate: false });
      try {
        await save();
        return true;
      } catch {
        return false;
      } finally {
        refetch();
      }
    },
    [mutate, mutateKeys, refetch]
  );

  return { working, loading: isLoading && !data, refetch, move };
}
