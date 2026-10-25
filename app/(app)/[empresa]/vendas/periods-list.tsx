"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { useToast } from "@/components/ui/toast";
import { formatBRL, formatDate } from "@/lib/format";
import { periodLabel, type SalesPeriod } from "@/lib/sales/types";
import { deleteSalesPeriod } from "./actions";

/** Períodos importados (só gestão): conferir e apagar um importado por engano. */
export function PeriodsList({ slug, periods }: { slug: string; periods: SalesPeriod[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<string | null>(null);

  function remove(id: string) {
    start(async () => {
      const r = await deleteSalesPeriod(slug, id);
      toast(r.ok ? r.message : r.error, r.ok ? "ok" : "bad");
      setConfirm(null);
      if (r.ok) router.replace(`/${slug}/vendas`);
    });
  }

  return (
    <Panel title="Períodos importados" subtitle="Cada importação de relatório de vendas fica aqui. Importar o mesmo período de novo substitui só ele.">
      <div className="row-list">
        {periods.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-3 py-2.5 text-[13px]">
            <span className="min-w-0 flex-1">
              <b className="font-semibold text-title">{periodLabel(p)}</b>
              <small className="block text-xs text-muted">
                {p.kind === "servicos" ? "Vendas e serviços" : "Movimento de vendas"} · {p.itemCount} produtos · {Math.round(p.totalQty)} unidades
                {p.totalValue !== null && ` · ${formatBRL(p.totalValue)}`} · importado em {formatDate(p.createdAt)}
              </small>
            </span>
            {confirm === p.id ? (
              <>
                <span className="text-xs">Apagar este período?</span>
                <Button size="sm" variant="danger" loading={pending} onClick={() => remove(p.id)}>
                  Apagar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                  Cancelar
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirm(p.id)}>
                Apagar
              </Button>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}
