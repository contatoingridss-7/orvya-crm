"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/lib/auth/viewer";
import { publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

const NOT_ALLOWED: ActionResult = { ok: false, error: "Só o administrador pode alterar a equipe." };

/** Só administrador ativo mexe na equipe (SPEC 1, matriz). */
async function requireAdmin() {
  const viewer = await getViewer();
  return viewer?.active && viewer.isAdmin ? viewer : null;
}

function refresh() {
  revalidatePath("/[empresa]/config/equipe", "page");
}

const inviteSchema = z
  .object({
    fullName: z.string().trim().min(2, "Informe o nome."),
    email: z.string().trim().toLowerCase().pipe(z.email("Informe um e-mail válido.")),
    companyId: z.uuid("Escolha a empresa."),
    role: z.enum(["gestor", "vendedor"]),
    method: z.enum(["convite", "senha"]),
    password: z.string().optional(),
  })
  .refine((d) => d.method === "convite" || (d.password?.length ?? 0) >= 8, {
    message: "A senha provisória precisa ter pelo menos 8 caracteres.",
  });

export type InviteInput = z.input<typeof inviteSchema>;

export async function inviteMember(input: InviteInput): Promise<ActionResult> {
  if (!(await requireAdmin())) return NOT_ALLOWED;

  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const { fullName, email, companyId, role, method, password } = parsed.data;

  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: company } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle<{ name: string }>();
  if (!company) return { ok: false, error: "Empresa não encontrada." };

  // Pessoa que já tem conta (ex.: vendedor que passa a atender a outra empresa): só cria o vínculo.
  const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle<{ id: string }>();
  let userId = existing?.id;
  let message: string;

  if (userId) {
    message = `${fullName} já tinha conta e agora também acessa a ${company.name}.`;
  } else if (method === "convite") {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/redefinir-senha?convite=1`,
    });
    if (error || !data.user) return { ok: false, error: inviteErrorMessage(error) };
    userId = data.user.id;
    message = `Convite enviado para ${email}.`;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error || !data.user) return { ok: false, error: `Não foi possível criar o usuário: ${error?.message ?? "erro desconhecido"}` };
    userId = data.user.id;
    message = `${fullName} criado. Passe o e-mail e a senha provisória para a pessoa.`;
  }

  // Vínculo pelo cliente do próprio admin: o RLS confere a permissão de novo.
  const { error: linkError } = await supabase
    .from("memberships")
    .upsert({ user_id: userId, company_id: companyId, role }, { onConflict: "user_id,company_id" });
  if (linkError) return { ok: false, error: `Usuário criado, mas não foi possível ligar à empresa: ${linkError.message}` };

  refresh();
  return { ok: true, message };
}

function inviteErrorMessage(error: { status?: number; code?: string; message: string } | null): string {
  if (!error) return "Não foi possível enviar o convite.";
  if (error.status === 429 || error.code === "over_email_send_rate_limit") {
    return "Limite de e-mails do Supabase atingido. Use a opção de senha provisória ou configure um servidor de e-mail.";
  }
  return `Não foi possível enviar o convite: ${error.message}`;
}

const roleSchema = z.object({ userId: z.uuid(), companyId: z.uuid(), role: z.enum(["gestor", "vendedor"]) });

export async function changeRole(input: z.input<typeof roleSchema>): Promise<ActionResult> {
  if (!(await requireAdmin())) return NOT_ALLOWED;
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("memberships")
    .update({ role: parsed.data.role }, { count: "exact" })
    .eq("user_id", parsed.data.userId)
    .eq("company_id", parsed.data.companyId);
  if (error || !count) return { ok: false, error: "Não foi possível mudar o perfil." };

  refresh();
  return { ok: true, message: `Perfil alterado para ${parsed.data.role === "gestor" ? "Gestor" : "Vendedor"}.` };
}

const activeSchema = z.object({ userId: z.uuid(), active: z.boolean() });

/**
 * Desativa ou reativa. Desativar corta o acesso aos dados na hora (o RLS confere `active`)
 * e bloqueia novos logins no Supabase Auth.
 */
export async function setMemberActive(input: z.input<typeof activeSchema>): Promise<ActionResult> {
  const viewer = await requireAdmin();
  if (!viewer) return NOT_ALLOWED;
  const parsed = activeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };
  const { userId, active } = parsed.data;
  if (userId === viewer.id) return { ok: false, error: "Você não pode desativar a própria conta." };

  // `active` não é editável pelo usuário (só nome e tema): vai pelo service_role.
  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ active }).eq("id", userId);
  if (error) return { ok: false, error: "Não foi possível alterar o acesso." };

  const { error: authError } = await admin.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
  if (authError) return { ok: false, error: `Acesso aos dados ${active ? "liberado" : "cortado"}, mas o login não foi atualizado: ${authError.message}` };

  refresh();
  return { ok: true, message: active ? "Acesso reativado." : "Acesso desativado." };
}
