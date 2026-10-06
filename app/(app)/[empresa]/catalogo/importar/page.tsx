import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app-shell/page-header";
import { requireRole } from "@/lib/auth/viewer";
import type { ExistingProduct } from "@/lib/catalog/import-plan";
import { createClient } from "@/lib/supabase/server";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Importar catálogo" };

type Row = { id: string; code: string | null; name: string; active: boolean; stock: number; sale_price: string | number | null; is_rental: boolean };

export default async function ImportarPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { company } = await requireRole((await params).empresa, ["admin", "gestor"]);
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("id, code, name, active, stock, sale_price, is_rental")
    .eq("company_id", company.id)
    .returns<Row[]>();

  const existing: ExistingProduct[] = (data ?? []).map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    active: p.active,
    stock: p.stock,
    salePrice: p.sale_price === null ? null : Number(p.sale_price),
    isRental: p.is_rental,
  }));

  return (
    <>
      <PageHeader
        title="Importar catálogo"
        subtitle={`${company.name}: relatórios do Net Use ou planilha`}
        actions={
          <Link href={`/${company.slug}/catalogo`} className="btn">
            Voltar ao catálogo
          </Link>
        }
      />
      <div className="content">
        <ImportWizard slug={company.slug} companyName={company.name} existing={existing} />
      </div>
    </>
  );
}
