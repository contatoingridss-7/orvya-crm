import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type NoticeTone = "info" | "ok" | "bad" | "warn";

/** Aviso fixo na tela (diferente do toast, que some sozinho). */
export function Notice({
  tone = "info",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: NoticeTone }) {
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cn("notice", tone !== "info" && tone, className)} {...props}>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
