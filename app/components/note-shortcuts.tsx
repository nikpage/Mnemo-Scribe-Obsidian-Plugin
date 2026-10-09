"use client";

// [utils]
import { useSyncExternalStore } from "react";
import Link from "next/link";
import { useLang } from "@/hooks/use-lang";
import { NO_RECENT_NOTES, type RecentNote, recentNotes } from "@/lib/note/recent";
import { noteHref } from "@/lib/note/filing";
import { Heading } from "@/components/ui";

function List({ title, notes }: { title: string; notes: { id: string; path?: string; label: string }[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="mb-3">
      <Heading className="mb-1 px-2">{title}</Heading>
      <ul className="space-y-0.5 text-sm">
        {notes.map((note) => (
          <li key={note.id}>
            <Link
              href={noteHref(note.path ?? "", note.id)}
              className="block rounded-lg px-2 py-1 hover:bg-muted"
            >
              <span className="block truncate">{note.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The two shortest routes back to a note: the ones the user pinned, and the
 * ones they just had open. Neither costs a query.
 */
export function NoteShortcuts({ pinned }: { pinned: { id: string; path?: string; label: string }[] }) {
  const { t } = useLang();
  // This list lives in localStorage, so the server has nothing to render for
  // it — an empty list there, the real one once hydrated.
  const recent = useSyncExternalStore<RecentNote[]>(
    () => () => {},
    recentNotes,
    () => NO_RECENT_NOTES
  );
  // The server cannot see that list, so both wait for the browser and come
  // together; the pinned ones drawn first had the recent ones land under them.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  if (!hydrated) return null;

  return (
    <>
      <List title={t("pinned")} notes={pinned} />
      <List title={t("recent")} notes={recent.slice(0, 5)} />
    </>
  );
}
