// [Filer]

import Link from "next/link";
import { noteHref, noteName } from "@/lib/note/filing";
import { preloadNote } from "@/lib/note/open-note";

/**
 * One note in a list: its folders, its name, a line under it, and an
 * optional action on the right. A list that shows lines passes a string,
 * empty until it arrives; one that shows none passes nothing. The same row on Recent, in a folder and in
 * search, so a note looks like itself wherever it is found.
 */
export function NoteRow({
  note,
  meta,
  excerpt,
  action,
}: {
  note: { id: string; path: string | null; label: string };
  meta?: React.ReactNode;
  excerpt?: string | null;
  action?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
      {/* Pointing at a note starts reading it, so it opens whole on the click. */}
      <Link
        href={noteHref(note.path || "", note.id)}
        onMouseEnter={() => preloadNote(note.id)}
        onTouchStart={() => preloadNote(note.id)}
        className="min-w-0 flex-1"
      >
        <span className="block truncate font-medium">{noteName(note.path || "", note.label)}</span>
        {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
        {/* Two lines tall whatever it holds, even before it arrives, so a
            summary landing never makes the rows below move. */}
        {excerpt !== undefined && excerpt !== null && (
          <p className="mt-1 line-clamp-2 h-8 text-xs leading-4 text-muted-foreground">{excerpt}</p>
        )}
      </Link>
      {action}
    </li>
  );
}
