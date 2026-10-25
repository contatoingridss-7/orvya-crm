import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app-shell/page-header";
import { Wordmark } from "@/components/brand";
import { Notice } from "@/components/ui/notice";
import { loadTraffic, resolveTrafficPeriod, TRAFFIC_PERIODS } from "@/lib/ads/report";
import { requireRole } from "@/lib/auth/viewer";
import { formatDate, formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { TrafficDashboard } from "./traffic-dashboard";
import { AccountsPanel } from "./accounts-panel";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Tráfego" };

/**
 * Tráfego pago: investimento (Meta) cruzado com leads e vendas do Orvya.
 * Só o administrador da plataforma (o RLS das tabelas de anúncio também exige).
 */
export default async function TrafegoPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>;
  searchParams: Promise<{ periodo?: string; escopo?: string }>;
}) {
  const { viewer, company } = await requireRole((await params).empresa, ["admin"]);
  const sp = await searchParams;
  const period = resolveTrafficPeriod(sp.periodo);
  const all = sp.escopo === "todas" && viewer.companies.length > 1;
  const companies = all ? viewer.companies : [company];
  const supabase = await createClient();
  const data = await loadTraffic(
    supabase,
    companies.map((c) => c.id),
    period,
  );
  const companyName = new Map(viewer.companies.map((c) => [c.id, c.name]));
  const link = (periodo: string, todas: boolean) => `/${company.slug}/trafego?periodo=${periodo}${todas ? "&escopo=todas" : ""}`;
  const range = period.since === period.until ? formatDate(`${period.since}T12:00:00`) : `${formatDate(`${period.since}T12:00:00`)} a ${formatDate(`${period.until}T12:00:00`)}`;
  const title = all ? "Todas as empresas" : company.name;

  return (
    <>
      <PageHeader title="Tráfego" subtitle={`${title}: investimento, leads e vendas que vieram dos anúncios`} actions={<PrintButton />} />
      <div className="content grid gap-4">
        {/* Cabeçalho do relatório em PDF */}
        <div className="print-only">
          <p className="m-0 flex items-center gap-2 text-[13px]">
            <Wordmark className="text-[16px]" /> <b>Orvya</b>
          </p>
          <h2 className="mt-2 text-[20px]">Relatório de tráfego · {title}</h2>
          <p className="m-0 text-[12px]">
            {period.label} ({range}) · gerado em {formatDateTime(new Date())}
          </p>
        </div>

        <div className="toolbar no-print">
          <nav className="tabs" aria-label="Período">
            {TRAFFIC_PERIODS.map((p) => (
              <Link key={p.key} href={link(p.key, all)} aria-current={p.key === period.key ? "page" : undefined}>
                {p.label}
              </Link>
            ))}
          </nav>
          {viewer.companies.length > 1 && (
            <nav className="tabs" aria-label="Empresas">
              <Link href={link(period.key, false)} aria-current={!all ? "page" : undefined}>
                {company.shortName}
              </Link>
              <Link href={link(period.key, true)} aria-current={all ? "page" : undefined}>
                Todas as empresas
              </Link>
            </nav>
          )}
          <span className="text-[13px] text-muted">{range}</span>
        </div>

        {data.error && <Notice tone="bad">Parte dos dados não carregou. Se a migration 0011 ainda não foi rodada no Supabase, rode e recarregue.</Notice>}

        <TrafficDashboard data={data} companyName={Object.fromEntries(companyName)} showCompany={all} />

        <AccountsPanel slug={company.slug} companyName={company.name} accounts={data.health.filter((h) => h.companyId === company.id)} />
      </div>
    </>
  );
}
