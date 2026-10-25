import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app-shell/page-header";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { isManager, SALES_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/viewer";
import { formatBRL } from "@/lib/format";
import { periodLabel, type ProductSales, type SalesPeriod } from "@/lib/sales/types";
import { createClient } from "@/lib/supabase/server";
import { PeriodSelect } from "./period-select";
import { PeriodsList } from "./periods-list";
import { ProductTable } from "./product-table";

export const metadata: Metadata = { title: "Vendas" };

type PeriodRow = {
  id: string;
  kind: SalesPeriod["kind"];
  period_start: string;
  period_end: string;
  item_count: number;
  total_qty: number | string;
  total_value: number | string | null;
  created_at: string;
};
type ProductRow = { product_id: string | null; code: string | null; name: string; unit: string | null; is_rental: boolean; qty: number | string; total: number | string | null };

const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const n = (v: number | string | null) => (v === null ? null : Number(v));

/**
 * Histórico de vendas importado do Net Use.
 * Vendedor: quantidades. Gestor e admin: quantidades e valores (o banco não entrega R$ ao vendedor).
 */
export default async function VendasPage({ params, searchParams }: { params: Promise<{ empresa: string }>; searchParams: Promise<{ periodo?: string }> }) {
  const { company } = await requireRole((await params).empresa, SALES_ROLES);
  const manager = isManager(company.role);
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: periodRows, error: periodsError } = await supabase.rpc("sales_periods", { p_company: company.id });
  const periods: SalesPeriod[] = ((periodRows as PeriodRow[] | null) ?? []).map((p) => ({
    id: p.id,
    kind: p.kind,
    start: p.period_start,
    end: p.period_end,
    itemCount: p.item_count,
    totalQty: Number(p.total_qty),
    totalValue: n(p.total_value),
    createdAt: p.created_at,
  }));

  // Seleção: um período, "todos os períodos" ou o mais recente (padrão).
  const selected = sp.periodo === "todos" ? periods : periods.filter((p) => p.id === (sp.periodo ?? periods[0]?.id));
  // Período anterior para comparar (só quando um único período está selecionado).
  const single = selected.length === 1 ? selected[0]! : null;
  const previous = single ? periods.find((p) => p.kind === single.kind && p.end < single.start) : undefined;

  const load = async (ids: string[]): Promise<ProductSales[]> => {
    if (!ids.length) return [];
    const { data } = await supabase.rpc("sales_by_product", { p_company: company.id, p_reports: ids });
    return ((data as ProductRow[] | null) ?? []).map((r) => ({
      productId: r.product_id,
      code: r.code,
      name: r.name,
      unit: r.unit,
      isRental: r.is_rental,
      qty: Number(r.qty),
      total: n(r.total),
    }));
  };
  const [rows, prevRows] = await Promise.all([load(selected.map((p) => p.id)), load(previous ? [previous.id] : [])]);

  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalValue = manager ? rows.reduce((s, r) => s + (r.total ?? 0), 0) : null;
  const prevQty = prevRows.reduce((s, r) => s + r.qty, 0);
  const delta = previous && prevQty ? ((totalQty - prevQty) / prevQty) * 100 : null;
  const prevByKey = Object.fromEntries(prevRows.map((r) => [r.code ?? r.name, r.qty]));

  return (
    <>
      <PageHeader title="Vendas" subtitle={`${company.name}: o que mais vende, pelos relatórios importados do Net Use`} />
      <div className="content grid gap-4">
        {periodsError && <Notice tone="bad">Não foi possível carregar o histórico. Se a migration 0012 ainda não foi rodada no Supabase, rode e recarregue.</Notice>}

        {periods.length === 0 ? (
          <Panel title="Nenhum período de vendas ainda">
            <p className="m-0 text-[13.5px] text-muted">
              {manager ? (
                <>
                  Importe o relatório <b className="text-ink">Movimento Sintético de Vendas</b>
                  {company.slug === "locpress" ? " ou Acompanhamento de Vendas e Serviços" : ""} do Net Use em{" "}
                  <Link className="font-semibold text-tint-ink hover:underline" href={`/${company.slug}/catalogo/importar`}>
                    Catálogo → Importar
                  </Link>
                  . Cada importação fica salva como um período.
                </>
              ) : (
                "Assim que a gestão importar os relatórios de vendas, você vê aqui os produtos que mais vendem."
              )}
            </p>
          </Panel>
        ) : (
          <>
            <div className="toolbar">
              <PeriodSelect slug={company.slug} periods={periods} value={sp.periodo === "todos" ? "todos" : (single?.id ?? periods[0]!.id)} />
            </div>

            <div className="kpis">
              <Kpi label="Unidades vendidas" value={int.format(totalQty)} sub={single ? periodLabel(single) : `${selected.length} períodos`} highlight />
              <Kpi
                label="Comparado ao período anterior"
                value={delta === null ? "—" : `${delta >= 0 ? "+" : ""}${delta.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
                sub={previous ? `Antes: ${int.format(prevQty)} un. (${periodLabel(previous)})` : "Sem período anterior para comparar"}
              />
              <Kpi label="Produtos diferentes" value={int.format(rows.length)} sub="Com pelo menos uma venda" />
              {manager && <Kpi label="Faturamento" value={formatBRL(totalValue ?? 0)} sub="Soma do relatório (só gestão)" />}
              {manager && <Kpi label="Valor médio por unidade" value={totalQty ? formatBRL((totalValue ?? 0) / totalQty) : "—"} sub="Faturamento ÷ unidades" />}
            </div>

            <ProductTable rows={rows} prevByKey={previous ? prevByKey : null} manager={manager} totalQty={totalQty} />

            {manager && <PeriodsList slug={company.slug} periods={periods} />}
          </>
        )}
      </div>
    </>
  );
}

function Kpi({ label, value, sub, highlight }: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div className={`kpi ${highlight ? "hl" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{sub}</em>
    </div>
  );
}
