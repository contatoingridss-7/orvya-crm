"use client";

import { useRouter } from "next/navigation";
import { periodLabel, type SalesPeriod } from "@/lib/sales/types";

/** Escolha do período: um relatório importado ou todos juntos. */
export function PeriodSelect({ slug, periods, value }: { slug: string; periods: SalesPeriod[]; value: string }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-[13px] text-muted">
      Período
      <select className="inp !w-auto" value={value} onChange={(e) => router.push(`/${slug}/vendas?periodo=${e.target.value}`)} aria-label="Período">
        {periods.map((p) => (
          <option key={p.id} value={p.id}>
            {periodLabel(p)}
            {p.kind === "servicos" ? " (vendas e serviços)" : ""}
          </option>
        ))}
        <option value="todos">Todos os períodos juntos</option>
      </select>
    </label>
  );
}
