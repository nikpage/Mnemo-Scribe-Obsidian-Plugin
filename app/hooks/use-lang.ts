"use client";

// [utils]
import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import { type Lang, type TranslationKey, type Vars, detectLang, t as translate } from "@/lib/i18n";

// Module-level listeners so all components share the same lang state
const listeners = new Set<() => void>();
let currentLang: Lang | null = null;

/**
 * The language the server drew the page in. The browser's first drawing has
 * to match it, or every page showed English and then switched to Czech.
 */
export const LangSeed = createContext<Lang | null>(null);

/** Mirrors the choice into a cookie, the only place the server can read it. */
function remember(lang: Lang) {
  document.cookie = `scribe-lang=${lang}; path=/; max-age=31536000; samesite=lax`;
}

function getLang(seed: Lang | null = null): Lang {
  if (currentLang !== null) return currentLang;
  if (typeof window === "undefined") return "en";
  const stored = localStorage.getItem("scribe-lang") as Lang | null;
  // A choice made before the cookie existed reaches the server from now on.
  if (stored) remember(stored);
  currentLang = stored ?? seed ?? detectLang();
  return currentLang;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setLang(newLang: Lang) {
  currentLang = newLang;
  localStorage.setItem("scribe-lang", newLang);
  remember(newLang);
  listeners.forEach((l) => l());
}

/**
 * Takes the language stored on the user's profile, unless this device has
 * already been switched by hand — a deliberate local choice outranks it.
 */
export function adoptLang(profileLang: Lang) {
  if (typeof window === "undefined") return;
  if (localStorage.getItem("scribe-lang")) return;
  if (getLang() === profileLang) return;
  setLang(profileLang);
}

export function useLang() {
  const seed = useContext(LangSeed);
  const lang = useSyncExternalStore(subscribe, () => getLang(seed), () => seed ?? "en");

  const switchLang = useCallback((newLang: Lang) => {
    setLang(newLang);
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Vars) => translate(key, lang, vars),
    [lang]
  );

  return { lang, switchLang, t };
}
