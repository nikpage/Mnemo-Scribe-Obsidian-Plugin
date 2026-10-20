"use client";

// [Writer]
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useLang } from "@/hooks/use-lang";
import { useCounts } from "@/hooks/use-notes-page";
import { allAnswered, send, useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { tagsByUse } from "@/lib/note/notes-page";
import { type Scope, startOf } from "@/lib/note/what-next-target";
import { SaveAsNote } from "@/components/save-as-note";
import { WhichNotes, readOf, useWhich } from "@/components/what-next";
import { PIECES, PieceBackground, type PieceAnswer, PieceFields, PieceMore, PieceView, type Translate, WriteIt, formName, pieceUrl, refused, usePieceChoice } from "@/components/write-it";
import { Button, Heading, List, Notice, buttonClass, useConfirm } from "@/components/ui";

/** A piece as the list shows it. */
export type PieceRow = {
  id: string;
  title: string | null;
  brief: string;
  form_key: string | null;
  form_name: string;
  voice_name: string | null;
  spoken_id: string | null;
  unkept: string[] | null;
  stage: "outline" | "piece";
  status: "running" | "done" | "failed";
  notes: number | null;
  created_at: string;
};

/** Where a piece is: its outline being written or waiting, the piece being written or shaped, to check, done or failed. */
export function pieceState(t: Translate, p: Pick<PieceRow, "stage" | "status" | "spoken_id" | "unkept">): string {
  if (p.status === "running") return t(p.spoken_id ? "pieceShaping" : p.stage === "outline" ? "pieceOutlining" : "pieceWriting");
  if (p.status === "failed") return t("pieceFailedShort");
  if (p.unkept?.length) return t("pieceCheck");
  return t(p.stage === "outline" ? "pieceOutlineReady" : "pieceDone");
}

/** Written, and nothing in it waiting to be checked against the recording. */
const finished = (p: PieceRow) => p.stage === "piece" && p.status === "done" && !p.unkept?.length;

/** Pieces newest first, each opening on its own page; a draft says where it is. */
function PieceList({ pieces }: { pieces: PieceRow[] }) {
  const { lang, t } = useLang();
  return (
    <List>
      {pieces.map((p) => (
        <li key={p.id}>
          <Link href={`/write/${p.id}`} data-tip={t("tipPieceOpen")} className="block px-4 py-3 hover:bg-muted">
            <span className="flex items-center justify-between gap-3">
              <span className="truncate text-sm font-medium">{p.title || p.brief}</span>
              {!finished(p) && (
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${p.status === "failed" ? "bg-destructive/10 text-destructive" : p.status === "done" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                  {pieceState(t, p)}
                </span>
              )}
            </span>
            <span className="block text-xs text-muted-foreground">
              {formName(t, p.form_key, p.form_name)} · {p.voice_name ?? t("writingNoVoice")} · {formatDate(p.created_at, lang)}
            </span>
          </Link>
        </li>
      ))}
    </List>
  );
}

/**
 * Write: the person's pieces, drafts (an outline waiting, being written, a
 * shaped piece to check, or failed) apart from finished ones, newest first, and "New piece". One free
 * request.
 */
export function WriteHome() {
  const { t } = useLang();
  const pieces = useApi<{ pieces: PieceRow[] }>(PIECES);
  if (!allAnswered(pieces)) return <main className="p-4 md:p-6" />;
  const all = pieces.data?.pieces ?? [];
  const drafts = all.filter((p) => !finished(p));
  const done = all.filter(finished);

  return (
    <main className="mx-auto max-w-3xl p-4 md:p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("writeNav")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("writeWhat")}</p>
        </div>
        <Link href="/write/new" data-tip={t("tipPieceNew")} className={`${buttonClass("primary")} shrink-0`}>
          <Plus className="h-4 w-4" aria-hidden />
          {t("pieceNew")}
        </Link>
      </div>
      {all.length === 0 && <p className="text-sm text-muted-foreground">{t("piecesNone")}</p>}
      {drafts.length > 0 && (
        <section className="mb-8">
          <Heading>{t("pieceDrafts")}</Heading>
          <PieceList pieces={drafts} />
        </section>
      )}
      {done.length > 0 && (
        <section>
          <Heading>{t("pieceFinished")}</Heading>
          <PieceList pieces={done} />
        </section>
      )}
    </main>
  );
}

/**
 * New piece, one short flow: its type, its voice, what it is written from
 * (a recording picked in place of the notes), what it is about, which
 * notes (the Brain's pills; `of`, a Brain output's id, starts on the notes
 * it read), what it must stay true to (folded unless a story), and under
 * More its opening words and models. One press, at the
 * price on it, writes the outline; the piece's page takes it from there.
 */
export function NewPiece({ of }: { of?: string }) {
  const { t } = useLang();
  const router = useRouter();
  const choice = usePieceChoice();
  const counts = useCounts();
  const tags = useMemo(() => tagsByUse(counts.data?.sets ?? []), [counts.data]);
  const output = useApi<{ reading: { id: string; scope: Scope; target: string; title: string } }>(of ? `/api/notes/what-next?id=${encodeURIComponent(of)}` : null);
  const [start] = useState(() => startOf([], { of }));
  const which = useWhich(start);
  if (!allAnswered(choice.voices, choice.forms, choice.recordings, counts, of ? output : { data: null })) return <main className="p-4 md:p-6" />;
  const reading = output.data?.reading;
  // A Brain output gone since the link was made narrows nothing.
  const narrow = reading ? which.live : { ...which.live, of: undefined };

  return (
    <main className="mx-auto max-w-3xl p-4 md:p-6">
      <Link href="/write" data-tip={t("tipPieceBack")} className="mb-4 inline-block text-sm text-primary hover:underline">
        ← {t("writeNav")}
      </Link>
      <h1 className="mb-1 text-2xl font-bold">{t("pieceNew")}</h1>
      <p className="mb-8 text-sm text-muted-foreground">{t("pieceNewWhat")}</p>

      <div className="space-y-8">
        <PieceFields choice={choice} />

        {choice.spoken === null && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t("brainWhich")}</h3>
            <p className="text-xs text-muted-foreground">{t("pieceNotesWhat")}</p>
            <WhichNotes which={which} tags={tags} of={reading ? { id: reading.id, title: reading.title || readOf(t, reading.scope, reading.target) } : undefined} alone={false} />
          </section>
        )}

        <PieceBackground choice={choice} />

        <PieceMore choice={choice} />

        <WriteIt choice={choice} narrow={narrow} topics={which.topics} onStarted={(id) => router.push(`/write/${id}`)} />
      </div>
    </main>
  );
}

