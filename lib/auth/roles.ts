// Perfis conforme docs/SPEC.md. Quem bloqueia de verdade é o RLS no banco;
// isto serve só para a interface decidir o que mostrar.

export type MemberRole = "gestor" | "vendedor" | "logistica";
export type Role = "admin" | MemberRole;

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  gestor: "Gestor",
  vendedor: "Vendedor",
  logistica: "Expedição",
};

export const MEMBER_ROLES: MemberRole[] = ["gestor", "vendedor", "logistica"];

/** Perfis da área comercial (funil, conversas, tarefas). A expedição fica de fora. */
export const SALES_ROLES: Role[] = ["admin", "gestor", "vendedor"];

export function isManager(role: Role): boolean {
  return role === "admin" || role === "gestor";
}

/** Tela inicial de cada perfil: vendedor cai em Meu dia; expedição na Expedição; admin e gestor no Painel. */
export function homeSection(role: Role): string {
  if (role === "vendedor") return "meu-dia";
  if (role === "logistica") return "expedicao";
  return "painel";
}
