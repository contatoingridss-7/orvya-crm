import "server-only";

// Google Ads API (leitura): login da Google, contas acessíveis e desempenho diário por campanha.
// O acesso à API é liberado no projeto do Google Cloud dono do cliente OAuth (nível Exploração ou acima).

const API_VERSION = process.env.GOOGLE_ADS_API_VERSION || "v26";
const API = `https://googleads.googleapis.com/${API_VERSION}`;
const SCOPE = "https://www.googleapis.com/auth/adwords";

/** Cookie com o "state" do login (contra falsificação) e a empresa de volta. */
export const GOOGLE_STATE_COOKIE = "gads_state";

export class GoogleAdsError extends Error {
  constructor(
    message: string,
    public status: number,
    public reason: string | null = null,
  ) {
    super(message);
  }
}

function oauthClient() {
  const id = process.env.GOOGLE_ADS_CLIENT_ID;
  const secret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
}

export const googleConfigured = () => oauthClient() !== null;

export function googleAuthUrl(redirectUri: string, state: string): string {
  const client = oauthClient();
  if (!client) throw new GoogleAdsError("Google Ads não configurado na Vercel.", 503);
  const params = new URLSearchParams({
    client_id: client.id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    // offline + consent: a Google devolve o refresh token, que mantém a conexão sem novo login.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(body: Record<string, string>) {
  const client = oauthClient();
  if (!client) throw new GoogleAdsError("Google Ads não configurado na Vercel.", 503);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: client.id, client_secret: client.secret, ...body }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    const reason = json.error ?? null;
    const message = reason === "invalid_grant" ? "O acesso à Google foi revogado ou expirou. Conecte o Google Ads de novo." : (json.error_description ?? "A Google recusou o login.");
    throw new GoogleAdsError(message, res.status, reason);
  }
  return json;
}

/** Troca o código do login pelo refresh token (acesso de longa duração). */
export async function exchangeCode(code: string, redirectUri: string): Promise<string> {
  const json = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  if (!json.refresh_token) throw new GoogleAdsError("A Google não devolveu o acesso permanente. Tente conectar de novo.", 400);
  return json.refresh_token;
}

async function accessToken(refreshToken: string): Promise<string> {
  return (await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken })).access_token!;
}

type ApiError = { error?: { message?: string; status?: string; details?: { errors?: { errorCode?: Record<string, string>; message?: string }[] }[] } };

