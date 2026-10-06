import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { TIMEZONE } from "@/lib/format";

export type PeriodKey = "30d" | "mes" | "mes-passado" | "90d";

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "30d", label: "Últimos 30 dias" },
  { key: "mes", label: "Este mês" },
  { key: "mes-passado", label: "Mês passado" },
  { key: "90d", label: "Últimos 90 dias" },
];

export type Period = { key: PeriodKey; label: string; start: Date; end: Date };

/** Início do mês (00:00 em Teresina) deslocado em `offset` meses. */
function monthStart(now: Date, offset: number): Date {
  const [y, m] = formatInTimeZone(now, TIMEZONE, "yyyy-MM").split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return fromZonedTime(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01T00:00`, TIMEZONE);
}

export function resolvePeriod(key: string | undefined, now = new Date()): Period {
  const found = PERIODS.find((p) => p.key === key) ?? PERIODS[0]!;
  const day = 86_400_000;
  switch (found.key) {
    case "mes":
      return { ...found, start: monthStart(now, 0), end: now };
    case "mes-passado":
      return { ...found, start: monthStart(now, -1), end: monthStart(now, 0) };
    case "90d":
      return { ...found, start: new Date(now.getTime() - 90 * day), end: now };
    default:
      return { ...found, start: new Date(now.getTime() - 30 * day), end: now };
  }
}

export function inPeriod(iso: string | null, p: Period): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= p.start.getTime() && t < p.end.getTime();
}
