// Modelos de mensagem do WhatsApp (docs/WHATSAPP.md, seção 5).
// Funções puras: usadas no servidor (ações, webhook) e na tela.

import { firstName } from "@/lib/names";
import type { TemplateCategory } from "./pricing";

export type TemplateStatus = "draft" | "pending" | "approved" | "rejected" | "paused" | "disabled";

export const CATEGORY_LABEL: Record<TemplateCategory, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação",
};

export const STATUS_LABEL: Record<TemplateStatus, { label: string; tone: "ok" | "warn" | "bad" | "neutral" }> = {
  approved: { label: "Aprovado", tone: "ok" },
  pending: { label: "Em análise", tone: "warn" },
  rejected: { label: "Rejeitado", tone: "bad" },
  paused: { label: "Pausado", tone: "warn" },
  disabled: { label: "Desativado", tone: "bad" },
  draft: { label: "Rascunho", tone: "neutral" },
};

const REJECTED_REASON: Record<string, string> = {
  ABUSIVE_CONTENT: "conteúdo considerado abusivo",
  INCORRECT_CATEGORY: "categoria incorreta",
  INVALID_FORMAT: "formato inválido",
  SCAM: "suspeita de golpe",
  PROMOTIONAL: "conteúdo promocional fora da categoria Marketing",
  TAG_CONTENT_MISMATCH: "o texto não combina com a categoria escolhida",
};

export function rejectedReasonLabel(reason: string | null | undefined): string | null {
  if (!reason || reason === "NONE") return null;
  return REJECTED_REASON[reason] ?? reason.toLowerCase().replace(/_/g, " ");
}

/** Status da Meta (lista de modelos ou webhook) → status do Orvya. null = não muda nada. */
export function mapMetaStatus(status: string | null | undefined): TemplateStatus | null {
  switch ((status ?? "").toUpperCase()) {
    case "APPROVED":
    case "REINSTATED":
      return "approved";
    case "PENDING":
    case "IN_APPEAL":
      return "pending";
    case "REJECTED":
      return "rejected";
    case "PAUSED":
      return "paused";
    case "DISABLED":
    case "PENDING_DELETION":
    case "DELETED":
      return "disabled";
    default:
      return null;
  }
}

/** Nome aceito pela Meta: minúsculas, números e "_" (sem acento). */
export function normalizeTemplateName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 512);
}

/** Nome de variável amigável: "Nome do cliente" → "nome_do_cliente". */
export function normalizeVariableName(raw: string): string {
  return normalizeTemplateName(raw) || "campo";
}

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

/**
 * Corpo com variáveis amigáveis ({{nome}}, {{produto}}) → corpo da Meta ({{1}}, {{2}}),
 * na ordem em que aparecem. A mesma variável repetida usa o mesmo número.
 */
export function friendlyToMeta(friendly: string): { body: string; variables: string[] } {
  const variables: string[] = [];
  const body = friendly.replace(PLACEHOLDER, (_m, raw: string) => {
    const name = normalizeVariableName(raw);
    let index = variables.indexOf(name);
    if (index < 0) {
      variables.push(name);
      index = variables.length - 1;
    }
    return `{{${index + 1}}}`;
  });
  return { body, variables };
}

/** Variáveis amigáveis que aparecem no texto (para pedir exemplos na tela). */
export function detectVariables(friendly: string): string[] {
  return friendlyToMeta(friendly).variables;
}

/** Quantos campos o corpo da Meta tem (maior {{n}}). */
export function countParams(body: string): number {
  let max = 0;
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/** Nomes das variáveis na ordem ({{1}}, {{2}}...). Modelos importados da Meta viram var1, var2... */
export function variableNames(body: string, variables: string[]): string[] {
  return Array.from({ length: countParams(body) }, (_, i) => variables[i] || `var${i + 1}`);
}

/** Corpo da Meta → texto com os nomes amigáveis, para mostrar na tela. */
export function metaToFriendly(body: string, variables: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n: string) => {
    const name = variables[Number(n) - 1];
    return name ? `{{${name}}}` : m;
  });
}

/** Texto final com os valores preenchidos. Valor vazio continua aparecendo como {{nome}}. */
export function fillTemplate(body: string, variables: string[], values: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n: string) => {
    const i = Number(n) - 1;
    const v = values[i]?.trim();
    if (v) return v;
    const name = variables[i];
    return name ? `{{${name}}}` : m;
  });
}

/** A Meta recusa parâmetro com quebra de linha, tabulação ou mais de 4 espaços seguidos. */
export function cleanParam(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Rótulo do campo na tela: "nome_do_cliente" → "Nome do cliente". */
export function variableLabel(name: string): string {
  const s = name.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const CONTACT_FIELDS = ["nome", "cliente", "nome_cliente", "nome_do_cliente"];
const SELLER_FIELDS = ["vendedor", "vendedora", "atendente", "consultor", "consultora"];
const PRODUCT_FIELDS = ["produto", "equipamento", "produto_de_interesse", "item"];

export type PrefillSource = { contactName?: string | null; sellerName?: string | null; productName?: string | null };

/**
 * Valores iniciais dos campos do modelo: nome = primeiro nome do cliente; vendedor = primeiro nome
 * do responsável (ou de quem envia); produto = produto de interesse. O resto fica vazio para digitar.
 */
export function prefillValues(body: string, variables: string[], src: PrefillSource): string[] {
  const first = (s: string | null | undefined) => (s?.trim() ? firstName(s) : "");
  return variableNames(body, variables).map((v) => {
    if (CONTACT_FIELDS.includes(v)) return first(src.contactName);
    if (SELLER_FIELDS.includes(v)) return first(src.sellerName);
    if (PRODUCT_FIELDS.includes(v)) return cleanParam(src.productName ?? "");
    return "";
  });
}
