import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app-shell/page-header";
import { requireRole } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { MaterialsManager, QuickRepliesManager } from "./manager";

export const metadata: Metadata = { title: "Respostas e materiais" };

/** Respostas rápidas e materiais da empresa: gestor e admin cadastram; a equipe usa nas conversas. */
export default async function RespostasPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { company } = await requireRole((await params).empresa, ["admin", "gestor"]);
  const supabase = await createClient();
  const [repliesRes, materialsRes] = await Promise.all([
    supabase
      .from("quick_replies")
      .select("*")
      .eq("company_id", company.id)
      .order("uses", { ascending: false })
      .order("shortcut")
      .returns<{ id: string; shortcut: string; body: string; uses: number; material_ids?: string[] }[]>(),
    supabase
      .from("sales_materials")
      .select("id, title, file_name, mime, size_bytes, uses")
      .eq("company_id", company.id)
      .order("title")
      .returns<{ id: string; title: string; file_name: string; mime: string; size_bytes: number; uses: number }[]>(),
  ]);

  return (
    <>
      <PageHeader
        title="Respostas e materiais"
        subtitle={`${company.name}: atalhos de texto (/) e catálogos em PDF para a equipe usar nas conversas`}
        actions={
          <Link href={`/${company.slug}/conversas`} className="btn">
            Voltar às conversas
          </Link>
        }
      />
      <div className="content grid gap-4">
        <QuickRepliesManager
          slug={company.slug}
          replies={(repliesRes.data ?? []).map((r) => ({ id: r.id, shortcut: r.shortcut, body: r.body, uses: r.uses, materialIds: r.material_ids ?? [] }))}
          materials={(materialsRes.data ?? []).filter((m) => m.mime.startsWith("image/")).map((m) => ({ id: m.id, title: m.title }))}
          loadError={!!repliesRes.error}
        />
        <MaterialsManager
          slug={company.slug}
          companyId={company.id}
          materials={(materialsRes.data ?? []).map((m) => ({ id: m.id, title: m.title, fileName: m.file_name, mime: m.mime, size: m.size_bytes, uses: m.uses }))}
          loadError={!!materialsRes.error}
        />
      </div>
    </>
  );
}
