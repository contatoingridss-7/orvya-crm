"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { sendTestReport } from "./actions";

/** Baixar em PDF (impressão do navegador → "Salvar como PDF") e testar o e-mail de sábado. */
export function ReportActions({ slug }: { slug: string }) {
  const toast = useToast();
  const [pending, start] = useTransition();

  return (
    <div className="no-print flex flex-wrap gap-2">
      <Button
        variant="soft"
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await sendTestReport(slug);
            toast(r.ok ? r.message : r.error, r.ok ? "ok" : "bad");
          })
        }
      >
        Enviar e-mail de teste
      </Button>
      <Button variant="primary" onClick={() => window.print()}>
        Baixar PDF
      </Button>
    </div>
  );
}
