"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { safeNext } from "@/lib/auth/safe-next";
import { WALLPAPERS } from "@/lib/wallpapers";

export type FormState = { error?: string; success?: string } | undefined;

const loginSchema = z.object({
  email: z.email("Informe um e-mail válido"),
  password: z.string().min(1, "Informe a senha"),
  next: z.string().optional(),
});

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email.trim().toLowerCase(),
    password: parsed.data.password,
  });

  if (error || !data.user) {
    if (error?.code === "email_not_confirmed") return { error: "Confirme seu e-mail pelo link que enviamos antes de entrar." };
    return { error: "E-mail ou senha incorretos." };
  }

  const { data: profile } = await supabase.from("profiles").select("active").eq("id", data.user.id).maybeSingle<{ active: boolean }>();
  if (!profile?.active) {
    await supabase.auth.signOut();
    return { error: "Seu acesso está desativado. Fale com o administrador." };
  }

  redirect(safeNext(parsed.data.next));
}

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = z.email().safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) return { error: "Informe um e-mail válido." };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/auth/callback?next=/redefinir-senha`,
  });

  if (error?.status === 429) return { error: "Muitas tentativas. Aguarde alguns minutos e tente de novo." };
  // Mesma resposta exista ou não a conta: não revelar quem tem cadastro.
  return { success: "Se houver uma conta com esse e-mail, você vai receber um link para criar uma nova senha." };
}

/** Salva o tema escolhido no perfil (o usuário só pode alterar o próprio nome e tema). */
export async function saveTheme(theme: "light" | "dark") {
  if (theme !== "light" && theme !== "dark") return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("profiles").update({ theme }).eq("id", user.id);
}

/** Foto do perfil: o arquivo já subiu para avatars/{id do usuário}/...; aqui grava o caminho (null remove). */
export async function saveAvatar(path: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Entre de novo no Orvya." };
  if (path !== null && !new RegExp(`^${user.id}/[0-9a-f-]{36}\\.jpg$`).test(path)) return { ok: false, error: "Arquivo inválido." };
  const { data: old } = await supabase.from("profiles").select("avatar_path").eq("id", user.id).maybeSingle<{ avatar_path: string | null }>();
  const { error } = await supabase.from("profiles").update({ avatar_path: path }).eq("id", user.id);
  if (error) return { ok: false, error: "Não foi possível salvar a foto. A migration 0031 já foi rodada?" };
  if (old?.avatar_path && old.avatar_path !== path) await supabase.storage.from("avatars").remove([old.avatar_path]);
  return { ok: true };
}

/** Papel de parede das conversas (null = sem papel de parede). */
export async function saveWallpaper(value: string | null): Promise<void> {
  if (value !== null && !(WALLPAPERS as readonly string[]).includes(value)) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("profiles").update({ chat_wallpaper: value }).eq("id", user.id);
}
