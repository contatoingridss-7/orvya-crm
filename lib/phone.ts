/**
 * Normaliza telefone para E.164 (+5586999990000). Números com 10 ou 11 dígitos
 * são tratados como brasileiros com DDD. Retorna null se não parecer telefone.
 */
export function toE164(input: string): string | null {
  let d = input.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return `+${d}`;
  if (!d.startsWith("55") && d.length >= 8 && d.length <= 15) return `+${d}`;
  return null;
}

/** +5586999990000 → (86) 99999-0000. Outros países ficam como vieram. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const d = e164.replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const n = d.slice(4);
    return `(${ddd}) ${n.slice(0, n.length - 4)}-${n.slice(-4)}`;
  }
  return e164;
}
