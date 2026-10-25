"use client";

import { Button } from "@/components/ui/button";

/** Relatório do período escolhido em PDF (impressão do navegador → "Salvar como PDF"). */
export function PrintButton() {
  return (
    <Button variant="primary" className="no-print" onClick={() => window.print()}>
      Baixar relatório
    </Button>
  );
}
