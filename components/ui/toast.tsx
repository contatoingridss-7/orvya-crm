"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type ToastKind = "info" | "ok" | "bad" | "auto";
type ToastItem = { id: number; text: string; kind: ToastKind };
type ToastFn = (text: string, kind?: ToastKind) => void;

const ToastContext = createContext<ToastFn | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const show = useCallback<ToastFn>((text, kind = "info") => {
    const id = nextId.current++;
    setItems((list) => [...list, { id, text, kind }]);
    window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 4200);
  }, []);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} className={cn("toast", t.kind !== "info" && t.kind)} role={t.kind === "bad" ? "alert" : "status"}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Mostra um aviso temporário no canto da tela. Tipos: info, ok, bad, auto (automação). */
export function useToast(): ToastFn {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast precisa estar dentro de <ToastProvider>");
  return ctx;
}
