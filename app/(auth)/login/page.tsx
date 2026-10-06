import type { Metadata } from "next";
import { Notice } from "@/components/ui/notice";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

const ERRORS: Record<string, string> = {
  desativado: "Seu acesso foi desativado. Fale com o administrador.",
  link: "O link expirou ou já foi usado. Peça um novo.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string; next?: string }> }) {
  const { erro, next } = await searchParams;
  const message = erro ? ERRORS[erro] : undefined;

  return (
    <>
      <div>
        <h1 className="text-[22px] font-bold tracking-[-0.03em]">Entrar</h1>
        <p className="mt-1 text-[13px] text-muted">Use o e-mail e a senha do seu convite.</p>
      </div>
      {message && <Notice tone="bad">{message}</Notice>}
      <LoginForm next={next} />
    </>
  );
}
