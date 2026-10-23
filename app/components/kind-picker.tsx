"use client";

// [Librarian]
import { useLang } from "@/hooks/use-lang";
import { KINDS, KIND_NAME, type Kind } from "@/lib/note/kinds";
import { Chip } from "@/components/ui";

/** The Kinds as chips, any chosen; several hold for one passage, with the tags (`kindMatch()`). */
export function KindPicker({ chosen, onChange }: { chosen: Kind[]; onChange: (kinds: Kind[]) => void }) {
  const { t } = useLang();
  return (
    <div className="mb-4 flex flex-wrap gap-1">
      {KINDS.map((kind) => (
        <Chip
          key={kind}
          on={chosen.includes(kind)}
          tip={t("tipKindChip")}
          onClick={() => onChange(chosen.includes(kind) ? chosen.filter((k) => k !== kind) : [...chosen, kind])}
        >
          {t(KIND_NAME[kind])}
        </Chip>
      ))}
    </div>
  );
}
