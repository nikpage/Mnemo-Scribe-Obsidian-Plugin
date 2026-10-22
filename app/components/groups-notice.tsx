"use client";

// [Librarian]
import Link from "next/link";
import { useLang } from "@/hooks/use-lang";
import { useCounts } from "@/hooks/use-notes-page";
import { GROUPS_PAGE } from "@/lib/note/groups";

/**
 * One line on a screen a saved group setting is narrowing: how many notes are
 * out of sight (`hidden`), or out of the Brain (`kept`), and the way to Groups.
 * Nothing when no group narrows it. Read from the sidebar's own numbers, so it
 * costs no request of its own.
 */
export function GroupsNotice({ kind, aside = 0, link = true }: { kind: "hidden" | "kept"; aside?: number; link?: boolean }) {
  const { t } = useLang();
  const counts = useCounts().data;
  const n = kind === "hidden" ? (counts?.hidden ?? 0) : (counts?.kept ?? 0);
  if (!n && !aside) return null;
  const words = [n ? t(kind === "hidden" ? "groupsNoticeHidden" : "groupsNoticeKept", { n }) : "", aside ? t("groupsNoticeAside", { n: aside }) : ""].filter(Boolean).join(" ");
  return (
    <p className="mb-3 text-xs text-muted-foreground">
      {words}{" "}
      {link && (
        <Link href={GROUPS_PAGE} data-tip={t("tipGroupsOpen")} className="text-primary hover:underline">
          {t("groupsOpen")}
        </Link>
      )}
    </p>
  );
}
