import type { SupabaseClient } from "@supabase/supabase-js";
import { Pill } from "@/components/ui/pill";
import { formatDateTime } from "@/lib/format";

type ImportFile = { name: string; label: string; detail: string };
type Row = {
  created_at: string;
  files: ImportFile[] | null;
  inserted: number;
  updated: number;
  deactivated: number;
  sales_periods: number;
  profiles: { full_name: string | null } | null;
};

export type LastImport = {
  createdAt: string;
  by: string | null;
  files: ImportFile[];
  inserted: number;
  updated: number;
  deactivated: number;
  salesPeriods: number;
};

/** Último carregamento do catálogo (vale até o próximo). Sem a migration 0014, volta null. */
export async function loadLastImport(supabase: SupabaseClient, companyId: string): Promise<LastImport | null> {
  const { data } = await supabase
    .from("catalog_imports")
    .select("created_at, files, inserted, updated, deactivated, sales_periods, profiles(full_name)")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<Row>();
  if (!data) return null;
  return {
    createdAt: data.created_at,
    by: data.profiles?.full_name ?? null,
    files: data.files ?? [],
    inserted: data.inserted,
    updated: data.updated,
    deactivated: data.deactivated,
    salesPeriods: data.sales_periods,
  };
}

function resultText(l: LastImport): string {
  const parts = [
    l.inserted && `${l.inserted} novo(s)`,
    l.updated && `${l.updated} atualizado(s)`,
    l.deactivated && `${l.deactivated} retirado(s)`,
    l.salesPeriods && `${l.salesPeriods} período(s) de vendas`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "sem mudanças no catálogo";
}

/** Linha curta para o topo do catálogo. */
export function LastImportLine({ data }: { data: LastImport }) {
  return (
    <p className="m-0 text-[13px] text-muted">
      Último carregamento: <b className="font-semibold text-ink">{formatDateTime(data.createdAt)}</b>
      {data.by && ` por ${data.by}`} · {resultText(data)}. Vale até o próximo carregamento.
    </p>
  );
}

/** Detalhe na tela de importação: arquivos e resultado. */
export function LastImportDetail({ data }: { data: LastImport }) {
  return (
    <div className="grid gap-2 text-[13px]">
      <p className="m-0">
        <b className="font-semibold">{formatDateTime(data.createdAt)}</b>
        {data.by && ` por ${data.by}`} · {resultText(data)}.
      </p>
      {data.files.length > 0 ? (
        <div className="row-list">
          {data.files.map((f) => (
            <div key={f.name} className="flex flex-wrap items-center gap-2 py-1.5">
              <Pill tone="ok">{f.label}</Pill>
              <b className="font-semibold break-all">{f.name}</b>
              <span className="text-muted">{f.detail}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="m-0 text-muted">Carregamento feito antes do registro dos arquivos.</p>
      )}
      <p className="m-0 text-xs text-muted">Os produtos e o histórico de vendas ficam guardados no banco. Só mudam quando você fizer um novo carregamento.</p>
    </div>
  );
}
