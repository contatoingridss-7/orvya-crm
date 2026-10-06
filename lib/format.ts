import { differenceInCalendarDays, formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";

export const TIMEZONE = "America/Fortaleza";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlShort = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function formatBRL(value: number): string {
  return brl.format(value);
}

/** Sem centavos, para somas de coluna e indicadores. */
export function formatBRLShort(value: number): string {
  return brlShort.format(value);
}

/** Data no padrão brasileiro, no fuso de Teresina. Ex.: 05/10/2026 */
export function formatDate(date: Date | string): string {
  return formatInTimeZone(date, TIMEZONE, "dd/MM/yyyy");
}

/** Data e hora no fuso de Teresina. Ex.: 05/10/2026 14:30 */
export function formatDateTime(date: Date | string): string {
  return formatInTimeZone(date, TIMEZONE, "dd/MM/yyyy HH:mm");
}

/** "há 3 dias", "há 2 horas" */
export function timeAgo(date: Date | string): string {
  return `há ${formatDistanceToNowStrict(new Date(date), { locale: ptBR })}`;
}

/** Dias inteiros desde a data (0 = hoje). */
export function daysSince(date: Date | string): number {
  return differenceInCalendarDays(new Date(), new Date(date));
}
