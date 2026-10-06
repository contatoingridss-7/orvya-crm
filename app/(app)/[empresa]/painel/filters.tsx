"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PERIODS } from "@/lib/crm/period";
import type { Person } from "@/lib/crm/types";

/** Filtros do Painel guardados no endereço (dá para compartilhar o link). */
export function PainelFilters({ people, period, owner }: { people: Person[]; period: string; owner: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  }

  return (
    <div className="toolbar">
      <select className="inp !w-auto" value={owner} onChange={(e) => set("vendedor", e.target.value)} aria-label="Vendedor">
        <option value="">Toda a equipe</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        <option value="sem">Sem responsável</option>
      </select>
      <select className="inp !w-auto" value={period} onChange={(e) => set("periodo", e.target.value)} aria-label="Período">
        {PERIODS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </select>
    </div>
  );
}
