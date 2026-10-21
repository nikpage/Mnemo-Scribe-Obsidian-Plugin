// [utils]

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Coins } from "lucide-react";
import { useLang } from "@/hooks/use-lang";

/**
 * The app's `components/ui.tsx` as the plugins run it: the same parts with
 * the same props, drawn by the panel's stylesheet (`panel/style.ts`) in the
 * colours and type of the app the panel sits in. Only the parts the shared
 * screens use are here; one more is a build error, never a wrong look.
 */

type ButtonVariant = "primary" | "secondary" | "danger" | "record" | "warning" | "quiet" | "link";
const VARIANT: Record<ButtonVariant, string> = {
  primary: "scribe-btn is-primary",
  secondary: "scribe-btn",
  danger: "scribe-btn is-record",
  record: "scribe-btn is-recording",
  warning: "scribe-btn is-primary",
  quiet: "scribe-link",
  link: "scribe-link",
};

export function Button({
  variant = "secondary",
  size,
  tip,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg"; tip?: string }) {
  return <button type="button" data-tip={tip} {...props} className={`${VARIANT[variant]} ${size === "sm" ? "is-small" : ""} ${className}`} />;
}

export function buttonClass(variant: ButtonVariant = "secondary", size?: "sm" | "md" | "lg"): string {
  return `${VARIANT[variant]} ${size === "sm" ? "is-small" : ""}`;
}

export function Cost({ credits, why }: { credits: number | null | undefined; why?: string }) {
  if (credits === 0) return null;
  return (
    <span data-tip={why} aria-label={why} className="scribe-cost" style={credits == null ? { visibility: "hidden" } : undefined}>
      <Coins aria-hidden />
      {credits ?? 0}
    </span>
  );
}

export function Input({ size, className = "", ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: "md" | "lg" }) {
  void size;
  return <input {...props} className={`scribe-input ${className}`} />;
}

export const selectClass = "scribe-input scribe-select";

export function inputClass(size: "md" | "lg" = "md", fullWidth = true): string {
  void size;
  return fullWidth ? "scribe-input w-full" : "scribe-input";
}

export function Heading({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h3 className={`scribe-heading ${className}`}>{children}</h3>;
}

export function Notice({ tone = "info", children, className = "" }: { tone?: "info" | "primary" | "error"; children: React.ReactNode; className?: string }) {
  return <div className={`scribe-notice is-${tone} ${className}`}>{children}</div>;
}

export function Chip({
  on = false,
  count,
  onRemove,
  tip,
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean; count?: number; onRemove?: () => void; tip?: string }) {
  return (
    <button type="button" data-tip={tip} aria-pressed={onRemove ? undefined : on} onClick={onRemove} {...props} className={`scribe-chip ${className}`}>
      {children}
      {count !== undefined && <span className="scribe-count">{count}</span>}
      {onRemove && <span aria-hidden>×</span>}
    </button>
  );
}

export function Pill({ children, onClick, onRemove, removeLabel, tip, removeTip }: { children: React.ReactNode; onClick?: () => void; onRemove: () => void; removeLabel: string; tip?: string; removeTip?: string }) {
  return (
    <span className="scribe-pill">
      {onClick ? (
        <button type="button" data-tip={tip} onClick={onClick}>
          {children}
        </button>
      ) : (
        <span data-tip={tip}>{children}</span>
      )}
      <button type="button" data-tip={removeTip} onClick={onRemove} aria-label={removeLabel}>
        ×
      </button>
    </span>
  );
}

export function Options<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; hint: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="scribe-options">
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={option.value === value} onClick={() => onChange(option.value)} className="scribe-option">
          <span aria-hidden className="scribe-dot" />
          <span>
            <b>{option.label}</b>
            <small>{option.hint}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

export function List({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <ul className={`scribe-list ${className}`}>{children}</ul>;
}

type Presence = "opening" | "open" | "closing" | null;

/** The app's `usePresence()`: "opening" and "closing" while a part moves, null once gone. */
function usePresence(open: boolean): { state: Presence; settle: (event: React.AnimationEvent) => void } {
  const [state, setState] = useState<Presence>(open ? "open" : null);
  const [was, setWas] = useState(open);
  if (open !== was) {
    setWas(open);
    setState(open ? "opening" : state === null ? null : "closing");
  }
  const settle = (event: React.AnimationEvent) => {
    if (event.target !== event.currentTarget) return;
    setState((now) => (now === "opening" ? "open" : now === "closing" ? null : now));
  };
  return { state, settle };
}

/** A part of a screen that unfolds in place and folds away before it goes. */
export function Reveal({ open, children, onClosed }: { open: boolean; children: React.ReactNode; onClosed?: () => void }) {
  const { state, settle } = usePresence(open);
  const done = (event: React.AnimationEvent) => {
    settle(event);
    if (state === "closing" && event.target === event.currentTarget) onClosed?.();
  };
  if (state === null) return null;
  return (
    <div
      className="scribe-reveal"
      data-state={state}
      onAnimationEnd={done}
    >
      <div>{children}</div>
    </div>
  );
}

type ConfirmOptions = { action: string; cancel: string; danger?: boolean };
type Ask = (message: string, options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

/** "Are you sure?" inside the panel, as the app asks it in its own look. */
export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error("useConfirm must be used inside ConfirmProvider");
  return ask;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const { t } = useLang();
  // The question stays on the box while it fades away.
  const [pending, setPending] = useState<{ message: string; options: ConfirmOptions } | null>(null);
  const [open, setOpen] = useState(false);
  const { state, settle } = usePresence(open);
  const answer = useRef<(yes: boolean) => void>(() => {});
  const ask = useCallback<Ask>(
    (message, options) =>
      new Promise((resolve) => {
        answer.current = resolve;
        setPending({ message, options });
        setOpen(true);
      }),
    []
  );
  function close(yes: boolean) {
    answer.current(yes);
    answer.current = () => {};
    setOpen(false);
  }
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending && state && (
        <div className="scribe-confirm" role="alertdialog" aria-label={pending.message} data-state={state === "closing" ? "closed" : "open"}>
          <div onAnimationEnd={settle}>
            <p>{pending.message}</p>
            <div className="scribe-row">
              <Button tip={t("tipConfirmCancel")} onClick={() => close(false)}>
                {pending.options.cancel}
              </Button>
              <Button variant={pending.options.danger ? "record" : "primary"} tip={t("tipConfirmGo")} onClick={() => close(true)}>
                {pending.options.action}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
