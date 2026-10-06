"use client";

import Link from "next/link";
import { navFor } from "./nav-items";
import { useSection } from "./sidebar";

/** Barra inferior do vendedor no celular (só aparece em telas estreitas, via CSS). */
export function BottomNav({ slug }: { slug: string }) {
  const section = useSection(slug);

  return (
    <nav className="bottom-nav" aria-label="Seções">
      {navFor("vendedor").map((item) =>
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
