"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/lib/auth/viewer";
import { listGoogleAccounts, googleErrorText } from "@/lib/ads/google";
import { loadGoogleGrant } from "@/lib/ads/google-grants";
import { fetchMetaAccount, metaErrorText } from "@/lib/ads/meta";
import { syncAdAccount } from "@/lib/ads/sync";
import { buildReportData, reportRange, upsertDraft } from "@/lib/ads/traffic-report";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

const NOT_ALLOWED: ActionResult = { ok: false, error: "Só o administrador da plataforma acessa o tráfego." };

/** Tráfego é restrito ao administrador da plataforma (o RLS das tabelas também exige). */
async function adminFor(slug: string) {
  const viewer = await getViewer();
  if (!viewer?.active || !viewer.isAdmin) return null;
  const company = viewer.companies.find((c) => c.slug === slug);
  return company ? { viewer, company, supabase: await createClient() } : null;
}

function refresh(slug: string) {
  revalidatePath(`/${slug}/trafego`);
}

const connectSchema = z.object({
  externalId: z
    .string()
    .trim()
    .transform((v) => v.replace(/^act_/i, "").replace(/\D/g, ""))
    .pipe(z.string().regex(/^\d{5,25}$/, "Número da conta de anúncios inválido (só números, sem act_).")),
  token: z.string().trim().min(20, "Cole o token do usuário do sistema.").max(2000),
});

/** Confere na Meta se o token lê a conta, guarda o token só no servidor e puxa 90 dias. */
export async function connectAdAccount(slug: string, input: z.input<typeof connectSchema>): Promise<ActionResult> {
  const ctx = await adminFor(slug);
  if (!ctx) return NOT_ALLOWED;
  const parsed = connectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const { externalId, token } = parsed.data;

  let info;
  try {
    info = await fetchMetaAccount(externalId, token);
  } catch (e) {
    return { ok: false, error: `A Meta recusou: ${metaErrorText(e)}` };
  }

  const { data: acc, error } = await ctx.supabase
    .from("ad_accounts")
    .upsert(
      { company_id: ctx.company.id, platform: "meta", external_id: externalId, name: info.name, currency: info.currency, timezone: info.timezone, active: true },
      { onConflict: "platform,external_id" },
    )
    .select("id")
    .single<{ id: string }>();
  if (error || !acc) return { ok: false, error: "Não foi possível salvar a conta." };

  const admin = createAdminClient();
  const { error: credError } = await admin
    .from("ad_credentials")
    .upsert({ ad_account_id: acc.id, access_token: token, updated_at: new Date().toISOString() }, { onConflict: "ad_account_id" });
  if (credError) return { ok: false, error: "Conta salva, mas o token não foi guardado. Tente de novo." };

  const sync = await syncAdAccount(admin, acc.id, 90);
  refresh(slug);
  return sync.ok
    ? { ok: true, message: `${info.name} conectada. Últimos 90 dias importados.` }
    : { ok: false, error: `Conta conectada, mas a importação falhou: ${sync.error}` };
}

const googleSchema = z.object({ grantId: z.uuid(), customerId: z.string().regex(/^\d{6,12}$/) });

