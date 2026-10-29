import { formatBRL } from "@/lib/format";

// Motor de insights do tráfego: regras claras sobre os números da Meta e do Orvya, calibradas
// pelas metas da gestora. Cada alerta tem um texto interno (para a gestora) e, quando faz
// sentido, um texto em linguagem de cliente (para o relatório). Sem dependência de servidor:
// o mesmo cálculo serve o painel, os relatórios e os testes.

export type Goals = {
  costPerConversationMax: number | null;
  cplMax: number | null;
  costPerSaleMax: number | null;
  roasMin: number | null;
  frequencyMax: number;
  ctrMin: number;
};

export const DEFAULT_GOALS: Goals = { costPerConversationMax: null, cplMax: null, costPerSaleMax: null, roasMin: null, frequencyMax: 3, ctrMin: 0.8 };

/** Números de um período (Meta + Orvya). */
export type PeriodNumbers = {
  spend: number;
  impressions: number;
  clicks: number; // cliques no link
  conversations: number; // conversas iniciadas, contadas pela Meta
  leads: number; // leads de anúncio que chegaram no Orvya
  sales: number;
  revenue: number;
};

export type CreativeInput = {
  adId: string;
  name: string;
  campaignName: string | null;
  adsetName: string | null;
  status: string | null;
  thumbnailUrl: string | null;
  createdTime: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversations: number;
  leads: number;
  sales: number;
  revenue: number;
  /** Frequência e alcance dos últimos 7 dias, calculados pela Meta para o período inteiro. */
  frequency7: number | null;
  reach7: number | null;
  /** CTR dos 3 dias mais recentes com entrega e dos 3 anteriores (tendência de cansaço). */
  ctrRecent: number | null;
  ctrBefore: number | null;
  recentImpressions: number;
};

/** Atendimento dos leads que vieram do anúncio no período. */
export type OpsInput = {
  adLeads: number;
  waitingNow: number; // conversas de lead de anúncio esperando resposta agora (mais de 15 min)
  medianFirstResponseMin: number | null;
  slowFirstResponses: number; // primeira resposta depois de 15 min
};

export type InsightLevel = "critico" | "atencao" | "bom" | "info";
export type InsightArea = "criativo" | "custo" | "entrega" | "atendimento" | "vendas" | "saldo";

export type Insight = {
  id: string;
  level: InsightLevel;
  area: InsightArea;
  title: string;
  detail: string;
  /** Texto para o cliente; null = só para a gestora. */
  client: string | null;
  adId?: string;
};

export type CreativeVerdict = "saudavel" | "atencao" | "saturado" | "sem-dados";

export type CreativeResult = CreativeInput & {
  verdict: CreativeVerdict;
  ctr: number | null;
  cpm: number | null;
  costPerConversation: number | null;
  daysLive: number | null;
};

export type Metric = { value: number | null; previous: number | null; change: number | null };

export type InsightsResult = {
  metrics: {
    spend: Metric;
    conversations: Metric;
    costPerConversation: Metric;
    leads: Metric;
    cpl: Metric;
    sales: Metric;
    costPerSale: Metric;
    revenue: Metric;
    roas: Metric;
    ctr: Metric;
    cpm: Metric;
  };
  insights: Insight[];
  creatives: CreativeResult[];
};

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const pct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const dec = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function metric(value: number | null, previous: number | null): Metric {
  const change = value !== null && previous !== null && previous > 0 ? (value - previous) / previous : null;
  return { value, previous, change };
}

/** Anúncio com volume para ser julgado (evita alerta em anúncio que mal entregou). */
const hasVolume = (c: CreativeInput) => c.impressions >= 1000 || c.spend >= 20;

const LEVEL_ORDER: Record<InsightLevel, number> = { critico: 0, atencao: 1, info: 2, bom: 3 };

