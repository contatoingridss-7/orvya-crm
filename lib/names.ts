/** Iniciais para avatar: "Ingrid Soares" → "IS". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() || "?";
}

/** Sigla da empresa no seletor (como no protótipo: IC, LP). */
export function monogram(company: { slug: string; shortName: string }): string {
  if (company.slug === "ic-supra") return "IC";
  if (company.slug === "locpress") return "LP";
  return initials(company.shortName).slice(0, 2);
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
