import type { NetUseReport } from "@/lib/catalog/netuse";

// Relatórios de vendas do Net Use → períodos do histórico de vendas.

export type SalesReportPayload = {
  kind: "vendas" | "servicos";
  start: string; // yyyy-MM-dd
  end: string;
  label: string; // "01/08/2026 a 30/09/2026"
  items: { code: string; name: string; unit: string | null; qty: number; total: number; is_rental: boolean }[];
  totalQty: number;
  totalValue: number;
};

const toIso = (br: string) => {
  const [d, m, y] = br.split("/");
  return `${y}-${m}-${d}`;
};

/** "01/08/2026 a 30/09/2026" → { start, end } (null se o relatório não trouxe o período). */
export function parsePeriod(period: string | null): { start: string; end: string } | null {
  const m = period?.match(/(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/);
  if (!m) return null;
  const start = toIso(m[1]!);
  const end = toIso(m[2]!);
  return end >= start ? { start, end } : null;
}

/** Só os relatórios de vendas com período reconhecido viram histórico. */
export function salesPayloads(reports: NetUseReport[]): { payloads: SalesReportPayload[]; withoutPeriod: number } {
  const payloads: SalesReportPayload[] = [];
  let withoutPeriod = 0;
  for (const r of reports) {
    if (r.kind !== "vendas" && r.kind !== "servicos") continue;
    const p = parsePeriod(r.period);
    if (!p) {
      withoutPeriod += 1;
      continue;
    }
    const items =
      r.kind === "vendas"
        ? r.items.map((i) => ({ code: i.code, name: i.name, unit: i.unit, qty: i.qty, total: i.total, is_rental: false }))
        : r.items.map((i) => ({ code: i.code, name: i.name, unit: i.unit, qty: i.qty, total: Math.round(i.total * 100) / 100, is_rental: i.rental }));
    payloads.push({
      kind: r.kind,
      ...p,
      label: r.period ?? "",
      items,
      totalQty: items.reduce((s, i) => s + i.qty, 0),
      totalValue: items.reduce((s, i) => s + i.total, 0),
    });
  }
  return { payloads, withoutPeriod };
}
