"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Recarrega os dados do servidor de tempos em tempos (ex.: novos alertas de espera). */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