/** Liga a conta do Google Ads escolhida à empresa, com o acesso do login da Google, e puxa 90 dias. */
export async function connectGoogleAccount(slug: string, input: z.input<typeof googleSchema>): Promise<ActionResult> {
  const ctx = await adminFor(slug);
  if (!ctx) return NOT_ALLOWED;
  const parsed = googleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Conta inválida." };

  const admin = createAdminClient();
  const grant = await loadGoogleGrant(admin, parsed.data.grantId, ctx.viewer.id);
  if (!grant) return { ok: false, error: "O login da Google expirou. Clique em Conectar Google Ads de novo." };

  let accounts;
  try {
    accounts = await listGoogleAccounts(grant.refreshToken);
  } catch (e) {
    return { ok: false, error: googleErrorText(e) };
  }
  const chosen = accounts.find((a) => a.customerId === parsed.data.customerId);
  if (!chosen) return { ok: false, error: "Este login da Google não alcança essa conta." };

  const { data: acc, error } = await ctx.supabase
    .from("ad_accounts")
    .upsert(
      {
        company_id: ctx.company.id,
        platform: "google",
        external_id: chosen.customerId,
        name: chosen.name,
        currency: chosen.currency,
        timezone: chosen.timezone,
        login_customer_id: chosen.loginCustomerId,
        active: true,
      },
      { onConflict: "platform,external_id" },
    )
    .select("id")
    .single<{ id: string }>();
  if (error || !acc) return { ok: false, error: "Não foi possível salvar a conta. Confira se a migration 0015 foi rodada." };

  const { error: credError } = await admin
    .from("ad_credentials")
    .upsert({ ad_account_id: acc.id, access_token: grant.refreshToken, updated_at: new Date().toISOString() }, { onConflict: "ad_account_id" });
  if (credError) return { ok: false, error: "Conta salva, mas o acesso não foi guardado. Tente de novo." };

  const sync = await syncAdAccount(admin, acc.id, 90);
  refresh(slug);
  return sync.ok
    ? { ok: true, message: `${chosen.name} conectada. Últimos 90 dias importados.` }
    : { ok: false, error: `Conta conectada, mas a importação falhou: ${sync.error}` };
}

/** Atualiza agora (além da rotina automática). */
export async function syncNow(slug: string, accountId: string): Promise<ActionResult> {
  const ctx = await adminFor(slug);
  if (!ctx) return NOT_ALLOWED;
  // Confere pelo cliente do usuário que a conta existe e ele pode vê-la.
  const { data } = await ctx.supabase.from("ad_accounts").select("id, name").eq("id", accountId).maybeSingle<{ id: string; name: string }>();
  if (!data) return { ok: false, error: "Conta não encontrada." };
  const r = await syncAdAccount(createAdminClient(), accountId);
  refresh(slug);
  return r.ok ? { ok: true, message: `${data.name} atualizada.` } : { ok: false, error: r.error };
}

const settingsSchema = z.object({ accountId: z.uuid(), lowBalanceDays: z.coerce.number().int().min(1).max(30) });

export async function saveAccountSettings(slug: string, input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  const ctx = await adminFor(slug);
  if (!ctx) return NOT_ALLOWED;
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Informe de 1 a 30 dias." };
  const { error } = await ctx.supabase.from("ad_accounts").update({ low_balance_days: parsed.data.lowBalanceDays }).eq("id", parsed.data.accountId);
  if (error) return { ok: false, error: "Não foi possível salvar." };
  refresh(slug);
  return { ok: true, message: "Alerta de saldo atualizado." };
}

export async function removeAdAccount(slug: string, accountId: string): Promise<ActionResult> {
  const ctx = await adminFor(slug);
  if (!ctx) return NOT_ALLOWED;
  const { data, error } = await ctx.supabase.from("ad_accounts").delete().eq("id", accountId).select("id");
  if (error || !data?.length) return { ok: false, error: "Não foi possível remover a conta." };
  refresh(slug);
  return { ok: true, message: "Conta removida do Orvya. Nada muda na Meta." };
}

const money = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(String(v).replace(",", "."))), z.number().min(0).max(1_000_000).nullable());
const goalsSchema = z.object({
  costPerConversationMax: money,
  cplMax: money,
  costPerSaleMax: money,
  roasMin: money,
  frequencyMax: z.preprocess((v) => Number(String(v).replace(",", ".")), z.number().min(1, "Frequência mínima: 1.").max(20)),
  ctrMin: z.preprocess((v) => Number(String(v).replace(",", ".")), z.number().min(0).max(20)),
});

