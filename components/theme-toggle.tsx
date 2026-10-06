"use client";

import { useEffect, useSyncExternalStore } from "react";
import { MoonIcon, SunIcon } from "@/components/ui/icons";
import { saveTheme } from "@/lib/auth/actions";

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

function applyTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Sem armazenamento (aba anônima): vale só até recarregar.
  }
  document.documentElement.setAttribute("data-theme", theme);
  listeners.forEach((l) => l());
}

/** Botão claro/escuro. Com `persist`, a escolha também vai para o perfil do usuário. */
export function ThemeToggle({ persist = false }: { persist?: boolean }) {
  // No servidor não sabemos o tema; o ícone aparece depois de montar.
  const theme = useSyncExternalStore<Theme | null>(subscribe, effectiveTheme, () => null);
  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => {
        applyTheme(next);
        if (persist) void saveTheme(next);
      }}
      aria-label={next === "dark" ? "Mudar para o modo escuro" : "Mudar para o modo claro"}
      title={next === "dark" ? "Modo escuro" : "Modo claro"}
    >
      {theme === null ? null : theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

/**
 * Aplica o tema salvo no perfil ao entrar em outro aparelho.
 * Sem preferência salva, segue o tema do aparelho (padrão da SPEC).
 */
export function ThemeSync({ theme }: { theme: Theme | null }) {
  useEffect(() => {
    if (theme && readStored() !== theme) applyTheme(theme);
  }, [theme]);
  return null;
}

/** Script que roda antes da pintura para aplicar o tema salvo sem piscar. */
export const themeInitScript = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
