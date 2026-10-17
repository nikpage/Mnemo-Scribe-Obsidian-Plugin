// [Librarian]
import { X } from "lucide-react";
import type { useLang } from "@/hooks/use-lang";
import { formatDateShort } from "@/lib/format";
import type { WalkNode } from "@/lib/note/walk";
import type { Share } from "@/lib/note/walk-set";
import { LEVEL_WIDTH, type Row, isStruck, levelColour, nameOf } from "@/lib/note/walk-levels";

type T = ReturnType<typeof useLang>["t"];
type Lang = ReturnType<typeof useLang>["lang"];

/** The mark for a note held by several anchors (two rings) or by one (a dot), drawn centred on 0,0 in the picture and in every list. */
export function ShareGlyph({ share }: { share: Share }) {
  return share === "shared" ? (
    <>
      <circle cx={-2.5} cy={0} r={3.4} fill="none" stroke="currentColor" strokeWidth={1.4} />
      <circle cx={2.5} cy={0} r={3.4} fill="none" stroke="currentColor" strokeWidth={1.4} />
    </>
  ) : (
    <circle cx={0} cy={0} r={3} fill="currentColor" />
  );
}

/** The mark with its words, for a list row and the box under the picture. */
export function ShareMark({ share, word }: { share: Share; word: string }) {
  return (
    <span className="text-xs text-muted-foreground" style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
      <svg width={14} height={8} viewBox="-7 -4 14 8" aria-hidden="true">
        <ShareGlyph share={share} />
      </svg>
      {word}
    </span>
  );
}

/**
 * The walk as a list, nearest first, in the picture's colours. A row lights its
 * bubble and, pressed, joins the trail (`chosen`) as a tag joins the set in the
 * left list: marked in the centre colour with its ×, pressed again it leaves.
 * A node that touches several nearer ones is opened under one and shown again,
 * shut, under the others.
 * A row carries no tip (`tips-check.mjs`): the box under the picture already says
 * what the lit thing is and why, and a tip here covered the picture.
 */
export function WalkList({ rows, height, lit, struck, centre, chosen, shares, words, onPoint, onLeave, onTap, t, lang }: { rows: Row[]; height: number; shares: ReadonlyMap<string, Share>; words: Record<Share, string>; struck: ReadonlySet<string>; lit: Set<string> | null; centre: string; chosen: ReadonlySet<string>; onPoint: (id: string) => void; onLeave: () => void; onTap: (n: WalkNode) => void; t: T; lang: Lang }) {
  return (
    <div className="overflow-y-auto rounded-2xl border border-border bg-card" style={{ maxHeight: height }} onPointerLeave={onLeave}>
      {rows.map((r, i) => {
        const n = r.node;
        const tag = n.kind === "tag";
        const on = !!lit && lit.has(n.id);
        const colour = levelColour(r.level);
        const picked = chosen.has(n.id);
        return (
          <div
            key={`${n.id}:${i}`}
            role="button"
            tabIndex={0}
            aria-label={nameOf(n)}
            className={on ? "bg-muted" : "hover:bg-muted"}
            style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "7px 10px", marginLeft: 6 + r.depth * 14, borderLeft: `${LEVEL_WIDTH[r.level]}px solid ${colour}`, opacity: r.again ? 0.6 : 1 }}
            onPointerEnter={(ev) => ev.pointerType !== "touch" && onPoint(n.id)}
            onFocus={() => onPoint(n.id)}
            onClick={() => onTap(n)}
            onKeyDown={(ev) => ev.key === "Enter" && onTap(n)}
          >
            <span aria-hidden style={{ flex: "none", width: 10, height: 10, borderRadius: "50%", boxSizing: "border-box", border: `2px solid ${colour}`, background: tag ? "transparent" : colour }} />
            <span className="truncate text-sm" style={{ flex: 1, minWidth: 0, fontWeight: n.id === centre || tag || picked ? 600 : 400, color: picked ? levelColour(1) : undefined, textDecoration: isStruck(n, struck) ? "line-through" : undefined }}>
              {nameOf(n)}
            </span>
            {shares.get(n.id) && <ShareMark share={shares.get(n.id)!} word={words[shares.get(n.id)!]} />}
            <span className="text-xs text-muted-foreground" style={{ flex: "none" }}>
              {tag ? t("webNotes", { n: n.count }) : formatDateShort(n.at, lang)}
            </span>
            {picked && <X className="h-3.5 w-3.5" style={{ flex: "none", color: levelColour(1) }} aria-hidden />}
          </div>
        );
      })}
    </div>
  );
}
