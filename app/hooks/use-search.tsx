"use client";

// [Librarian]
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, useApi } from "@/lib/api";
import type { Shelf } from "@/lib/note/shelf";
import type { Kind } from "@/lib/note/kinds";
import type { LibraryRow } from "@/lib/note/brain-library";

export type SearchResult = {
  note: {
    id: string;
    label: string;
    recorded_at: string;
    path: string;
    tags: string[];
    /** Narrowed by a tag: it reaches the note only through fiction. */
    in_fiction?: boolean;
  };
  excerpt: string;
};

/** Everything that narrows a search. The sidebar sets none of it. */
export type Filters = {
  tags?: string[];
  /** Kinds one passage must all be, with the tags (`kindMatch()`). */
  kinds?: Kind[];
  from?: string | null;
  language?: string;
  actionsOnly?: boolean;
  /** Cold storage or Trash, searched only in their own view. None: the shelves search reads. */
  shelf?: Extract<Shelf, "cold" | "trash">;
};

type Search = {
  query: string;
  setQuery: (q: string) => void;
  /** The page owns the filters; the sidebar leaves them alone. */
  setFilters: (f: Filters) => void;
  results: SearchResult[] | null;
  searching: boolean;
  /** Below this a query is not yet a search, and the groups stay on screen. */
  active: boolean;
  /** Search by meaning as well as words. One run, when asked. */
  runFuzzy: () => Promise<void>;
  fuzzying: boolean;
  /** Whether what is on screen came from a fuzzy run. */
  fuzzy: boolean;
  /** More notes match by name or tag than are shown; `showMore` adds the next page of them. */
  more: boolean;
  showMore: () => void;
  /** Brain outputs whose title or text holds the words: their own group, never a note. */
  brain: LibraryRow[];
};

const Ctx = createContext<Search | null>(null);

const MIN = 2;

export function useSearch(): Search {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSearch outside SearchProvider");
  return s;
}

/** The filters, as the API expects them. */
export function searchParams(query: string, f: Filters): URLSearchParams {
  const params = new URLSearchParams({ q: query });
  if (f.tags?.length) params.set("tags", f.tags.join(","));
  if (f.kinds?.length) params.set("kinds", f.kinds.join(","));
  if (f.from) params.set("from", f.from);
  if (f.language) params.set("language", f.language);
  if (f.actionsOnly) params.set("actions", "1");
  if (f.shelf) params.set("shelf", f.shelf);
  return params;
}

/** What the server's typed search answers: notes matching by name or tag, then by the words inside. */
type Typed = { results: SearchResult[]; names?: { results: SearchResult[]; more: boolean }; brain?: LibraryRow[] };

/**
 * One search for the whole app, with two boxes onto it.
 *
 * Once typing pauses the server is asked, free — no model, nothing billed —
 * for the notes whose name or tags match, a page at a time, and under them
 * the notes whose own words do. The browser holds no list of every note to
 * match against: that list was every screen's wait. What was found for the
 * words before stays on screen until the new answer lands, so the list never
 * blinks empty. Searching by meaning is still the button.
 */
export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState("");
  const [filters, setFiltersState] = useState<Filters>({});
  const [fuzzyResults, setFuzzyResults] = useState<SearchResult[] | null>(null);
  const [fuzzying, setFuzzying] = useState(false);
  const [fuzzy, setFuzzy] = useState(false);

  // Filters arrive as a fresh object on every render of the page, so they are
  // compared by what they say rather than by identity.
  const key = JSON.stringify(filters);
  const setFilters = (f: Filters) => {
    setFiltersState((prev) => (JSON.stringify(f) === JSON.stringify(prev) ? prev : f));
  };

  const trimmed = query.trim();
  const active = trimmed.length >= MIN;

  // Asked once typing pauses, never per keystroke.
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSettled(active ? trimmed : ""), 250);
    return () => clearTimeout(timer);
  }, [trimmed, active]);

  // Pages of name matches for this search; a new search starts at one.
  const asking = `${settled}|${key}`;
  const [named, setNamed] = useState({ asking, pages: 1 });
  const pages = named.asking === asking ? named.pages : 1;
  const params = searchParams(settled, filters);
  params.set("names", String(pages));
  const typedRes = useApi<Typed>(settled ? `/api/notes/search?${params}` : null, { keepPreviousData: true, revalidateOnFocus: false });
  const typed = active ? typedRes.data : undefined;

  // The two answers are one list: what matched by name or tag, then what only
  // the note's own words matched, each note once.
  const words = useMemo(() => {
    if (!typed) return null;
    const names = typed.names?.results ?? [];
    const seen = new Set(names.map((r) => r.note.id));
    return [...names, ...typed.results.filter((r) => r.note && !seen.has(r.note.id))];
  }, [typed]);
  const more = Boolean(typed?.names?.more);
  const brain = useMemo(() => typed?.brain ?? [], [typed]);

  // A fuzzy run answers one query. The moment the query changes it is stale,
  // so what is on screen goes back to the words.
  const answering = useRef("");
  const results = fuzzy && answering.current === trimmed ? fuzzyResults : words;
  // What was found before stays on screen while the next answer is on its way.
  const searching = false;
  // A fuzzy run that comes back after the query moved on is thrown away.
  const latest = useRef(0);

  /**
   * The same query again, this time by meaning as well as by words. It costs
   * a model call, so it happens once, on the press, and never on a keystroke.
   */
  async function runFuzzy() {
    if (!active) return;
    const mine = ++latest.current;
    answering.current = trimmed;
    setFuzzying(true);
    try {
      const params = searchParams(trimmed, filters);
      params.set("fuzzy", "1");
      const found = await api<{ results: SearchResult[] }>(`/api/notes/search?${params}`).then(
        (data) => data.results,
        () => []
      );
      if (mine === latest.current) {
        setFuzzyResults(found);
        setFuzzy(true);
      }
    } catch {
      /* the word results already on screen stay */
    }
    setFuzzying(false);
  }

  const value = useMemo(
    () => ({
      query,
      setQuery,
      setFilters,
      results,
      searching,
      active,
      runFuzzy,
      fuzzying,
      fuzzy,
      more,
      showMore: () => setNamed({ asking, pages: pages + 1 }),
      brain,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, results, searching, active, fuzzying, fuzzy, trimmed, key, more, asking, pages, brain]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
