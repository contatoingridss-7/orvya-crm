"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/lib/auth/viewer";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fetchPhoneNumber, GraphError, registerNumber, subscribeApp, type PhoneNumberInfo } from "@/lib/whatsapp/graph";
import { exchangeSignupCode, findWabaPhone, requestAppSync } from "@/lib/whatsapp/signup";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/** Números de WhatsApp: só o administrador da plataforma edita (SPEC 1). */
async function adminContext(slug: string) {
  const viewer = await getViewer();
  if (!viewer?.active || !viewer.isAdmin) return null;
  const company = viewer.companies.find((c) => c.slug === slug);
  return company ? { company, supabase: await createClient() } : null;
}

const NOT_ALLOWED: ActionResult = { ok: false, error: "Só o administrador conecta números de WhatsApp." };

const settingsSchema = z.object({
  slot: z.union([z.literal(1), z.literal(2)]),
  label: z.string().trim().min(2, "Dê um nome interno ao número.").max(60),
  defaultPipelineId: z.uuid("Escolha o funil."),
});

const connectSchema = settingsSchema.extend({
  phoneNumberId: z.string().trim().regex(/^\d{5,25}$/, "Identificação do número inválida (só números)."),
  wabaId: z.string().trim().regex(/^\d{5,25}$/, "Identificação da conta (WABA) inválida (só números)."),
  token: z.string().trim().max(2000),
  // PIN da verificação em duas etapas: só para registrar número real; não é guardado.
  pin: z.string().trim().regex(/^(\d{6})?$/, "O PIN tem 6 números.").default(""),
});

function refresh(slug: string) {
  revalidatePath(`/${slug}/config/canais`);
}

type NumberRow = { id: string; phone_number_id: string | null };

async function loadSlot(supabase: Awaited<ReturnType<typeof createClient>>, companyId: string, slot: number) {
  const { data } = await supabase.from("whatsapp_numbers").select("id, phone_number_id").eq("company_id", companyId).eq("slot", slot).maybeSingle<NumberRow>();
  return data;
}

/** Nome interno e funil padrão (para onde vão os leads novos desse número). */
export async function saveNumberSettings(slug: string, input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  const ctx = await adminContext(slug);
  if (!ctx) return NOT_ALLOWED;
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const d = parsed.data;

  const { data, error } = await ctx.supabase
    .from("whatsapp_numbers")
    .update({ label: d.label, default_pipeline_id: d.defaultPipelineId })
    .eq("company_id", ctx.company.id)
    .eq("slot", d.slot)
    .select("id");
  if (error || !data?.length) return { ok: false, error: "Não foi possível salvar." };
  refresh(slug);
  return { ok: true, message: "Número atualizado." };
}

/**
 * Conecta (ou reconecta) o número: confere na Meta se o token acessa o número,
 * guarda o token só no servidor e inscreve o app na conta para receber os webhooks.
 */
export async function connectNumber(slug: string, input: z.input<typeof connectSchema>): Promise<ActionResult> {
  const ctx = await adminContext(slug);
  if (!ctx) return NOT_ALLOWED;
  const parsed = connectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const d = parsed.data;

  const slot = await loadSlot(ctx.supabase, ctx.company.id, d.slot);
  if (!slot) return { ok: false, error: "Vaga de número não encontrada." };

  // Token em branco = manter o que já está guardado (só se for o mesmo número).
  const admin = createAdminClient();
  let token = d.token;
  if (!token) {
    const { data: cred } = await admin.from("whatsapp_credentials").select("access_token").eq("number_id", slot.id).maybeSingle<{ access_token: string }>();
    if (!cred || slot.phone_number_id !== d.phoneNumberId) return { ok: false, error: "Cole o token de acesso do número." };
    token = cred.access_token;
  }

  let info;
  try {
    info = await fetchPhoneNumber(d.phoneNumberId, token);
  } catch (e) {
    const msg = e instanceof GraphError ? e.message : "sem resposta";
    return { ok: false, error: `A Meta recusou os dados: ${msg}. Confira a identificação do número e o token.` };
  }

  // Número real: registra na API oficial com o PIN (o número de teste da Meta dispensa).
  if (d.pin) {
    try {
      await registerNumber(d.phoneNumberId, token, d.pin);
    } catch (e) {
      const msg = e instanceof GraphError ? e.message : "sem resposta";
      return {
        ok: false,
        error: `A Meta não registrou o número: ${msg}. Se o número já tinha um PIN, use o mesmo; para trocar, use o Gerenciador do WhatsApp.`,
      };
    }
  }

  const saved = await saveConnection(ctx, slot.id, { ...d, coexistence: false }, token, info);
  if (!saved.ok) return saved;

  refresh(slug);
  const name = info.verified_name ? ` (${info.verified_name})` : "";
  return {
    ok: true,
    message: saved.subscribed
      ? `Número ${info.display_phone_number ?? ""}${name} ${d.pin ? "registrado e conectado" : "conectado"}.`
      : `Número conectado, mas a inscrição do app na conta falhou. Confira a permissão do token (whatsapp_business_management).`,
  };
}

type AdminCtx = NonNullable<Awaited<ReturnType<typeof adminContext>>>;

