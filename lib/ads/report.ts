import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TIMEZONE } from "@/lib/format";

// Painel de tráfego: junta o que a Meta informa (investimento, alcance, cliques) com o que
// o Orvya sabe (lead que de fato chegou, venda fechada e valor) — CPL real, custo por venda e ROAS.

export type TrafficPeriodKey = "hoje" | "ontem" | "7d" | "30d" | "mes" | "mes-passado";
export const TRAFFIC_PERIODS: { key: TrafficPeriodKey; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "ontem", label: "Ontem" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "mes", label: "Este mês" },
  { key: "mes-passado", label: "Mês passado" },
];

export type TrafficPeriod = { key: TrafficPeriodKey; label: string; since: string; until: string; days: string[] };

const day = (d: Date) => formatInTimeZone(d, TIMEZONE, "yyyy-MM-dd");
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function resolveTrafficPeriod(key: string | undefined, now = new Date()): TrafficPeriod {
  const found = TRAFFIC_PERIODS.find((p) => p.key === key) ?? TRAFFIC_PERIODS[2]!;
  const today = day(now);
  let since = today;
  let until = today;
  switch (found.key) {
    case "ontem":
      since = until = addDays(today, -1);
      break;
    case "7d":
      since = addDays(today, -6);
      break;
    case "30d":
      since = addDays(today, -29);
      break;
    case "mes":
      since = `${today.slice(0, 7)}-01`;
      break;
    case "mes-passado": {
      const firstThis = `${today.slice(0, 7)}-01`;
      until = addDays(firstThis, -1);
      since = `${until.slice(0, 7)}-01`;
      break;
    }
  }
  const days: string[] = [];
  for (let d = since; d <= until; d = addDays(d, 1)) days.push(d);
  return { ...found, since, until, days };
}

export type Kpis = {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  conversations: number;
  metaLeads: number;
  leads: number; // leads de anúncio que chegaram no Orvya
  cpl: number | null;
  sales: number;
  revenue: number;
  costPerSale: number | null;
  roas: number | null;
};

export type CampaignRow = Kpis & { id: string; name: string; accountId: string; companyId: string; platform: "meta" | "google" };
export type DayPoint = { date: string; spend: number; leads: number; clicks: number };

export type AccountHealth = {
  id: string;
  companyId: string;
  companyName: string;
  name: string;
  platform: "meta" | "google";
  externalId: string;
  status: number | null;
  isPrepay: boolean | null;
  availableBalance: number | null;
  capRemaining: number | null;
  avgDailySpend: number;
  daysLeft: number | null;
  lowBalanceDays: number;
  fundingDisplay: string | null;
  lastSyncedAt: string | null;
  syncError: string | null;
  alerts: { level: "bad" | "warn"; text: string }[];
};

const STATUS_TEXT: Record<number, string> = {
  2: "Conta desativada pela Meta",
  3: "Pagamento pendente: a veiculação para até quitar",
  7: "Conta em análise de risco",
  8: "Liquidação pendente",
  9: "Período de tolerância: regularize o pagamento",
  100: "Conta em encerramento",
  101: "Conta encerrada",
};

function kpis(spend: number, impressions: number, clicks: number, conversations: number, metaLeads: number, leads: number, sales: number, revenue: number): Kpis {
  return {
    spend,
    impressions,
    clicks,
    ctr: impressions ? (clicks / impressions) * 100 : null,
    cpc: clicks ? spend / clicks : null,
    conversations,
    metaLeads,
    leads,
    cpl: leads ? spend / leads : null,
    sales,
    revenue,
    costPerSale: sales ? spend / sales : null,
    roas: spend ? revenue / spend : null,
  };
}

type AccountDb = {
  id: string;
  company_id: string;
  platform: "meta" | "google";
  external_id: string;
  name: string;
  account_status: number | null;
  is_prepay: boolean | null;
  amount_spent: number | string | null;
  spend_cap: number | string | null;
  available_balance: number | string | null;
  funding_display: string | null;
  low_balance_days: number;
  last_synced_at: string | null;
  sync_error: string | null;
  companies: { name: string } | null;
};
type DailyDb = {
  ad_account_id: string;
  company_id: string;
  date: string;
  campaign_id: string;
  campaign_name: string;
  spend: number | string;
  impressions: number;
  clicks: number;
  meta_leads: number;
  conversations: number;
};
type LeadDb = {
  id: string;
  company_id: string;
  value: number | string;
  created_at: string;
  closed_at: string | null;
  ad_referral: { source_id?: string } | null;
  stages: { kind: string } | null;
};

