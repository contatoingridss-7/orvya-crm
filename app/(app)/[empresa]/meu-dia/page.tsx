import type { Metadata } from "next";
import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";
import { ComingSoon } from "@/components/app-shell/coming-soon";
import { PageHeader } from "@/components/app-shell/page-header";
import { requireRole } from "@/lib/auth/viewer";
import { TIMEZONE } from "@/lib/format";
import { firstName } from "@/lib/names";

export const metadata: Metadata = { title: "Meu dia" };

function greeting(now: Date): string {
  const hour = Number(formatInTimeZone(now, TIMEZONE, "H"));
  return hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
}

export default async function MeuDiaPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { viewer, company } = await requireRole((await params).empresa, ["vendedor"]);
  const now = new Date();
  const date = formatInTimeZone(now, TIMEZONE, "EEEE, d 'de' MMMM", { locale: ptBR });

  return (
    <>
      <PageHeader title={`${greeting(now)}, ${firstName(viewer.fullName)}`} subtitle={`${company.name}: ${date}`} />
      <div className="content">
        <ComingSoon phase="Fase 2">
          Suas conversas esperando resposta, a fila sem responsável, tarefas de hoje e leads parados aparecem aqui.
        </ComingSoon>
      </div>
    </>
  );
}
