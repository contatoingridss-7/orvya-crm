import { BottomNav } from "@/components/app-shell/bottom-nav";
import { Sidebar, type ShellCompany } from "@/components/app-shell/sidebar";
import { ThemeSync } from "@/components/theme-toggle";
import { isManager } from "@/lib/auth/roles";
import { WAIT_MINUTES } from "@/lib/crm/attention";
import { requireCompany, type CompanyAccess } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

/**
 * Contador de "Precisa de mim": pedidos de atendimento + conversas cuja última mensagem é do
 * cliente há mais de WAIT_MINUTES (5 min). Duas contagens baratas (head: true) pelo cliente autenticado.
 */
async function attentionCount(companyId: string): Promise<number> {
  const supabase = await createClient();
  const cutoff = new Date(Date.now() - WAIT_MINUTES * 60_000).toISOString();
  const [needs, waiting] = await Promise.all([
    supabase.from("conversations").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("needs_human", true),
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("needs_human", false)
      .eq("last_direction", "in")
      .lt("last_inbound_at", cutoff),
  ]);
  return (needs.count ?? 0) + (waiting.count ?? 0);
}

function toShell(c: CompanyAccess): ShellCompany {
  return { slug: c.slug, name: c.name, shortName: c.shortName, segment: c.segment };
}

export default async function CompanyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ empresa: string }>;
}) {
  const { empresa } = await params;
  const { viewer, company } = await requireCompany(empresa);
  const filaCount = isManager(company.role) ? await attentionCount(company.id) : 0;

  return (
    <div className="app" data-role={company.role}>
      <ThemeSync theme={viewer.theme} />
      <Sidebar
        current={toShell(company)}
        companies={viewer.companies.map(toShell)}
        role={company.role}
        userName={viewer.fullName}
        counts={{ fila: filaCount }}
      />
      <div className="main">{children}</div>
      {(company.role === "vendedor" || company.role === "logistica") && <BottomNav slug={company.slug} role={company.role} />}
    </div>
  );
}
