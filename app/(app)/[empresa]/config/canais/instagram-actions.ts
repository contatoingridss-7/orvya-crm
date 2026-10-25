"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/lib/auth/viewer";
import { instagramErrorText, listInstagramPages, subscribeInstagram } from "@/lib/instagram/graph";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type IgPageOption = { pageId: string; pageName: string; username: string | null; name: string | null };
export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/** Instagram: só o administrador da plataforma conecta (o RLS também exige). */
async function adminContext(slug: string) {
  const viewer = await getViewer();
  if (!viewer?.active || !viewer.isAdmin) return null;
  const company = viewer.companies.find((c) => c.slug === slug);
  return company ? { company, supabase: await createClient() } : null;
}

const NOT_ALLOWED = { ok: false as const, error: "Só o administrador conecta o Instagram." };

const tokenSchema = z.string().trim().min(20, "Cole o token do usuário do sistema.").max(2000);

function refresh(slug: string) {
  revalidatePath(`/${slug}/config/canais`);
  revalidatePath(`/${slug}/conversas`);
}

/** Páginas com Instagram profissional que o token alcança. Os tokens das Páginas não saem do servidor. */
export async function listIgPages(slug: string, token: string): Promise<{ ok: true; pages: IgPageOption[] } | { ok: false; error: string }> {
  if (!(await adminContext(slug))) return NOT_ALLOWED;
  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Token inválido." };
  try {
    const pages = await listInstagramPages(parsed.data);
    if (!pages.length) {
      return { ok: false, error: "Nenhuma Página com Instagram profissional nesse token. Atribua a Página ao usuário do sistema e gere o token com as permissões do Instagram." };
    }
    return { ok: true, pages: pages.map(({ pageId, pageName, username, name }) => ({ pageId, pageName, username, name })) };
  } catch (e) {
    return { ok: false, error: instagramErrorText(e) };
  }
}

const connectSchema = z.object({ token: tokenSchema, pageId: z.string().regex(/^\d{5,25}$/), pipelineId: z.uuid("Escolha o funil.") });

/** Liga a conta à empresa, guarda o token da Página só no servidor e assina os webhooks da Página. */
export async function connectInstagram(slug: string, input: z.input<typeof connectSchema>): Promise<ActionResult> {
  const ctx = await adminContext(slug);
  if (!ctx) return NOT_ALLOWED;
  const parsed = connectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  let page;
  try {
    page = (await listInstagramPages(parsed.data.token)).find((p) => p.pageId === parsed.data.pageId);
  } catch (e) {
    return { ok: false, error: instagramErrorText(e) };
  }
  if (!page) return { ok: false, error: "Essa Página não aparece mais no token. Liste de novo." };

  // Sem os avisos ativados, a conta conecta e o erro fica visível em Canais (o webhook do app pode já bastar).
  const subscribeError = await subscribeInstagram(page.pageId, page.igUserId, page.pageToken);

  // Conta já ligada a outra empresa não troca de dona sem ser desconectada lá.
  const admin = createAdminClient();
  const { data: existing } = await admin.from("instagram_accounts").select("id, company_id").eq("ig_user_id", page.igUserId).maybeSingle<{ id: string; company_id: string }>();
  if (existing && existing.company_id !== ctx.company.id) return { ok: false, error: "Esta conta do Instagram já está ligada à outra empresa." };

  const values = {
    company_id: ctx.company.id,
    ig_user_id: page.igUserId,
    page_id: page.pageId,
    username: page.username,
    name: page.name ?? page.pageName,
    default_pipeline_id: parsed.data.pipelineId,
    status: "connected",
    last_error: subscribeError ? `Avisos da Página não ativados: ${subscribeError}` : null,
    connected_at: new Date().toISOString(),
  };
  const { data: acc, error } = await ctx.supabase.from("instagram_accounts").upsert(values, { onConflict: "ig_user_id" }).select("id").single<{ id: string }>();
  if (error || !acc) return { ok: false, error: "Não foi possível salvar a conta. Confira se a migration 0013 foi rodada." };

  const { error: credError } = await admin
    .from("instagram_credentials")
    .upsert({ account_id: acc.id, page_access_token: page.pageToken, updated_at: new Date().toISOString() }, { onConflict: "account_id" });
  if (credError) return { ok: false, error: "Conta salva, mas o token não foi guardado. Tente de novo." };

  refresh(slug);
  return {
    ok: true,
    message: subscribeError
      ? `@${page.username ?? page.pageName} conectado. Mande uma mensagem de teste no Direct para confirmar que chega.`
      : `@${page.username ?? page.pageName} conectado. As mensagens do Direct entram em Conversas.`,
  };
}

const settingsSchema = z.object({ accountId: z.uuid(), pipelineId: z.uuid("Escolha o funil.") });

export async function saveInstagramSettings(slug: string, input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  const ctx = await adminContext(slug);
  if (!ctx) return NOT_ALLOWED;
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const { data, error } = await ctx.supabase
    .from("instagram_accounts")
    .update({ default_pipeline_id: parsed.data.pipelineId })
    .eq("id", parsed.data.accountId)
    .eq("company_id", ctx.company.id)
    .select("id");
  if (error || !data?.length) return { ok: false, error: "Não foi possível salvar." };
  refresh(slug);
  return { ok: true, message: "Funil do Instagram atualizado." };
}

/** Para de receber e enviar pelo Direct. O histórico das conversas fica. */
export async function disconnectInstagram(slug: string, accountId: string): Promise<ActionResult> {
  const ctx = await adminContext(slug);
  if (!ctx) return NOT_ALLOWED;
  if (!z.uuid().safeParse(accountId).success) return { ok: false, error: "Conta inválida." };
  const { data, error } = await ctx.supabase
    .from("instagram_accounts")
    .update({ status: "off" })
    .eq("id", accountId)
    .eq("company_id", ctx.company.id)
    .select("id");
  if (error || !data?.length) return { ok: false, error: "Não foi possível desconectar." };
  await createAdminClient().from("instagram_credentials").delete().eq("account_id", accountId);
  refresh(slug);
  return { ok: true, message: "Instagram desconectado. As conversas antigas continuam em Conversas." };
}
