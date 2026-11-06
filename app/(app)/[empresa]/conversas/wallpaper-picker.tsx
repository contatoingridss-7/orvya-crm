"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { saveWallpaper } from "@/lib/auth/actions";
import { WALLPAPER_LABEL, WALLPAPERS, type Wallpaper } from "@/lib/wallpapers";

function apply(value: Wallpaper | null) {
  if (value) document.documentElement.dataset.wall = value;
  else delete document.documentElement.dataset.wall;
}

/** Papel de parede das conversas: cada pessoa escolhe o seu (fica salvo no perfil). */
export function WallpaperPicker({ initial }: { initial: Wallpaper | null }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<Wallpaper | null>(initial);

  useEffect(() => {
    apply(initial);
    return () => apply(null);
  }, [initial]);

  function pick(next: Wallpaper | null) {
    setValue(next);
    apply(next);
    void saveWallpaper(next);
  }

  const options: (Wallpaper | null)[] = [null, ...WALLPAPERS];

  return (
    <>
      <Button aria-label="Papel de parede das conversas" title="Papel de parede das conversas" onClick={() => setOpen(true)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <path d="M3 16l5-5 4 4 3-3 6 6" />
          <circle cx="16" cy="8" r="1.6" />
        </svg>
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Papel de parede das conversas">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {options.map((o) => (
            <button
              key={o ?? "nenhum"}
              type="button"
              className="wall-opt"
              aria-pressed={value === o}
              onClick={() => pick(o)}
            >
              <span className="wall-thumb" data-wall-preview={o ?? "nenhum"} aria-hidden>
                <span className="bub lead">Olá!</span>
                <span className="bub human">Oi, tudo bem?</span>
              </span>
              <span className="text-[13px] font-semibold">{o ? WALLPAPER_LABEL[o] : "Sem papel de parede"}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 mb-0 text-[12px] text-muted">Vale só para você. Acompanha o modo claro e o escuro.</p>
      </Modal>
    </>
  );
}
