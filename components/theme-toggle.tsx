"use client";

import { useSyncExternalStore } from "react";
import { MoonIcon, SunIcon } from "@/components/ui/icons";

// Preferência local. Na Fase 1 também passa a ser salva em profiles.theme (por usuário).
export const THEME_STORAGE_KEY = "orvya-theme";

type Theme = "light" | "dark";
const listeners = new Set<() => void>();

function readStored(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function effectiveTheme(): Theme {
  return readStored() ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => {
    listeners.delete(onChange);
    media.removeEventListener("change", onChange);
  };
}

function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Sem armazenamento (aba anônima): vale só até recarregar.
  }
  document.documentElement.setAttribute("data-theme", theme);
  listeners.forEach((l) => l());
}

export function ThemeToggle() {
  // No servidor não sabemos o tema; o ícone aparece depois de montar.
  const theme = useSyncExternalStore<Theme | null>(subscribe, effectiveTheme, () => null);
  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => setTheme(next)}
      aria-label={next === "dark" ? "Mudar para o modo escuro" : "Mudar para o modo claro"}
      title={next === "dark" ? "Modo escuro" : "Modo claro"}
    >
      {theme === null ? null : theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

/** Script que roda antes da pintura para aplicar o tema salvo sem piscar. */
export const themeInitScript = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
