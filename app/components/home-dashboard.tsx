"use client";

// [Guru]
import { useState } from "react";
import Link from "next/link";
import { useLang } from "@/hooks/use-lang";
import { send, useApi } from "@/lib/api";
import { useNotes } from "@/components/app-shell";
import { JOB_LABEL } from "@/components/what-next";
import { formatCount, formatDate } from "@/lib/format";
import { noteHref, noteName } from "@/lib/note/filing";
import { NoteRow } from "@/components/note-row";
import { Button, Heading, List, Notice, selectClass } from "@/components/ui";
import type { Home } from "@/lib/note/home";
import type { Todo } from "@/lib/note/todos";

/**
 * The first screen: what is waiting on the person, the open to-dos (tick one
 * off, say which note it led to or none), how much is in the store, the
 * newest of what Brain wrote and the notes added last. One free read
 * (`/api/notes/home`); nothing on it calls a model. The app and the plugins
 * draw this same file.
 */

/** Asks the shell to show Brain (an event that bubbles up): the app opens its sheet, a plugin its tab. */
export const OPEN_BRAIN = "scribe:open-brain";

const SHOWN = 8;
const HIDE_KEY = "scribe-home-needs-hidden";

type Ticked = { todo: Todo; result: string | null };
const keyOf = (todo: Todo) => `${todo.noteId}\n${todo.text}`;

function hiddenBefore(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
}

function remember(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(HIDE_KEY, "1");
    else localStorage.removeItem(HIDE_KEY);
  } catch {
    // A blocked store only means the choice is not kept.
  }
}

/**
 * `links` is false where a screen of its own is not reachable (a note app's
 * panel): the questions are then only counted.
 */
