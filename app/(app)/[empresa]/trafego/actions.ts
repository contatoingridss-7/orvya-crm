"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/lib/auth/viewer";
import { fetchMetaAccount, metaErrorText } from "@/lib/ads/meta";
import { syncAdAccount } from "@/lib/ads/sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

const NOT_ALLOWED: ActionResult = { ok: false, error: "Só o administrador da plataforma acessa o tráfego." };

/** Tráfego é restrito ao administrador da plataforma (o RLS das tabelas também exige). */
async function adminFor(slug: string) {
  const viewer = await getViewer();
  if (!viewer?.active || !viewer.isAdmin) return null;
  const company = viewer.companies.find((c) => c.slug === slug);
  return company ? { company, supabase: await createClient() } : null;
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
