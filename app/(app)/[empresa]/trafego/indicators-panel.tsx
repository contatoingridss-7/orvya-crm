import { Panel } from "@/components/ui/panel";
import { Pill, type Tone } from "@/components/ui/pill";
import type { Indicators } from "@/lib/ads/indicators";
import type { CreativeVerdict, InsightLevel, Metric } from "@/lib/ads/insights";
import { formatBRL } from "@/lib/format";

const int = new Intl.NumberFormat("pt-BR");
const brl = (v: number | null) => (v === null ? "—" : formatBRL(v));
const pct = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);
const dec = (v: number | null) => (v === null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const roasText = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}x`);

const LEVEL: Record<InsightLevel, { text: string; tone: Tone }> = {
  critico: { text: "Agir agora", tone: "bad" },
  atencao: { text: "Atenção", tone: "warn" },
  info: { text: "Para saber", tone: "neutral" },
  bom: { text: "Bom sinal", tone: "ok" },
};

const VERDICT: Record<CreativeVerdict, { text: string; tone: Tone }> = {
  saturado: { text: "Saturado", tone: "bad" },
  atencao: { text: "Atenção", tone: "warn" },
  saudavel: { text: "Saudável", tone: "ok" },
  "sem-dados": { text: "Pouca entrega", tone: "neutral" },
};

/** "▲ 12%" verde quando melhora, vermelho quando piora (custo subir é piorar). */
function Delta({ metric, better }: { metric: Metric; better: "up" | "down" }) {
  if (metric.change === null) return null;
  const c = metric.change;
  if (Math.abs(c) < 0.03) return <b className="font-semibold text-muted">estável</b>;
  const good = c > 0 === (better === "up");
  return (
    <b className="font-semibold" style={{ color: good ? "var(--ok-fg)" : "var(--bad-fg)" }}>
      {c > 0 ? "▲" : "▼"} {Math.round(Math.abs(c) * 100)}%
    </b>
  );
}

function Kpi({ label, value, metric, better, sub, showDelta }: { label: string; value: string; metric: Metric; better: "up" | "down"; sub: string; showDelta: boolean }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      <em>
        {showDelta && metric.change !== null && (
          <>
            <Delta metric={metric} better={better} /> vs anterior ·{" "}
          </>
        )}
        {sub}
      </em>
    </div>
  );
}

/** Indicadores com leitura automática: alertas, números contra o período anterior e a meta, funil e criativos. */
export function IndicatorsPanel({ data, showDelta, previousText }: { data: Indicators; showDelta: boolean; previousText: string }) {
  const m = data.metrics;
  const g = data.goals;
  const goal = (v: number | null, prefix = "Meta até") => (v === null ? "Sem meta definida" : `${prefix} ${formatBRL(v)}`);
  const top = data.insights.slice(0, 6);
  const rest = data.insights.slice(6);
  const f = data.funnel;
  const steps = [
    { label: "Impressões", value: f.impressions },
    { label: "Cliques no link", value: f.clicks },
    { label: "Conversas iniciadas (Meta)", value: f.conversations },
    { label: "Leads no Orvya", value: f.leads },
    { label: "Respondidos", value: f.answered },
    { label: "Vendas", value: f.sales },
  ];
  const maxStep = Math.max(1, ...steps.map((s) => s.value));

  return (
    <>
      {data.missing && (
        <div className="notice warn">
          <span>
            Os indicadores por criativo dependem da migration <b>0018</b>. Rode no Supabase e clique em <b>Atualizar agora</b> na conta de anúncios.
          </span>
        </div>
      )}

      <Panel
        title="O que olhar agora"
        subtitle={`Leitura automática dos números da Meta e do Orvya${data.goalsSaved ? ", com as suas metas" : ". Defina as metas do cliente abaixo para alertas mais precisos"}.`}
      >
        {data.insights.length === 0 ? (
          <div className="empty">Nada fora do normal neste período.</div>
        ) : (
          <div className="grid gap-2">
            {top.map((i) => (
              <InsightRow key={i.id} level={i.level} title={i.title} detail={i.detail} />
            ))}
            {rest.length > 0 && (
              <details>
                <summary className="cursor-pointer text-[13px] font-semibold text-muted">Mais {rest.length} leitura(s)</summary>
                <div className="mt-2 grid gap-2">
                  {rest.map((i) => (
                    <InsightRow key={i.id} level={i.level} title={i.title} detail={i.detail} />
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </Panel>

      <div className="kpis">
        <Kpi label="Custo por conversa" value={brl(m.costPerConversation.value)} metric={m.costPerConversation} better="down" sub={goal(g.costPerConversationMax)} showDelta={showDelta} />
        <Kpi label="Conversas iniciadas" value={int.format(m.conversations.value ?? 0)} metric={m.conversations} better="up" sub="Contadas pela Meta" showDelta={showDelta} />
        <Kpi label="Custo por lead (real)" value={brl(m.cpl.value)} metric={m.cpl} better="down" sub={goal(g.cplMax)} showDelta={showDelta} />
        <Kpi label="Custo por venda" value={brl(m.costPerSale.value)} metric={m.costPerSale} better="down" sub={goal(g.costPerSaleMax)} showDelta={showDelta} />
        <Kpi
          label="Retorno (ROAS)"
          value={roasText(m.roas.value)}
          metric={m.roas}
          better="up"
          sub={g.roasMin === null ? "Sem mínimo definido" : `Mínimo ${roasText(g.roasMin)}`}
          showDelta={showDelta}
        />
      </div>
      <div className="kpis">
        <Kpi label="Investimento" value={brl(m.spend.value)} metric={m.spend} better="up" sub="No período" showDelta={showDelta} />
        <Kpi label="CTR (cliques no link)" value={pct(m.ctr.value)} metric={m.ctr} better="up" sub={`Mínimo ${pct(g.ctrMin)}`} showDelta={showDelta} />
        <Kpi label="CPM" value={brl(m.cpm.value)} metric={m.cpm} better="down" sub="Custo de mil exibições" showDelta={showDelta} />
        <Kpi
          label="1ª resposta (mediana)"
          value={data.ops.medianFirstResponseMin === null ? "—" : `${Math.max(1, Math.round(data.ops.medianFirstResponseMin))} min`}
          metric={{ value: null, previous: null, change: null }}
          better="down"
          sub="Leads do anúncio, seg a sáb, 7h às 19h"
          showDelta={false}
        />
        <Kpi label="Vendas" value={int.format(m.sales.value ?? 0)} metric={m.sales} better="up" sub={`Faturamento ${brl(m.revenue.value)}`} showDelta={showDelta} />
      </div>
      {showDelta && <p className="m-0 -mt-2 text-[12px] text-muted">Comparação com {previousText}.</p>}

      <Panel title="Funil do anúncio à venda" subtitle="Onde as pessoas ficam pelo caminho. A taxa ao lado é a passagem da etapa anterior para esta.">
        {f.impressions === 0 && f.leads === 0 ? (
          <div className="empty">Sem veiculação neste período.</div>
        ) : (
          <div className="grid gap-2">
            {steps.map((s, idx) => {
              const prevValue = idx > 0 ? steps[idx - 1]!.value : null;
              const rate = prevValue ? (s.value / prevValue) * 100 : null;
              return (
                <div key={s.label} className="grid grid-cols-[minmax(110px,190px)_minmax(0,1fr)_72px_56px] items-center gap-3 text-[13px] max-sm:grid-cols-[96px_minmax(0,1fr)_60px_48px] max-sm:gap-2">
                  <span className="text-muted">{s.label}</span>
                  <span className="relative h-5 overflow-hidden rounded-md" style={{ background: "var(--tint)" }}>
                    <span
                      className="absolute inset-y-0 left-0 rounded-md"
                      style={{ width: `${Math.max(1.5, Math.sqrt(s.value / maxStep) * 100)}%`, background: idx === steps.length - 1 ? "var(--accent)" : "var(--chart-navy)" }}
                    />
                  </span>
                  <b className="text-right font-semibold text-title tabular-nums">{int.format(s.value)}</b>
                  <span className="text-right text-[12px] text-muted tabular-nums">{rate === null ? "" : pct(rate)}</span>
                </div>
              );
            })}
            <p className="m-0 text-[12px] text-muted">Barras em escala de raiz para as etapas pequenas continuarem visíveis.</p>
          </div>
        )}
      </Panel>

      <Panel
        title="Criativos"
        subtitle={`Cada anúncio com sua saúde. Saturado = frequência de 7 dias acima de ${dec(g.frequencyMax)} e CTR caindo. Ordenados por urgência e investimento.`}
      >
        {data.creatives.length === 0 ? (
          <div className="empty">{data.missing ? "Disponível depois da migration 0018 e da próxima atualização." : "Nenhum anúncio com veiculação neste período."}</div>
        ) : (
          <div className="scroll-x">
            <table className="min-w-[1020px]">
              <thead>
                <tr>
                  <th>Anúncio</th>
                  <th>Saúde</th>
                  <th className="text-right">Frequência 7d</th>
                  <th className="text-right">CTR</th>
                  <th className="text-right">Tendência CTR</th>
                  <th className="text-right">Investimento</th>
                  <th className="text-right">Conversas</th>
                  <th className="text-right">Custo/conversa</th>
                  <th className="text-right">Leads</th>
                  <th className="text-right">Vendas</th>
                </tr>
              </thead>
              <tbody>
                {data.creatives.map((c) => {
                  const trend = c.ctrRecent !== null && c.ctrBefore ? (c.ctrRecent - c.ctrBefore) / c.ctrBefore : null;
                  const freqHigh = c.frequency7 !== null && c.frequency7 >= g.frequencyMax;
                  const costHigh = g.costPerConversationMax !== null && c.costPerConversation !== null && c.costPerConversation > g.costPerConversationMax;
                  return (
                    <tr key={c.adId}>
                      <td>
                        <span className="flex items-center gap-2.5">
                          {c.thumbnailUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={c.thumbnailUrl} alt="" className="thumb" loading="lazy" referrerPolicy="no-referrer" />
                          ) : (
                            <span className="thumb" aria-hidden />
                          )}
                          <span className="min-w-0">
                            <b className="block max-w-[260px] truncate font-semibold text-title" title={c.name}>
                              {c.name}
                            </b>
                            <small className="block max-w-[260px] truncate text-xs text-muted">
                              {[c.campaignName, c.adsetName].filter(Boolean).join(" · ")}
                              {c.daysLive !== null && ` · no ar há ${c.daysLive} ${c.daysLive === 1 ? "dia" : "dias"}`}
                              {c.status && c.status !== "ACTIVE" && " · pausado"}
                            </small>
                          </span>
                        </span>
                      </td>
                      <td>
                        <Pill tone={VERDICT[c.verdict].tone}>{VERDICT[c.verdict].text}</Pill>
                      </td>
                      <td className="text-right tabular-nums" style={freqHigh ? { color: "var(--bad-fg)", fontWeight: 600 } : undefined}>
                        {dec(c.frequency7)}
                      </td>
                      <td className="text-right tabular-nums">{pct(c.ctr)}</td>
                      <td className="text-right tabular-nums">
                        {trend === null ? (
                          "—"
                        ) : (
                          <span style={{ color: trend <= -0.25 ? "var(--bad-fg)" : trend >= 0.1 ? "var(--ok-fg)" : undefined }}>
                            {trend > 0 ? "▲" : trend < 0 ? "▼" : ""} {Math.round(Math.abs(trend) * 100)}%
                          </span>
                        )}
                      </td>
                      <td className="text-right tabular-nums">{formatBRL(c.spend)}</td>
                      <td className="text-right tabular-nums">{int.format(c.conversations)}</td>
                      <td className="text-right tabular-nums" style={costHigh ? { color: "var(--bad-fg)", fontWeight: 600 } : undefined}>
                        {brl(c.costPerConversation)}
                      </td>
                      <td className="text-right tabular-nums">{int.format(c.leads)}</td>
                      <td className="text-right tabular-nums">{int.format(c.sales)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function InsightRow({ level, title, detail }: { level: InsightLevel; title: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line px-3 py-2.5">
      <Pill tone={LEVEL[level].tone} className="mt-0.5 shrink-0">
        {LEVEL[level].text}
      </Pill>
      <div className="min-w-0">
        <b className="block font-semibold text-title">{title}</b>
        <span className="block text-[13px] text-muted">{detail}</span>
      </div>
    </div>
  );
}
