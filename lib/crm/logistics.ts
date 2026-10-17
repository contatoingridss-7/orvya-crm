import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { TIMEZONE } from "@/lib/format";
import type { LogisticsStatus, StageLogistics } from "./types";

export const LOGISTICS_STEPS: LogisticsStatus[] = ["agendado", "separado", "faturado", "em_rota", "entregue"];

export const LOGISTICS_LABEL: Record<LogisticsStatus, string> = {
  agendado: "Agendado",
  separado: "Separado",
  faturado: "Faturado",
  em_rota: "Saiu para entrega",
  entregue: "Entregue",
};

/** Texto do botão que leva ao próximo status. */
export const NEXT_ACTION: Record<Exclude<LogisticsStatus, "entregue">, string> = {
  agendado: "Marcar separado",
  separado: "Marcar faturado",
  faturado: "Saiu para entrega",
  em_rota: "Confirmar entrega",
};

export const KIND_LABEL: Record<StageLogistics, string> = { entrega: "Entrega", adaptacao: "Adaptação in loco" };

export function nextStatus(s: LogisticsStatus): LogisticsStatus | null {
  const i = LOGISTICS_STEPS.indexOf(s);
  return i >= 0 && i < LOGISTICS_STEPS.length - 1 ? LOGISTICS_STEPS[i + 1]! : null;
}

/** Valor para <input type="datetime-local"> no fuso de Teresina. */
export function toLocalInput(iso: string): string {
  return formatInTimeZone(iso, TIMEZONE, "yyyy-MM-dd'T'HH:mm");
}

/** "2026-10-20T14:00" digitado em Teresina → ISO em UTC. */
export function fromLocalInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = fromZonedTime(value, TIMEZONE);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "20/10 às 14:00" */
export function formatSchedule(iso: string): string {
  return formatInTimeZone(iso, TIMEZONE, "dd/MM 'às' HH:mm");
}

/** Dia do agendamento em Teresina (yyyy-MM-dd), para agrupar a agenda. */
export function scheduleDay(iso: string): string {
  return formatInTimeZone(iso, TIMEZONE, "yyyy-MM-dd");
}
