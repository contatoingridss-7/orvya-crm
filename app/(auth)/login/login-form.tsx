"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { signIn } from "@/lib/auth/actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signIn, undefined);

  return (
    <form action={action} className="grid gap-3">
      {next && <input type="hidden" name="next" value={next} />}
      <TextField label="E-mail" name="email" type="email" autoComplete="email" required autoFocus />
      <TextField label="Senha" name="password" type="password" autoComplete="current-password" required />
      {state?.error && <Notice tone="bad">{state.error}</Notice>}
      <Button type="submit" variant="primary" loading={pending} className="mt-1 w-full">
        Entrar
      </Button>
      <Link href="/recuperar-senha" className="justify-self-center text-[13px] font-semibold text-tint-ink hover:underline">
        Esqueci minha senha
      </Link>
    </form>
  );
}
