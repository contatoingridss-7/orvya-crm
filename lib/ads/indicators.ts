import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TIMEZONE } from "@/lib/format";
import { computeInsights, DEFAULT_GOALS, type CreativeInput, type Goals, type InsightsResult, type OpsInput, type PeriodNumbers } from "./insights";
import type { AccountHealth, TrafficPeriod } from "./report";

// Indicadores do tráfego: busca o que o motor de insights precisa (período atual e anterior,
// números por anúncio, frequência de 7 dias, metas e tempo de resposta aos leads do anúncio).

const day = (d: Date) => formatInTimeZone(d, TIMEZONE, "yyyy-MM-dd");
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const startOf = (iso: string) => fromZonedTime(`${iso}T00:00:00`, TIMEZONE).toISOString();
const endOf = (iso: string) => fromZonedTime(`${iso}T23:59:59.999`, TIMEZONE).toISOString();

/** Mesmo número de dias, imediatamente antes. */
export function previousRange(since: string, until: string) {
  const len = daysBetween(since, until);
  const prevUntil = addDays(since, -1);
  return { since: addDays(prevUntil, -(len - 1)), until: prevUntil };
}
function daysBetween(since: string, until: string) {
  return Math.round((new Date(`${until}T12:00:00Z`).getTime() - new Date(`${since}T12:00:00Z`).getTime()) / 86_400_000) + 1;
}

type GoalsDb = {
  company_id: string;
  cost_per_conversation_max: number | string | null;
  cpl_max: number | string | null;
  cost_per_sale_max: number | string | null;
  roas_min: number | string | null;
  frequency_max: number | string;
  ctr_min: number | string;
};
const n = (v: number | string | null) => (v === null ? null : Number(v));

export function goalsFromRow(row: GoalsDb | null | undefined): Goals {
  if (!row) return DEFAULT_GOALS;
  return {
    costPerConversationMax: n(row.cost_per_conversation_max),
    cplMax: n(row.cpl_max),
    costPerSaleMax: n(row.cost_per_sale_max),
    roasMin: n(row.roas_min),
    frequencyMax: Number(row.frequency_max),
    ctrMin: Number(row.ctr_min),
  };
}

export async function loadGoals(supabase: SupabaseClient, companyId: string): Promise<{ goals: Goals; saved: boolean }> {
  const { data } = await supabase.from("traffic_goals").select("*").eq("company_id", companyId).maybeSingle<GoalsDb>();
  return { goals: goalsFromRow(data), saved: !!data };
}

type AdDailyDb = {
  date: string;
  ad_id: string;
  campaign_id: string;
  spend: number | string;
  impressions: number;
  clicks: number;
  conversations: number;
};
type AdDb = {
  ad_id: string;
  campaign_id: string;
  ad_name: string | null;
  status: string | null;
  thumbnail_url: string | null;
  created_time: string | null;
  adset_name: string | null;
};
type LeadDb = {
  id: string;
  value: number | string;
  created_at: string;
  closed_at: string | null;
  ad_referral: { source_id?: string } | null;
  stages: { kind: string } | null;
};
type ConvDb = { id: string; lead_id: string | null; last_inbound_at: string | null; last_message_at: string | null };
type MsgDb = { conversation_id: string; direction: "in" | "out"; sender: string; created_at: string };

export type Funnel = { impressions: number; clicks: number; conversations: number; leads: number; answered: number; sales: number; revenue: number };

export type Indicators = InsightsResult & {
  goals: Goals;
  goalsSaved: boolean;
  previous: { since: string; until: string };
  funnel: Funnel;
  ops: OpsInput;
  /** Tabelas da 0018 ainda não existem. */
  missing: boolean;
};

