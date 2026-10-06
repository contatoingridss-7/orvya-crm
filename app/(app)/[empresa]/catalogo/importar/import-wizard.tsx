"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import { buildPlan, toPayload, type ExistingProduct, type ImportPlan, type PlanRow } from "@/lib/catalog/import-plan";
import { parseNetUse, type NetUseReport } from "@/lib/catalog/netuse";
import { pdfToRows } from "@/lib/catalog/pdf-rows";
import { readSpreadsheet, templateCsv, type SheetRow } from "@/lib/catalog/spreadsheet";
import { formatBRL } from "@/lib/format";
import { applyImport } from "../actions";

type LoadedFile = { name: string; label: string; ok: boolean; detail: string };
type View = "marcados" | "novos" | "existentes" | "todos";

const REPORT_LABEL: Record<NetUseReport["kind"], string> = {
  estoque: "Net Use · Estoque",
  vendas: "Net Use · Vendas",
  servicos: "Net Use · Vendas e serviços",
  desconhecido: "Não reconhecido",
};

const PAGE = 120;
const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function ImportWizard({ slug, companyName, existing }: { slug: string; companyName: string; existing: ExistingProduct[] }) {
  const router = useRouter();
  const toast = useToast();
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zeroMissing, setZeroMissing] = useState(true);
  const [reading, setReading] = useState(false);
  const [view, setView] = useState<View>("marcados");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [saving, startSaving] = useTransition();

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setReading(true);
    const loaded: LoadedFile[] = [];
    const reports: NetUseReport[] = [];
    let sheet: SheetRow[] | null = null;

    for (const file of Array.from(list)) {
      try {
        if (/\.pdf$/i.test(file.name)) {
          const report = parseNetUse(await pdfToRows(file));
          const wrongCompany = report.company && report.company !== slug;
          const count = "items" in report ? report.items.length : 0;
          const ok = report.kind !== "desconhecido" && !wrongCompany && count > 0;
          loaded.push({
            name: file.name,
            label: REPORT_LABEL[report.kind],
            ok,
            detail: wrongCompany
              ? `Este relatório é de outra empresa (${report.company === "locpress" ? "LocPress" : "IC Supra"}).`
              : report.kind === "desconhecido"
                ? "Use os relatórios Estoque x Preço Custo, Movimento Sintético de Vendas ou Acompanhamento de Vendas e Serviços."
                : `${count} produto(s)${"period" in report && report.period ? ` · ${report.period}` : ""}${"issuedAt" in report && report.issuedAt ? ` · emitido em ${report.issuedAt}` : ""}`,
          });
          if (ok) reports.push(report);
        } else if (/\.(csv|xlsx)$/i.test(file.name)) {
          const rows = await readSpreadsheet(file);
          const ok = rows.length > 0;
          loaded.push({ name: file.name, label: "Planilha", ok, detail: ok ? `${rows.length} linha(s)` : "Nenhuma linha encontrada. Confira o cabeçalho." });
          if (ok) sheet = [...(sheet ?? []), ...rows];
        } else {
          loaded.push({ name: file.name, label: "Formato não aceito", ok: false, detail: "Envie PDF do Net Use, CSV ou Excel (.xlsx)." });
        }
      } catch {
        loaded.push({ name: file.name, label: "Erro", ok: false, detail: "Não foi possível ler o arquivo." });
      }
    }

    setFiles(loaded);
    if (reports.length || sheet) {
      const next = buildPlan(existing, reports, sheet);
      setPlan(next);
      setSelected(new Set(next.rows.filter((r) => r.selected).map((r) => r.key)));
      setView("marcados");
      setLimit(PAGE);
    } else {
      setPlan(null);
    }
    setReading(false);
  }

  const visible = useMemo(() => {
    if (!plan) return [];
    const q = normalize(query.trim());
    return plan.rows.filter((r) => {
      if (view === "marcados" && !selected.has(r.key)) return false;
      if (view === "novos" && r.existingId) return false;
      if (view === "existentes" && !r.existingId) return false;
      return !q || normalize(r.name).includes(q) || (r.code ?? "").includes(q);
    });
  }, [plan, view, query, selected]);

  const stats = useMemo(() => {
    if (!plan) return null;
    const rows = plan.rows;
    return {
      selected: rows.filter((r) => selected.has(r.key)).length,
      newSelected: rows.filter((r) => !r.existingId && selected.has(r.key)).length,
      updated: rows.filter((r) => r.existingId && selected.has(r.key)).length,
      removed: rows.filter((r) => r.existingId && r.existingActive && !selected.has(r.key)).length,
      errors: rows.filter((r) => r.errors.length).length,
      total: rows.length,
      existing: rows.filter((r) => r.existingId).length,
      fresh: rows.filter((r) => !r.existingId).length,
    };
  }, [plan, selected]);

  function setMany(rows: PlanRow[], on: boolean) {
    setSelected((s) => {
      const next = new Set(s);
      for (const r of rows) {
        if (r.errors.length) continue;
        if (on) next.add(r.key);
        else next.delete(r.key);
      }
      return next;
    });
  }

  function save() {
    if (!plan) return;
    const payload = toPayload(plan, selected, zeroMissing);
    startSaving(async () => {
      const result = await applyImport(slug, payload);
      if (result.ok) {
        toast(result.message, "ok");
        router.push(`/${slug}/catalogo`);
        router.refresh();
      } else toast(result.error, "bad");
    });
  }

  function downloadTemplate() {
    const blob = new Blob([templateCsv(slug)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: `modelo-catalogo-${slug}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-4">
      <Panel title="1. Escolha os arquivos" subtitle="Pode enviar vários de uma vez. Os PDFs são lidos aqui no seu computador; preço de custo e nomes de clientes não são enviados.">
        <div className="grid gap-3">
          <ul className="m-0 grid gap-1 pl-5 text-[13px] text-muted">
            {slug === "locpress" ? (
              <li>
                <b className="text-ink">Acompanhamento de Vendas e Serviços</b> (Net Use): produtos, códigos e preços praticados. Itens com
                “LOCAÇÃO” no nome entram como negociados pela equipe.
              </li>
            ) : (
              <>
                <li>
                  <b className="text-ink">Estoque x Preço Custo</b> (positivo e negativo juntos): código, nome e estoque. O custo é ignorado.
                </li>
                <li>
                  <b className="text-ink">Movimento Sintético de Vendas</b> (um ou mais meses): preço médio praticado, como referência.
                </li>
              </>
            )}
            <li>
              <b className="text-ink">Planilha CSV ou Excel</b>: preços confirmados e ajustes.{" "}
              <button type="button" className="font-semibold text-tint-ink hover:underline" onClick={downloadTemplate}>
                Baixar modelo
              </button>
            </li>
          </ul>

          <label className="btn primary w-full cursor-pointer sm:w-auto sm:justify-self-start">
            {reading ? "Lendo arquivos…" : plan ? "Escolher outros arquivos" : "Escolher arquivos"}
            <input
              type="file"
              className="sr-only"
              multiple
              accept=".pdf,.csv,.xlsx"
              disabled={reading}
              onChange={(e) => {
                void onFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>

          {files.length > 0 && (
            <div className="row-list">
              {files.map((f) => (
                <div key={f.name} className="flex flex-wrap items-center gap-2 py-2 text-[13px]">
                  <Pill tone={f.ok ? "ok" : "bad"}>{f.label}</Pill>
                  <b className="font-semibold break-all">{f.name}</b>
                  <span className="text-muted">{f.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>

      {plan && stats && (
        <Panel title="2. Confira e escolha o que entra no catálogo" subtitle={plan.summary.join(" · ")}>
          <div className="grid gap-3">
            <Notice>
              Vieram marcados: os produtos que já estão no catálogo
              {slug === "locpress" ? " e os vendidos no período" : " e os vendidos no período que têm estoque"}. Desmarcar um produto que já
              está no catálogo tira ele do catálogo (a IA deixa de oferecer). Preços confirmados nunca são alterados pelo Net Use.
            </Notice>

            {plan.missingFromStock.length > 0 && (
              <label className="flex items-start gap-2.5 text-[13.5px]">
                <input type="checkbox" className="mt-1 accent-accent" checked={zeroMissing} onChange={(e) => setZeroMissing(e.target.checked)} />
                <span>
                  Zerar o estoque de {plan.missingFromStock.length} produto(s) do catálogo que não aparecem no relatório de estoque
                  <small className="block text-xs text-muted">No Net Use eles estão no relatório de estoque zerado.</small>
                </span>
              </label>
            )}

            <div className="toolbar">
              <div className="tabs" role="group" aria-label="Filtrar prévia">
                {(
                  [
                    ["marcados", `Marcados ${stats.selected}`],
                    ["novos", `Novos ${stats.fresh}`],
                    ["existentes", `Já no catálogo ${stats.existing}`],
                    ["todos", `Todos ${stats.total}`],
                  ] as [View, string][]
                ).map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>
                    {label}
                  </button>
                ))}
              </div>
              <label className="search flex-1">
                <svg viewBox="0 0 24 24" aria-hidden>
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-4-4" />
                </svg>
                <input type="search" placeholder="Buscar por nome ou código" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar na prévia" />
              </label>
              <Button size="sm" onClick={() => setMany(visible, true)}>
                Marcar visíveis
              </Button>
              <Button size="sm" onClick={() => setMany(visible, false)}>
                Desmarcar visíveis
              </Button>
            </div>

            {visible.length === 0 ? (
              <div className="empty">Nenhum produto com esse filtro.</div>
            ) : (
              <div className="scroll-x -mx-1">
                <table className="min-w-[820px]">
                  <thead>
                    <tr>
                      <th className="w-8" />
                      <th>Código</th>
                      <th>Produto</th>
                      <th className="text-right">Estoque</th>
                      <th className="text-right">Vendido</th>
                      <th className="text-right">Referência</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.slice(0, limit).map((r) => (
                      <PreviewRow key={r.key} row={r} checked={selected.has(r.key)} onToggle={(on) => setMany([r], on)} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {visible.length > limit && (
              <Button size="sm" className="justify-self-center" onClick={() => setLimit((l) => l + PAGE)}>
                Mostrar mais ({visible.length - limit} restantes)
              </Button>
            )}
          </div>
        </Panel>
      )}

      {plan && stats && (
        <Panel title="3. Confirmar">
          <div className="flex flex-wrap items-center gap-3">
            <p className="m-0 flex-1 text-[13.5px]">
              {companyName}: <b>{stats.newSelected}</b> novo(s), <b>{stats.updated}</b> atualizado(s)
              {stats.removed > 0 && (
                <>
                  , <b className="text-[var(--bad-fg)]">{stats.removed}</b> sai(em) do catálogo
                </>
              )}
              {stats.errors > 0 && <span className="text-muted"> · {stats.errors} com erro (não entram)</span>}.
            </p>
            <Button variant="primary" loading={saving} disabled={stats.selected === 0 && stats.removed === 0} onClick={save}>
              Importar
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}

function PreviewRow({ row: r, checked, onToggle }: { row: PlanRow; checked: boolean; onToggle: (on: boolean) => void }) {
  const stockChanged = r.stockNew !== null && r.stockOld !== null && r.stockNew !== r.stockOld;
  return (
    <tr className={checked ? "" : "opacity-60"}>
      <td>
        <input
          type="checkbox"
          className="accent-accent"
          checked={checked}
          disabled={r.errors.length > 0}
          aria-label={`Incluir ${r.name}`}
          onChange={(e) => onToggle(e.target.checked)}
        />
      </td>
      <td className="text-muted tabular-nums">{r.code ?? "—"}</td>
      <td>
        <b className="block font-semibold text-title">{r.name}</b>
        <span className="text-xs text-muted">
          {[r.category, r.unit].filter(Boolean).join(" · ")}
          {r.salePrice !== null && ` · preço da planilha ${formatBRL(r.salePrice)}`}
          {r.clearSalePrice && " · sob consulta"}
        </span>
        {r.warning && <small className="block text-xs text-[var(--warn-fg)]">{r.warning}</small>}
        {r.errors.map((e) => (
          <small key={e} className="block text-xs text-[var(--bad-fg)]">
            {e}
          </small>
        ))}
      </td>
      <td className="text-right tabular-nums whitespace-nowrap">
        {stockChanged ? (
          <>
            <span className="text-muted line-through">{r.stockOld}</span> {r.stockNew}
          </>
        ) : (
          (r.stockNew ?? r.stockOld ?? "—")
        )}
      </td>
      <td className="text-right tabular-nums">{r.soldQty ? r.soldQty.toLocaleString("pt-BR") : "—"}</td>
      <td className="text-right tabular-nums whitespace-nowrap" title={r.referenceNote ?? undefined}>
        {r.isRental ? (
          <Pill tone="ind">Locação</Pill>
        ) : r.warning ? (
          <Pill tone="warn">Confira</Pill>
        ) : r.referencePrice !== null ? (
          formatBRL(r.referencePrice)
        ) : (
          "—"
        )}
      </td>
      <td>
        {r.errors.length ? (
          <Pill tone="bad">Erro</Pill>
        ) : !r.existingId ? (
          <Pill tone="ok">Novo</Pill>
        ) : !r.existingActive ? (
          checked ? <Pill tone="warn">Volta ao catálogo</Pill> : <Pill>Fora do catálogo</Pill>
        ) : checked ? (
          <Pill>Atualiza</Pill>
        ) : (
          <Pill tone="bad">Sai do catálogo</Pill>
        )}
      </td>
    </tr>
  );
}
