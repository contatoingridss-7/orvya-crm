import { formatInTimeZone } from "date-fns-tz";

export const TIMEZONE = "America/Fortaleza";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(value: number): string {
  return brl.format(value);
}

/** Data no padrão brasileiro, no fuso de Teresina. Ex.: 05/10/2026 */
export function formatDate(date: Date | string): string {
  return formatInTimeZone(date, TIMEZONE, "dd/MM/yyyy");
}

/** Data e hora no fuso de Teresina. Ex.: 05/10/2026 14:30 */
export function formatDateTime(date: Date | string): string {
  return formatInTimeZone(date, TIMEZONE, "dd/MM/yyyy HH:mm");
}
