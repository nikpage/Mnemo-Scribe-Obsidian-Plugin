"use client";

// [Guru]
import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useLang } from "@/hooks/use-lang";
import { send, useApi } from "@/lib/api";
import { JOB_LABEL, ReadingText } from "@/components/what-next";
import { formatCount, formatDate } from "@/lib/format";
import { NoteRow } from "@/components/note-row";
import { NoteLink } from "@/components/note-link";
import { Button, Heading, List, Notice } from "@/components/ui";
import { EVERYTHING, subjectOf, type Scope } from "@/lib/note/what-next-target";
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
const READINGS_SHOWN = 2;
const HIDE_KEY = "scribe-home-needs-hidden";

type Ticked = { todo: Todo };
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
  const { data } = useApi<Home>("/api/notes/home");
  const [ticked, setTicked] = useState<Record<string, Ticked>>({});
  const [showAll, setShowAll] = useState(false);
  const [moreReadings, setMoreReadings] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const [hidden, setHidden] = useState(hiddenBefore);
  const [problem, setProblem] = useState<string | null>(null);

  // A screen draws once, whole.
  if (!data) return null;

  const save = (todo: Todo, done: boolean) => send("/api/notes/todos", "PUT", { id: todo.noteId, text: todo.text, done });
  const set = (todo: Todo, next: Ticked | null) =>
    setTicked((all) => {
      const rest = { ...all };
      delete rest[keyOf(todo)];
      return next ? { ...rest, [keyOf(todo)]: next } : rest;
    });
  const failed = (error: unknown) => setProblem(error instanceof Error ? error.message : String(error));

  const tick = (todo: Todo) => {
    setProblem(null);
    set(todo, { todo });
    save(todo, true).catch((error) => {
      set(todo, null);
      failed(error);
    });
  };
  const untick = (entry: Ticked) => {
    setProblem(null);
    set(entry.todo, null);
    save(entry.todo, false).catch((error) => {
      set(entry.todo, entry);
      failed(error);
    });
  };

  const open = data.todos.filter((todo) => !ticked[keyOf(todo)]);
  const listed = showAll ? open : open.slice(0, SHOWN);
  const done = Object.values(ticked);
  const openCount = open.length;

  const waiting = data.needs.tags > 0 || data.needs.report;

  const noteOf = (todo: Todo) => ({ id: todo.noteId, path: todo.title.replace(/\.md$/i, "") });
  const titled = (todo: Todo) => (
    <NoteLink note={noteOf(todo)} data-tip={t("tipTodoFrom")} className="text-xs text-muted-foreground hover:underline">
      {todo.title}
    </NoteLink>
  );

  const nameOf = (scope: string, target: string) => {
    const of = scope === "subject" ? subjectOf(target) : null;
    if (of) return `${t(JOB_LABEL[of.kind])}: ${of.subject === EVERYTHING ? t("brainEverything") : of.subject}`;
    if (scope === "tags") return `${t("jobPicture")}: ${target.split(",").map((tag) => `#${tag}`).join(" ")}`;
    return t("jobPicture");
  };
  const readings = moreReadings ? data.readings : data.readings.slice(0, READINGS_SHOWN);

  return (
    <div className="space-y-5">
      <List>
        <li className="flex flex-wrap gap-3 px-4 py-3">
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
        </li>
      </List>

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
          <List>
            {done.map((entry) => (
              <li key={keyOf(entry.todo)} className="px-4 py-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked onChange={() => untick(entry)} aria-label={t("homeTodoUndo")} data-tip={t("tipTodoUndo")} />
                  <span className="min-w-0 flex-1">
                    <span className="text-muted-foreground line-through">{entry.todo.text}</span> {titled(entry.todo)}
                  </span>
                </label>
              </li>
            ))}
            {listed.map((todo) => (
              <li key={keyOf(todo)} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50">
                <input type="checkbox" className="mt-1" checked={false} onChange={() => tick(todo)} aria-label={t("homeTodoDone")} data-tip={t("tipTodoTick")} />
                {/* Drawn like a note: the words, the sentence they were said in, the note and its day. The tick is the box alone. */}
                <NoteLink
                  note={noteOf(todo)}
                  hash={todo.source?.line != null ? `line-${todo.source.line}` : undefined}
                  data-tip={t("tipTodoFrom")}
                  className="min-w-0 flex-1"
                >
                  <span className="block font-medium">{todo.text}</span>
                  {todo.source && <span className="mt-1 line-clamp-2 block text-xs leading-4 text-muted-foreground">{todo.source.text}</span>}
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {todo.title} · {formatDate(todo.recordedAt, lang)}
                  </span>
                </NoteLink>
              </li>
            ))}
          </List>
        )}
        {!showAll && openCount > SHOWN && (
          <Button variant="link" className="mt-2" tip={t("tipTodosMore")} onClick={() => setShowAll(true)}>
            {t("homeTodosMore", { n: openCount - SHOWN })}
          </Button>
        )}
      </section>

      <section>
        <Heading>{t("homeBrain")}</Heading>
        {data.readings.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("homeBrainNone")}</p>
        ) : (
          <>
            <List>
              {readings.map((reading) => {
                const isOpen = opened === reading.id;
                // The row opens where it is, as every block on the note screen does.
                return (
                  <li key={reading.id}>
                    <details open={isOpen} onToggle={(event) => setOpened(event.currentTarget.open ? reading.id : null)} className="group">
                      <summary data-tip={t("tipReadingMore")} className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 hover:bg-muted/50">
                        <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{nameOf(reading.scope, reading.target)}</span>
                          <span className="text-xs text-muted-foreground">{formatDate(reading.at, lang)}</span>
                          {!isOpen && <span className="mt-1 line-clamp-2 block text-xs leading-4 text-muted-foreground">{reading.excerpt}</span>}
                        </span>
                      </summary>
                      {isOpen && (
                        <div className="pb-3 pl-10 pr-4">
                          <ReadingText scope={reading.scope as Scope} target={reading.target} />
                        </div>
                      )}
                    </details>
                  </li>
                );
              })}
            </List>
            {!moreReadings && data.readings.length > READINGS_SHOWN && (
              <Button variant="link" className="mt-2" tip={t("tipReadingsMore")} onClick={() => setMoreReadings(true)}>
                {t("homeTodosMore", { n: data.readings.length - READINGS_SHOWN })}
              </Button>
            )}
          </>
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
          <Link href="/recent" data-tip={t("tipAllNotes")} className="mt-2 block text-sm text-muted-foreground hover:underline">
            {t("allNotes")} →
          </Link>
        )}
      </section>
    </div>
  );
}
