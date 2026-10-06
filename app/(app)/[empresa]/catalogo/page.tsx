import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app-shell/page-header";
import { Notice } from "@/components/ui/notice";
import { isManager } from "@/lib/auth/roles";
import { requireCompany } from "@/lib/auth/viewer";
import { PRODUCT_COLUMNS, toProduct, type ProductRow } from "@/lib/catalog/types";
import { createClient } from "@/lib/supabase/server";
import { CatalogView } from "./catalog-view";

export const metadata: Metadata = { title: "Catálogo" };

export default async function CatalogoPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { company } = await requireCompany((await params).empresa);
  const canEdit = isManager(company.role);
  const isLoc = company.slug === "locpress";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("company_id", company.id)
    .order("name")
    .returns<ProductRow[]>();

  const products = (data ?? []).map(toProduct);
  const sub = isLoc ? "equipamentos para venda e locação" : "produtos e preços que o agente pode informar";

  return (
    <>
      <PageHeader
        title="Catálogo"
        subtitle={`${company.name}: ${sub}`}
        actions={
          canEdit && (
            <Link href={`/${company.slug}/catalogo/importar`} className="btn">
              Importar
            </Link>
          )
        }
      />
      <div className="content grid gap-4">
        {error && <Notice tone="bad">Não foi possível carregar o catálogo. Recarregue a página.</Notice>}
        <CatalogView products={products} slug={company.slug} canEdit={canEdit} isLoc={isLoc} />
      </div>
    </>
  );
}
