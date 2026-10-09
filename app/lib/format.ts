// [utils]

import type { Lang } from "@/lib/i18n";

/**
 * Every date, time, length and amount the app shows, written one way.
 *
 * Screens used to format these themselves — Czech on one, American month-first
 * on the next, British on a third — so the same note read differently depending
 * on where it was seen. English is British: day before month, like Czech.
 */

const LOCALE: Record<Lang, string> = { cs: "cs-CZ", en: "en-GB" };

function formatter(lang: Lang, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(LOCALE[lang], options);
}

/** 18. 9. 2026 / 18/09/2026 — the date in a list. */
export function formatDate(iso: string, lang: Lang): string {
  return formatter(lang, { day: "numeric", month: "numeric", year: "numeric" }).format(new Date(iso));
}

/** 18. 9. 2026 10:30 — the date and time a recording was made. */
export function formatDateTime(iso: string, lang: Lang): string {
  return formatter(lang, {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** 18. září 2026 10:30 / 18 September 2026 10:30 — the heading of a note. */
export function formatDateLong(iso: string, lang: Lang): string {
  return formatter(lang, {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** 18. zář 2026 / 18 Sept 2026 — a date on a timeline. */
export function formatDateShort(iso: string, lang: Lang): string {
  return formatter(lang, { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

/**
 * 1967 / March 1967 / 10/01/1967 — when a fact is about, only as exact as it
 * was said: `spokenDate()` hands over "1967", "1967-03" or "1967-01-10".
 */
export function formatFactDate(day: string, lang: Lang): string {
  if (day.length === 4) return day;
  const at = new Date(`${day.length === 7 ? `${day}-01` : day}T12:00:00Z`);
  if (day.length === 7) {
    return new Intl.DateTimeFormat(LOCALE[lang], { month: "long", year: "numeric", timeZone: "UTC" }).format(at);
  }
  return new Intl.DateTimeFormat(LOCALE[lang], { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" }).format(at);
}

/** "Friday" for a YYYY-MM-DD, in English, for a model resolving "last Friday". */
export function weekdayOf(day: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(
    new Date(`${day}T12:00:00Z`)
  );
}

/** 4:05, or 1:04:05 past an hour. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** 340 KB, 2.4 MB. */
export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Dollars. `digits` fixes the precision; without it small sums get three
 * places and the rest two, which is what a spend overview wants.
 */
export function formatUsd(amount: number, digits?: number): string {
  return `$${amount.toFixed(digits ?? (amount < 1 ? 3 : 2))}`;
}

/** A price from Stripe: minor units (cents) in its own currency. */
export function formatPrice(minor: number, currency: string, lang: Lang): string {
  return new Intl.NumberFormat(LOCALE[lang], { style: "currency", currency: currency.toUpperCase() }).format(minor / 100);
}
