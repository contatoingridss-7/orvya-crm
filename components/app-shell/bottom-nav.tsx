"use client";

import Link from "next/link";
import type { Role } from "@/lib/auth/roles";
import { navFor } from "./nav-items";
import { useSection } from "./sidebar";

/** Barra inferior do vendedor e da expedição no celular (só aparece em telas estreitas, via CSS). */
export function BottomNav({ slug, role }: { slug: string; role: Role }) {
  const section = useSection(slug);

  return (
    <nav className="bottom-nav" aria-label="Seções">
      {navFor(role).map((item) =>
        "sep" in item ? null : (
          <Link key={item.section} href={`/${slug}/${item.section}`} aria-current={section === item.section ? "page" : undefined}>
            {item.icon}
            <span>{item.short ?? item.label}</span>
          </Link>
        ),
      )}
    </nav>
  );
}
