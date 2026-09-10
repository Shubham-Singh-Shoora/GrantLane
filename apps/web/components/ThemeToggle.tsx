"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

/**
 * Light/dark ground switch.
 *
 * The theme is applied by an inline script in <head> before first paint (see
 * layout.tsx), so this component only has to read back what is already on the
 * document. Rendering a stable placeholder until mounted avoids a hydration
 * mismatch, since the server cannot know what the browser stored.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "dark" ? "dark" : "light");
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("grantlane-theme", next);
    } catch {
      // Private mode or blocked storage — the choice just won't persist.
    }
  }

  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? "Switch to light" : "Switch to dark"}
      aria-label="Switch theme"
      className="btn-secondary"
      style={{ width: 36, height: 36, padding: 0, fontSize: 14 }}
    >
      <span aria-hidden>{theme === "dark" ? "☀" : "☾"}</span>
    </button>
  );
}
