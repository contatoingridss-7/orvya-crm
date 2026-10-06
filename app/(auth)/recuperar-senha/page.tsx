import type { Metadata } from "next";
import { ResetRequestForm } from "./reset-request-form";

export const metadata: Metadata = { title: "Recuperar senha" };

export default function RecuperarSenhaPage() {
  return (
    <>
      <div>
        <h1 className="text-[22px] font-bold tracking-[-0.03em]">Esqueci minha senha</h1>
        <p className="mt-1 text-[13px] text-muted">Informe seu e-mail e enviaremos um link para criar uma nova senha.</p>
      </div>
      <ResetRequestForm />
    </>
  );
}
