import type { Metadata } from "next";
import { NewPasswordForm } from "./new-password-form";

export const metadata: Metadata = { title: "Criar senha" };

export default function RedefinirSenhaPage() {
  return <NewPasswordForm />;
}