/** One piece on its own page: the piece, "Save as my note" once it is written, and its delete. */
export function PiecePage({ id }: { id: string }) {
  const { t } = useLang();
  const router = useRouter();
  const confirm = useConfirm();
  // The request the piece itself makes, so one answer serves both.
  const page = useApi<PieceAnswer>(pieceUrl(id));
  const [note, setNote] = useState<string | null>(null);

  if (!allAnswered(page)) return <main className="p-4 md:p-6" />;
  const piece = page.data?.piece;

  async function remove() {
    if (!(await confirm(t("pieceDeleteAsk"), { action: t("pieceDelete"), cancel: t("cancel") }))) return;
    try {
      await send(PIECES, "DELETE", { id });
      router.push("/write");
    } catch (err) {
      setNote(refused(t, err));
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-4 md:p-6">
      <Link href="/write" data-tip={t("tipPieceBack")} className="mb-4 inline-block text-sm text-primary hover:underline">
        ← {t("writeNav")}
      </Link>
      <PieceView id={id} big written={(p) => <div className="mt-4"><SaveAsNote title={p.title} text={p.text} piece={id} /></div>} />
      {note && <Notice tone="error" className="mt-4">{note}</Notice>}
      {piece && piece.status !== "running" && (
        <Button variant="link" tip={t("tipPieceDelete")} onClick={() => void remove()}>
          {t("pieceDelete")}
        </Button>
      )}
    </main>
  );
}
