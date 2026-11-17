// The console's theme: System (follows the computer), Light or Dark, kept in this browser only. Applied before the
// first paint (main.tsx), so the page never flashes the other theme.
export type Theme = "system" | "light" | "dark";

const KEY = "ucp.console.theme";

export function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system"; // storage blocked: follow the computer
  }
}

export function applyTheme(theme: Theme, keep = false) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  if (!keep) return;
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // storage blocked: the choice lasts until the page is closed
  }
}
