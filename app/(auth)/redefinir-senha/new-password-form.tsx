"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { createClient } from "@/lib/supabase/client";

type Status = "checking" | "ready" | "invalid";

/**
 * Serve para o convite (primeira senha) e para a recuperação.
 * - Recuperação: /auth/callback já criou a sessão antes de chegar aqui.
 * - Convite: o Supabase manda os tokens no fragmento da URL (#access_token=...), tratado aqui.
 */
export function NewPasswordForm() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("checking");
  const [isInvite, setIsInvite] = useState(false);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    const invite = hash.get("type") === "invite" || new URLSearchParams(window.location.search).has("convite");
    setIsInvite(invite);

    // Tira os tokens da barra de endereço.
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);

    if (hash.get("error")) {
      setStatus("invalid");
      return;
    }

    const session =
      accessToken && refreshToken
        ? supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then((r) => r.data.user)
        : supabase.auth.getUser().then((r) => r.data.user);

    session.then((user) => setStatus(user ? "ready" : "invalid")).catch(() => setStatus("invalid"));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirm = String(data.get("confirm") ?? "");

    if (password.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres.");
    if (password !== confirm) return setError("As senhas não são iguais.");

    setSaving(true);
    setError(undefined);
    const { error: updateError } = await createClient().auth.updateUser({ password });
    setSaving(false);

    if (updateError) {
      setError(
        updateError.code === "same_password"
          ? "A nova senha precisa ser diferente da anterior."
          : updateError.code === "weak_password"
            ? "Senha fraca. Use letras e números, com pelo menos 8 caracteres."
            : "Não foi possível salvar a senha. Tente de novo.",
      );
      return;
    }
    router.replace("/");
    router.refresh();
  }

  const title = isInvite ? "Crie sua senha" : "Nova senha";

  if (status === "checking") {
    return (
      <div className="flex items-center gap-3 text-muted">
        <span className="spinner" aria-hidden /> Conferindo o link…
      </div>
    );
  }

  if (status === "invalid") {
    return (
      <>
        <h1 className="text-[22px] font-bold tracking-[-0.03em]">Link inválido</h1>
        <Notice tone="bad">Este link expirou ou já foi usado.</Notice>
        <Link href="/recuperar-senha" className="btn primary w-full">
          Pedir um novo link
        </Link>
      </>
    );
  }

  return (
    <>
      <div>
        <h1 className="text-[22px] font-bold tracking-[-0.03em]">{title}</h1>
        <p className="mt-1 text-[13px] text-muted">Use pelo menos 8 caracteres.</p>
      </div>
      <form onSubmit={onSubmit} className="grid gap-3">
        <TextField label="Nova senha" name="password" type="password" autoComplete="new-password" required minLength={8} autoFocus />
        <TextField label="Repita a senha" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
        {error && <Notice tone="bad">{error}</Notice>}
        <Button type="submit" variant="primary" loading={saving} className="mt-1 w-full">
          Salvar senha e entrar
        </Button>
      </form>
    </>
  );
}
