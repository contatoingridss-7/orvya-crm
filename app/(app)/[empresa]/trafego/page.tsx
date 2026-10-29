import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { PageHeader } from "@/components/app-shell/page-header";
import { Wordmark } from "@/components/brand";
import { Notice } from "@/components/ui/notice";
import { loadGoals, loadIndicators } from "@/lib/ads/indicators";
import { DEFAULT_GOALS } from "@/lib/ads/insights";
import { loadTraffic, resolveTrafficPeriod, TRAFFIC_PERIODS } from "@/lib/ads/report";
import { reportPeriodText, type ReportRow } from "@/lib/ads/traffic-report";
import { googleConfigured } from "@/lib/ads/google";
import { loadGoogleChoice, type GoogleChoice } from "@/lib/ads/google-grants";
import { syncAdAccount } from "@/lib/ads/sync";
import { requireRole } from "@/lib/auth/viewer";
import { formatDate, formatDateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { GoalsForm } from "./goals-form";
import { IndicatorsPanel } from "./indicators-panel";
import { ReportsPanel, type ReportListItem } from "./reports-panel";
import { TrafficDashboard } from "./traffic-dashboard";
import { AccountsPanel } from "./accounts-panel";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Tráfego" };

/** Se a rotina das 6h/13h não rodou, a própria visita atualiza (o token fica guardado; nada a reconectar). */
const STALE_MS = 6 * 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GOOGLE_NOTICE: Record<string, string> = {
  erro: "Não foi possível concluir o login da Google. Tente de novo.",
  cancelado: "Login da Google cancelado. Nada foi conectado.",
  "sem-config": "Faltam GOOGLE_ADS_CLIENT_ID e GOOGLE_ADS_CLIENT_SECRET na Vercel (e um novo deploy).",
};

/**
 * Tráfego pago: investimento (Meta) cruzado com leads e vendas do Orvya.
 * Só o administrador da plataforma (o RLS das tabelas de anúncio também exige).
 */
export default async function TrafegoPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>;
  searchParams: Promise<{ periodo?: string; escopo?: string; google?: string }>;
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
  // Metas são por cliente: na visão de todas as empresas, os alertas usam os limites padrão.
  const goals = all ? { goals: DEFAULT_GOALS, saved: false } : await loadGoals(supabase, company.id);
  const [indicators, reportsRes] = await Promise.all([
    loadIndicators(
      supabase,
      companies.map((c) => c.id),
      period,
      { goals: goals.goals, goalsSaved: goals.saved, health: data.health },
    ),
    supabase
      .from("traffic_reports")
      .select("id, kind, period_start, period_end, status, data")
      .eq("company_id", company.id)
      .order("period_end", { ascending: false })
      .order("kind")
      .limit(12)
      .returns<Pick<ReportRow, "id" | "kind" | "period_start" | "period_end" | "status" | "data">[]>(),
  ]);
  const reports: ReportListItem[] = (reportsRes.data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    period: reportPeriodText(r.period_start, r.period_end),
    status: r.status,
    alerts: r.data?.alerts?.length ?? 0,
  }));
  const stale = data.health.filter((h) => !h.lastSyncedAt || Date.now() - new Date(h.lastSyncedAt).getTime() > STALE_MS);
  if (stale.length) {
    after(async () => {
      const admin = createAdminClient();
      for (const h of stale) await syncAdAccount(admin, h.id);
    });
  }
  // Volta do login da Google: lista as contas para escolher qual liga a esta empresa.
  const googleChoice: GoogleChoice | null = sp.google && UUID.test(sp.google) ? await loadGoogleChoice(createAdminClient(), sp.google, viewer.id) : null;
  const googleNotice = sp.google ? (GOOGLE_NOTICE[sp.google] ?? null) : null;
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

        {data.health.length > 0 && (
          <IndicatorsPanel data={indicators} showDelta={period.key !== "hoje"} previousText={reportPeriodText(indicators.previous.since, indicators.previous.until)} />
        )}

        <TrafficDashboard data={data} companyName={Object.fromEntries(companyName)} showCompany={all} />

        {!all && data.health.length > 0 && (
          <div className="no-print grid gap-4">
            <ReportsPanel slug={company.slug} reports={reports} />
            <GoalsForm slug={company.slug} companyName={company.name} goals={goals.goals} saved={goals.saved} />
          </div>
        )}

        <AccountsPanel
          refreshing={stale.length > 0}
          googleReady={googleConfigured()}
          googleChoice={googleChoice}
          googleNotice={googleNotice}
          slug={company.slug}
          companyName={company.name}
          accounts={data.health.filter((h) => h.companyId === company.id)}
        />
      </div>
    </>
  );
}
