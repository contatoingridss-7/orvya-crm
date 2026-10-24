import { cn } from "@/lib/cn";

export const SLOGAN = "Conexões inteligentes. Resultados integrados.";

/**
 * Símbolo VÉR7ICE: três vértices aninhados apontando para baixo; o central em verde mineral.
 * Traço na cor do texto (off-white no escuro, grafite no claro).
 */
export function BrandMark({ className, size = 34 }: { className?: string; size?: number }) {
  return (
    <span className={cn("vmark", className)} style={{ width: size, height: size * 1.04 }} aria-hidden>
      <svg viewBox="0 0 100 104">
        <path d="M6 7 L50 97 L94 7" strokeWidth="5.2" />
        <path d="M23 7 L50 60 L77 7" strokeWidth="5.2" />
        <path className="v-in" d="M40.5 7 L50 27 L59.5 7" strokeWidth="5.2" />
      </svg>
    </span>
  );
}

/** Logotipo oficial VÉR7ICE (arquivo da marca aplicado como máscara, na cor do texto). */
export function Wordmark({ className }: { className?: string }) {
  return <span className={cn("wordmark", className)} role="img" aria-label="VÉR7ICE" />;
}

/** Símbolo + "Orvya" + slogan (topo da lateral e telas de entrada). */
export function Brand({ showSlogan = true }: { showSlogan?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <BrandMark size={30} />
      <div>
        <strong className="font-title block text-[20px] leading-[1.05] font-semibold tracking-[-0.035em] text-title">Orvya</strong>
        {showSlogan && <span className="mt-1 block max-w-[190px] text-[10.5px] leading-[1.35] text-muted">{SLOGAN}</span>}
      </div>
    </div>
  );
}

/** Assinatura "VÉR7ICE Orvya" (rodapé da lateral e das telas de entrada). */
export function Signature({ className }: { className?: string }) {
  return (
    <p className={cn("signature m-0 flex items-center gap-1.5", className)}>
      <Wordmark className="text-[16px]" />
      <b>Orvya</b>
    </p>
  );
}
