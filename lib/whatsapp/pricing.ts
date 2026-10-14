// Custo APROXIMADO por modelo de mensagem enviado no Brasil (API oficial do WhatsApp).
// A Meta cobra por modelo entregue, conforme a categoria; respostas dentro da janela de 24 h
// aberta pelo cliente não são cobradas. Ajuste aqui quando a tabela da Meta mudar (único lugar).

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export const TEMPLATE_COST_BRL: Record<TemplateCategory, number> = {
  MARKETING: 0.35,
  UTILITY: 0.04,
  AUTHENTICATION: 0.04,
};

export const COST_NOTE = "valor aproximado; a Meta cobra conforme a tabela vigente";

export function templateCost(category: TemplateCategory): number {
  return TEMPLATE_COST_BRL[category] ?? 0;
}
