import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type Tone = "neutral" | "ok" | "bad" | "warn" | "ind";

const TONE_CLASS: Record<Tone, string | false> = {
  neutral: false,
  ok: "ok",
  bad: "bad",
  warn: "warn",
  ind: "ind",
};

export function Pill({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cn("pill", TONE_CLASS[tone], className)} {...props} />;
}
