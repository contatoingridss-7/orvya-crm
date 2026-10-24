"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand, Signature } from "@/components/brand";
import { ROLE_LABEL, type Role } from "@/lib/auth/roles";
import { initials, monogram } from "@/lib/names";
import { navFor } from "./nav-items";

export type ShellCompany = { slug: string; name: string; shortName: string; segment: string | null };

type SidebarProps = {
  current: ShellCompany;
  companies: ShellCompany[];
  role: Role;
  userName: string;
  /** Contadores ao lado do item do menu (ex.: { fila: 3 }). */
  counts?: Partial<Record<string, number>>;
};

/** Seção atual a partir do endereço (/ic-supra/config/equipe → config/equipe). */
export function useSection(slug: string): string {
  const pathname = usePathname();
  return pathname.replace(`/${slug}`, "").replace(/^\//, "");
}

export function Sidebar({ current, companies, role, userName, counts }: SidebarProps) {
  const section = useSection(current.slug);

  return (
    <aside className="side">
      {/* A marca leva de volta à tela de entrada (saudação e escolha da empresa). */}
      <Link href="/" className="brand-row block rounded-[12px] transition-opacity hover:opacity-80" aria-label="Início: voltar à tela de entrada" title="Voltar ao início">
        <Brand />
      </Link>

      {companies.length > 1 && (
        <nav className="co-switch" aria-label="Empresa">
          {companies.map((c) => (
            <Link
              key={c.slug}
              href={`/${c.slug}/${section}`}
              className="co-btn"
              aria-current={c.slug === current.slug ? "true" : undefined}
            >
              <span className="mono" data-co={c.slug}>
                {monogram(c)}
              </span>
              <span className="min-w-0">
                <b>{c.name}</b>
                {c.segment && <small>{c.segment}</small>}
              </span>
            </Link>
          ))}
        </nav>
      )}

      <nav className="nav" aria-label="Seções">
        {navFor(role).map((item, i) =>
          "sep" in item ? (
            <div key={`sep-${i}`} className="sep" role="separator" />
          ) : (
            <Link
              key={item.section}
              href={`/${current.slug}/${item.section}`}
              aria-current={section === item.section || section.startsWith(`${item.section}/`) ? "page" : undefined}
            >
              {item.icon}
              <span>{item.label}</span>
              {!!counts?.[item.section] && (
                <span className="count alert" aria-label={`${counts[item.section]} pendentes`}>
                  {counts[item.section]! > 99 ? "99+" : counts[item.section]}
                </span>
              )}
            </Link>
          ),
        )}
      </nav>

      <div className="side-foot">
        <div className="user-box">
          <span className="av" aria-hidden>
            {initials(userName)}
          </span>
          <div className="min-w-0 flex-1">
            <b>{userName}</b>
            <small>{ROLE_LABEL[role]}</small>
          </div>
          <form action="/auth/sair" method="post">
            <button type="submit" className="btn ghost sm">
              Sair
            </button>
          </form>
        </div>
        <Signature className="mx-1" />
      </div>
    </aside>
  );
}