/** Metas da gestora para a empresa: calibram os alertas do painel e dos relatórios. */
export async function saveGoals(slug: string, input: Record<string, unknown>): Promise<ActionResult> {
  const ctx = await adminFor(slug);
  if (!ctx) return NOT_ALLOWED;
  const parsed = goalsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Metas inválidas." };
  const g = parsed.data;
  const { error } = await ctx.supabase.from("traffic_goals").upsert(
    {
      company_id: ctx.company.id,
      cost_per_conversation_max: g.costPerConversationMax,
      cpl_max: g.cplMax,
      cost_per_sale_max: g.costPerSaleMax,
      roas_min: g.roasMin,
      frequency_max: g.frequencyMax,
      ctr_min: g.ctrMin,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id" },
  );
  if (error) return { ok: false, error: "Não foi possível salvar as metas. A migration 0018 já foi rodada?" };
  refresh(slug);
  return { ok: true, message: "Metas salvas. Os alertas já usam os novos limites." };
}

const kindSchema = z.enum(["diario", "semanal"]);

/** Gera agora o rascunho de ontem (diário) ou da semana passada (semanal). */
export async function generateReport(slug: string, kind: z.input<typeof kindSchema>): Promise<ActionResult & { id?: string }> {
  const ctx = await adminFor(slug);
  if (!ctx) return NOT_ALLOWED;
  const k = kindSchema.safeParse(kind);
  if (!k.success) return { ok: false, error: "Tipo de relatório inválido." };
  const r = await upsertDraft(ctx.supabase, ctx.company, k.data, reportRange(k.data));
  if (!r.ok) return r;
  refresh(slug);
  return { ok: true, message: "Rascunho pronto para revisar.", id: r.id };
}

const reportEditSchema = z.object({
  id: z.uuid(),
  notesDone: z.string().max(2000),
  notesNext: z.string().max(2000),
  hiddenAlerts: z.array(z.string().max(80)).max(50),
});

async function reportOf(ctx: NonNullable<Awaited<ReturnType<typeof adminFor>>>, id: string) {
  const { data } = await ctx.supabase.from("traffic_reports").select("id, status, kind, period_start, period_end").eq("id", id).eq("company_id", ctx.company.id).maybeSingle<{
    id: string;
    status: string;
    kind: "diario" | "semanal";
    period_start: string;
    period_end: string;
  }>();
  return data;
}

/** Salva as observações e os alertas escondidos; com release = true, libera o link para o cliente. */
export async function saveReport(slug: string, input: z.input<typeof reportEditSchema>, release = false): Promise<ActionResult> {
  const ctx = await adminFor(slug);
  if (!ctx) return NOT_ALLOWED;
  const parsed = reportEditSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };
  const rep = await reportOf(ctx, parsed.data.id);
  if (!rep) return { ok: false, error: "Relatório não encontrado." };
  const { error } = await ctx.supabase
    .from("traffic_reports")
    .update({
      notes_done: parsed.data.notesDone.trim() || null,
      notes_next: parsed.data.notesNext.trim() || null,
      hidden_alerts: parsed.data.hiddenAlerts,
      ...(release && rep.status !== "liberado" ? { status: "liberado", released_at: new Date().toISOString() } : {}),
    })
    .eq("id", rep.id);
  if (error) return { ok: false, error: "Não foi possível salvar o relatório." };
  refresh(slug);
  return { ok: true, message: release ? "Relatório liberado. Copie o texto e envie ao cliente." : "Relatório salvo." };
}

/** Refaz os números de um rascunho (por exemplo, depois de uma venda marcada como ganha). */
export async function refreshReport(slug: string, id: string): Promise<ActionResult> {
  const ctx = await adminFor(slug);
  if (!ctx) return NOT_ALLOWED;
  const rep = await reportOf(ctx, id);
  if (!rep) return { ok: false, error: "Relatório não encontrado." };
  if (rep.status === "liberado") return { ok: false, error: "Relatório já liberado: os números ficam como o cliente viu." };
  const data = await buildReportData(ctx.supabase, ctx.company, rep.period_start, rep.period_end);
  const { error } = await ctx.supabase.from("traffic_reports").update({ data }).eq("id", rep.id);
  if (error) return { ok: false, error: "Não foi possível atualizar os números." };
  refresh(slug);
  return { ok: true, message: "Números atualizados." };
}

/** Apaga um relatório (rascunho ou liberado: o link deixa de abrir). */
export async function deleteReport(slug: string, id: string): Promise<ActionResult> {
  const ctx = await adminFor(slug);
  if (!ctx) return NOT_ALLOWED;
  const { error } = await ctx.supabase.from("traffic_reports").delete().eq("id", id).eq("company_id", ctx.company.id);
  if (error) return { ok: false, error: "Não foi possível apagar o relatório." };
  refresh(slug);
  return { ok: true, message: "Relatório apagado." };
}
