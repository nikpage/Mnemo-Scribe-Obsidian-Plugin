"use client";

// [Guru]
import Link from "next/link";
import { useApi } from "@/lib/api";
import { useLang } from "@/hooks/use-lang";
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

export function NoteLinks({ recordingId }: { recordingId: string }) {
  const { t } = useLang();
  const links = useApi<{ links: NoteLink[] }>(`/api/notes/links?id=${recordingId}`).data?.links ?? [];

  // A link the user rejected is kept in the database so the question is not
  // asked twice, but it is not a relation any more and is not shown.
  const shown = links.filter((l) => l.confirmed !== false);
  if (shown.length === 0) return null;

  return (
    <NoteSection title={t("connected")} hint={t("connectedHint")} defaultOpen>
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
    </NoteSection>
  );
}
