"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { TextAreaField, TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Pill } from "@/components/ui/pill";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import type { Product } from "@/lib/catalog/types";
import { formatBRL, formatDateTime } from "@/lib/format";
import { saveProduct } from "./actions";

type Props = {
  product: Product | null;
  open: boolean;
  onClose: () => void;
  slug: string;
  canEdit: boolean;
  isLoc: boolean;
  categories: string[];
};

const moneyText = (v: number | null) => (v === null ? "" : v.toFixed(2).replace(".", ","));

export function ProductDrawer({ product, open, onClose, slug, canEdit, isLoc, categories }: Props) {
  // A chave remonta o formulário a cada produto aberto, zerando o estado.
  return open ? (
    <ProductForm key={product?.id ?? "new"} product={product} onClose={onClose} slug={slug} canEdit={canEdit} isLoc={isLoc} categories={categories} />
  ) : null;
}

function ProductForm({ product, onClose, slug, canEdit, isLoc, categories }: Omit<Props, "open">) {
  const toast = useToast();
  const [isRental, setIsRental] = useState(product?.isRental ?? false);
  const [requiresHuman, setRequiresHuman] = useState(product?.requiresHuman ?? false);
  const [active, setActive] = useState(product?.active ?? true);
  const [salePrice, setSalePrice] = useState(moneyText(product?.salePrice ?? null));
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const readOnly = !canEdit;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const get = (k: string) => String(data.get(k) ?? "");
    setError(undefined);
    startTransition(async () => {
      const result = await saveProduct(slug, {
        id: product?.id,
        name: get("name"),
        code: get("code"),
        category: get("category"),
        unit: get("unit"),
        salePrice,
        rentPriceMonth: get("rentPriceMonth"),
        stock: get("stock") || "0",
        rentedCount: get("rentedCount") || "0",
        promoLabel: get("promoLabel"),
        aiNotes: get("aiNotes"),
        isRental,
        requiresHuman,
        active,
      });
      if (result.ok) {
        toast(result.message, "ok");
        onClose();
      } else setError(result.error);
    });
  }

  const title = product ? product.name : "Novo produto";
  const priceLocked = requiresHuman;

  return (
    <Drawer
      open
      onClose={onClose}
      title={title}
      subtitle={product ? [product.code && `Código ${product.code}`, product.category].filter(Boolean).join(" · ") || undefined : "Cadastro manual"}
      footer={
        canEdit ? (
          <>
            <Button type="submit" form="product-form" variant="primary" loading={pending}>
              Salvar
            </Button>
            <Button onClick={onClose}>Cancelar</Button>
          </>
        ) : (
          <Button onClick={onClose}>Fechar</Button>
        )
      }
    >
      <form id="product-form" onSubmit={onSubmit} className="grid gap-5">
        <fieldset disabled={readOnly} className="m-0 grid gap-2.5 border-0 p-0 sm:grid-cols-2">
          <TextField label="Nome" name="name" defaultValue={product?.name} required className="sm:col-span-2" />
          <TextField label="Código (Net Use)" name="code" defaultValue={product?.code ?? ""} />
          <TextField label="Unidade" name="unit" defaultValue={product?.unit ?? ""} placeholder="UN, PA, CX..." />
          <TextField label="Categoria" name="category" defaultValue={product?.category ?? ""} list="catalog-categories" className="sm:col-span-2" />
          <datalist id="catalog-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </fieldset>

        <section className="grid gap-2.5">
          <h3 className="text-[13px] font-[650]">Preço</h3>

          {(isLoc || isRental) && (
            <label className="flex items-center gap-3 text-[13.5px]">
              <Switch label="Item de locação" checked={isRental} disabled={readOnly} onChange={(e) => setIsRental(e.target.checked)} />
              Item de locação
            </label>
          )}
          <label className="flex items-start gap-3 text-[13.5px]">
            <Switch label="Valor negociado pela equipe" checked={requiresHuman} disabled={readOnly} onChange={(e) => setRequiresHuman(e.target.checked)} />
            <span>
              Valor negociado pela equipe
              <small className="block text-xs text-muted">
                A IA não informa preço: coleta o que o cliente precisa e passa para um vendedor (aparece em Precisa de mim).
              </small>
            </span>
          </label>

          <fieldset disabled={readOnly} className="m-0 grid gap-2.5 border-0 p-0 sm:grid-cols-2">
            <TextField
              label="Preço de venda (confirmado)"
              name="salePrice"
              inputMode="decimal"
              value={priceLocked && isRental ? "" : salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              disabled={priceLocked && isRental}
              placeholder="Sob consulta"
              hint={priceLocked && isRental ? "Negociado pela equipe." : "É o valor que a IA informa. Vazio = sob consulta."}
            />
            {isRental && (
              <TextField
                label="Aluguel por mês"
                name="rentPriceMonth"
                inputMode="decimal"
                defaultValue={moneyText(product?.rentPriceMonth ?? null)}
                disabled={priceLocked}
                hint={priceLocked ? "Negociado pela equipe." : "Só para referência interna."}
              />
            )}
          </fieldset>

          {canEdit && product?.referencePrice != null && (
            <div className="notice">
              <div className="min-w-0 flex-1">
                <b>Referência: {formatBRL(product.referencePrice)}</b>
                <small className="block text-xs opacity-80">{product.referenceNote}</small>
              </div>
              {!(priceLocked && isRental) && (
                <Button size="sm" variant="soft" disabled={readOnly} onClick={() => setSalePrice(moneyText(product.referencePrice))}>
                  Usar como preço
                </Button>
              )}
            </div>
          )}
        </section>

        <fieldset disabled={readOnly} className="m-0 grid gap-2.5 border-0 p-0 sm:grid-cols-2">
          <h3 className="text-[13px] font-[650] sm:col-span-2">Estoque e divulgação</h3>
          <TextField
            label="Estoque"
            name="stock"
            type="number"
            step={1}
            defaultValue={product?.stock ?? 0}
            hint={product?.stockUpdatedAt ? `Atualizado pela importação em ${formatDateTime(product.stockUpdatedAt)}` : undefined}
          />
          {isRental ? (
            <TextField label="Em locação agora" name="rentedCount" type="number" min={0} step={1} defaultValue={product?.rentedCount ?? 0} />
          ) : (
            <input type="hidden" name="rentedCount" value={product?.rentedCount ?? 0} />
          )}
          <TextField label="Campanha" name="promoLabel" defaultValue={product?.promoLabel ?? ""} placeholder="Ex.: Oferta de outubro" className={isRental ? "sm:col-span-2" : ""} />
          <TextAreaField
            label="Informações para a IA"
            name="aiNotes"
            rows={3}
            defaultValue={product?.aiNotes ?? ""}
            placeholder="Medidas, indicação de uso, garantia, peso suportado..."
            hint="A IA pode usar este texto para explicar o produto. Não coloque preço nem desconto aqui."
            className="sm:col-span-2"
          />
        </fieldset>

        <label className="flex items-center gap-3 text-[13.5px]">
          <Switch label="No catálogo" checked={active} disabled={readOnly} onChange={(e) => setActive(e.target.checked)} />
          <span>
            {active ? "No catálogo" : "Fora do catálogo"}
            <small className="block text-xs text-muted">Fora do catálogo, a IA não oferece o produto.</small>
          </span>
        </label>

        {!canEdit && <Pill className="justify-self-start">Somente consulta</Pill>}
        {error && <Notice tone="bad">{error}</Notice>}
      </form>
    </Drawer>
  );
}
