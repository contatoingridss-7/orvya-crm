"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { requestPasswordReset } from "@/lib/auth/actions";

export function ResetRequestForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);

  return (
    <form action={action} className="grid gap-3">
      <TextField label="E-mail" name="email" type="email" autoComplete="email" required autoFocus />
      {state?.error && <Notice tone="bad">{state.error}</Notice>}
      {state?.success && <Notice tone="ok">{state.success}</Notice>}
      <Button type="submit" variant="primary" loading={pending} className="mt-1 w-full">
        Enviar link
      </Button>
      <Link href="/login" className="justify-self-center text-[13px] font-semibold text-tint-ink hover:underline">
        Voltar para o login
      </Link>
    </form>
  );
}
