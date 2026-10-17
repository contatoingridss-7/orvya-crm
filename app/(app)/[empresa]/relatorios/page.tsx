import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app-shell/page-header";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { requireRole } from "@/lib/auth/viewer";
import { dueLabel } from "@/lib/crm/tasks";
import { formatDate, formatDateTime } from "@/lib/format";
import { buildTaskReport, loadReportTasks, REPORT_PERIODS, resolveReportPeriod } from "@/lib/reports/tasks";
import { createClient } from "@/lib/supabase/server";
import { ReportActions } from "./report-actions";

export const metadata: Metadata = { title: "Relatórios" };

export default async function RelatoriosPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>;
  searchParams: Promise<{ periodo?: string }>;
}) {
  const { company } = await requireRole((await params).empresa, ["admin", "gestor"]);
  const period = resolveReportPeriod((await searchParams).periodo);
  const supabase = await createClient();
  const start = period.start.toISOString();
  const end = period.end.toISOString();

  const [{ tasks, error }, deliveredRes, scheduledRes] = await Promise.all([
    loadReportTasks(supabase, company.id, period),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("company_id", company.id).gte("delivered_at", start).lt("delivered_at", end),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("company_id", company.id)
      .not("scheduled_at", "is", null)
      .neq("logistics_status", "entregue")
      .gte("scheduled_at", new Date().toISOString()),
  ]);
  const report = buildTaskReport(tasks, period);
  const maxPerson = Math.max(1, ...report.byPerson.map((p) => p.done + p.open));

  return (
    <>
      <PageHeader
        title="Relatórios"
        subtitle={`${company.name}: visão geral de tarefas e entregas para a gestão`}
        actions={<ReportActions slug={company.slug} />}
      />
      <div className="content grid gap-4">
        <p className="print-only m-0 text-[13px]">
          {company.name} · Relatório de tarefas · {period.label} ({formatDate(period.start)} a {formatDate(period.end)}) · gerado em {formatDateTime(report.generatedAt)}
        </p>

        <nav className="tabs no-print self-start" aria-label="Período">
          {REPORT_PERIODS.map((p) => (
            <Link key={p.key} href={`/${company.slug}/relatorios?periodo=${p.key}`} aria-current={p.key === period.key ? "page" : undefined} >
              {p.label}
            </Link>
          ))}
        </nav>

        {error && <Notice tone="bad">Não foi possível carregar as tarefas. Recarregue a página.</Notice>}

        <div className="kpis">
          <Kpi label="Concluídas no período" value={report.done} sub={report.onTimeRate === null ? "Nenhuma concluída" : `${report.onTimeRate}% no prazo`} />
          <Kpi label="Criadas no período" value={report.created} sub={`${report.byOrigin.automation} por automação · ${report.byOrigin.manual} pela equipe`} />
          <Kpi label="Atrasadas agora" value={report.overdueOpen} sub="Em aberto, com prazo vencido" tone={report.overdueOpen ? "bad" : undefined} />
          <Kpi label="Próximos 7 dias" value={report.nextSevenDays} sub="Tarefas com prazo na semana" />
          <Kpi label="Entregas concluídas" value={deliveredRes.count ?? 0} sub={`${scheduledRes.count ?? 0} agendada(s) daqui para frente`} />
        </div>

        <Panel title="Por pessoa" subtitle="Concluídas no período e situação das tarefas em aberto.">
          {report.byPerson.length === 0 ? (
            <div className="empty">Nenhuma tarefa no período.</div>
          ) : (
            <>
              <div className="legend mb-2">
                <span>
                  <i style={{ background: "var(--won)" }} />
                  Concluídas
                </span>
                <span>
                  <i style={{ background: "var(--lost)" }} />
                  Atrasadas
                </span>
                <span>
                  <i style={{ background: "var(--accent)", opacity: 0.55 }} />
                  Em aberto no prazo
                </span>
              </div>
              {report.byPerson.map((p) => (
                <div key={p.id} className="bar-row">
                  <span className="truncate">{p.name}</span>
                  <span className="bar-track" aria-hidden>
                    <span className="done" style={{ width: `${(p.done / maxPerson) * 100}%` }} />
                    <span className="late" style={{ width: `${(p.overdueOpen / maxPerson) * 100}%` }} />
                    <span className="open" style={{ width: `${((p.open - p.overdueOpen) / maxPerson) * 100}%` }} />
                  </span>
                  <span className="text-right text-xs whitespace-nowrap text-muted tabular-nums">
                    {p.done} concl. ({p.done ? Math.round((p.onTime / p.done) * 100) : 0}% no prazo) · {p.overdueOpen} atras. · {p.open} abertas
                  </span>
                </div>
              ))}
            </>
          )}
        </Panel>

        <Panel title="Atrasadas mais antigas" subtitle="Até 15 tarefas em aberto com prazo vencido.">
          {report.overdueList.length === 0 ? (
            <div className="empty">Nenhuma tarefa atrasada. Equipe em dia.</div>
          ) : (
            <div className="scroll-x">
              <table className="min-w-[620px]">
                <thead>
                  <tr>
                    <th>Tarefa</th>
                    <th>Lead</th>
                    <th>Responsável</th>
                    <th>Prazo</th>
                  </tr>
                </thead>
                <tbody>
                  {report.overdueList.map((t) => (
                    <tr key={t.id}>
                      <td>{t.title}</td>
                      <td className="text-muted">{t.leadName ? `${t.leadName}${t.pipelineName ? ` · ${t.pipelineName}` : ""}` : "—"}</td>
                      <td>{t.ownerName}</td>
                      <td className="whitespace-nowrap text-[var(--bad-fg)]" suppressHydrationWarning>
                        {dueLabel(t.dueAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <p className="m-0 text-xs text-muted">
          Todo sábado às 8h, gestores e administradores recebem por e-mail o resumo dos últimos 7 dias (só números, sem nomes de pacientes).
        </p>
      </div>
    </>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: number; sub: string; tone?: "bad" }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <strong className={tone === "bad" ? "!text-[var(--bad-fg)]" : undefined}>{value}</strong>
      <em>{sub}</em>
    </div>
  );
}
