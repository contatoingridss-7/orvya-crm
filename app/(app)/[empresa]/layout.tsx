import { BottomNav } from "@/components/app-shell/bottom-nav";
import { Sidebar, type ShellCompany } from "@/components/app-shell/sidebar";
import { ThemeSync } from "@/components/theme-toggle";
import { requireCompany, type CompanyAccess } from "@/lib/auth/viewer";

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

  return (
    <div className="app" data-role={company.role}>
      <ThemeSync theme={viewer.theme} />
      <Sidebar
        current={toShell(company)}
        companies={viewer.companies.map(toShell)}
        role={company.role}
        userName={viewer.fullName}
      />
      <div className="main">{children}</div>
      {company.role === "vendedor" && <BottomNav slug={company.slug} />}
    </div>
  );
}
