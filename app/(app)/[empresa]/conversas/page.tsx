import type { Metadata } from "next";
import { ComingSoon } from "@/components/app-shell/coming-soon";
import { PageHeader } from "@/components/app-shell/page-header";
import { requireCompany } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Conversas" };

export default async function ConversasPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { company } = await requireCompany((await params).empresa);
  return (
    <>
      <PageHeader title="Conversas" subtitle={`${company.name}: WhatsApp, Instagram e Messenger em um só lugar`} />
      <div className="content">
        <ComingSoon phase="Fase 3">Caixa de conversas do WhatsApp ao vivo, com janela de 24 h e modelos de mensagem.</ComingSoon>
      </div>
    </>
  );
}
