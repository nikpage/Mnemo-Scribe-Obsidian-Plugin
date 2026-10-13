"use client";

// [Librarian]
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLang } from "@/hooks/use-lang";
import { Button } from "@/components/ui";
import { allAnswered } from "@/lib/api";
import type { NoteView } from "@/lib/note/notes-page";
import { useNotePage, useSummaries } from "@/hooks/use-notes-page";
import type { Recording } from "@/hooks/use-recordings";

/**
 * How many pages of a long list are on screen: one to start, back to one
 * whenever `from` changes (another tag, another shelf).
 */
export function usePages(from: string): [number, () => void] {
  const [at, setAt] = useState({ from, pages: 1 });
  const pages = at.from === from ? at.pages : 1;
  return [pages, () => setAt({ from, pages: pages + 1 })];
}

/**
 * Where each page below the first starts, as far as `pages` reach: a page
 * is asked for once the one above it has said where it ends. `more` once the
 * last page shown has said there is another. `from` as in `usePages()`.
 */
export function usePageChain(from: string, first: string | null | undefined, pages: number) {
  const [at, setAt] = useState<{ from: string; ends: Record<string, string | null> }>({ from, ends: {} });
  const ends = at.from === from ? at.ends : {};
  const starts: string[] = [];
  let next = first ?? null;
  let waiting = false;
  while (next && starts.length < pages - 1) {
    starts.push(next);
    if (!(next in ends)) {
      waiting = true;
      break;
    }
    next = ends[next];
  }
  const ended = useCallback(
    (start: string, end: string | null) =>
      setAt((was) => {
        const known = was.from === from ? was.ends : {};
        return known[start] === end && was.from === from ? was : { from, ends: { ...known, [start]: end } };
      }),
    [from]
  );
  return { starts, more: !waiting && next !== null, ended };
}

/**
 * A page below the first: asked for from where the one above ended, drawn
 * once it (and, with `summaries`, the line under each note) is in, so no
 * row grows after. Tells the list where it ends.
 */
export function LaterPage({
  view,
  start,
  onEnd,
  row,
  summaries = false,
}: {
  view: NoteView;
  start: string;
  onEnd: (start: string, end: string | null) => void;
  row: (note: Recording, excerpt: string) => React.ReactNode;
  summaries?: boolean;
}) {
  const page = useNotePage(view, start);
  const notes = page.data?.recordings ?? [];
  const lines = useSummaries(summaries ? notes.map((n) => n.id) : []);
  // Before the paint: the next page and "Show more" come with this one.
  useLayoutEffect(() => {
    if (page.data) onEnd(start, page.data.next);
  }, [page.data, start, onEnd]);
  if (!allAnswered(page, lines.request)) return null;
  return notes.map((note) => row(note, lines.summaries[note.id] ?? ""));
}

/**
 * The foot of a list with more below: the next page comes when this nears the
 * screen after the person has scrolled, or on the press. Never before a
 * scroll, so a screen never grows on its own as it opens.
 */
export function ShowMore({ onMore }: { onMore: () => void }) {
  const { t } = useLang();
  const foot = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (scrolled) return;
    const mark = () => setScrolled(true);
    // Capture: the panes scroll inside their own boxes, not the window.
    document.addEventListener("scroll", mark, { capture: true, once: true });
    return () => document.removeEventListener("scroll", mark, { capture: true });
  }, [scrolled]);

  useEffect(() => {
    const el = foot.current;
    if (!el || !scrolled) return;
    const near = new IntersectionObserver((seen) => seen.some((s) => s.isIntersecting) && onMore(), { rootMargin: "400px" });
    near.observe(el);
    return () => near.disconnect();
  }, [scrolled, onMore]);

  return (
    <div ref={foot} className="mt-3 flex justify-center">
      <Button size="sm" tip={t("tipNotesMore")} onClick={onMore}>
        {t("notesMore")}
      </Button>
    </div>
  );
}
