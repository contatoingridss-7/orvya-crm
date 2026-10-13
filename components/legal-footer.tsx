import Link from "next/link";
import { LEGAL } from "@/lib/legal";

/** Nota de rodapé das páginas públicas: responsável, CNPJ e link da política de privacidade. */
export function LegalFooter() {
  return (
    <p className="m-0 text-center text-[11px] leading-relaxed text-muted">
      {LEGAL.brand} é uma marca de {LEGAL.owner} · CNPJ {LEGAL.cnpj}
      <br />
      <Link href="/privacidade" className="underline-offset-2 hover:underline">
        Política de privacidade
      </Link>
    </p>
  );
}
