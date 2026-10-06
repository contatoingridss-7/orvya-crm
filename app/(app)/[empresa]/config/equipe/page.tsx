import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/page-header";
import { Notice } from "@/components/ui/notice";
import type { MemberRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { TeamManager, type TeamMember } from "./team-manager";

export const metadata: Metadata = { title: "Equipe" };

type MembershipRow = {
  role: MemberRole;
  profiles: { id: string; full_name: string | null; email: string | null; active: boolean } | null;
};
type ProfileRow = { id: string; full_name: string | null; email: string | null; active: boolean };

export default async function EquipePage({ params }: { params: Promise<{ empresa: string }> }) {
  const { viewer, company } = await requireRole((await params).empresa, ["admin", "gestor"]);
  const canEdit = company.role === "admin";
  const supabase = await createClient();

  const [membersRes, adminsRes] = await Promise.all([
    supabase
      .from("memberships")
      .select("role, profiles(id, full_name, email, active)")
      .eq("company_id", company.id)
      .returns<MembershipRow[]>(),
    canEdit
      ? supabase.from("profiles").select("id, full_name, email, active").eq("is_platform_admin", true).returns<ProfileRow[]>()
      : Promise.resolve({ data: [] as ProfileRow[], error: null }),
  ]);

  const members: TeamMember[] = (membersRes.data ?? [])
    .flatMap((m) =>
      m.profiles
        ? [{ id: m.profiles.id, name: m.profiles.full_name || m.profiles.email || "Sem nome", email: m.profiles.email ?? "", role: m.role, active: m.profiles.active }]
        : [],
    )
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "pt-BR"));

  const admins = (adminsRes.data ?? []).map((p) => ({ id: p.id, name: p.full_name || p.email || "Sem nome", email: p.email ?? "" }));

  return (
    <>
      <PageHeader
        title="Equipe"
        subtitle={`${company.name}: quem acessa o Orvya e com qual perfil`}
      />
      <div className="content grid gap-4">
        {membersRes.error && <Notice tone="bad">Não foi possível carregar a equipe. Recarregue a página.</Notice>}
        {!canEdit && <Notice>Você pode ver a equipe. Convites e mudanças de perfil são feitos pelo administrador.</Notice>}
        <TeamManager
          members={members}
          admins={admins}
          companyId={company.id}
          companyName={company.name}
          companies={viewer.companies.map((c) => ({ id: c.id, name: c.name }))}
          canEdit={canEdit}
          viewerId={viewer.id}
        />
      </div>
    </>
  );
}