export function HomeDashboard({ links = true }: { links?: boolean }) {
  const { lang, t } = useLang();
  const { recordings } = useNotes();
  const { data } = useApi<Home>("/api/notes/home");
  const [ticked, setTicked] = useState<Record<string, Ticked>>({});
  const [showAll, setShowAll] = useState(false);
  const [hidden, setHidden] = useState(hiddenBefore);
  const [problem, setProblem] = useState<string | null>(null);

  // A screen draws once, whole.
  if (!data) return null;

  const save = (todo: Todo, done: boolean, result: string | null) =>
    send("/api/notes/todos", "PUT", { id: todo.noteId, text: todo.text, done, result });
  const set = (todo: Todo, next: Ticked | null) =>
    setTicked((all) => {
      const rest = { ...all };
      delete rest[keyOf(todo)];
      return next ? { ...rest, [keyOf(todo)]: next } : rest;
    });
  const failed = (error: unknown) => setProblem(error instanceof Error ? error.message : String(error));

  const tick = (todo: Todo) => {
    setProblem(null);
    set(todo, { todo, result: null });
    save(todo, true, null).catch((error) => {
      set(todo, null);
      failed(error);
    });
  };
  const untick = (entry: Ticked) => {
    setProblem(null);
    set(entry.todo, null);
    save(entry.todo, false, null).catch((error) => {
      set(entry.todo, entry);
      failed(error);
    });
  };
  const lead = (entry: Ticked, result: string | null) => {
    setProblem(null);
    set(entry.todo, { ...entry, result });
    save(entry.todo, true, result).catch((error) => {
      set(entry.todo, entry);
      failed(error);
    });
  };

  const open = data.todos.filter((todo) => !ticked[keyOf(todo)]);
  const listed = showAll ? open : open.slice(0, SHOWN);
  const done = Object.values(ticked);
  const openCount = open.length;

  const waiting = data.needs.tags > 0 || data.needs.report;
  const candidates = recordings
    .filter((n) => n.status === "done")
    .sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1))
    .slice(0, 40);

  const titled = (todo: Todo) => (
    <Link
      href={noteHref(todo.title.replace(/\.md$/i, ""), todo.noteId)}
      data-tip={t("tipTodoFrom")}
      className="text-xs text-muted-foreground hover:underline"
    >
      {todo.title}
    </Link>
  );

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap gap-3">
        {[
          [t("homeNotes"), formatCount(data.totals.notes, lang), t("tipStatNotes")],
          [t("homeWords"), formatCount(data.totals.words, lang), t("tipStatWords")],
          [t("homeWeek"), formatCount(data.totals.week, lang), t("tipStatWeek")],
          [t("homeOpenTodos"), formatCount(openCount + done.length, lang), t("tipStatTodos")],
        ].map(([label, value, tip]) => (
          <div key={label} data-tip={tip} className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-lg font-semibold">{value}</div>
          </div>
        ))}
      </section>

      <div className="grid gap-5 lg:grid-cols-2 lg:gap-8">
        <div className="min-w-0 space-y-5">
          <section>
            {!waiting && hidden ? (
              <p className="text-xs text-muted-foreground">
                {t("homeNeedsHidden")}{" "}
                <Button
                  variant="link"
                  tip={t("tipNeedsShow")}
                  onClick={() => {
                    remember(false);
                    setHidden(false);
                  }}
                >
                  {t("homeNeedsShow")}
                </Button>
              </p>
            ) : (
              <>
                <Heading>{t("homeNeeds")}</Heading>
                <Notice tone={waiting ? "primary" : "info"} className="flex flex-wrap items-center gap-3">
                  {waiting ? (
                    <div className="space-y-1 text-sm">
                      {data.needs.tags > 0 &&
                        (links ? (
                          <Link href="/tags" data-tip={t("tipTagQuestions")} className="block font-medium text-primary hover:underline">
                            {t("homeTagQuestions", { n: data.needs.tags })} →
                          </Link>
                        ) : (
                          <p className="font-medium">{t("homeTagQuestions", { n: data.needs.tags })}</p>
                        ))}
                      {data.needs.report &&
                        (links ? (
                          <Link href="/insights" data-tip={t("tipReportReady")} className="block font-medium text-primary hover:underline">
                            {t("reportReady")} →
                          </Link>
                        ) : (
                          <p className="font-medium">{t("reportReady")}</p>
                        ))}
                    </div>
                  ) : (
                    <>
                      <span className="flex-1 text-sm text-muted-foreground">{t("homeNeedsNone")}</span>
                      <Button
                        variant="link"
                        tip={t("tipNeedsHide")}
                        onClick={() => {
                          remember(true);
                          setHidden(true);
                        }}
                      >
                        {t("homeNeedsHide")}
                      </Button>
                    </>
                  )}
                </Notice>
              </>
            )}
          </section>

          <section>
            <Heading>{t("homeTodos")}</Heading>
            {problem && <p className="mb-2 text-sm text-destructive">{problem}</p>}
            {done.length === 0 && listed.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("homeTodosNone")}</p>
            ) : (
              <ul className="space-y-1">
                {done.map((entry) => (
                  <li key={keyOf(entry.todo)} className="space-y-1 py-1">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked onChange={() => untick(entry)} aria-label={t("homeTodoUndo")} data-tip={t("tipTodoUndo")} />
                      <span className="min-w-0 flex-1">
                        <span className="text-muted-foreground line-through">{entry.todo.text}</span> {titled(entry.todo)}
                      </span>
                    </label>
                    <label className="flex items-center gap-2 pl-3 text-xs text-muted-foreground" data-tip={t("tipTodoResult")}>
                      {t("homeTodoResult")}
                      <select
                        data-tip={t("tipTodoResult")}
                        className={selectClass}
                        value={entry.result ?? ""}
                        onChange={(event) => lead(entry, event.target.value || null)}
                      >
                        <option value="">{t("homeTodoNoResult")}</option>
                        {candidates
                          .filter((n) => n.id !== entry.todo.noteId)
                          .map((n) => (
                            <option key={n.id} value={n.id}>
                              {noteName(n.path || "", n.label)}
                            </option>
                          ))}
                      </select>
                    </label>
                  </li>
                ))}
                {listed.map((todo) => (
                  <li key={keyOf(todo)} className="py-1">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={false} onChange={() => tick(todo)} aria-label={t("homeTodoDone")} data-tip={t("tipTodoTick")} />
                      <span className="min-w-0 flex-1">
                        {todo.text} {titled(todo)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {!showAll && openCount > SHOWN && (
              <Button variant="link" className="mt-2" tip={t("tipTodosMore")} onClick={() => setShowAll(true)}>
                {t("homeTodosMore", { n: openCount - SHOWN })}
              </Button>
            )}
          </section>
        </div>
        <div className="min-w-0 space-y-5">
          <section>
            <Heading>{t("homeBrain")}</Heading>
            {data.reading || data.topics.length > 0 || data.insights.length > 0 ? (
              <div className="space-y-2 text-sm">
                <List>
                  {data.reading && (
                    <li className="px-4 py-3">
                      <p>{data.reading.excerpt}</p>
                    </li>
                  )}
                  {data.topics.map((topic) => (
                    <li key={topic.subject} className="px-4 py-3">
                      <span className="block font-medium">{topic.label}</span>
                      {topic.jobs.length > 0 && (
                        <span className="text-xs text-muted-foreground">{topic.jobs.map((job) => t(JOB_LABEL[job])).join(" · ")}</span>
                      )}
                      <p className="mt-1 text-xs leading-4 text-muted-foreground">{topic.subject}</p>
                    </li>
                  ))}
                  {data.insights.map((insight) => (
                    <li key={insight.headline} className="px-4 py-3">
                      <span className="block text-xs text-muted-foreground">{t("homeInsights")}</span>
                      <p className="mt-1">{insight.headline}</p>
                    </li>
                  ))}
                </List>
                <Button variant="link" tip={t("tipBrainOpen")} onClick={(event) => event.currentTarget.dispatchEvent(new CustomEvent(OPEN_BRAIN, { bubbles: true }))}>
                  {t("homeBrainOpen")} →
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("homeBrainNone")}</p>
            )}
          </section>

          <section>
            <Heading>{t("homeAdditions")}</Heading>
            <List>
              {data.recent.map((note) => (
                <NoteRow key={note.id} note={note} meta={formatDate(note.recordedAt, lang)} excerpt={note.summary} />
              ))}
            </List>
            {links && (
              <Link href="/recent" data-tip={t("tipHomeAllNotes")} className="mt-2 block text-sm text-muted-foreground hover:underline">
                {t("homeAllNotes")} →
              </Link>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
