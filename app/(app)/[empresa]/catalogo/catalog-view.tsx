"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import type { Product } from "@/lib/catalog/types";
import { formatBRL } from "@/lib/format";
import { confirmReferencePrices } from "./actions";
import { ProductDrawer } from "./product-drawer";

type Filter = "ativos" | "sem-preco" | "fora" | "todos";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "ativos", label: "No catálogo" },
  { id: "sem-preco", label: "Sem preço" },
  { id: "fora", label: "Fora do catálogo" },
  { id: "todos", label: "Todos" },
];

const PAGE = 150;

const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Sem preço confirmado e não é item negociado pela equipe: a IA vai passar para humano. */
export const needsPrice = (p: Product) => p.active && p.salePrice === null && !p.requiresHuman;

export function CatalogView({ products, slug, canEdit, isLoc }: { products: Product[]; slug: string; canEdit: boolean; isLoc: boolean }) {
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("ativos");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [pending, startTransition] = useTransition();

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [products],
  );

  const counts = useMemo(
    () => ({
      ativos: products.filter((p) => p.active).length,
      "sem-preco": products.filter(needsPrice).length,
      fora: products.filter((p) => !p.active).length,
      todos: products.length,
    }),
    [products],
  );

  const visible = useMemo(() => {
    const q = normalize(query.trim());
    return products.filter((p) => {
      if (filter === "ativos" && !p.active) return false;
      if (filter === "sem-preco" && !needsPrice(p)) return false;
      if (filter === "fora" && p.active) return false;
      if (category && p.category !== category) return false;
      return !q || normalize(p.name).includes(q) || (p.code ?? "").includes(q);
    });
  }, [products, filter, query, category]);

  const selectable = visible.filter((p) => p.referencePrice !== null && p.salePrice === null && !p.requiresHuman);
  const allSelected = selectable.length > 0 && selectable.every((p) => selected.has(p.id));

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirmSelected(ids: string[]) {
    startTransition(async () => {
      const result = await confirmReferencePrices(slug, ids);
      toast(result.ok ? result.message : result.error, result.ok ? "ok" : "bad");
      if (result.ok) setSelected(new Set());
    });
  }

  return (
    <>
      <div className="toolbar">
        <div className="tabs" role="group" aria-label="Filtrar produtos">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} <span className="opacity-70">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <label className="search flex-1">
          <svg viewBox="0 0 24 24" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input type="search" placeholder="Buscar por nome ou código" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar produto" />
        </label>
        <select className="inp !w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        {canEdit && (
          <Button variant="primary" onClick={() => setEditing("new")}>
            Novo produto
          </Button>
        )}
      </div>

      {canEdit && counts["sem-preco"] > 0 && filter !== "sem-preco" && (
        <div className="notice warn">
          <div className="min-w-0 flex-1">
            <b>{counts["sem-preco"]} produto(s) no catálogo sem preço confirmado.</b> Para esses, a IA vai dizer que confirma com a
            equipe e passar a conversa para um vendedor.
          </div>
          <Button size="sm" onClick={() => setFilter("sem-preco")}>
            Ver
          </Button>
        </div>
      )}

      <Panel className="!p-0">
        {canEdit && selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
            <span className="text-[13px]">{selected.size} selecionado(s)</span>
            <Button size="sm" variant="primary" loading={pending} onClick={() => confirmSelected([...selected])}>
              Usar preço de referência
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Limpar seleção
            </Button>
          </div>
        )}

        {visible.length === 0 ? (
          <div className="p-5">
            <div className="empty">
              {products.length === 0
                ? canEdit
                  ? "O catálogo está vazio. Use Importar para trazer os produtos do Net Use ou de uma planilha."
                  : "O catálogo ainda está vazio."
                : "Nenhum produto com esses filtros."}
            </div>
          </div>
        ) : (
          <div className="scroll-x">
            <table className={isLoc ? "min-w-[860px]" : "min-w-[760px]"}>
              <thead>
                <tr>
                  {canEdit && (
                    <th className="w-8">
                      <input
                        type="checkbox"
                        className="accent-accent"
                        aria-label="Selecionar todos com preço de referência"
                        checked={allSelected}
                        disabled={!selectable.length}
                        onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((p) => p.id)))}
                      />
                    </th>
                  )}
                  {!isLoc && <th>Código</th>}
                  <th>{isLoc ? "Equipamento" : "Produto"}</th>
                  <th className="text-right">{isLoc ? "Preço de venda" : "Preço"}</th>
                  {isLoc && <th className="text-right">Aluguel/mês</th>}
                  {canEdit && <th className="text-right">Referência</th>}
                  <th className="text-right">Estoque</th>
                  {isLoc && <th className="text-right">Em locação</th>}
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, limit).map((p) => {
                  const canConfirm = p.referencePrice !== null && p.salePrice === null && !p.requiresHuman;
                  return (
                    <tr key={p.id} className={`cursor-pointer hover:bg-surface-2 ${p.active ? "" : "opacity-55"}`} onClick={() => setEditing(p)}>
                      {canEdit && (
                        <td onClick={(e) => e.stopPropagation()}>
                          {canConfirm && (
                            <input
                              type="checkbox"
                              className="accent-accent"
                              aria-label={`Selecionar ${p.name}`}
                              checked={selected.has(p.id)}
                              onChange={() => toggle(p.id)}
                            />
                          )}
                        </td>
                      )}
                      {!isLoc && <td className="text-muted tabular-nums">{p.code ?? "—"}</td>}
                      <td>
                        <b className="block font-semibold text-title">{p.name}</b>
                        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          {p.category ?? "Sem categoria"}
                          {p.unit && <span>· {p.unit}</span>}
                          {p.promoLabel && <Pill tone="ind">{p.promoLabel}</Pill>}
                          {!p.active && <Pill>Fora do catálogo</Pill>}
                        </span>
                      </td>
                      <td className="text-right tabular-nums whitespace-nowrap">
                        {p.requiresHuman ? (
                          <Pill tone="ind">Negociado pela equipe</Pill>
                        ) : p.salePrice !== null ? (
                          formatBRL(p.salePrice)
                        ) : (
                          <Pill tone="warn">Sob consulta</Pill>
                        )}
                      </td>
                      {isLoc && (
                        <td className="text-right tabular-nums whitespace-nowrap">
                          {!p.isRental ? <span className="text-muted">Só venda</span> : p.requiresHuman ? <span className="text-muted">Com a equipe</span> : p.rentPriceMonth !== null ? formatBRL(p.rentPriceMonth) : "—"}
                        </td>
                      )}
                      {canEdit && (
                        <td className="text-right whitespace-nowrap">
                          {p.referencePrice !== null ? (
                            <span className="tabular-nums text-muted" title={p.referenceNote ?? undefined}>
                              {formatBRL(p.referencePrice)}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                          {canConfirm && (
                            <button
                              type="button"
                              className="ml-2 text-xs font-semibold text-tint-ink hover:underline"
                              disabled={pending}
                              onClick={(e) => {
                                e.stopPropagation();
                                confirmSelected([p.id]);
                              }}
                            >
                              Usar
                            </button>
                          )}
                        </td>
                      )}
                      <td className={`text-right tabular-nums ${p.stock <= 0 ? "font-semibold text-[var(--bad-fg)]" : ""}`}>{p.stock}</td>
                      {isLoc && <td className="text-right tabular-nums">{p.isRental ? p.rentedCount : "—"}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {visible.length > limit && (
          <div className="flex justify-center border-t border-line p-3">
            <Button size="sm" onClick={() => setLimit((l) => l + PAGE)}>
              Mostrar mais ({visible.length - limit} restantes)
            </Button>
          </div>
        )}
      </Panel>

      <ProductDrawer
        product={editing === "new" ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        slug={slug}
        canEdit={canEdit}
        isLoc={isLoc}
        categories={categories}
      />
    </>
  );
}
