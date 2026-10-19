"use client";

// [Guru, Writer]
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLang } from "@/hooks/use-lang";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Button, useConfirm } from "@/components/ui";

/** A Brain output's Elaborate or addition, as its page reads it back. */
export type Written = {
  id: string;
  target: string;
  part: string | null;
  status: "running" | "done" | "failed";
  reading: string | null;
  created_at: string;
  notes: number | null;
  spent?: { costUsd: number; readTokens: number; wroteTokens: number };
};

/** The output as a Markdown file: its title, its text, each Elaborate under the heading it writes out, then each addition under its date. */
function outputFile(title: string, text: string, more: Written[], addedOn: (m: Written) => string): File {
  const parts = [
    `# ${title}`,
    "",
    text,
    ...more.filter((m) => m.part && m.reading).flatMap((m) => ["", `## ${m.part}`, "", m.reading!]),
    ...more.filter((m) => !m.part && m.reading).flatMap((m) => ["", `## ${addedOn(m)}`, "", m.reading!]),
  ];
  const name = `${title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "brain"}.md`;
  return new File([parts.join("\n")], name, { type: "text/markdown" });
}

/**
 * "Save as my note": a Brain output or a written piece becomes an ordinary
 * note of the person's own, through the import every file takes, at the price
 * it quotes first. From then on it is theirs: filed, tagged, editable, and
 * read by the AI like any note. The plugins draw it too.
 */
export function SaveAsNote({ title, text, more = [] }: { title: string; text: string; more?: Written[] }) {
  const { lang, t } = useLang();
  const confirm = useConfirm();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const file = outputFile(title, text, more, (m) => t("addedOn", { date: formatDate(m.created_at, lang), n: m.notes ?? 0 }));
      const asked = new FormData();
      asked.append("files", file);
      const quoted = await api<{ credits: number; balance: number }>("/api/notes/import/quote", { method: "POST", body: asked });
      if (quoted.credits > 0 && !(await confirm(t("importConfirm", { n: quoted.credits, b: quoted.balance }), { action: t("importAction", { n: quoted.credits }), cancel: t("cancel") }))) return;
      const body = new FormData();
      body.append("files", file);
      body.append("credits", String(quoted.credits));
      const done = await api<{ imported?: { id: string }[] }>("/api/notes/import", { method: "POST", body });
      const id = done.imported?.[0]?.id;
      if (!id) throw new Error("not imported");
      router.push(`/transcript/${id}`);
    } catch {
      setNote(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6">
      <Button size="sm" disabled={busy} tip={t("tipLibrarySave")} onClick={() => void save()}>
        {busy ? t("librarySaving") : t("librarySave")}
      </Button>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
