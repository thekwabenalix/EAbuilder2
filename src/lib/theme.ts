export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "eab-theme";

export type ResolvedTheme = "light" | "dark";

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") return getSystemTheme();
  return preference;
}

export function readStoredTheme(): ThemePreference {
  if (typeof window === "undefined") return "dark";
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "dark";
}

export function applyThemeClass(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  if (resolved === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

/** Inline in index.html before paint - keep in sync with readStoredTheme / resolveTheme. */
export const THEME_INIT_SCRIPT = `(function(){try{var k="eab-theme";var s=localStorage.getItem(k);var t=s==="light"||s==="dark"||s==="system"?s:"dark";var r=t==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t;if(r==="dark")document.documentElement.classList.add("dark");else document.documentElement.classList.remove("dark");}catch(e){document.documentElement.classList.add("dark");}})();`;
