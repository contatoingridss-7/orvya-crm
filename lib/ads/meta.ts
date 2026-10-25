import "server-only";

import { graph, GraphError } from "@/lib/whatsapp/graph";

// API de Marketing da Meta (leitura): conta de anúncios, desempenho por campanha e anúncios.
// Token de usuário do sistema com a permissão ads_read e a conta atribuída a ele.

export type MetaAccount = {
  name: string;
  currency: string | null;
  timezone: string | null;
  isPrepay: boolean | null;
  status: number | null;
  disableReason: number | null;
  amountSpent: number | null;
  spendCap: number | null;
  balanceDue: number | null;
  availableBalance: number | null;
  fundingDisplay: string | null;
};

type AccountRow = {
  name?: string;
  currency?: string;
  timezone_name?: string;
  is_prepay_account?: boolean;
  account_status?: number;
  disable_reason?: number;
  amount_spent?: string;
  spend_cap?: string;
  balance?: string;
};

/** "123456" ou "act_123456" → "act_123456". */
export const actId = (id: string) => `act_${id.replace(/^act_/, "")}`;

// Valores de conta (gasto, limite, saldo devedor) vêm em centavos.
const cents = (v: string | undefined) => (v === undefined || v === "" ? null : Number(v) / 100);

/** "Saldo disponível (R$ 1.234,56 BRL)" → 1234.56 */
export function parseBrlAmount(text: string | null | undefined): number | null {
  const m = text?.match(/R\$\s?(-?[\d.]+,\d{2})/);
  return m ? Number(m[1]!.replace(/\./g, "").replace(",", ".")) : null;
}

export async function fetchMetaAccount(externalId: string, token: string): Promise<MetaAccount> {
  const a = await graph<AccountRow>(
    `${actId(externalId)}?fields=name,currency,timezone_name,is_prepay_account,account_status,disable_reason,amount_spent,spend_cap,balance`,
    token,
  );
  // Forma de pagamento (com o saldo das contas pré-pagas) exige permissão de gerenciar a conta:
  // se não houver, segue sem ela.
  let fundingDisplay: string | null = null;
  try {
    const f = await graph<{ funding_source_details?: { display_string?: string } }>(`${actId(externalId)}?fields=funding_source_details`, token);
    fundingDisplay = f.funding_source_details?.display_string ?? null;
  } catch {
    fundingDisplay = null;
  }
  const spendCap = cents(a.spend_cap);
  return {
    name: a.name ?? `Conta ${externalId}`,
    currency: a.currency ?? null,
    timezone: a.timezone_name ?? null,
    isPrepay: a.is_prepay_account ?? null,
    status: a.account_status ?? null,
    disableReason: a.disable_reason ?? null,
    amountSpent: cents(a.amount_spent),
    spendCap: spendCap === 0 ? null : spendCap,
    balanceDue: cents(a.balance),
    availableBalance: parseBrlAmount(fundingDisplay),
    fundingDisplay,
  };
}

type Action = { action_type: string; value: string };
type InsightRow = {
  campaign_id: string;
  campaign_name: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  actions?: Action[];
};
type Paged<T> = { data: T[]; paging?: { next?: string; cursors?: { after?: string } } };

export type CampaignDay = {
  date: string;
  campaignId: string;
  campaignName: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  metaLeads: number;
  conversations: number;
};

const LEAD_TYPES = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];
const CONVERSATION_TYPE = "onsite_conversion.messaging_conversation_started_7d";

function actionValue(actions: Action[] | undefined, types: string[]): number {
  if (!actions) return 0;
  // "lead" já é o total quando existe; senão soma os tipos específicos.
  const total = actions.find((a) => a.action_type === types[0]);
  if (total) return Number(total.value) || 0;
  return actions.filter((a) => types.includes(a.action_type)).reduce((s, a) => s + (Number(a.value) || 0), 0);
}

/** Percorre as páginas de um resultado da Graph API (até um limite de segurança). */
async function allPages<T>(firstPath: string, token: string, maxPages = 30): Promise<T[]> {
  const out: T[] = [];
  let path: string | null = firstPath;
  for (let i = 0; path && i < maxPages; i++) {
    const page: Paged<T> = await graph<Paged<T>>(path, token);
    out.push(...page.data);
    const after = page.paging?.cursors?.after;
    path = page.paging?.next && after ? `${firstPath}&after=${encodeURIComponent(after)}` : null;
  }
  return out;
}

/** Desempenho por campanha e por dia no intervalo (datas yyyy-MM-dd, no fuso da conta). */
export async function fetchCampaignDays(externalId: string, token: string, since: string, until: string): Promise<CampaignDay[]> {
  const range = encodeURIComponent(JSON.stringify({ since, until }));
  const rows = await allPages<InsightRow>(
    `${actId(externalId)}/insights?level=campaign&time_increment=1&time_range=${range}&fields=campaign_id,campaign_name,spend,impressions,reach,clicks,actions&limit=500`,
    token,
  );
  return rows.map((r) => ({
    date: r.date_start,
    campaignId: r.campaign_id,
    campaignName: r.campaign_name,
    spend: Number(r.spend ?? 0),
    impressions: Number(r.impressions ?? 0),
    reach: Number(r.reach ?? 0),
    clicks: Number(r.clicks ?? 0),
    metaLeads: actionValue(r.actions, LEAD_TYPES),
    conversations: actionValue(r.actions, [CONVERSATION_TYPE]),
  }));
}

/** Anúncios da conta com a campanha de cada um (liga o "referral" do WhatsApp à campanha). */
export async function fetchAds(externalId: string, token: string) {
  const rows = await allPages<{ id: string; name?: string; campaign_id: string }>(
    `${actId(externalId)}/ads?fields=id,name,campaign_id&limit=500`,
    token,
  );
  return rows.map((r) => ({ adId: r.id, campaignId: r.campaign_id, name: r.name ?? null }));
}

export function metaErrorText(e: unknown): string {
  if (e instanceof GraphError) {
    if (e.code === 190) return "Token inválido ou expirado. Gere um novo token do usuário do sistema.";
    if (e.code === 200 || e.code === 10) return "Sem permissão: atribua a conta de anúncios ao usuário do sistema e gere o token com ads_read.";
    if (e.code === 100) return "Conta de anúncios não encontrada. Confira o número da conta.";
    if (e.code === 17 || e.code === 80004) return "Limite de consultas da Meta atingido. Tente de novo em alguns minutos.";
    return e.message;
  }
  return "Sem resposta da Meta.";
}
