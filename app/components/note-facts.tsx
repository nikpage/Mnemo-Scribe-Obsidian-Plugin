"use client";

// [Guru]
import { useState } from "react";
import { useApi } from "@/lib/api";
import { useLang } from "@/hooks/use-lang";
import { NoteSection } from "@/components/note-section";
import { Chip } from "@/components/ui";
import { factMeta } from "@/lib/note/fact-line";
import { formatDate, formatFactDate } from "@/lib/format";

export interface Fact {
  id: string;
  subject: string;
  variable: string;
  valueText: string;
  unit: string | null;
  happenedOn: string | null;
  saidOn: string | null;
  saidAt: number | null;
  quote: string;
  confidence: number;
}

/**
 * What a note states, read off it once when it completed.
 *
 * Shown because an extraction the user cannot see is one they cannot
 * correct: every row carries the sentence it came from, so a wrong fact is
 * obvious rather than quietly wrong underneath a later answer.
 *
 * A note that states nothing renders nothing — an empty strip is noise.
 */
export function NoteFacts({ recordingId }: { recordingId: string }) {
  const { t, lang } = useLang();
  const facts = useApi<{ facts: Fact[] }>(`/api/notes/facts?id=${recordingId}`).data?.facts ?? [];
  const [open, setOpen] = useState<string | null>(null);

  if (facts.length === 0) return null;

  return (
    <NoteSection title={t("whatThisSays")} hint={t("whatThisSaysHint")} defaultOpen>
      <div className="flex flex-wrap gap-2">
        {facts.map((fact) => (
          <Chip
            key={fact.id}
            on={open === fact.id}
            onClick={() => setOpen(open === fact.id ? null : fact.id)}
            // A fact the extraction was unsure of looks unsure.
            className={fact.confidence < 0.5 ? "border-dashed" : "text-foreground"}
            title={fact.quote}
          >
            <span className="font-medium">{fact.subject}</span>
            <span className="text-muted-foreground">
              {": "}
              {/* A date only when the fact is about a different day from the
                  one it was spoken on — the case this exists for. */}
              {factMeta({ ...fact, happenedOn: fact.happenedOn === fact.saidOn ? null : fact.happenedOn }, lang)}
            </span>
            {fact.valueText}
          </Chip>
        ))}
      </div>

      {open && (
        <div className="mt-2 border-l-2 border-border pl-3 text-xs text-muted-foreground">
          <p className="italic">“{facts.find((f) => f.id === open)?.quote}”</p>
          {(() => {
            const fact = facts.find((f) => f.id === open);
            if (!fact?.happenedOn || fact.happenedOn === fact.saidOn) return null;
            // Both dates, plainly, so a wrong resolution is visible rather
            // than silently reordering a series.
            return (
              <p className="mt-1">
                {t("factAbout")} {formatFactDate(fact.happenedOn, lang)} · {t("factSaid")}{" "}
                {fact.saidOn && formatDate(fact.saidOn, lang)}
              </p>
            );
          })()}
        </div>
      )}
    </NoteSection>
  );
}
