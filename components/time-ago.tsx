"use client";

import { formatDateTime, timeAgo } from "@/lib/format";

/**
 * "há 3 dias" calculado na hora de exibir. Servidor e navegador rodam com segundos
 * de diferença, então o texto pode mudar entre os dois: suppressHydrationWarning
 * evita o aviso sem afetar o resto da tela.
 */
export function TimeAgo({ date, prefix = "" }: { date: string; prefix?: string }) {
  return (
    <time dateTime={date} title={formatDateTime(date)} suppressHydrationWarning>
      {prefix}
      {timeAgo(date)}
    </time>
  );
}