/** Horário em que se espera resposta rápida: seg a sáb, 7h às 19h (Teresina). */
function businessHour(iso: string) {
  const dow = Number(formatInTimeZone(new Date(iso), TIMEZONE, "i")); // 1 = segunda ... 7 = domingo
  const h = Number(formatInTimeZone(new Date(iso), TIMEZONE, "H"));
  return dow <= 6 && h >= 7 && h < 19;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

export async function loadIndicators(
  supabase: SupabaseClient,
  companyIds: string[],
  period: Pick<TrafficPeriod, "since" | "until">,
  opts: { goals?: Goals; goalsSaved?: boolean; health?: AccountHealth[]; now?: Date } = {},
): Promise<Indicators> {
  const now = opts.now ?? new Date();
  const prev = previousRange(period.since, period.until);
  const today = day(now);
  // Tendência de CTR precisa de até 6 dias com entrega antes do fim do período.
  const trendSince = addDays(period.until, -13);
  const adSince = prev.since < trendSince ? prev.since : trendSince;

  const [campRes, adDailyRes, windowRes, leadsRes] = await Promise.all([
    supabase
      .from("ad_campaign_daily")
      .select("date, spend, impressions, clicks, conversations")
      .in("company_id", companyIds)
      .gte("date", prev.since)
      .lte("date", period.until)
      .limit(20000)
      .returns<{ date: string; spend: number | string; impressions: number; clicks: number; conversations: number }[]>(),
    supabase
      .from("ad_ad_daily")
      .select("date, ad_id, campaign_id, spend, impressions, clicks, conversations")
      .in("company_id", companyIds)
      .gte("date", adSince)
      .lte("date", period.until)
      .limit(50000)
      .returns<AdDailyDb[]>(),
    supabase.from("ad_ad_window").select("ad_id, reach, frequency").in("company_id", companyIds).eq("days", 7).returns<{ ad_id: string; reach: number; frequency: number | string | null }[]>(),
    supabase
      .from("leads")
      .select("id, value, created_at, closed_at, ad_referral, stages(kind)")
      .in("company_id", companyIds)
      .not("ad_referral", "is", null)
      .or(`and(created_at.gte."${startOf(prev.since)}",created_at.lte."${endOf(period.until)}"),and(closed_at.gte."${startOf(prev.since)}",closed_at.lte."${endOf(period.until)}")`)
      .limit(20000)
      .returns<LeadDb[]>(),
  ]);

  const camp = campRes.data ?? [];
  const adDaily = adDailyRes.data ?? [];
  const leads = leadsRes.data ?? [];
  const inRange = (iso: string | null, since: string, until: string) => !!iso && iso >= startOf(since) && iso <= endOf(until);
  const won = (l: LeadDb) => l.stages?.kind === "won";

  const numbers = (since: string, until: string): PeriodNumbers => {
    const rows = camp.filter((d) => d.date >= since && d.date <= until);
    const sales = leads.filter((l) => won(l) && inRange(l.closed_at, since, until));
    return {
      spend: rows.reduce((s, d) => s + Number(d.spend), 0),
      impressions: rows.reduce((s, d) => s + d.impressions, 0),
      clicks: rows.reduce((s, d) => s + d.clicks, 0),
      conversations: rows.reduce((s, d) => s + d.conversations, 0),
      leads: leads.filter((l) => inRange(l.created_at, since, until)).length,
      sales: sales.length,
      revenue: sales.reduce((s, l) => s + Number(l.value), 0),
    };
  };
  const current = numbers(period.since, period.until);
  const previous = numbers(prev.since, prev.until);

  // ------------------------------------------------------------ Por anúncio
  const curAd = adDaily.filter((d) => d.date >= period.since && d.date <= period.until);
  const adIds = [...new Set(curAd.filter((d) => Number(d.spend) > 0 || d.impressions > 0).map((d) => d.ad_id))];
  const adsInfo = new Map<string, AdDb>();
  const campaignName = new Map<string, string>();
  if (adIds.length) {
    const [adsRes, campNames] = await Promise.all([
      supabase.from("ad_ads").select("ad_id, campaign_id, ad_name, status, thumbnail_url, created_time, adset_name").in("ad_id", adIds).returns<AdDb[]>(),
      supabase
        .from("ad_campaign_daily")
        .select("campaign_id, campaign_name")
        .in("company_id", companyIds)
        .gte("date", period.since)
        .lte("date", period.until)
        .limit(5000)
        .returns<{ campaign_id: string; campaign_name: string }[]>(),
    ]);
    for (const a of adsRes.data ?? []) adsInfo.set(a.ad_id, a);
    for (const c of campNames.data ?? []) campaignName.set(c.campaign_id, c.campaign_name);
  }
  const windowOf = new Map((windowRes.data ?? []).map((w) => [w.ad_id, w]));

  const creatives: CreativeInput[] = adIds.map((adId) => {
    const rows = curAd.filter((d) => d.ad_id === adId);
    const info = adsInfo.get(adId);
    const adLeads = leads.filter((l) => l.ad_referral?.source_id === adId);
    const adSales = adLeads.filter((l) => won(l) && inRange(l.closed_at, period.since, period.until));
    // Tendência: 3 dias mais recentes com entrega contra os 3 anteriores.
    const delivered = adDaily
      .filter((d) => d.ad_id === adId && d.date <= period.until && d.impressions > 0)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 6);
    const ctrOf = (xs: AdDailyDb[]) => {
      const imp = xs.reduce((s, d) => s + d.impressions, 0);
      return imp ? (xs.reduce((s, d) => s + d.clicks, 0) / imp) * 100 : null;
    };
    const recent = delivered.slice(0, 3);
    const before = delivered.slice(3, 6);
    const w = windowOf.get(adId);
    return {
      adId,
      name: info?.ad_name ?? `Anúncio ${adId}`,
      campaignName: campaignName.get(rows[0]?.campaign_id ?? info?.campaign_id ?? "") ?? null,
      adsetName: info?.adset_name ?? null,
      status: info?.status ?? null,
      thumbnailUrl: info?.thumbnail_url ?? null,
      createdTime: info?.created_time ?? null,
      spend: rows.reduce((s, d) => s + Number(d.spend), 0),
      impressions: rows.reduce((s, d) => s + d.impressions, 0),
      clicks: rows.reduce((s, d) => s + d.clicks, 0),
      conversations: rows.reduce((s, d) => s + d.conversations, 0),
      leads: adLeads.filter((l) => inRange(l.created_at, period.since, period.until)).length,
      sales: adSales.length,
      revenue: adSales.reduce((s, l) => s + Number(l.value), 0),
      // A janela de 7 dias termina hoje: só vale para períodos que chegam até ontem ou hoje.
      frequency7: w && period.until >= addDays(today, -1) && w.frequency !== null ? Number(w.frequency) : null,
      reach7: w ? Number(w.reach) : null,
      ctrRecent: before.length === 3 ? ctrOf(recent) : null,
      ctrBefore: before.length === 3 ? ctrOf(before) : null,
      recentImpressions: recent.reduce((s, d) => s + d.impressions, 0),
    };
  });

  // ------------------------------------------------------------ Atendimento
  const periodLeads = leads.filter((l) => inRange(l.created_at, period.since, period.until));
  const ops: OpsInput = { adLeads: periodLeads.length, waitingNow: 0, medianFirstResponseMin: null, slowFirstResponses: 0 };
  let answered = 0;
  if (periodLeads.length) {
    const { data: convs } = await supabase
      .from("conversations")
      .select("id, lead_id, last_inbound_at, last_message_at")
      .in(
        "lead_id",
        periodLeads.slice(0, 1000).map((l) => l.id),
      )
      .returns<ConvDb[]>();
    const conversations = convs ?? [];
    const cutoff = now.getTime() - 15 * 60_000;
    // "Esperando agora" só vale para o período que chega até hoje (não em relatório de dias passados).
    ops.waitingNow = period.until < today ? 0 : conversations.filter((c) => {
      if (!c.last_inbound_at || !c.last_message_at) return false;
      const lastIn = new Date(c.last_inbound_at).getTime();
      return lastIn >= new Date(c.last_message_at).getTime() - 1000 && lastIn < cutoff && lastIn > now.getTime() - 24 * 3_600_000;
    }).length;

    if (conversations.length) {
      const { data: msgs } = await supabase
        .from("messages")
        .select("conversation_id, direction, sender, created_at")
        .in(
          "conversation_id",
          conversations.map((c) => c.id),
        )
        .gte("created_at", startOf(period.since))
        .order("created_at")
        .limit(20000)
        .returns<MsgDb[]>();
      const byConv = new Map<string, MsgDb[]>();
      for (const m of msgs ?? []) byConv.set(m.conversation_id, [...(byConv.get(m.conversation_id) ?? []), m]);
      const waits: number[] = [];
      for (const list of byConv.values()) {
        const firstIn = list.find((m) => m.direction === "in");
        if (!firstIn) continue;
        const reply = list.find((m) => m.direction === "out" && m.sender !== "system" && m.created_at > firstIn.created_at);
        if (reply) answered++;
        if (!businessHour(firstIn.created_at)) continue;
        const end = reply ? new Date(reply.created_at).getTime() : now.getTime();
        const minutes = (end - new Date(firstIn.created_at).getTime()) / 60_000;
        if (!reply && minutes < 15) continue; // ainda dentro do prazo
        waits.push(minutes);
        if (minutes > 15) ops.slowFirstResponses++;
      }
      ops.medianFirstResponseMin = median(waits);
    }
  }

  const goals = opts.goals ?? DEFAULT_GOALS;
  const singleDay = period.since === period.until;
  const accountAlerts = (opts.health ?? []).flatMap((h) => h.alerts.map((a) => ({ ...a, account: h.name })));
  const result = computeInsights({ current, previous, creatives, ops, goals, accountAlerts, singleDay, now });

  return {
    ...result,
    goals,
    goalsSaved: !!opts.goalsSaved,
    previous: prev,
    funnel: {
      impressions: current.impressions,
      clicks: current.clicks,
      conversations: current.conversations,
      leads: current.leads,
      answered,
      sales: current.sales,
      revenue: current.revenue,
    },
    ops,
    missing: !!(adDailyRes.error || windowRes.error),
  };
}
