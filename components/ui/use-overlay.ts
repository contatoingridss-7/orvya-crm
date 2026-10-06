"use client";

import { useEffect, useRef } from "react";

/** Comportamento comum de modal e painel lateral: Esc fecha, foco entra e volta, rolagem da página trava. */
export function useOverlay<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const firstFocusable = node?.querySelector<HTMLElement>(
      "input, select, textarea, button:not([data-close]), [href], [tabindex]:not([tabindex='-1'])",
    );
    (firstFocusable ?? node)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);

  return ref;
}
