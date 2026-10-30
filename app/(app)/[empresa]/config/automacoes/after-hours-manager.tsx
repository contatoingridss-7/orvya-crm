"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { DAY_KEYS, DAY_NAMES, DEFAULT_HOURS, fillAfterHours, parseHours, type BusinessHours } from "@/lib/whatsapp/after-hours";
import { saveAfterHours } from "./after-hours-actions";

export type AfterHours = { enabled: boolean; hours: BusinessHours; message: string };

type DayRow = { day: (typeof DAY_KEYS)[number]; open: boolean; start: string; end: string };

const toRows = (hours: BusinessHours): DayRow[] =>
  DAY_KEYS.map((day) => ({ day, open: !!hours[day], start: hours[day]?.[0] ?? "08:00", end: hours[day]?.[1] ?? "18:00" }));

/**
 * Resposta automática do WhatsApp fora do expediente: uma vez por conversa a cada 12 horas,
 * dentro da janela de 24 h (sem custo). A conversa continua em "Precisa de mim".
 */
export function AfterHoursManager({ slug, companyName, settings, loadError }: { slug: string; companyName: string; settings: AfterHours | null; loadError: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(settings?.enabled ?? true);
  const [rows, setRows] = useState<DayRow[]>(toRows(settings?.hours ?? DEFAULT_HOURS));
  const [message, setMessage] = useState(
    settings?.message ??
      `Olá! Aqui é a ${companyName}. Recebemos sua mensagem! Nosso atendimento é de segunda a sexta, das 8h às 18h, e aos sábados, das 8h às 12h. Um consultor fala com você {retorno}.`,
  );
  const [error, setError] = useState<string>();

  const hours = useMemo(() => parseHours(Object.fromEntries(rows.filter((r) => r.open).map((r) => [r.day, [r.start, r.end]]))), [rows]);
  // Prévia: como sai numa sexta às 22h (cai no sábado de manhã, se o sábado estiver aberto).
  const sample = useMemo(() => {
    const now = new Date();
    const friday = new Date(now);
    friday.setDate(now.getDate() + ((5 - now.getDay() + 7) % 7));
    friday.setHours(22, 0, 0, 0);
    return fillAfterHours(message, hours, friday);
  }, [message, hours]);

  function setRow(i: number, patch: Partial<DayRow>) {
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }

  function save() {
    setError(undefined);
    start(async () => {
      const r = await saveAfterHours(slug, { enabled, message, days: rows });
      if (r.ok) {
        toast(r.message, "ok");
        router.refresh();
      } else setError(r.error);
    });
  }

  return (
    <Panel
      title="Resposta fora do horário (WhatsApp)"
      subtitle="Quem escrever fora do expediente recebe uma vez o horário de atendimento. Não tem custo (vai dentro da janela de 24 horas) e a conversa continua em Precisa de mim para a equipe responder quando abrir."
      actions={<Switch label={enabled ? "Desligar resposta" : "Ligar resposta"} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
    >
      {loadError && <Notice tone="bad">Não foi possível carregar. Rode a migration 0019 no Supabase.</Notice>}

      <div className={`grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] ${enabled ? "" : "opacity-60"}`}>
        <div className="grid gap-4">
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mb-1 text-[13px] font-[650]">Horário de atendimento</legend>
            {rows.map((r, i) => (
              <div key={r.day} className="flex flex-wrap items-center gap-2 text-[13.5px]">
                <label className="flex w-[118px] items-center gap-2">
                  <input type="checkbox" checked={r.open} onChange={(e) => setRow(i, { open: e.target.checked })} />
                  <span className="capitalize">{DAY_NAMES[r.day]}</span>
                </label>
                {r.open ? (
                  <>
                    <input type="time" className="inp !w-[118px]" value={r.start} aria-label={`Abertura de ${DAY_NAMES[r.day]}`} onChange={(e) => setRow(i, { start: e.target.value })} />
                    <span className="text-muted">às</span>
                    <input type="time" className="inp !w-[118px]" value={r.end} aria-label={`Fechamento de ${DAY_NAMES[r.day]}`} onChange={(e) => setRow(i, { end: e.target.value })} />
                  </>
                ) : (
                  <span className="text-muted">Fechado</span>
                )}
              </div>
            ))}
          </fieldset>

          <TextAreaField
            label="Mensagem"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={900}
            rows={4}
            hint="{retorno} vira, por exemplo, “amanhã a partir das 8h” ou “na segunda a partir das 8h”."
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" loading={pending} onClick={save}>
              Salvar
            </Button>
            {error && <Notice tone="bad">{error}</Notice>}
          </div>
        </div>

        <div className="ig-preview" aria-label="Prévia no WhatsApp">
          <p className="m-0 text-xs text-muted">Prévia: cliente escreve numa sexta às 22h</p>
          <div className="ig-bubble ig-me">Boa noite! Vocês abrem amanhã?</div>
          <div className="ig-bubble break-words">{sample}</div>
          <p className="m-0 text-xs text-muted">Sai uma vez por conversa a cada 12 horas, e não sai se alguém da equipe respondeu na última hora.</p>
        </div>
      </div>
    </Panel>
  );
}
