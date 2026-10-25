"use client";

import { DailyBars, DailyLine } from "@/components/daily-bars";
import { PlatformLogo, PLATFORM_NAME } from "@/components/platform-logo";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import type { TrafficData } from "@/lib/ads/report";
import { formatBRL, formatBRLShort } from "@/lib/format";

const int = new Intl.NumberFormat("pt-BR");
const brl = (v: number | null) => (v === null ? "—" : formatBRL(v));
const pct = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);
const roasText = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}x`);

export function TrafficDashboard({ data, companyName, showCompany }: { data: TrafficData; companyName: Record<string, string>; showCompany: boolean }) {
  const t = data.totals;
  const alerts = data.health.flatMap((h) => h.alerts.map((a) => ({ ...a, account: h })));
  const hasData = data.campaigns.length > 0 || t.leads > 0;

  return (
    <>
      {alerts.length > 0 && (
        <div className="grid gap-2">
          {alerts.map((a, i) => (
            <div key={i} className={`notice ${a.level === "bad" ? "bad" : "warn"}`}>
              <PlatformLogo platform={a.account.platform} />
              <div className="min-w-0 flex-1">
                <b>{a.account.name}</b>
                {showCompany && <span className="text-muted"> · {a.account.companyName}</span>}
                <span className="block text-[13px]">{a.text}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {data.health.length === 0 ? (
        <Panel title="Nenhuma conta de anúncios conectada" subtitle="Conecte a conta da Meta ou do Google Ads desta empresa logo abaixo, em Contas de anúncio.">
          <p className="m-0 text-[13px] text-muted">
            Depois de conectar, o Orvya puxa o investimento dos últimos 90 dias e passa a atualizar sozinho duas vezes por dia.
          </p>
        </Panel>
      ) : (
        <>
          <div className="kpis">
            <Kpi label="Investimento" value={brl(t.spend)} sub={`${int.format(t.impressions)} impressões`} highlight />
            <Kpi label="Leads dos anúncios" value={int.format(t.leads)} sub={`Chegaram no Orvya · nas plataformas: ${int.format(t.conversations + t.metaLeads)}`} />
            <Kpi label="Custo por lead (real)" value={brl(t.cpl)} sub="Investimento ÷ leads no Orvya" />
            <Kpi label="Vendas" value={int.format(t.sales)} sub={`Custo por venda: ${brl(t.costPerSale)}`} />
            <Kpi label="Retorno (ROAS)" value={roasText(t.roas)} sub={`Faturamento: ${brl(t.revenue)}`} />
          </div>
          <div className="kpis">
            <Kpi label="Cliques" value={int.format(t.clicks)} sub={`CPC ${brl(t.cpc)}`} />
            <Kpi label="Taxa de cliques (CTR)" value={pct(t.ctr)} sub="Cliques ÷ impressões" />
            <Kpi label="Conversas iniciadas" value={int.format(t.conversations)} sub="Contadas pela Meta" />
            <Kpi label="Formulários e conversões" value={int.format(t.metaLeads)} sub="Formulários da Meta e conversões do Google" />
            <Kpi label="Leads sem campanha" value={int.format(data.unattributed)} sub="Do anúncio, sem campanha identificada" />
          </div>

          <Panel title="Dia a dia" subtitle="Investimento e leads separados, alinhados pela data. Passe o mouse para ver cada dia.">
            {hasData ? (
              <div className="grid gap-5">
                <DailyBars
                  title="Investimento por dia"
                  points={data.series.map((p) => ({ date: p.date, value: p.spend }))}
                  format={(v) => formatBRL(v)}
                  label={(v) => formatBRLShort(v)}
                />
                <DailyBars title="Leads por dia (chegaram no Orvya)" points={data.series.map((p) => ({ date: p.date, value: p.leads }))} format={(v) => int.format(v)} tone="navy" />
                <DailyLine title="Cliques por dia" points={data.series.map((p) => ({ date: p.date, value: p.clicks }))} format={(v) => int.format(v)} unit="cliques" />
              </div>
            ) : (
              <div className="empty">Sem investimento nem leads de anúncio neste período.</div>
            )}
          </Panel>

          <Panel title="Campanhas" subtitle="Ordenadas por investimento. Leads e vendas são os que o Orvya ligou à campanha pelo anúncio de origem.">
            {data.campaigns.length === 0 ? (
              <div className="empty">Nenhuma campanha com veiculação neste período.</div>
            ) : (
              <div className="scroll-x">
                <table className="min-w-[980px]">
                  <thead>
                    <tr>
                      <th>Campanha</th>
                      <th className="text-right">Investimento</th>
                      <th className="text-right">Impressões</th>
                      <th className="text-right">Cliques</th>
                      <th className="text-right">CTR</th>
                      <th className="text-right">Leads na plataforma</th>
                      <th className="text-right">Leads (Orvya)</th>
                      <th className="text-right">CPL real</th>
                      <th className="text-right">Vendas</th>
                      <th className="text-right">Custo/venda</th>
                      <th className="text-right">ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.campaigns.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <span className="flex items-center gap-2">
                            <PlatformLogo platform={c.platform} />
                            <span className="min-w-0">
                              <b className="block font-semibold text-title">{c.name}</b>
                              <small className="text-xs text-muted">
                                {PLATFORM_NAME[c.platform]}
                                {showCompany && ` · ${companyName[c.companyId] ?? ""}`}
                              </small>
                            </span>
                          </span>
                        </td>
                        <td className="text-right tabular-nums">{formatBRL(c.spend)}</td>
                        <td className="text-right tabular-nums">{int.format(c.impressions)}</td>
                        <td className="text-right tabular-nums">{int.format(c.clicks)}</td>
                        <td className="text-right tabular-nums">{pct(c.ctr)}</td>
                        <td className="text-right tabular-nums">{int.format(c.conversations + c.metaLeads)}</td>
                        <td className="text-right tabular-nums">{int.format(c.leads)}</td>
                        <td className="text-right tabular-nums">{brl(c.cpl)}</td>
                        <td className="text-right tabular-nums">{int.format(c.sales)}</td>
                        <td className="text-right tabular-nums">{brl(c.costPerSale)}</td>
                        <td className="text-right tabular-nums">{c.roas === null ? "—" : <Pill tone={c.roas >= 1 ? "ok" : "warn"}>{roasText(c.roas)}</Pill>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}

function Kpi({ label, value, sub, highlight }: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div className={`kpi ${highlight ? "hl" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{sub}</em>
    </div>
  );
}
