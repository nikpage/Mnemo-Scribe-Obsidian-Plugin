"use client";

// [Librarian]
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { findNotes } from "@/lib/note/find";
import { api, useApi } from "@/lib/api";
import { READ, type Shelf } from "@/lib/note/shelf";

export type SearchResult = {
  note: {
    id: string;
    label: string;
    recorded_at: string;
    path: string;
    tags: string[];
  };
  excerpt: string;
};

/** Everything that narrows a search. The sidebar sets none of it. */
export type Filters = {
  tags?: string[];
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
  if (f.from) params.set("from", f.from);
  if (f.language) params.set("language", f.language);
  if (f.actionsOnly) params.set("actions", "1");
  if (f.shelf) params.set("shelf", f.shelf);
  return params;
}

/**
 * One search for the whole app, with two boxes onto it.
 *
 * Typing matches names and tags against the notes the browser already
 * has: no request behind a keystroke, the answer ready in the same breath.
 * The words *inside* the notes are not in the browser — carrying every note's
 * text to every phone is what made the app slow — so once typing pauses the
 * server is asked for those too, by word, and its notes are added under the
 * ones already shown. That is a free query: no model, nothing billed.
 * Searching by meaning is still the button.
 */
export function SearchProvider({
  notes,
  children,
}: {
  /** Every note, on every shelf: the filters say which shelf is searched. */
  notes: (Parameters<typeof findNotes>[0][number] & { shelf?: string })[];
  children: React.ReactNode;
}) {
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

  // Typing searches the notes the browser already holds. No request, no
  // waiting, nothing billed — the answer is ready in the same breath as the
  // keystroke. A store this size never needed a server to look through it.
  const shelf = filters.shelf;
  const typed = useMemo(() => {
    if (!active) return null;
    const searched = notes.filter((n) => {
      const on = (n.shelf ?? "normal") as Shelf;
      return shelf ? on === shelf : READ.includes(on);
    });
    return findNotes(searched, trimmed) as SearchResult[];
  }, [notes, trimmed, active, shelf]);

  // The server's word search, once typing pauses. Words only — no `fuzzy`, no
  // model, nothing billed — and the previous answer stays on screen while the
  // next one is on its way, so the list never blinks empty.
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSettled(active ? trimmed : ""), 250);
    return () => clearTimeout(timer);
  }, [trimmed, active]);

  const inside = useApi<{ results: SearchResult[] }>(
    settled ? `/api/notes/search?${searchParams(settled, filters)}` : null,
    { keepPreviousData: true, revalidateOnFocus: false }
  );
  const fromServer = settled === trimmed ? inside.data?.results : undefined;

  // The two answers are one list: what the browser matched, then what only the
  // note's own words matched, each note once.
  const words = useMemo(() => {
    if (!typed) return null;
    if (!fromServer?.length) return typed;
    const seen = new Set(typed.map((r) => r.note.id));
    return [...typed, ...fromServer.filter((r) => r.note && !seen.has(r.note.id))];
  }, [typed, fromServer]);

  // A fuzzy run answers one query. The moment the query changes it is stale,
  // so what is on screen goes back to the words.
  const answering = useRef("");
  const results = fuzzy && answering.current === trimmed ? fuzzyResults : words;
  // The browser's own matches are already on screen, so a search never waits;
  // the server's additions arrive underneath them.
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
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, results, searching, active, fuzzying, fuzzy, trimmed, key]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