export function computeInsights(input: {
  current: PeriodNumbers;
  previous: PeriodNumbers;
  creatives: CreativeInput[];
  ops: OpsInput;
  goals: Goals;
  /** Alertas de saldo e de conta já calculados (texto pronto). */
  accountAlerts?: { level: "bad" | "warn"; text: string; account?: string }[];
  /** Período de um dia só (relatório diário, "ontem"): algumas regras pedem mais tempo. */
  singleDay?: boolean;
  now?: Date;
}): InsightsResult {
  const { current: cur, previous: prev, goals, ops } = input;
  const now = input.now ?? new Date();
  const insights: Insight[] = [];

  const m = {
    spend: metric(cur.spend, prev.spend),
    conversations: metric(cur.conversations, prev.conversations),
    costPerConversation: metric(ratio(cur.spend, cur.conversations), ratio(prev.spend, prev.conversations)),
    leads: metric(cur.leads, prev.leads),
    cpl: metric(ratio(cur.spend, cur.leads), ratio(prev.spend, prev.leads)),
    sales: metric(cur.sales, prev.sales),
    costPerSale: metric(ratio(cur.spend, cur.sales), ratio(prev.spend, prev.sales)),
    revenue: metric(cur.revenue, prev.revenue),
    roas: metric(ratio(cur.revenue, cur.spend), ratio(prev.revenue, prev.spend)),
    ctr: metric(cur.impressions ? (cur.clicks / cur.impressions) * 100 : null, prev.impressions ? (prev.clicks / prev.impressions) * 100 : null),
    cpm: metric(cur.impressions ? (cur.spend / cur.impressions) * 1000 : null, prev.impressions ? (prev.spend / prev.impressions) * 1000 : null),
  };

  // ---------------------------------------------------------------- Entrega
  if (cur.spend === 0 && prev.spend > 0) {
    insights.push({
      id: "entrega-parada",
      level: "critico",
      area: "entrega",
      title: "Os anúncios pararam de veicular",
      detail: `Nenhum investimento no período, contra ${formatBRL(prev.spend)} no período anterior. Verifique saldo, pagamento e reprovações.`,
      client: "Os anúncios ficaram sem veiculação no período. Já estamos verificando o motivo.",
    });
  }

  // ---------------------------------------------------------------- Custos
  const cpc = m.costPerConversation;
  if (cpc.value !== null && cur.conversations >= 3) {
    const max = goals.costPerConversationMax;
    if (max) {
      if (cpc.value > max * 1.2) {
        insights.push({
          id: "custo-conversa-meta",
          level: "critico",
          area: "custo",
          title: "Custo por conversa bem acima da meta",
          detail: `${formatBRL(cpc.value)} por conversa, para uma meta de até ${formatBRL(max)}.`,
          client: `O custo por conversa ficou em ${formatBRL(cpc.value)}, acima do que planejamos. Estamos ajustando público e criativos para trazer de volta à meta.`,
        });
      } else if (cpc.value > max) {
        insights.push({
          id: "custo-conversa-meta",
          level: "atencao",
          area: "custo",
          title: "Custo por conversa acima da meta",
          detail: `${formatBRL(cpc.value)} por conversa, para uma meta de até ${formatBRL(max)}.`,
          client: `O custo por conversa ficou em ${formatBRL(cpc.value)}, um pouco acima da meta de ${formatBRL(max)}. Seguimos acompanhando.`,
        });
      } else if (cpc.value <= max * 0.8) {
        insights.push({
          id: "custo-conversa-meta",
          level: "bom",
          area: "custo",
          title: "Custo por conversa abaixo da meta",
          detail: `${formatBRL(cpc.value)} por conversa, meta de até ${formatBRL(max)}.`,
          client: `Cada conversa custou ${formatBRL(cpc.value)}, abaixo da meta de ${formatBRL(max)}.`,
        });
      }
    } else if (cpc.change !== null && cur.conversations >= 5) {
      if (cpc.change >= 0.3) {
        insights.push({
          id: "custo-conversa-subiu",
          level: "atencao",
          area: "custo",
          title: `Custo por conversa subiu ${pct(cpc.change * 100)}`,
          detail: `De ${formatBRL(cpc.previous!)} para ${formatBRL(cpc.value)}. Defina uma meta para este cliente para calibrar o alerta.`,
          client: `O custo por conversa subiu para ${formatBRL(cpc.value)}. Estamos revisando criativos e público.`,
        });
      } else if (cpc.change <= -0.2) {
        insights.push({
          id: "custo-conversa-caiu",
          level: "bom",
          area: "custo",
          title: `Custo por conversa caiu ${pct(-cpc.change * 100)}`,
          detail: `De ${formatBRL(cpc.previous!)} para ${formatBRL(cpc.value)}.`,
          client: `Cada conversa ficou mais barata: ${formatBRL(cpc.value)}, contra ${formatBRL(cpc.previous!)} no período anterior.`,
        });
      }
    }
  }

  if (goals.cplMax && m.cpl.value !== null && cur.leads >= 3 && m.cpl.value > goals.cplMax) {
    insights.push({
      id: "cpl-meta",
      level: m.cpl.value > goals.cplMax * 1.2 ? "critico" : "atencao",
      area: "custo",
      title: "Custo por lead acima da meta",
      detail: `${formatBRL(m.cpl.value)} por lead que chegou no Orvya, para uma meta de até ${formatBRL(goals.cplMax)}.`,
      client: null,
    });
  }

  if (goals.costPerSaleMax && m.costPerSale.value !== null && cur.sales > 0 && m.costPerSale.value > goals.costPerSaleMax) {
    insights.push({
      id: "custo-venda-meta",
      level: "atencao",
      area: "vendas",
      title: "Custo por venda acima da meta",
      detail: `${formatBRL(m.costPerSale.value)} por venda, para uma meta de até ${formatBRL(goals.costPerSaleMax)}.`,
      client: null,
    });
  }

  if (goals.roasMin && m.roas.value !== null && cur.spend > 0 && !input.singleDay) {
    if (m.roas.value < goals.roasMin) {
      insights.push({
        id: "roas-meta",
        level: m.roas.value < goals.roasMin * 0.7 ? "critico" : "atencao",
        area: "vendas",
        title: "Retorno abaixo do mínimo",
        detail: `Cada R$ 1 investido voltou ${formatBRL(m.roas.value)} em vendas; o mínimo combinado é ${formatBRL(goals.roasMin)}.`,
        client: `Cada R$ 1 investido em anúncios voltou ${formatBRL(m.roas.value)} em vendas no período.`,
      });
    } else {
      insights.push({
        id: "roas-meta",
        level: "bom",
        area: "vendas",
        title: "Retorno acima do mínimo",
        detail: `Cada R$ 1 investido voltou ${formatBRL(m.roas.value)} em vendas (mínimo ${formatBRL(goals.roasMin)}).`,
        client: `Cada R$ 1 investido em anúncios voltou ${formatBRL(m.roas.value)} em vendas no período.`,
      });
    }
  }

  if (m.cpm.change !== null && m.cpm.change >= 0.3 && cur.impressions >= 2000) {
    insights.push({
      id: "cpm-subiu",
      level: "info",
      area: "entrega",
      title: `CPM subiu ${pct(m.cpm.change * 100)}`,
      detail: `Mil exibições passaram a custar ${formatBRL(m.cpm.value!)} (antes ${formatBRL(m.cpm.previous!)}). Leilão mais disputado ou público saturado.`,
      client: null,
    });
  }

  // ---------------------------------------------------------------- Criativos
  const creatives: CreativeResult[] = input.creatives.map((c) => {
    const ctr = c.impressions ? (c.clicks / c.impressions) * 100 : null;
    const cpm = c.impressions ? (c.spend / c.impressions) * 1000 : null;
    const costPerConversation = ratio(c.spend, c.conversations);
    const daysLive = c.createdTime ? Math.max(0, Math.floor((now.getTime() - new Date(c.createdTime).getTime()) / 86_400_000)) : null;
    let verdict: CreativeVerdict = hasVolume(c) ? "saudavel" : "sem-dados";
    if (!hasVolume(c)) return { ...c, verdict, ctr, cpm, costPerConversation, daysLive };

    const highFreq = c.frequency7 !== null && c.frequency7 >= goals.frequencyMax;
    const ctrDrop = c.ctrRecent !== null && c.ctrBefore !== null && c.ctrBefore > 0 && c.recentImpressions >= 1000 ? (c.ctrBefore - c.ctrRecent) / c.ctrBefore : null;
    const nome = `“${c.name}”`;

    if (highFreq && ctrDrop !== null && ctrDrop >= 0.25) {
      verdict = "saturado";
      insights.push({
        id: `saturado-${c.adId}`,
        adId: c.adId,
        level: "critico",
        area: "criativo",
        title: `Criativo saturado: ${c.name}`,
        detail: `Frequência de ${dec(c.frequency7!)} nos últimos 7 dias e CTR caiu de ${pct(c.ctrBefore!)} para ${pct(c.ctrRecent!)}. Hora de trocar o criativo ou o público.`,
        client: `O anúncio ${nome} já foi visto muitas vezes pelo mesmo público e começou a perder resposta. Vamos renovar o criativo.`,
      });
    } else if (highFreq) {
      verdict = "atencao";
      insights.push({
        id: `frequencia-${c.adId}`,
        adId: c.adId,
        level: "atencao",
        area: "criativo",
        title: `Frequência alta: ${c.name}`,
        detail: `Cada pessoa viu este anúncio ${dec(c.frequency7!)} vezes nos últimos 7 dias (limite ${dec(goals.frequencyMax)}). O CTR ainda se mantém; prepare a troca.`,
        client: `O anúncio ${nome} está sendo exibido muitas vezes para o mesmo público. Já estamos preparando a renovação.`,
      });
    } else if (ctrDrop !== null && ctrDrop >= 0.3) {
      verdict = "atencao";
      insights.push({
        id: `ctr-caiu-${c.adId}`,
        adId: c.adId,
        level: "atencao",
        area: "criativo",
        title: `CTR em queda: ${c.name}`,
        detail: `Cliques no link caíram de ${pct(c.ctrBefore!)} para ${pct(c.ctrRecent!)} nos últimos dias, sem frequência alta. Pode ser cansaço do criativo ou mudança no leilão.`,
        client: null,
      });
    }

    if (verdict === "saudavel" && ctr !== null && c.impressions >= 2000 && ctr < goals.ctrMin) {
      verdict = "atencao";
      insights.push({
        id: `ctr-baixo-${c.adId}`,
        adId: c.adId,
        level: "atencao",
        area: "criativo",
        title: `CTR baixo: ${c.name}`,
        detail: `${pct(ctr)} de cliques no link, abaixo do mínimo de ${pct(goals.ctrMin)}. A chamada ou a imagem não está despertando interesse.`,
        client: null,
      });
    }

    if (goals.costPerConversationMax && costPerConversation !== null && c.conversations >= 3 && costPerConversation > goals.costPerConversationMax * 1.3) {
      if (verdict === "saudavel") verdict = "atencao";
      insights.push({
        id: `custo-anuncio-${c.adId}`,
        adId: c.adId,
        level: "atencao",
        area: "criativo",
        title: `Conversa cara neste anúncio: ${c.name}`,
        detail: `${formatBRL(costPerConversation)} por conversa, bem acima da meta de ${formatBRL(goals.costPerConversationMax)}. Considere redistribuir a verba.`,
        client: null,
      });
    }
    return { ...c, verdict, ctr, cpm, costPerConversation, daysLive };
  });

  // Destaque: o anúncio que trouxe conversa mais barata.
  const best = creatives
    .filter((c) => c.verdict !== "sem-dados" && c.conversations >= 3 && c.costPerConversation !== null)
    .sort((a, b) => a.costPerConversation! - b.costPerConversation!)[0];
  if (best && creatives.filter((c) => c.conversations >= 3).length >= 2) {
    insights.push({
      id: `melhor-${best.adId}`,
      adId: best.adId,
      level: "bom",
      area: "criativo",
      title: `Melhor criativo: ${best.name}`,
      detail: `${best.conversations} conversas a ${formatBRL(best.costPerConversation!)} cada${best.sales ? ` e ${best.sales} venda(s)` : ""}. Vale reforçar a verba nele.`,
      client: `O anúncio “${best.name}” foi o que trouxe conversas pelo menor custo: ${formatBRL(best.costPerConversation!)} cada.`,
    });
  }

  // ---------------------------------------------------------------- Atendimento
  if (ops.waitingNow > 0) {
    insights.push({
      id: "esperando-agora",
      level: "critico",
      area: "atendimento",
      title: `${ops.waitingNow} lead(s) do anúncio esperando resposta`,
      detail: "Conversas de quem veio do anúncio estão há mais de 15 minutos sem resposta da equipe.",
      client: `${ops.waitingNow} contato(s) que vieram dos anúncios estão aguardando resposta da equipe.`,
    });
  }
  if (ops.medianFirstResponseMin !== null && ops.adLeads >= 3) {
    if (ops.medianFirstResponseMin > 15) {
      insights.push({
        id: "resposta-lenta",
        level: "atencao",
        area: "atendimento",
        title: `Primeira resposta demorando: ${Math.round(ops.medianFirstResponseMin)} min`,
        detail: `Metade dos leads do anúncio esperou mais de ${Math.round(ops.medianFirstResponseMin)} minutos pela primeira resposta. ${ops.slowFirstResponses} passaram de 15 minutos.`,
        client: `A primeira resposta da equipe aos contatos do anúncio levou, em média, ${Math.round(ops.medianFirstResponseMin)} minutos. Quanto mais rápida a resposta, maior a chance de venda.`,
      });
    } else if (ops.medianFirstResponseMin <= 5) {
      insights.push({
        id: "resposta-rapida",
        level: "bom",
        area: "atendimento",
        title: `Resposta rápida: ${Math.max(1, Math.round(ops.medianFirstResponseMin))} min`,
        detail: "Metade dos leads do anúncio foi respondida em até 5 minutos.",
        client: `A equipe respondeu os contatos do anúncio em cerca de ${Math.max(1, Math.round(ops.medianFirstResponseMin))} minuto(s). Ótimo para a conversão.`,
      });
    }
  }

  // ---------------------------------------------------------------- Vendas
  if (!input.singleDay && cur.leads >= 10 && cur.sales === 0) {
    insights.push({
      id: "leads-sem-venda",
      level: "atencao",
      area: "vendas",
      title: "Leads chegando, vendas não",
      detail: `${cur.leads} leads do anúncio no período e nenhuma venda registrada no Orvya. Confira o atendimento e se as vendas estão sendo marcadas como ganhas.`,
      client: `Chegaram ${cur.leads} contatos pelos anúncios no período. Vamos olhar juntos o que está travando o fechamento.`,
    });
  }
  if (cur.conversations >= 10 && cur.leads < cur.conversations * 0.5) {
    insights.push({
      id: "conversas-sem-lead",
      level: "info",
      area: "vendas",
      title: "Parte das conversas não chegou como lead",
      detail: `A Meta contou ${cur.conversations} conversas iniciadas e o Orvya recebeu ${cur.leads} leads de anúncio. Confira se todos os anúncios apontam para o número conectado ao Orvya.`,
      client: null,
    });
  }

  // ---------------------------------------------------------------- Saldo e conta
  for (const [i, a] of (input.accountAlerts ?? []).entries()) {
    insights.push({
      id: `conta-${i}`,
      level: a.level === "bad" ? "critico" : "atencao",
      area: "saldo",
      title: a.text,
      detail: a.account ? `Conta de anúncios: ${a.account}.` : "Situação da conta de anúncios.",
      client: /^Não foi possível atualizar/.test(a.text) ? null : /saldo|boleto|pix|pagamento/i.test(a.text) ? "O saldo da conta de anúncios está acabando. Para os anúncios não pararem, precisamos do novo pagamento." : null,
    });
  }

  insights.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  const verdictOrder: Record<CreativeVerdict, number> = { saturado: 0, atencao: 1, saudavel: 2, "sem-dados": 3 };
  creatives.sort((a, b) => verdictOrder[a.verdict] - verdictOrder[b.verdict] || b.spend - a.spend);
  return { metrics: m, insights, creatives };
}
