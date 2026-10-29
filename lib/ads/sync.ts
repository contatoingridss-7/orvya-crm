import "server-only";

import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TIMEZONE } from "@/lib/format";
import { fetchGoogleData, googleErrorText, googleStatusCode, GoogleAdsError } from "./google";
import { fetchAdDays, fetchAds, fetchAdWindow, fetchCampaignDays, fetchMetaAccount, metaErrorText } from "./meta";

type AccountRow = { id: string; company_id: string; platform: string; external_id: string; timezone: string | null; login_customer_id: string | null };

/**
 * Atualiza uma conta: dados e saldo, desempenho diário por campanha e o mapa de anúncios.
 * Usa o cliente service_role (job ou ação do administrador já conferida).
 * `days`: quantos dias para trás buscar (a Meta ainda ajusta os números dos últimos dias).
 */
export async function syncAdAccount(admin: SupabaseClient, accountId: string, days = 35): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: acc } = await admin.from("ad_accounts").select("id, company_id, platform, external_id, timezone, login_customer_id").eq("id", accountId).maybeSingle<AccountRow>();
  if (!acc) return { ok: false, error: "Conta não encontrada." };
  const { data: cred } = await admin.from("ad_credentials").select("access_token").eq("ad_account_id", acc.id).maybeSingle<{ access_token: string }>();
  if (!cred) return { ok: false, error: "Token da conta não cadastrado." };
  if (acc.platform === "google") return syncGoogle(admin, acc, cred.access_token, days);

  try {
    const info = await fetchMetaAccount(acc.external_id, cred.access_token);
    const tz = info.timezone ?? acc.timezone ?? TIMEZONE;
    const until = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
    const since = formatInTimeZone(new Date(Date.now() - days * 86_400_000), tz, "yyyy-MM-dd");
    const [rows, ads] = await Promise.all([fetchCampaignDays(acc.external_id, cred.access_token, since, until), fetchAds(acc.external_id, cred.access_token)]);

    // Substitui o intervalo inteiro: dias que a Meta zerou ou campanhas apagadas não ficam para trás.
    await admin.from("ad_campaign_daily").delete().eq("ad_account_id", acc.id).gte("date", since).lte("date", until);
    if (rows.length) {
      const { error } = await admin.from("ad_campaign_daily").insert(
        rows.map((r) => ({
          ad_account_id: acc.id,
          company_id: acc.company_id,
          date: r.date,
          campaign_id: r.campaignId,
          campaign_name: r.campaignName,
          spend: r.spend,
          impressions: r.impressions,
          reach: r.reach,
          clicks: r.clicks,
          meta_leads: r.metaLeads,
          conversations: r.conversations,
        })),
      );
      if (error) throw new Error("Falha ao gravar o desempenho.");
    }
    if (ads.length) {
      await admin.from("ad_ads").upsert(
        ads.map((a) => ({
          ad_account_id: acc.id,
          ad_id: a.adId,
          campaign_id: a.campaignId,
          ad_name: a.name,
          status: a.status,
          thumbnail_url: a.thumbnailUrl,
          created_time: a.createdTime,
          adset_name: a.adsetName,
        })),
        { onConflict: "ad_account_id,ad_id" },
      );
    }

    // Indicadores por anúncio (criativo): falha aqui não derruba a atualização das campanhas.
    try {
      await syncMetaAds(admin, acc, cred.access_token, tz, since, until);
    } catch {
      // Tabelas da migration 0018 ausentes ou limite da Meta: tenta de novo na próxima rotina.
    }

    await admin
      .from("ad_accounts")
      .update({
        name: info.name,
        currency: info.currency,
        timezone: info.timezone,
        is_prepay: info.isPrepay,
        account_status: info.status,
        disable_reason: info.disableReason,
        amount_spent: info.amountSpent,
        spend_cap: info.spendCap,
        balance_due: info.balanceDue,
        available_balance: info.availableBalance,
        funding_display: info.fundingDisplay,
        last_synced_at: new Date().toISOString(),
        sync_error: null,
      })
      .eq("id", acc.id);
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error && !("status" in e) ? e.message : metaErrorText(e);
    await admin.from("ad_accounts").update({ sync_error: error, last_synced_at: new Date().toISOString() }).eq("id", acc.id);
    return { ok: false, error };
  }
}

