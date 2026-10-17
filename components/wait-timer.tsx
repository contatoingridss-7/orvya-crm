"use client";

import { useEffect, useState } from "react";
import { WAIT_CRITICAL_MINUTES, WAIT_MINUTES } from "@/lib/crm/attention";
import { formatDateTime } from "@/lib/format";

function elapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Cronômetro de espera do cliente: amarelo a partir de 5 min, vermelho a partir de 15. */
export function WaitTimer({ since }: { since: string }) {
  const start = new Date(since).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const minutes = (now - start) / 60_000;
  const level = minutes >= WAIT_CRITICAL_MINUTES ? "bad" : minutes >= WAIT_MINUTES ? "warn" : undefined;

  return (
    <time className="timer" data-level={level} dateTime={since} title={`Esperando desde ${formatDateTime(since)}`} suppressHydrationWarning>
      {elapsed(now - start)}
    </time>
  );
}
