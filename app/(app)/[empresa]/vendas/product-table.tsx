"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { formatBRL } from "@/lib/format";
import type { ProductSales } from "@/lib/sales/types";

const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const PAGE = 100;
const pctText = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/** Mais vendidos (barras) e tabela completa com busca. Valores em R$ só para a gestão. */
export function ProductTable({
  rows,
  prevByKey,
  manager,
  totalQty,
}: {
  rows: ProductSales[];
  prevByKey: Record<string, number> | null;
  manager: boolean;
  totalQty: number;
}) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const top = rows.slice(0, 10);
  const max = Math.max(1, ...top.map((r) => r.qty));

  const visible = useMemo(() => {
    const q = normalize(query.trim());
    return rows.filter((r) => !q || normalize(r.name).includes(q) || (r.code ?? "").includes(q));
  }, [rows, query]);

  return (
    <>
      <Panel title="10 mais vendidos" subtitle="Em unidades no período.">
        {top.length === 0 ? (
          <div className="empty">Nenhuma venda neste período.</div>
        ) : (
          top.map((r, i) => (
            <div key={r.code ?? r.name} className="bar-row">
              <span className="truncate" title={r.name}>
                <b className="mr-1.5 text-muted tabular-nums">{i + 1}.</b>
                {r.name}
              </span>
              <span className="bar-track" aria-hidden>
                <span className="done" style={{ width: `${(r.qty / max) * 100}%`, background: "var(--accent)" }} />
              </span>
              <span className="text-right text-xs whitespace-nowrap text-muted tabular-nums">
                {int.format(r.qty)} {r.unit?.toLowerCase() ?? "un."}
              </span>
            </div>
          ))
        )}
      </Panel>

      <Panel title="Todos os produtos vendidos" subtitle={manager ? "Quantidade, participação e valores do relatório." : "Quantidade e participação no total do período."}>
        <label className="search mb-3">
          <svg viewBox="0 0 24 24" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input type="search" placeholder="Buscar por nome ou código" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar produto" />
        </label>
        <div className="scroll-x">
          <table className={manager ? "min-w-[820px]" : "min-w-[560px]"}>
            <thead>
              <tr>
                <th>Produto</th>
                <th className="text-right">Unidades</th>
                <th className="text-right">% do total</th>
                {prevByKey && <th className="text-right">Antes</th>}
                {manager && <th className="text-right">Faturamento</th>}
                {manager && <th className="text-right">Valor médio</th>}
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, limit).map((r) => {
                const before = prevByKey?.[r.code ?? r.name];
                const diff = before ? ((r.qty - before) / before) * 100 : null;
                return (
                  <tr key={r.code ?? r.name}>
                    <td>
                      <b className="block font-semibold text-title">{r.name}</b>
                      <small className="flex items-center gap-1.5 text-xs text-muted">
                        {r.code && `Código ${r.code}`}
                        {r.isRental && <Pill tone="ind">Locação</Pill>}
                        {!r.productId && <span>· fora do catálogo</span>}
                      </small>
                    </td>
                    <td className="text-right tabular-nums">{int.format(r.qty)}</td>
                    <td className="text-right tabular-nums">{totalQty ? pctText((r.qty / totalQty) * 100) : "—"}</td>
                    {prevByKey && (
                      <td className="text-right tabular-nums whitespace-nowrap">
                        {before === undefined ? (
                          <Pill tone="ok">Novo</Pill>
                        ) : (
                          <>
                            {int.format(before)}{" "}
                            {diff !== null && (
                              <small className={diff >= 0 ? "text-[var(--ok-fg)]" : "text-[var(--bad-fg)]"}>
                                ({diff >= 0 ? "+" : ""}
                                {pctText(diff)})
                              </small>
                            )}
                          </>
                        )}
                      </td>
                    )}
                    {manager && <td className="text-right tabular-nums">{r.total === null ? "—" : formatBRL(r.total)}</td>}
                    {manager && <td className="text-right tabular-nums">{r.total === null || !r.qty ? "—" : formatBRL(r.total / r.qty)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {visible.length === 0 && <div className="empty mt-2">Nenhum produto com essa busca.</div>}
        {visible.length > limit && (
          <div className="mt-3 flex justify-center">
            <button type="button" className="btn sm" onClick={() => setLimit((l) => l + PAGE)}>
              Mostrar mais ({visible.length - limit} restantes)
            </button>
          </div>
        )}
      </Panel>
    </>
  );
}
