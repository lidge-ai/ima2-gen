import { useSyncExternalStore } from "react";

/**
 * Studio locale. Shares the classic UI's "ima2.locale" key, so a language chosen in either UI
 * carries over; the studio ships English and Korean and shows English for other values.
 * Each screen keeps its strings next to it with messages(en, ko) and reads them with useT.
 */
export type Locale = "en" | "ko";
export const LOCALES: readonly { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "ko", label: "한국어" },
];
const KEY = "ima2.locale";

function detect(): Locale {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved === "ko" ? "ko" : "en";
  } catch {
    /* storage disabled */
  }
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
}

let current: Locale = detect();
const listeners = new Set<() => void>();
if (typeof document !== "undefined") document.documentElement.lang = current;

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  current = locale;
  try {
    localStorage.setItem(KEY, locale);
  } catch {
    /* storage disabled */
  }
  document.documentElement.lang = locale;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

export type Vars = Record<string, string | number>;
export interface Messages<K extends string> {
  en: Record<K, string>;
  ko: Record<K, string>;
}

/** A screen's strings. Korean must cover every English key, so a missing translation fails typecheck. */
export function messages<K extends string>(en: Record<K, string>, ko: Record<K, string>): Messages<K> {
  return { en, ko };
}

export function format(text: string, vars?: Vars): string {
  return vars ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : text;
}

/** Look up a string for the current locale outside React (labels built in plain functions). */
export function tr<K extends string>(m: Messages<K>, key: K, vars?: Vars): string {
  return format(m[current][key] ?? m.en[key], vars);
}

/** Translator bound to a screen's messages; re-renders when the locale changes. */
export function useT<K extends string>(m: Messages<K>): (key: K, vars?: Vars) => string {
  const locale = useLocale();
  return (key, vars) => format(m[locale][key] ?? m.en[key], vars);
}

