import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

type PageHeaderProps = {
  title: string;
  /** Texto abaixo do título. O protótipo usa "Empresa: descrição". */
  subtitle?: ReactNode;
  actions?: ReactNode;
};

/** Topo de toda tela do app: título, ações e a alternância claro/escuro. */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="top">
      <div className="min-w-0">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="flex-1" />
      {actions}
      <ThemeToggle persist />
      {/* No celular a lateral some com o botão Sair; ele aparece aqui. */}
      <form action="/auth/sair" method="post" className="only-mobile">
        <button type="submit" className="icon-btn" aria-label="Sair" title="Sair">
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" />
          </svg>
        </button>
      </form>
    </header>
  );
}