/** Inscreve o app na conta (webhooks), grava o número na vaga e guarda o token só no servidor. */
async function saveConnection(
  ctx: AdminCtx,
  slotId: string,
  d: { label: string; defaultPipelineId: string; phoneNumberId: string; wabaId: string; coexistence: boolean },
  token: string,
  info: PhoneNumberInfo,
): Promise<{ ok: true; subscribed: boolean } | { ok: false; error: string }> {
  let subscribed = true;
  try {
    await subscribeApp(d.wabaId, token);
  } catch {
    subscribed = false;
  }

  const { error } = await ctx.supabase
    .from("whatsapp_numbers")
    .update({
      label: d.label,
      default_pipeline_id: d.defaultPipelineId,
      phone_number_id: d.phoneNumberId,
      waba_id: d.wabaId,
      display_phone: info.display_phone_number ?? null,
      quality_rating: info.quality_rating ?? null,
      status: "connected",
      connected_at: new Date().toISOString(),
      coexistence: d.coexistence,
    })
    .eq("id", slotId);
  if (error) {
    return {
      ok: false,
      error:
        error.code === "23505"
          ? "Este número já está cadastrado em outra vaga ou empresa."
          : error.code === "42703"
            ? "Rode a migration 0016 no Supabase e tente de novo."
            : "Não foi possível salvar o número.",
    };
  }

  const { error: credError } = await createAdminClient()
    .from("whatsapp_credentials")
    .upsert({ number_id: slotId, access_token: token, updated_at: new Date().toISOString() }, { onConflict: "number_id" });
  if (credError) return { ok: false, error: "Número salvo, mas o token não foi guardado. Tente de novo." };
  return { ok: true, subscribed };
}

const signupSchema = settingsSchema.extend({
  code: z.string().trim().min(10).max(2000),
  wabaId: z.string().trim().regex(/^\d{5,25}$/, "A Meta não devolveu a conta do WhatsApp."),
  phoneNumberId: z.string().trim().regex(/^(\d{5,25})?$/).default(""),
  // FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING = número que já está no app (coexistência)
  coexistence: z.boolean(),
  pin: z.string().trim().regex(/^(\d{6})?$/, "O PIN tem 6 números.").default(""),
});

/**
 * Cadastro integrado da Meta: troca o código pelo token da empresa, conecta o número e,
 * na coexistência, pede a sincronização de contatos e histórico do app (prazo da Meta: 24 h).
 */
export async function connectWithMeta(slug: string, input: z.input<typeof signupSchema>): Promise<ActionResult> {
  const ctx = await adminContext(slug);
  if (!ctx) return NOT_ALLOWED;
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const d = parsed.data;

  const slot = await loadSlot(ctx.supabase, ctx.company.id, d.slot);
  if (!slot) return { ok: false, error: "Vaga de número não encontrada." };

  let token: string;
  let phoneNumberId = d.phoneNumberId;
  let info: PhoneNumberInfo;
  try {
    token = await exchangeSignupCode(d.code);
    if (!phoneNumberId) phoneNumberId = (await findWabaPhone(d.wabaId, token)) ?? "";
    if (!phoneNumberId) return { ok: false, error: "A Meta não informou o número escolhido. Tente conectar de novo." };
    info = await fetchPhoneNumber(phoneNumberId, token);
  } catch (e) {
    return { ok: false, error: `A Meta recusou a conexão: ${e instanceof GraphError ? e.message : "sem resposta"}.` };
  }

  // Número novo (fora do app): precisa ser registrado na API com um PIN. Na coexistência, já está registrado.
  let registerNote = "";
  if (!d.coexistence) {
    if (d.pin) {
      try {
        await registerNumber(phoneNumberId, token, d.pin);
      } catch (e) {
        registerNote = ` A Meta não registrou o número (${e instanceof GraphError ? e.message : "sem resposta"}): use “Reconectar” com o PIN.`;
      }
    } else {
      registerNote = " Falta registrar o número: use “Reconectar”, deixe o token em branco e informe um PIN de 6 dígitos.";
    }
  }

  const saved = await saveConnection(ctx, slot.id, { ...d, phoneNumberId, coexistence: d.coexistence }, token, info);
  if (!saved.ok) return saved;

  let syncNote = "";
  if (d.coexistence) {
    const failures = await requestAppSync(phoneNumberId, token);
    await createAdminClient().from("whatsapp_numbers").update({ sync_requested_at: new Date().toISOString() }).eq("id", slot.id);
    syncNote = failures.length
      ? ` A sincronização não começou (${failures.join("; ")}).`
      : " Contatos e histórico do celular estão chegando; deixe o WhatsApp Business aberto no celular por alguns minutos.";
  }

  refresh(slug);
  const phone = info.display_phone_number ?? "";
  return {
    ok: true,
    message:
      `${phone} conectado${d.coexistence ? " (continua funcionando no celular)" : ""}.` +
      (saved.subscribed ? "" : " A inscrição do app na conta falhou: reconecte.") +
      registerNote +
      syncNote,
  };
}

/** Desconecta: o Orvya para de receber e enviar por esse número; o histórico continua. */
export async function disconnectNumber(slug: string, slot: 1 | 2): Promise<ActionResult> {
  const ctx = await adminContext(slug);
  if (!ctx) return NOT_ALLOWED;
  const row = await loadSlot(ctx.supabase, ctx.company.id, slot);
  if (!row) return { ok: false, error: "Vaga de número não encontrada." };

  const { error } = await ctx.supabase
    .from("whatsapp_numbers")
    .update({ phone_number_id: null, waba_id: null, status: "off", connected_at: null, quality_rating: null })
    .eq("id", row.id);
  if (error) return { ok: false, error: "Não foi possível desconectar." };
  await createAdminClient().from("whatsapp_credentials").delete().eq("number_id", row.id);

  refresh(slug);
  return { ok: true, message: "Número desconectado. As conversas continuam no Orvya." };
}
