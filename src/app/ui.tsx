// [utils]

import { Coins } from "lucide-react";

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
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg" }) {
  return <button type="button" {...props} className={`${VARIANT[variant]} ${size === "sm" ? "is-small" : ""} ${className}`} />;
}

export function Cost({ credits, why }: { credits: number | null | undefined; why?: string }) {
  if (credits === 0) return null;
  return (
    <span title={why} aria-label={why} className="scribe-cost" style={credits == null ? { visibility: "hidden" } : undefined}>
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
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean; count?: number; onRemove?: () => void }) {
  return (
    <button type="button" aria-pressed={onRemove ? undefined : on} onClick={onRemove} {...props} className={`scribe-chip ${className}`}>
      {children}
      {count !== undefined && <span className="scribe-count">{count}</span>}
      {onRemove && <span aria-hidden>×</span>}
    </button>
  );
}

export function Pill({ children, onClick, onRemove, removeLabel }: { children: React.ReactNode; onClick?: () => void; onRemove: () => void; removeLabel: string }) {
  return (
    <span className="scribe-pill">
      {onClick ? (
        <button type="button" onClick={onClick}>
          {children}
        </button>
      ) : (
        <span>{children}</span>
      )}
      <button type="button" onClick={onRemove} aria-label={removeLabel}>
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
