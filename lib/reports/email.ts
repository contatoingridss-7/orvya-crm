import { formatDate, formatDateTime } from "@/lib/format";
import type { TaskReport } from "./tasks";

// E-mail do relatório de sábado. Só números agregados por pessoa: nomes de pacientes e
// títulos de tarefa (ex.: follow-up de CPAP) ficam no Orvya, por serem dados de saúde (LGPD).

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderTaskReportEmail(opts: { companyName: string; report: TaskReport; link: string; deliveries: number }) {
  const { companyName, report: r, link, deliveries } = opts;
  const range = `${formatDate(r.period.start)} a ${formatDate(r.period.end)}`;
  const subject = `Orvya · ${companyName}: relatório de tarefas (${range})`;

  const kpi = (label: string, value: string, sub: string, color = "#16161D") =>
    `<td style="padding:12px 14px;border:1px solid #E7E7EE;border-radius:12px;background:#fff;vertical-align:top">
      <div style="font-size:12px;color:#6E6E7C">${label}</div>
      <div style="font-size:24px;font-weight:700;color:${color};margin-top:2px">${value}</div>
      <div style="font-size:12px;color:#6E6E7C">${sub}</div>
    </td>`;

  const rows = r.byPerson
    .map(
      (p) => `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #E7E7EE">${esc(p.name)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #E7E7EE;text-align:right">${p.done}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #E7E7EE;text-align:right">${p.done ? Math.round((p.onTime / p.done) * 100) : 0}%</td>
        <td style="padding:8px 10px;border-bottom:1px solid #E7E7EE;text-align:right;color:${p.overdueOpen ? "#B91C1C" : "#16161D"}">${p.overdueOpen}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #E7E7EE;text-align:right">${p.open}</td>
      </tr>`,
    )
    .join("");

  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F4F4F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;color:#16161D">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
    <div style="font-size:13px;color:#6E6E7C">VÉR7ICE Orvya · Conexões inteligentes. Resultados integrados.</div>
    <h1 style="font-size:20px;margin:8px 0 2px">Relatório de tarefas · ${esc(companyName)}</h1>
    <div style="font-size:13px;color:#6E6E7C;margin-bottom:16px">${r.period.label} (${range})</div>
    <table role="presentation" cellspacing="8" style="width:100%;border-collapse:separate;margin:0 -8px">
      <tr>
        ${kpi("Concluídas", String(r.done), r.onTimeRate === null ? "nenhuma no período" : `${r.onTimeRate}% no prazo`)}
        ${kpi("Atrasadas agora", String(r.overdueOpen), "em aberto, prazo vencido", r.overdueOpen ? "#B91C1C" : "#16161D")}
      </tr>
      <tr>
        ${kpi("Criadas", String(r.created), `${r.byOrigin.automation} por automação`)}
        ${kpi("Entregas concluídas", String(deliveries), `${r.nextSevenDays} tarefa(s) nos próximos 7 dias`)}
      </tr>
    </table>
    <h2 style="font-size:15px;margin:20px 0 8px">Por pessoa</h2>
    ${
      r.byPerson.length
        ? `<table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #E7E7EE;border-radius:12px;font-size:13px">
      <tr style="color:#6E6E7C;font-size:12px;text-align:right"><th style="padding:8px 10px;text-align:left">Pessoa</th><th style="padding:8px 10px">Concluídas</th><th style="padding:8px 10px">No prazo</th><th style="padding:8px 10px">Atrasadas</th><th style="padding:8px 10px">Em aberto</th></tr>
      ${rows}
    </table>`
        : `<p style="font-size:13px;color:#6E6E7C">Nenhuma tarefa no período.</p>`
    }
    <p style="margin:22px 0"><a href="${esc(link)}" style="display:inline-block;background:#7C5CFF;color:#fff;text-decoration:none;font-weight:600;padding:10px 16px;border-radius:12px">Ver detalhes no Orvya</a></p>
    <p style="font-size:12px;color:#6E6E7C">Gerado em ${formatDateTime(r.generatedAt)}. Os nomes dos clientes ficam no sistema, por segurança. Você recebe este e-mail por ser gestor ou administrador.</p>
  </div></body></html>`;

  const text = [
    `Relatório de tarefas · ${companyName} · ${range}`,
    `Concluídas: ${r.done}${r.onTimeRate === null ? "" : ` (${r.onTimeRate}% no prazo)`}`,
    `Atrasadas agora: ${r.overdueOpen}`,
    `Criadas: ${r.created} (${r.byOrigin.automation} por automação)`,
    `Entregas concluídas: ${deliveries}`,
    "",
    ...r.byPerson.map((p) => `${p.name}: ${p.done} concluídas, ${p.overdueOpen} atrasadas, ${p.open} em aberto`),
    "",
    `Detalhes: ${link}`,
  ].join("\n");

  return { subject, html, text };
}