async function api<T>(path: string, token: string, init: { body?: unknown; loginCustomerId?: string | null } = {}): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  // Opcional desde o fim do developer token (09/2026); enviado só se existir.
  if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN) headers["developer-token"] = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (init.loginCustomerId) headers["login-customer-id"] = init.loginCustomerId;
  const res = await fetch(`${API}/${path}`, {
    method: init.body === undefined ? "GET" : "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as T & ApiError;
  if (!res.ok) {
    const detail = json.error?.details?.[0]?.errors?.[0];
    const code = detail?.errorCode ? Object.values(detail.errorCode)[0] ?? null : null;
    throw new GoogleAdsError(detail?.message ?? json.error?.message ?? `Erro ${res.status} na Google Ads API.`, res.status, code ?? json.error?.status ?? null);
  }
  return json;
}

/** Consulta GAQL; a resposta do searchStream vem em lotes. */
async function gaql<R>(customerId: string, query: string, token: string, loginCustomerId?: string | null): Promise<R[]> {
  const batches = await api<{ results?: R[] }[]>(`customers/${customerId}/googleAds:searchStream`, token, { body: { query }, loginCustomerId });
  return batches.flatMap((b) => b.results ?? []);
}

type CustomerRow = {
  customer: { id: string; descriptiveName?: string; currencyCode?: string; timeZone?: string; manager?: boolean; status?: string };
};
type ClientRow = {
  customerClient: { id: string; descriptiveName?: string; currencyCode?: string; timeZone?: string; manager?: boolean; status?: string };
};

export type GoogleAccount = {
  customerId: string;
  name: string;
  currency: string | null;
  timezone: string | null;
  status: string | null;
  /** Conta de administrador (MCC) pela qual a conta é acessada, quando for o caso. */
  loginCustomerId: string | null;
};

const CUSTOMER_FIELDS = "customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.status";

/** Contas de anúncio que o login alcança, inclusive as ligadas a uma conta de administrador (MCC). */
export async function listGoogleAccounts(refreshToken: string): Promise<GoogleAccount[]> {
  const token = await accessToken(refreshToken);
  const { resourceNames = [] } = await api<{ resourceNames?: string[] }>("customers:listAccessibleCustomers", token);
  const out = new Map<string, GoogleAccount>();

  for (const rn of resourceNames) {
    const id = rn.replace("customers/", "");
    let me: CustomerRow["customer"] | undefined;
    try {
      me = (await gaql<CustomerRow>(id, `SELECT ${CUSTOMER_FIELDS} FROM customer LIMIT 1`, token))[0]?.customer;
    } catch {
      continue; // conta cancelada ou sem permissão de leitura
    }
    if (!me) continue;
    if (!me.manager) {
      out.set(id, { customerId: id, name: me.descriptiveName || `Conta ${id}`, currency: me.currencyCode ?? null, timezone: me.timeZone ?? null, status: me.status ?? null, loginCustomerId: null });
      continue;
    }
    // MCC: contas clientes diretas.
    try {
      const children = await gaql<ClientRow>(
        id,
        "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager, customer_client.status FROM customer_client WHERE customer_client.level = 1 AND customer_client.manager = false",
        token,
        id,
      );
      for (const { customerClient: c } of children) {
        if (out.has(c.id)) continue;
        out.set(c.id, { customerId: c.id, name: c.descriptiveName || `Conta ${c.id}`, currency: c.currencyCode ?? null, timezone: c.timeZone ?? null, status: c.status ?? null, loginCustomerId: id });
      }
    } catch {
      // segue com as demais
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** Situação da conta no formato que o Tráfego já usa (códigos da Meta): 1 ativa, 2 suspensa, 101 encerrada. */
export function googleStatusCode(status: string | null | undefined): number | null {
  if (!status) return null;
  if (status === "ENABLED") return 1;
  if (status === "SUSPENDED") return 2;
  if (status === "CANCELED" || status === "CLOSED") return 101;
  return null;
}

export type GoogleCampaignDay = {
  date: string;
  campaignId: string;
  campaignName: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
};

type CampaignRow = {
  segments: { date: string };
  campaign: { id: string; name?: string };
  metrics: { costMicros?: string; impressions?: string; clicks?: string; conversions?: number };
};

export async function fetchGoogleData(
  customerId: string,
  refreshToken: string,
  loginCustomerId: string | null,
  since: string,
  until: string,
): Promise<{ account: CustomerRow["customer"] | null; days: GoogleCampaignDay[] }> {
  const token = await accessToken(refreshToken);
  const [account] = await gaql<CustomerRow>(customerId, `SELECT ${CUSTOMER_FIELDS} FROM customer LIMIT 1`, token, loginCustomerId);
  const rows = await gaql<CampaignRow>(
    customerId,
    `SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
     FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}' AND metrics.impressions > 0`,
    token,
    loginCustomerId,
  );
  return {
    account: account?.customer ?? null,
    days: rows.map((r) => ({
      date: r.segments.date,
      campaignId: r.campaign.id,
      campaignName: r.campaign.name ?? `Campanha ${r.campaign.id}`,
      spend: Number(r.metrics.costMicros ?? 0) / 1_000_000,
      impressions: Number(r.metrics.impressions ?? 0),
      clicks: Number(r.metrics.clicks ?? 0),
      conversions: Number(r.metrics.conversions ?? 0),
    })),
  };
}

export function googleErrorText(e: unknown): string {
  if (e instanceof GoogleAdsError) {
    if (e.reason === "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION" || e.reason === "DEVELOPER_TOKEN_NOT_APPROVED") {
      return "O projeto Orvya no Google Cloud ainda não tem acesso de Exploração aprovado. Confira em Google Ads API → Níveis de acesso.";
    }
    if (e.reason === "USER_PERMISSION_DENIED" || e.status === 403) return "O login da Google não tem acesso a esta conta de anúncios.";
    if (e.reason === "invalid_grant") return e.message;
    return e.message;
  }
  return "Não foi possível falar com o Google Ads.";
}
