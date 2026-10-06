import { formatInTimeZone } from "date-fns-tz";
import { TIMEZONE } from "@/lib/format";

export type ContractStatus = "ativo" | "encerrado" | "renovado";

export type RentalContract = {
  id: string;
  leadId: string;
  productId: string | null;
  productName: string | null;
  serialNumber: string | null;
  startDate: string; // yyyy-MM-dd
  endDate: string; // yyyy-MM-dd
  monthlyValue: number;
  deliveryAddress: string | null;
  status: ContractStatus;
};

export const CONTRACT_SELECT = "id, lead_id, product_id, serial_number, start_date, end_date, monthly_value, delivery_address, status, products(name)";

export type ContractRow = {
  id: string;
  lead_id: string;
  product_id: string | null;
  serial_number: string | null;
  start_date: string;
  end_date: string;
  monthly_value: number | string;
  delivery_address: string | null;
  status: ContractStatus;
  products: { name: string } | null;
};

export function toContract(r: ContractRow): RentalContract {
  return {
    id: r.id,
    leadId: r.lead_id,
    productId: r.product_id,
    productName: r.products?.name ?? null,
    serialNumber: r.serial_number,
    startDate: r.start_date,
    endDate: r.end_date,
    monthlyValue: Number(r.monthly_value),
    deliveryAddress: r.delivery_address,
    status: r.status,
  };
}

/** Hoje no fuso de Teresina, como yyyy-MM-dd. */
export function todayISO(now = new Date()): string {
  return formatInTimeZone(now, TIMEZONE, "yyyy-MM-dd");
}

const toUTC = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};

/** Dias até a data (negativo = já passou). Datas sem hora, contadas no calendário de Teresina. */
export function daysUntil(dateISO: string, now = new Date()): number {
  return Math.round((toUTC(dateISO) - toUTC(todayISO(now))) / 86_400_000);
}

/** Soma meses a uma data yyyy-MM-dd e volta um dia (contrato de 3 meses a partir de 06/10 vai até 05/01). */
export function addMonthsMinusDay(startISO: string, months: number): string {
  const [y, m, d] = startISO.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1 + months, d) - 86_400_000);
  return date.toISOString().slice(0, 10);
}

export function nextDay(iso: string): string {
  return new Date(toUTC(iso) + 86_400_000).toISOString().slice(0, 10);
}

/** "vence em 9 dias", "vence hoje", "venceu há 2 dias" */
export function dueText(days: number): string {
  if (days < 0) return `venceu há ${-days} ${days === -1 ? "dia" : "dias"}`;
  if (days === 0) return "vence hoje";
  return `vence em ${days} ${days === 1 ? "dia" : "dias"}`;
}

export function dueTone(days: number): "bad" | "warn" | "ok" {
  return days <= 7 ? "bad" : days <= 15 ? "warn" : "ok";
}

/** dd/MM/yyyy a partir de yyyy-MM-dd, sem passar por fuso. */
export function formatISODate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
