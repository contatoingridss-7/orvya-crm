import { cn } from "@/lib/cn";

export const SLOGAN = "Conexões inteligentes. Resultados integrados.";

/** Símbolo da Orvya: círculo com um ponto em órbita. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("mark", className)} aria-hidden>
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="7.5" />
        <circle cx="18.2" cy="6.8" r="1.6" fill="#fff" stroke="none" />
      </svg>
    </span>
  );
}

/** Símbolo + "Orvya" + slogan (topo da lateral e tela de login). */
export function Brand({ showSlogan = true }: { showSlogan?: boolean }) {
  return (
    <div className="flex items-center gap-[11px]">
      <BrandMark />
      <div>
        <strong className="block text-[19px] leading-[1.1] font-bold tracking-[-0.035em] text-title">Orvya</strong>
        {showSlogan && <span className="mt-0.5 block max-w-[190px] text-[10.5px] leading-[1.35] text-muted">{SLOGAN}</span>}
      </div>
    </div>
  );
}

/** Assinatura "VÉR7ICE Orvya" (rodapé da lateral e do login). */
export function Signature({ className }: { className?: string }) {
  return (
    <p className={cn("signature m-0", className)}>
      VÉR7ICE <b>Orvya</b>
    </p>
  );
}
