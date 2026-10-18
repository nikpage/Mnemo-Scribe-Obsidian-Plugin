"use client";

// [Guru]
import { useLang } from "@/hooks/use-lang";
import { formatDate, formatUsd } from "@/lib/format";
import { inlineMarks, readingSections } from "@/lib/note/reading-sections";
import { tipOf } from "@/lib/tooltip";
import { Button, Cost } from "@/components/ui";

/**
 * How a Brain output reads and how a paid press looks, wherever one is drawn:
 * the Brain panel, the Brain library, a written piece.
 */

/** `spent` comes back for the owner's account alone: what the call really cost. */
export type Spent = { costUsd: number; readTokens: number; wroteTokens: number };
/** A row under a reading: an Elaborate names its part, an addition none. */
export type Under = { part: string | null; reading: string | null; created_at?: string; notes?: number | null; spent?: Spent };
export type Quote = { credits: number | null; balance: number | null; notes?: number; fill?: number };
/** What a reading really cost, under it; only the owner's account is ever sent one. */
export function SpentLine({ spent }: { spent?: Spent }) {
  const { t } = useLang();
  if (!spent) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {t("spentLine", { usd: formatUsd(spent.costUsd, 4), read: spent.readTokens, wrote: spent.wroteTokens })}
    </p>
  );
}

/** One block of written text: a paragraph per blank line, bold, italics and code drawn. */
export function Prose({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm">
      {text.split(/\n\s*\n/).map((p, i) => (
        <p key={i} className="whitespace-pre-line">
          {inlineMarks(p.trim()).map((run, j) =>
            run.mark === "strong" ? (
              <strong key={j}>{run.text}</strong>
            ) : run.mark === "em" ? (
              <em key={j}>{run.text}</em>
            ) : run.mark === "code" ? (
              <code key={j} className="rounded bg-muted px-1 text-xs">
                {run.text}
              </code>
            ) : (
              run.text
            )
          )}
        </p>
      ))}
    </div>
  );
}

/** A reading's text by its headings, nothing to press. */
export function Sections({ text }: { text: string }) {
  return (
    <>
      {readingSections(text).map((section, i) => (
        <section key={i}>
          {section.heading && <h3 className="mb-1 text-sm font-semibold">{section.heading}</h3>}
          {section.body && <Prose text={section.body} />}
        </section>
      ))}
    </>
  );
}

/** What was added to a reading as notes came in, oldest first, each under its date and how many notes it read. */
export function Additions({ more }: { more: Under[] }) {
  const { lang, t } = useLang();
  const added = more.filter((m) => !m.part && m.reading);
  if (added.length === 0) return null;
  return (
    <>
      {added.map((m, i) => (
        <section key={i} className="space-y-2 border-l-2 border-border pl-3" data-addition>
          <p className="text-xs font-semibold text-muted-foreground">{t("addedOn", { date: m.created_at ? formatDate(m.created_at, lang) : "", n: m.notes ?? 0 })}</p>
          <div className="space-y-4">
            <Sections text={m.reading!} />
          </div>
          <SpentLine spent={m.spent} />
        </section>
      ))}
    </>
  );
}

/** A reading's text by its headings, each Elaborate written under the heading it writes out, then its additions. */
export function ReadingProse({ text, more = [] }: { text: string; more?: Under[] }) {
  return (
    <div className="space-y-4">
      {readingSections(text).map((section, i) => {
        const out = section.heading ? more.find((m) => m.part === section.heading && m.reading) : undefined;
        return (
          <section key={i}>
            {section.heading && <h3 className="mb-1 text-sm font-semibold">{section.heading}</h3>}
            {section.body && <Prose text={section.body} />}
            {out && (
              <div className="mt-2 border-l-2 border-border pl-3">
                <Prose text={readingSections(out.reading!).map((s) => [s.heading, s.body].filter(Boolean).join("\n\n")).join("\n\n")} />
              </div>
            )}
          </section>
        );
      })}
      <Additions more={more} />
    </div>
  );
}

/** The press, its price inside it, and in words under it so a phone sees why. */
export function PressButton({ label, tip, primary, disabled, onPress, quote, why }: { label: string; tip: string; primary: boolean; disabled: boolean; onPress: () => void; quote?: Quote; why?: string }) {
  return (
    <div>
      <Button size="sm" variant={primary ? "primary" : "secondary"} onClick={onPress} disabled={disabled || quote?.credits === null} tip={tipOf(tip, why)}>
        {label}
        <Cost credits={quote?.credits} why={why} />
      </Button>
      <p className="mt-1 min-h-4 text-xs text-muted-foreground">{quote?.credits ? why : ""}</p>
    </div>
  );
}
