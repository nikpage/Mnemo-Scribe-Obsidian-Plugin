"use client";

// [Filer]
import { useEffect } from "react";
import Link from "next/link";
import { noteHref } from "@/lib/note/filing";
import { preloadNote } from "@/lib/note/open-note";

/** How many notes pages are on screen; only one of them draws a note from a written address. */
let notesPages = 0;

/** Marks the notes page as on screen, so a click on a note there only writes the address. */
export function useNotesPageHere(): void {
  useEffect(() => {
    notesPages++;
    return () => {
      notesPages--;
    };
  }, []);
}

/**
 * The one link to a note. Pointing at it starts reading the note, and a plain
 * click on the notes page only writes the address: that page draws the note
 * from the address and what is already in hand, so nothing waits on the
 * server. Elsewhere the click navigates there. A click meant for a new tab and a note with no name yet (its own
 * route) go the ordinary way. `hash` is a part of the note to land on, which
 * the note screen finds by itself on arriving.
 */
export function NoteLink({
  note,
  hash,
  tip,
  children,
  ...rest
}: {
  note: { id: string; path?: string | null };
  hash?: string;
  tip?: string;
} & Omit<React.ComponentProps<typeof Link>, "href">) {
  const href = noteHref(note.path || "", note.id);
  const own = href.endsWith(".md");
  const to = hash ? `${href}#${hash}` : href;
  return (
    <Link
      {...rest}
      href={to}
      data-tip={tip}
      onMouseEnter={() => preloadNote(note.id, note.path)}
      onTouchStart={() => preloadNote(note.id, note.path)}
      onClick={(e) => {
        rest.onClick?.(e);
        preloadNote(note.id, note.path);
        // Anywhere but the notes page (Tags, Insights, a pane) nothing reads the address: navigate.
        if (!own || notesPages === 0 || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        window.history.pushState(null, "", to);
      }}
    >
      {children}
    </Link>
  );
}
