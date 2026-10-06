import type { ReactNode } from "react";
import type { Role } from "@/lib/auth/roles";

export type NavItem = { section: string; label: string; short?: string; icon: ReactNode } | { sep: true };

// Ícones do protótipo
const I = {
  painel: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  meuDia: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  funil: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="10" y="4" width="5" height="11" rx="1.5" />
      <rect x="17" y="4" width="4" height="7" rx="1.5" />
    </svg>
  ),
  conversas: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
    </svg>
  ),
  fila: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  ),
  tarefas: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="4" y="4" width="16" height="17" rx="2" />
      <path d="M8 2v4M16 2v4M8 12l3 3 5-6" />
    </svg>
  ),
  catalogo: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M21 8l-9-5-9 5 9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </svg>
  ),
  automacoes: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  ),
  canais: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0V7zM12 16v5" />
    </svg>
  ),
  equipe: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.7 3 2.5 3.5 5.2" />
    </svg>
  ),
  ia: (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
    </svg>
  ),
};

// Ordem e nomes conforme docs/SPEC.md, seção 3.
const MANAGER_NAV: NavItem[] = [
  { section: "painel", label: "Painel", icon: I.painel },
  { section: "funil", label: "Funil", icon: I.funil },
  { section: "conversas", label: "Conversas", icon: I.conversas },
  { section: "fila", label: "Precisa de mim", icon: I.fila },
  { section: "tarefas", label: "Tarefas", icon: I.tarefas },
  { section: "catalogo", label: "Catálogo", icon: I.catalogo },
  { sep: true },
  { section: "config/automacoes", label: "Automações", icon: I.automacoes },
  { section: "config/canais", label: "Canais e integrações", icon: I.canais },
  { section: "config/equipe", label: "Equipe", icon: I.equipe },
  { section: "config/ia", label: "Agente de IA", icon: I.ia },
];

const SELLER_NAV: NavItem[] = [
  { section: "meu-dia", label: "Meu dia", icon: I.meuDia },
  { section: "conversas", label: "Conversas", icon: I.conversas },
  { section: "funil", label: "Meu funil", short: "Funil", icon: I.funil },
  { section: "tarefas", label: "Tarefas", icon: I.tarefas },
  { section: "catalogo", label: "Catálogo", icon: I.catalogo },
];

export function navFor(role: Role): NavItem[] {
  return role === "vendedor" ? SELLER_NAV : MANAGER_NAV;
}
