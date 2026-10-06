// Perfis conforme docs/SPEC.md. Quem bloqueia de verdade é o RLS no banco;
// isto serve só para a interface decidir o que mostrar.

export type MemberRole = "gestor" | "vendedor";
export type Role = "admin" | MemberRole;

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  gestor: "Gestor",
  vendedor: "Vendedor",
};

export const MEMBER_ROLES: MemberRole[] = ["gestor", "vendedor"];

export function isManager(role: Role): boolean {
  return role === "admin" || role === "gestor";
}

/** Tela inicial de cada perfil: vendedor cai em Meu dia; admin e gestor no Painel. */
export function homeSection(role: Role): string {
  return role === "vendedor" ? "meu-dia" : "painel";
}