/** Por anúncio e por dia, mais o retrato dos últimos 7 dias (frequência real) de cada anúncio. */
async function syncMetaAds(admin: SupabaseClient, acc: AccountRow, token: string, tz: string, since: string, until: string) {
  const weekSince = formatInTimeZone(new Date(Date.now() - 6 * 86_400_000), tz, "yyyy-MM-dd");
  const [days, window] = await Promise.all([fetchAdDays(acc.external_id, token, since, until), fetchAdWindow(acc.external_id, token, weekSince, until)]);

  await admin.from("ad_ad_daily").delete().eq("ad_account_id", acc.id).gte("date", since).lte("date", until);
  for (let i = 0; i < days.length; i += 1000) {
    const { error } = await admin.from("ad_ad_daily").insert(
      days.slice(i, i + 1000).map((d) => ({
        ad_account_id: acc.id,
        company_id: acc.company_id,
        date: d.date,
        ad_id: d.adId,
        campaign_id: d.campaignId,
        spend: d.spend,
        impressions: d.impressions,
        reach: d.reach,
        clicks: d.clicks,
        meta_leads: d.metaLeads,
        conversations: d.conversations,
      })),
    );
    if (error) throw new Error("Falha ao gravar o desempenho por anúncio.");
  }

  await admin.from("ad_ad_window").delete().eq("ad_account_id", acc.id).eq("days", 7);
  if (window.length) {
    await admin.from("ad_ad_window").insert(
      window.map((w) => ({
        ad_account_id: acc.id,
        company_id: acc.company_id,
        ad_id: w.adId,
        days: 7,
        since: weekSince,
        until,
        spend: w.spend,
        impressions: w.impressions,
        reach: w.reach,
        frequency: w.frequency,
        clicks: w.clicks,
        conversations: w.conversations,
        updated_at: new Date().toISOString(),
      })),
    );
  }
}

/** Google Ads: o "token" guardado é o refresh token do login da Google. Sem saldo (a API em Exploração não lê faturamento). */
async function syncGoogle(admin: SupabaseClient, acc: AccountRow, refreshToken: string, days: number): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const tz = acc.timezone ?? TIMEZONE;
    const until = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
    const since = formatInTimeZone(new Date(Date.now() - days * 86_400_000), tz, "yyyy-MM-dd");
    const { account, days: rows } = await fetchGoogleData(acc.external_id, refreshToken, acc.login_customer_id, since, until);

    await admin.from("ad_campaign_daily").delete().eq("ad_account_id", acc.id).gte("date", since).lte("date", until);
    if (rows.length) {
      const { error } = await admin.from("ad_campaign_daily").insert(
        rows.map((r) => ({
          ad_account_id: acc.id,
          company_id: acc.company_id,
          date: r.date,
          campaign_id: r.campaignId,
          campaign_name: r.campaignName,
          spend: r.spend,
          impressions: r.impressions,
          reach: 0,
          clicks: r.clicks,
          meta_leads: Math.round(r.conversions), // conversões que o Google conta
          conversations: 0,
        })),
      );
      if (error) throw new Error("Falha ao gravar o desempenho.");
    }

    await admin
      .from("ad_accounts")
      .update({
        ...(account?.descriptiveName ? { name: account.descriptiveName } : {}),
        currency: account?.currencyCode ?? null,
        timezone: account?.timeZone ?? acc.timezone,
        account_status: googleStatusCode(account?.status),
        last_synced_at: new Date().toISOString(),
        sync_error: null,
      })
      .eq("id", acc.id);
    return { ok: true };
  } catch (e) {
    const error = e instanceof GoogleAdsError ? googleErrorText(e) : e instanceof Error ? e.message : googleErrorText(e);
    await admin.from("ad_accounts").update({ sync_error: error, last_synced_at: new Date().toISOString() }).eq("id", acc.id);
    return { ok: false, error };
  }
}

/** Job diário: todas as contas ativas. */
export async function syncAllAdAccounts(admin: SupabaseClient) {
  const { data } = await admin.from("ad_accounts").select("id, name").eq("active", true).returns<{ id: string; name: string }[]>();
  const out: { conta: string; ok: boolean; erro?: string }[] = [];
  for (const a of data ?? []) {
    const r = await syncAdAccount(admin, a.id);
    out.push({ conta: a.name, ok: r.ok, ...(r.ok ? {} : { erro: r.error }) });
  }
  return out;
}
