"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type ToastKind = "info" | "ok" | "bad" | "auto";
/** Atalho dentro do aviso (ex.: "Abrir conversa" depois de assumir). */
type ToastAction = { label: string; href: string };
type ToastItem = { id: number; text: string; kind: ToastKind; action?: ToastAction };
type ToastFn = (text: string, kind?: ToastKind, action?: ToastAction) => void;

const ToastContext = createContext<ToastFn | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const close = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback<ToastFn>(
    (text, kind = "info", action) => {
      const id = nextId.current++;
      setItems((list) => [...list, { id, text, kind, action }]);
      // Com atalho, o aviso fica mais tempo para dar tempo de clicar.
      window.setTimeout(() => close(id), action ? 10_000 : 4200);
    },
    [close],
  );

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} className={cn("toast", t.kind !== "info" && t.kind, t.action && "has-action")} role={t.kind === "bad" ? "alert" : "status"}>
            <span className="min-w-0 flex-1">{t.text}</span>
            {t.action && (
              <Link href={t.action.href} className="toast-action" onClick={() => close(t.id)}>
                {t.action.label}
              </Link>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Mostra um aviso temporário no canto da tela. Tipos: info, ok, bad, auto (automação). Opcional: um atalho. */
export function useToast(): ToastFn {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast precisa estar dentro de <ToastProvider>");
  return ctx;
}
