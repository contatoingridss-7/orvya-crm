"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Filme da marca no login, em loop. Só monta o vídeo em tela larga e sem "reduzir movimento",
 * para não gastar dados no celular. O arquivo já tem uma pausa no símbolo e esmaece no fim,
 * para a volta ao começo ficar suave.
 */
export function AuthFilm({ className = "auth-video", minWidth = 1024 }: { className?: string; minWidth?: number }) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const wide = window.matchMedia(`(min-width: ${minWidth}px)`);
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setShow(wide.matches && !calm.matches);
    update();
    wide.addEventListener("change", update);
    calm.addEventListener("change", update);
    return () => {
      wide.removeEventListener("change", update);
      calm.removeEventListener("change", update);
    };
  }, [minWidth]);

  // O React não grava o atributo "muted" no HTML, e o navegador só toca sozinho vídeo mudo:
  // marca como mudo pela propriedade e manda tocar.
  useEffect(() => {
    const v = ref.current;
    if (!show || !v) return;
    v.muted = true;
    v.play().catch(() => {
      // Navegador bloqueou (economia de energia, por exemplo): fica o pôster com o símbolo.
    });
  }, [show]);

  // Sem vídeo (animações reduzidas): fica a imagem final, com o símbolo.
  if (!show) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={className} src="/brand/orvya-intro-poster.jpg" alt="" loading="lazy" />;
  }
  return (
    <video ref={ref} className={className} autoPlay muted loop playsInline preload="auto" poster="/brand/orvya-intro-poster.jpg">
      <source src="/brand/orvya-intro.mp4" type="video/mp4" />
    </video>
  );
}
