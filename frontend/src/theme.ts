/**
 * Site colour theme.
 *
 * The reader picks "system" (the default: follow the operating system's
 * light/dark setting, live), "light" or "dark". The choice is kept in
 * localStorage and applied as `data-theme="light|dark"` on <html>, which
 * switches the colour tokens in index.css.
 *
 * index.html applies the stored choice with a small inline script before the
 * first paint, so a dark-theme reader never sees a white flash; this module
 * keeps it current afterwards (OS changes, other tabs, the theme toggle) and
 * exposes it to React. It has no JSX and touches the DOM only inside guarded
 * functions, so plain Node can import it.
 */

import { useSyncExternalStore } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

/** localStorage key; the inline script in index.html reads the same key. */
export const THEME_STORAGE_KEY = "recommendica.theme";

/** Browser UI colour per theme (<meta name="theme-color">): the --canvas token. */
const THEME_COLOR: Record<ResolvedTheme, string> = { light: "#ffffff", dark: "#0b1120" };

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Anything other than a known preference (missing, corrupted) means "system". */
export function parsePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

let preference: ThemePreference = "system";
let systemPrefersDark = false;
let started = false;
const listeners = new Set<() => void>();

function readStoredPreference(): ThemePreference {
  try {
    return parsePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function storePreference(value: ThemePreference): void {
  try {
    if (value === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    // Storage is unavailable (private mode, blocked site data): the choice
    // still applies, for this page load only.
  }
}

function applyTheme(): void {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(preference, systemPrefersDark);
  const root = document.documentElement;
  if (root.dataset.theme !== resolved) root.dataset.theme = resolved;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", resolved);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[resolved]);
}

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Reads the stored preference, applies it, and starts following the system
 * setting and changes made in other tabs. Safe to call more than once.
 */
export function initTheme(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  preference = readStoredPreference();
  const media = typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
  systemPrefersDark = media?.matches ?? false;
  applyTheme();

  const onSystemChange = (event: MediaQueryListEvent) => {
    systemPrefersDark = event.matches;
    applyTheme();
    notify();
  };
  if (media) {
    if (typeof media.addEventListener === "function") media.addEventListener("change", onSystemChange);
    else media.addListener(onSystemChange); // Safari before 14
  }

  window.addEventListener("storage", (event) => {
    // A null key means another tab cleared the whole storage area.
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    preference = readStoredPreference();
    applyTheme();
    notify();
  });
}

export function getThemePreference(): ThemePreference {
  return preference;
}

export function getResolvedTheme(): ResolvedTheme {
  return resolveTheme(preference, systemPrefersDark);
}

/** Recolour without transitions, so every component switches in the same frame. */
function withoutTransitions(change: () => void): void {
  if (typeof document === "undefined" || typeof requestAnimationFrame !== "function") {
    change();
    return;
  }
  const root = document.documentElement;
  root.classList.add("theme-switching");
  change();
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
}

export function setThemePreference(next: ThemePreference): void {
  initTheme();
  if (next === preference) return;
  preference = next;
  storePreference(next);
  withoutTransitions(applyTheme);
  notify();
}

function subscribe(listener: () => void): () => void {
  initTheme();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The reader's choice: "system", "light" or "dark". */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, getThemePreference);
}

/** The theme actually shown: "light" or "dark". */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, getResolvedTheme);
}
