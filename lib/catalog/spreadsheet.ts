"use client";

// Planilha do catálogo (CSV ou Excel). Colunas reconhecidas pelo nome do cabeçalho,
// sem diferenciar maiúsculas e acentos. Célula vazia = manter o valor atual.

export type SheetRow = {
  line: number;
  code: string | null;
  name: string | null;
  category: string | null;
  unit: string | null;
  salePrice: number | null;
  clearSalePrice: boolean;
  rentPrice: number | null;
  isRental: boolean | null;
  stock: number | null;
  aiNotes: string | null;
  active: boolean | null;
  errors: string[];
};

export const TEMPLATE_COLUMNS = [
  "codigo",
  "nome",
  "categoria",
  "unidade",
  "preco_venda",
  "aluguel_mes",
  "locacao",
  "estoque",
  "observacoes_ia",
  "ativo",
] as const;

type Column = (typeof TEMPLATE_COLUMNS)[number];

const ALIASES: Record<string, Column> = {
  codigo: "codigo", cod: "codigo", code: "codigo",
  nome: "nome", produto: "nome", descricao: "nome", equipamento: "nome",
  categoria: "categoria",
  unidade: "unidade", und: "unidade", un: "unidade",
  preco_venda: "preco_venda", preco: "preco_venda", valor: "preco_venda", preco_de_venda: "preco_venda",
  aluguel_mes: "aluguel_mes", aluguel: "aluguel_mes", aluguel_mensal: "aluguel_mes",
  locacao: "locacao", aluga: "locacao",
  estoque: "estoque", quantidade: "estoque", qtd: "estoque",
  observacoes_ia: "observacoes_ia", observacoes: "observacoes_ia", obs: "observacoes_ia", informacoes_ia: "observacoes_ia",
  ativo: "ativo",
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim().replace(/[\s./-]+/g, "_");
}

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** Aceita 1.234,56 / 1234,56 / 1234.56 / R$ 1.234,56 / número do Excel. */
function money(v: unknown): number | null | "invalid" {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : "invalid";
  const s = text(v)?.replace(/R\$\s?/i, "").replace(/\s/g, "");
  if (!s) return null;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : "invalid";
}

function yesNo(v: unknown): boolean | null {
  const s = text(v)?.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!s) return null;
  if (["sim", "s", "x", "1", "true", "yes"].includes(s)) return true;
  if (["nao", "n", "0", "false", "no"].includes(s)) return false;
  return null;
}

function toRows(matrix: unknown[][]): SheetRow[] {
  const [header, ...body] = matrix;
  if (!header) return [];
  const columns = header.map((h) => ALIASES[normalizeHeader(String(h ?? ""))] ?? null);

  return body
    .map((cells, i) => {
      const get = (col: Column) => {
        const at = columns.indexOf(col);
        return at >= 0 ? cells[at] : undefined;
      };
      const errors: string[] = [];
      const priceRaw = text(get("preco_venda"));
      const sobConsulta = !!priceRaw && /consulta/i.test(priceRaw);
      const sale = sobConsulta ? null : money(get("preco_venda"));
      const rent = money(get("aluguel_mes"));
      const stockText = text(get("estoque"));
      const stock = stockText === null ? null : Number(stockText.replace(",", "."));

      if (sale === "invalid") errors.push("preço de venda inválido");
      if (rent === "invalid") errors.push("aluguel inválido");
      if (stock !== null && !Number.isFinite(stock)) errors.push("estoque inválido");

      const row: SheetRow = {
        line: i + 2,
        code: text(get("codigo")),
        name: text(get("nome")),
        category: text(get("categoria")),
        unit: text(get("unidade"))?.toUpperCase() ?? null,
        salePrice: sale === "invalid" ? null : sale,
        clearSalePrice: sobConsulta,
        rentPrice: rent === "invalid" ? null : rent,
        isRental: yesNo(get("locacao")),
        stock: stock !== null && Number.isFinite(stock) ? Math.round(stock) : null,
        aiNotes: text(get("observacoes_ia")),
        active: yesNo(get("ativo")),
        errors,
      };
      if (!row.code && !row.name) row.errors.push("sem código e sem nome");
      return row;
    })
    .filter((r) => r.code || r.name || r.errors.length > 1);
}

/** CSV com ; ou , (o Excel brasileiro salva com ;). Respeita aspas. */
function parseCsv(content: string): string[][] {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (quoted) {
      if (ch === '"' && content[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && content[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export async function readSpreadsheet(file: File): Promise<SheetRow[]> {
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import("read-excel-file/browser");
    return toRows((await readSheet(file)) as unknown[][]);
  }
  const buffer = await file.arrayBuffer();
  // Excel no Windows costuma salvar CSV em Windows-1252; UTF-8 inválido cai para ele.
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    content = new TextDecoder("windows-1252").decode(buffer);
  }
  return toRows(parseCsv(content.replace(/^﻿/, "")));
}

/** Modelo para baixar, já com exemplos da empresa. */
export function templateCsv(companySlug: string): string {
  const examples =
    companySlug === "locpress"
      ? [
          ["", "Oxímetro de pulso", "Diagnóstico", "UN", "200,00", "", "não", "5", "Mede saturação e frequência cardíaca", "sim"],
          ["", "CPAP automático com umidificador", "Respiratório", "UN", "sob consulta", "", "sim", "2", "Pressão sempre conforme receita médica", "sim"],
        ]
      : [
          ["414", "Muleta canadense preta ALO", "Ortopédicos", "UN", "62,40", "", "não", "19", "Regulagem de altura", "sim"],
          ["80", "Muleta universal axilar", "Ortopédicos", "PA", "", "", "não", "", "", "sim"],
        ];
  const lines = [TEMPLATE_COLUMNS.join(";"), ...examples.map((r) => r.join(";"))];
  return "﻿" + lines.join("\r\n");
}
