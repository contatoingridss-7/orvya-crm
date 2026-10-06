"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { takeLead } from "../funil/actions";

/** "Pegar" um lead da fila: vira responsável e abre o lead no funil. */
export function TakeButton({ slug, leadId, href }: { slug: string; leadId: string; href: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  return (
    <Button
      size="sm"
      variant="primary"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await takeLead(slug, leadId);
          if (r.ok) {
            toast(r.message ?? "O lead agora é seu.", "ok");
            router.push(href);
          } else {
            toast(r.error, "bad");
            router.refresh();
          }
        })
      }
    >
      Pegar
    </Button>
  );
}
