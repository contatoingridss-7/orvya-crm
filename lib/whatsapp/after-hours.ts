import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { TIMEZONE } from "@/lib/format";

// Horário de atendimento da empresa e o texto da resposta automática fora dele.
// Funções puras: servem o webhook, a tela de configuração (prévia) e os testes.

/** Dia da semana ISO (1 = segunda ... 7 = domingo) → [abertura, fechamento] "HH:mm". Dia ausente = fechado. */
export type BusinessHours = Partial<Record<"1" | "2" | "3" | "4" | "5" | "6" | "7", [string, string]>>;

export const DAY_KEYS = ["1", "2", "3", "4", "5", "6", "7"] as const;
export const DAY_NAMES: Record<(typeof DAY_KEYS)[number], string> = {
  "1": "segunda",
  "2": "terça",
  "3": "quarta",
  "4": "quinta",
  "5": "sexta",
  "6": "sábado",
  "7": "domingo",
};

export const DEFAULT_HOURS: BusinessHours = {
  "1": ["08:00", "18:00"],
  "2": ["08:00", "18:00"],
  "3": ["08:00", "18:00"],
  "4": ["08:00", "18:00"],
  "5": ["08:00", "18:00"],
  "6": ["08:00", "12:00"],
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Confere o formato vindo do banco ou da tela; ignora dias inválidos. */
export function parseHours(value: unknown): BusinessHours {
  const out: BusinessHours = {};
  if (!value || typeof value !== "object") return out;
  for (const k of DAY_KEYS) {
    const v = (value as Record<string, unknown>)[k];
    if (Array.isArray(v) && v.length === 2 && HHMM.test(String(v[0])) && HHMM.test(String(v[1])) && String(v[0]) < String(v[1])) {
      out[k] = [String(v[0]), String(v[1])];
    }
  }
  return out;
}

function local(at: Date) {
  return { day: formatInTimeZone(at, TIMEZONE, "i") as (typeof DAY_KEYS)[number], time: formatInTimeZone(at, TIMEZONE, "HH:mm"), date: formatInTimeZone(at, TIMEZONE, "yyyy-MM-dd") };
}

export function isOpen(hours: BusinessHours, at: Date): boolean {
  const { day, time } = local(at);
  const h = hours[day];
  return !!h && time >= h[0] && time < h[1];
}

/** Próxima abertura depois de `at` (até 8 dias à frente). */
export function nextOpening(hours: BusinessHours, at: Date): Date | null {
  const { date, time } = local(at);
  for (let i = 0; i <= 7; i++) {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const day = String(((d.getUTCDay() + 6) % 7) + 1) as (typeof DAY_KEYS)[number];
    const h = hours[day];
    if (!h) continue;
    if (i === 0 && time >= h[0]) continue; // hoje já abriu (e, fora do horário, já fechou)
    return fromZonedTime(`${iso}T${h[0]}:00`, TIMEZONE);
  }
  return null;
}

const hourText = (hhmm: string) => (hhmm.endsWith(":00") ? `${Number(hhmm.slice(0, 2))}h` : `${Number(hhmm.slice(0, 2))}h${hhmm.slice(3)}`);

/** "hoje a partir das 8h", "amanhã a partir das 8h", "na segunda a partir das 8h". */
export function returnText(hours: BusinessHours, at: Date): string {
  const next = nextOpening(hours, at);
  if (!next) return "assim que possível";
  const from = `a partir das ${hourText(formatInTimeZone(next, TIMEZONE, "HH:mm"))}`;
  const today = local(at).date;
  const nextDate = formatInTimeZone(next, TIMEZONE, "yyyy-MM-dd");
  if (nextDate === today) return `hoje ${from}`;
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (nextDate === tomorrow.toISOString().slice(0, 10)) return `amanhã ${from}`;
  const day = formatInTimeZone(next, TIMEZONE, "i") as (typeof DAY_KEYS)[number];
  return `${day === "6" || day === "7" ? "no" : "na"} ${DAY_NAMES[day]} ${from}`;
}

export function fillAfterHours(message: string, hours: BusinessHours, at: Date): string {
  return message.replaceAll("{retorno}", returnText(hours, at));
}
