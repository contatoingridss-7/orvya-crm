"use client";

import { useId, type ReactNode } from "react";
import { CloseIcon } from "./icons";
import { useOverlay } from "./use-overlay";

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Elemento à esquerda do título (ex.: avatar do lead). */
  leading?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
};

/** Painel lateral (detalhe do lead e afins). No celular ocupa a tela toda. */
export function Drawer({ open, onClose, title, subtitle, leading, children, footer }: DrawerProps) {
  const ref = useOverlay<HTMLElement>(open, onClose);
  const titleId = useId();
  if (!open) return null;

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden />
      <aside ref={ref} className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="dr-head">
          {leading}
          <div className="min-w-0 flex-1">
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar" data-close>
            <CloseIcon />
          </button>
        </header>
        <div className="dr-body">{children}</div>
        {footer && <footer className="dr-foot">{footer}</footer>}
      </aside>
    </>
  );
}
