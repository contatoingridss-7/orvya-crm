"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import { generateReport } from "./actions";

export type ReportListItem = { id: string; kind: "diario" | "semanal"; period: string; status: "rascunho" | "liberado"; alerts: number };

/** Relatórios para o cliente: a rotina da manhã cria os rascunhos; aqui também dá para gerar na hora. */
export function ReportsPanel({ slug, reports }: { slug: string; reports: ReportListItem[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  function generate(kind: "diario" | "semanal") {
    start(async () => {
      const r = await generateReport(slug, kind);
      if (!r.ok) return toast(r.error, "bad");
      router.push(`/${slug}/trafego/relatorios/${r.id}`);
    });
  }

  return (
    <Panel
      title="Relatórios para o cliente"
      subtitle="Todo dia às 6h sai o rascunho de ontem; na segunda, também o da semana. Você revisa, escreve suas observações e libera o link."
      actions={
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="soft" disabled={pending} onClick={() => generate("diario")}>
            Gerar de ontem
          </Button>
          <Button size="sm" variant="soft" disabled={pending} onClick={() => generate("semanal")}>
            Gerar da semana passada
          </Button>
        </div>
      }
    >
      {reports.length === 0 ? (
        <div className="empty">Nenhum relatório ainda. O primeiro rascunho sai amanhã às 6h, ou gere agora.</div>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {reports.map((r) => (
            <li key={r.id}>
              <Link href={`/${slug}/trafego/relatorios/${r.id}`} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 no-underline hover:bg-tint">
                <span className="min-w-0 flex-1">
                  <b className="block font-semibold text-title">{r.kind === "diario" ? "Resumo do dia" : "Relatório da semana"}</b>
                  <small className="text-xs text-muted">
                    {r.period}
                    {r.alerts > 0 && ` · ${r.alerts} ${r.alerts === 1 ? "observação" : "observações"} para o cliente`}
                  </small>
                </span>
                <Pill tone={r.status === "liberado" ? "ok" : "warn"}>{r.status === "liberado" ? "Liberado" : "Rascunho"}</Pill>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
