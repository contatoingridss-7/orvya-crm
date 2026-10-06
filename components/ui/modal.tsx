"use client";

import { useId, type ReactNode } from "react";
import { useOverlay } from "./use-overlay";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  /** Botões do rodapé, alinhados à direita. */
  actions?: ReactNode;
};

export function Modal({ open, onClose, title, children, actions }: ModalProps) {
  const ref = useOverlay<HTMLDivElement>(open, onClose);
  const titleId = useId();
  if (!open) return null;

  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId}>{title}</h2>
        {children}
        {actions && <div className="acts">{actions}</div>}
      </div>
    </div>
  );
}
