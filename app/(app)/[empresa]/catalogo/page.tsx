import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app-shell/page-header";
import { Notice } from "@/components/ui/notice";
import { isManager } from "@/lib/auth/roles";
import { requireCompany } from "@/lib/auth/viewer";
import { PRODUCT_COLUMNS, toProduct, type ProductRow } from "@/lib/catalog/types";
import { createClient } from "@/lib/supabase/server";
import { CatalogView } from "./catalog-view";
import { LastImportLine, loadLastImport } from "./last-import";

export const metadata: Metadata = { title: "Catálogo" };

export default async function CatalogoPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { company } = await requireCompany((await params).empresa);
  const canEdit = isManager(company.role);
  // Foto: gestor, admin e expedição (a expedição não altera preço nem estoque).
  const canPhoto = canEdit || company.role === "logistica";
  const isLoc = company.slug === "locpress";

  const supabase = await createClient();
  const [{ data, error }, salesRes, lastImport] = await Promise.all([
    supabase.from("products").select(PRODUCT_COLUMNS).eq("company_id", company.id).order("name").returns<ProductRow[]>(),
    // Média mensal de unidades vendidas (histórico do Net Use). Só quantidade: vale para todos.
    supabase.rpc("product_monthly_sales", { p_company: company.id }),
    loadLastImport(supabase, company.id),
  ]);
  const salesPerMonth = Object.fromEntries(
    ((salesRes.data as { product_id: string; per_month: number | string }[] | null) ?? []).map((r) => [r.product_id, Number(r.per_month)]),
  );

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
        {lastImport && <LastImportLine data={lastImport} />}
        <CatalogView products={products} slug={company.slug} companyId={company.id} canEdit={canEdit} canPhoto={canPhoto} isLoc={isLoc} salesPerMonth={salesPerMonth} />
      </div>
    </>
  );
}
