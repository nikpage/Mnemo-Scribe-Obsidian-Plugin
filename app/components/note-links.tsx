"use client";

// [Guru]
import Link from "next/link";
import { useState } from "react";
import { answered, send, useApi, useOptimistic } from "@/lib/api";
import { busyUntilDone } from "@/lib/busy";
import { formatDate } from "@/lib/format";
import { useLang } from "@/hooks/use-lang";
import { Button, List } from "@/components/ui";
import type { TranslationKey } from "@/lib/i18n";
import { NoteSection } from "@/components/note-section";

interface NoteLink {
  id: string;
  type: "outcome-of" | "same-event" | "contradicts" | "revisits";
  direction: "to" | "from";
  confidence: number;
  reason: string;
  confirmed: boolean | null;
  note: { id: string; title: string; path: string; recordedAt: string };
}

/**
 * How a link reads from each end. The relation is stored once, pointing
 * back in time, but the note at the earlier end is not "the outcome of" —
 * it is the thing that was reported on, and saying it the other way round
 * would be wrong rather than merely awkward.
 */
const PHRASE: Record<string, { to: TranslationKey; from: TranslationKey }> = {
  "outcome-of": { to: "linkReports", from: "linkReportedBy" },
  "same-event": { to: "linkSameEvent", from: "linkSameEvent" },
  contradicts: { to: "linkContradicts", from: "linkContradictedBy" },
  revisits: { to: "linkRevisits", from: "linkRevisitedBy" },
  continues: { to: "linkContinues", from: "linkContinuedBy" },
};

/**
 * Related: always shown once answered, so a note with no links says whether
 * it was never looked at or looked at and found nothing, and offers to look
 * again — against every note, earlier and later. Links the person turned
 * down sit folded under "Turned down", each restorable as kept.
 */
export function NoteLinks({ recordingId }: { recordingId: string }) {
  const { t, lang } = useLang();
  const res = useApi<{ links: NoteLink[]; lookedAt?: string | null }>(`/api/notes/links?id=${recordingId}`);
  const [looking, setLooking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showDown, setShowDown] = useState(false);
  const optimistic = useOptimistic(res.mutate);

  if (!answered(res)) return null;
  const links = res.data?.links ?? [];
  const lookedAt = res.data?.lookedAt ?? null;

  // A link the user rejected is kept in the database so the question is not
  // asked twice, but it is not a relation any more: it waits under "Turned down".
  const shown = links.filter((l) => l.confirmed !== false);
  const down = links.filter((l) => l.confirmed === false);

  async function restore(id: string) {
    const ok = await optimistic({ links: links.map((l) => (l.id === id ? { ...l, confirmed: true } : l)), lookedAt }, () =>
      send("/api/notes/links", "PUT", { id })
    );
    setFailed(!ok);
  }

  async function lookAgain() {
    const done = busyUntilDone();
    setLooking(true);
    setFailed(false);
    try {
      await send("/api/notes/links", "POST", { id: recordingId });
      await res.mutate();
    } catch {
      setFailed(true);
    } finally {
      setLooking(false);
      done();
    }
  }

  return (
    <NoteSection title={t("connected")} hint={t("connectedHint")} defaultOpen>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("linksNone")}</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((link) => (
            <li key={link.id} className="text-sm">
              <span className="text-muted-foreground">
                {t(PHRASE[link.type][link.direction])}{" "}
              </span>
              <Link href={`/transcript/${link.note.id}`} className="text-primary hover:underline">
                {link.note.title}
              </Link>
              {link.reason && (
                <p className="text-xs text-muted-foreground">
                  {link.reason}
                  {/* An unconfirmed link says so. Nothing here is asserted as
                      settled just because a model was willing to say it. */}
                  {link.confirmed === null && link.confidence < 0.8 && ` · ${t("linkUnsure")}`}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{lookedAt ? t("linksLooked", { date: formatDate(lookedAt, lang) }) : t("linksNotLooked")}</span>
        <Button variant="link" className="text-xs" tip={t("tipLinksLookAgain")} disabled={looking} onClick={lookAgain}>
          {looking ? t("linksLooking") : t("linksLookAgain")}
        </Button>
        {failed && <span>{t("linksLookFailed")}</span>}
      </p>
      {down.length > 0 && (
        <div className="mt-2">
          <Button variant="link" className="text-xs" tip={t("tipTurnedDown")} onClick={() => setShowDown((open) => !open)}>
            {t("turnedDown", { n: down.length })}
          </Button>
          {showDown && (
            <List className="mt-2">
              {down.map((link) => (
                <li key={link.id} className="flex flex-wrap items-start gap-2 px-4 py-3 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="text-muted-foreground">{t(PHRASE[link.type][link.direction])} </span>
                    {link.note.title}
                    {link.reason && <span className="block text-xs text-muted-foreground">{link.reason}</span>}
                  </span>
                  <Button size="sm" tip={t("tipRestoreLink")} onClick={() => void restore(link.id)}>
                    {t("restore")}
                  </Button>
                </li>
              ))}
            </List>
          )}
        </div>
      )}
    </NoteSection>
  );
}
