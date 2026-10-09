// [utils]

/**
 * The app's `components/note-section.tsx` as the plugins run it: the same
 * foldable block, folded the way this app folds things.
 */
export function NoteSection({
  id,
  title,
  hint,
  defaultOpen = false,
  onOpenChange,
  children,
}: {
  id?: string;
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <details id={id} open={defaultOpen} onToggle={(event) => onOpenChange?.(event.currentTarget.open)} className="scribe-fold">
      <summary>{title}</summary>
      {hint && <p className="scribe-muted">{hint}</p>}
      {children}
    </details>
  );
}