const num = (v: number | string | null | undefined) => (v === null || v === undefined ? null : Number(v));

export async function loadTraffic(supabase: SupabaseClient, companyIds: string[], period: TrafficPeriod) {
  const startIso = fromZonedTime(`${period.since}T00:00:00`, TIMEZONE).toISOString();
  const endIso = fromZonedTime(`${period.until}T23:59:59.999`, TIMEZONE).toISOString();
  const last7 = addDays(day(new Date()), -7);

  const [accRes, dailyRes, recentRes, leadsRes] = await Promise.all([
    supabase
      .from("ad_accounts")
      .select(
        "id, company_id, platform, external_id, name, account_status, is_prepay, amount_spent, spend_cap, available_balance, funding_display, low_balance_days, last_synced_at, sync_error, companies(name)",
      )
      .in("company_id", companyIds)
      .eq("active", true)
      .order("name")
      .returns<AccountDb[]>(),
    supabase
      .from("ad_campaign_daily")
      .select("ad_account_id, company_id, date, campaign_id, campaign_name, spend, impressions, clicks, meta_leads, conversations")
      .in("company_id", companyIds)
      .gte("date", period.since)
      .lte("date", period.until)
      .limit(20000)
      .returns<DailyDb[]>(),
    supabase.from("ad_campaign_daily").select("ad_account_id, spend").in("company_id", companyIds).gte("date", last7).returns<{ ad_account_id: string; spend: number | string }[]>(),
    supabase
      .from("leads")
      .select("id, company_id, value, created_at, closed_at, ad_referral, stages(kind)")
      .in("company_id", companyIds)
      .not("ad_referral", "is", null)
      .or(`and(created_at.gte."${startIso}",created_at.lte."${endIso}"),and(closed_at.gte."${startIso}",closed_at.lte."${endIso}")`)
      .limit(20000)
      .returns<LeadDb[]>(),
  ]);

  const accounts = accRes.data ?? [];
  const daily = dailyRes.data ?? [];
  const leads = leadsRes.data ?? [];

  // Anúncio → campanha (só dos anúncios que aparecem nos leads).
  const adIds = [...new Set(leads.map((l) => l.ad_referral?.source_id).filter((x): x is string => !!x))];
  const adMap = new Map<string, string>();
  if (adIds.length) {
    const { data } = await supabase.from("ad_ads").select("ad_id, campaign_id").in("ad_id", adIds).returns<{ ad_id: string; campaign_id: string }[]>();
    for (const a of data ?? []) adMap.set(a.ad_id, a.campaign_id);
  }

  const inPeriod = (iso: string | null) => !!iso && iso >= startIso && iso <= endIso;
  const newLeads = leads.filter((l) => inPeriod(l.created_at));
  const won = leads.filter((l) => l.stages?.kind === "won" && inPeriod(l.closed_at));
  const campaignOf = (l: LeadDb) => (l.ad_referral?.source_id ? adMap.get(l.ad_referral.source_id) : undefined);

  // Totais
  const sum = (f: (d: DailyDb) => number) => daily.reduce((s, d) => s + f(d), 0);
  const totals = kpis(
    sum((d) => Number(d.spend)),
    sum((d) => d.impressions),
    sum((d) => d.clicks),
    sum((d) => d.conversations),
    sum((d) => d.meta_leads),
    newLeads.length,
    won.length,
    won.reduce((s, l) => s + Number(l.value), 0),
  );

  // Por campanha
  const platformOf = new Map(accounts.map((a) => [a.id, a.platform]));
  const camp = new Map<string, { id: string; name: string; accountId: string; companyId: string; spend: number; impressions: number; clicks: number; conversations: number; metaLeads: number }>();
  for (const d of daily) {
    const c = camp.get(d.campaign_id) ?? { id: d.campaign_id, name: d.campaign_name, accountId: d.ad_account_id, companyId: d.company_id, spend: 0, impressions: 0, clicks: 0, conversations: 0, metaLeads: 0 };
    c.spend += Number(d.spend);
    c.impressions += d.impressions;
    c.clicks += d.clicks;
    c.conversations += d.conversations;
    c.metaLeads += d.meta_leads;
    c.name = d.campaign_name;
    camp.set(d.campaign_id, c);
  }
  const campaigns: CampaignRow[] = [...camp.values()]
    .map((c) => {
      const cl = newLeads.filter((l) => campaignOf(l) === c.id);
      const cw = won.filter((l) => campaignOf(l) === c.id);
      return {
        id: c.id,
        name: c.name,
        accountId: c.accountId,
        companyId: c.companyId,
        platform: platformOf.get(c.accountId) ?? "meta",
        ...kpis(c.spend, c.impressions, c.clicks, c.conversations, c.metaLeads, cl.length, cw.length, cw.reduce((s, l) => s + Number(l.value), 0)),
      };
    })
    .sort((a, b) => b.spend - a.spend);
  const unattributed = newLeads.filter((l) => !campaignOf(l)).length;

  // Série diária
  const series: DayPoint[] = period.days.map((d) => ({
    date: d,
    spend: daily.filter((x) => x.date === d).reduce((s, x) => s + Number(x.spend), 0),
    leads: newLeads.filter((l) => day(new Date(l.created_at)) === d).length,
    clicks: daily.filter((x) => x.date === d).reduce((s, x) => s + Number(x.clicks), 0),
  }));

  // Saúde das contas e alertas
  const recent = recentRes.data ?? [];
  const health: AccountHealth[] = accounts.map((a) => {
    const avgDailySpend = recent.filter((r) => r.ad_account_id === a.id).reduce((s, r) => s + Number(r.spend), 0) / 7;
    const available = num(a.available_balance);
    const cap = num(a.spend_cap);
    const spent = num(a.amount_spent);
    const capRemaining = cap && spent !== null ? Math.max(0, cap - spent) : null;
    const reserve = available ?? capRemaining;
    const daysLeft = reserve !== null && avgDailySpend > 0 ? reserve / avgDailySpend : null;
    const alerts: AccountHealth["alerts"] = [];
    if (a.sync_error) alerts.push({ level: "bad", text: `Não foi possível atualizar: ${a.sync_error}` });
    if (a.account_status && a.account_status !== 1 && STATUS_TEXT[a.account_status]) alerts.push({ level: "bad", text: STATUS_TEXT[a.account_status]! });
    if (daysLeft !== null && daysLeft <= a.low_balance_days) {
      const d = Math.max(0, Math.floor(daysLeft));
      alerts.push({
        level: d <= 1 ? "bad" : "warn",
        text:
          available !== null
            ? `Saldo para ${d === 0 ? "menos de 1 dia" : `cerca de ${d} ${d === 1 ? "dia" : "dias"}`}: emitir boleto ou PIX para o cliente`
            : `Limite de gastos acaba em ${d === 0 ? "menos de 1 dia" : `cerca de ${d} ${d === 1 ? "dia" : "dias"}`}: aumentar o limite`,
      });
    }
    return {
      id: a.id,
      companyId: a.company_id,
      companyName: a.companies?.name ?? "",
      name: a.name,
      platform: a.platform,
      externalId: a.external_id,
      status: a.account_status,
      isPrepay: a.is_prepay,
      availableBalance: available,
      capRemaining,
      avgDailySpend,
      daysLeft,
      lowBalanceDays: a.low_balance_days,
      fundingDisplay: a.funding_display,
      lastSyncedAt: a.last_synced_at,
      syncError: a.sync_error,
      alerts,
    };
  });

  return {
    totals,
    campaigns,
    series,
    health,
    unattributed,
    error: !!(accRes.error || dailyRes.error || leadsRes.error),
  };
}

export type TrafficData = Awaited<ReturnType<typeof loadTraffic>>;
