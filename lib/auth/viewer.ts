import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { homeSection, type MemberRole, type Role } from "@/lib/auth/roles";

export type CompanyAccess = {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  segment: string | null;
  role: Role;
  /** Automações, Canais, Equipe e Agente de IA: admin, ou gestor com o acesso liberado (memberships.settings_access). */
  canConfigure: boolean;
};

export type Viewer = {
  id: string;
  email: string;
  fullName: string;
  isAdmin: boolean;
  active: boolean;
  theme: "light" | "dark" | null;
  /** Entrou com senha provisória (criada ou redefinida pelo admin): precisa criar a própria antes de usar. */
  mustChangePassword: boolean;
  companies: CompanyAccess[];
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  is_platform_admin: boolean;
  active: boolean;
  theme: "light" | "dark" | null;
};
type CompanyRow = { id: string; slug: string; name: string; short_name: string; segment: string | null };
type MembershipRow = { company_id: string; role: MemberRole; settings_access?: boolean };

/**
 * Usuário logado com perfil e empresas que ele acessa (uma consulta por requisição).
 * As listas vêm pelo cliente autenticado, então já respeitam o RLS.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [profileRes, companiesRes, membershipsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email, is_platform_admin, active, theme")
      .eq("id", user.id)
      .maybeSingle<ProfileRow>(),
    supabase.from("companies").select("id, slug, name, short_name, segment").order("name").returns<CompanyRow[]>(),
    supabase.from("memberships").select("company_id, role, settings_access").eq("user_id", user.id).returns<MembershipRow[]>(),
  ]);

  const profile = profileRes.data;
  const isAdmin = Boolean(profile?.is_platform_admin && profile.active);
  const roleByCompany = new Map((membershipsRes.data ?? []).map((m) => [m.company_id, m.role]));
  const settingsByCompany = new Map((membershipsRes.data ?? []).map((m) => [m.company_id, m.settings_access === true]));

  const companies: CompanyAccess[] = (companiesRes.data ?? []).flatMap((c) => {
    const role: Role | undefined = isAdmin ? "admin" : roleByCompany.get(c.id);
    const canConfigure = role === "admin" || (role === "gestor" && settingsByCompany.get(c.id) === true);
    return role ? [{ id: c.id, slug: c.slug, name: c.name, shortName: c.short_name, segment: c.segment, role, canConfigure }] : [];
  });

  return {
    id: user.id,
    email: profile?.email ?? user.email ?? "",
    fullName: profile?.full_name || user.email?.split("@")[0] || "Usuário",
    isAdmin,
    // Sem perfil = algo deu errado no cadastro; tratar como sem acesso.
    active: profile?.active ?? false,
    theme: profile?.theme ?? null,
    mustChangePassword: user.user_metadata?.must_change_password === true,
    companies,
  };
});

/** Exige login e conta ativa. Conta desativada é deslogada na hora. */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.active) redirect("/auth/sair?motivo=desativado");
  if (viewer.mustChangePassword) redirect("/redefinir-senha?primeiro=1");
  return viewer;
}

export type CompanyContext = { viewer: Viewer; company: CompanyAccess };

/** Exige acesso à empresa do endereço. Sem acesso, volta para a escolha de empresa. */
export async function requireCompany(slug: string): Promise<CompanyContext> {
  const viewer = await requireViewer();
  const company = viewer.companies.find((c) => c.slug === slug);
  if (!company) redirect("/");
  return { viewer, company };
}

/** Telas de configuração: admin, ou gestor com o acesso liberado. Os outros voltam para a tela inicial. */
export async function requireSettings(slug: string): Promise<CompanyContext> {
  const ctx = await requireCompany(slug);
  if (!ctx.company.canConfigure) redirect(`/${slug}/${homeSection(ctx.company.role)}`);
  return ctx;
}

/** Exige um dos perfis. Quem não pode ver a tela vai para a tela inicial do seu perfil. */
export async function requireRole(slug: string, allowed: Role[]): Promise<CompanyContext> {
  const ctx = await requireCompany(slug);
  if (!allowed.includes(ctx.company.role)) redirect(`/${slug}/${homeSection(ctx.company.role)}`);
  return ctx;
}
