// Perfis conforme docs/SPEC.md. Quem bloqueia de verdade é o RLS no banco;
// isto serve só para a interface decidir o que mostrar.

export type MemberRole = "gestor" | "vendedor";
export type Role = "admin" | MemberRole;

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  gestor: "Gestor",
  vendedor: "Vendedor",
};

export function isManager(role: Role): boolean {
  return role === "admin" || role === "gestor";
}
