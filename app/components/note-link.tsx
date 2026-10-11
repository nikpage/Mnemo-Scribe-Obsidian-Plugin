"use client";

// [Filer]
import Link from "next/link";
import { noteHref } from "@/lib/note/filing";
import { preloadNote } from "@/lib/note/open-note";

/**
 * The one link to a note. Pointing at it starts reading the note, and a plain
 * click only writes the address: the notes page draws the note from the
 * address and what is already in hand, so nothing waits on the server for the
 * page. A click meant for a new tab and a note with no name yet (its own
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
      onMouseEnter={() => preloadNote(note.id)}
      onTouchStart={() => preloadNote(note.id)}
      onClick={(e) => {
        rest.onClick?.(e);
        if (!own || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        window.history.pushState(null, "", to);
      }}
    >
      {children}
    </Link>
  );
}
