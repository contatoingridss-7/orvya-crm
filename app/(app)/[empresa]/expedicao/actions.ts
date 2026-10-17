"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/lib/auth/viewer";
import { LOGISTICS_LABEL } from "@/lib/crm/logistics";
import type { LogisticsStatus } from "@/lib/crm/types";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

const schema = z.object({ leadId: z.uuid(), status: z.enum(["agendado", "separado", "faturado", "em_rota", "entregue"]) });

/** Avança o pedido na expedição. A função do banco confere o perfil e registra no histórico do lead. */
export async function setLogisticsStatus(slug: string, input: z.input<typeof schema>): Promise<ActionResult> {
  const viewer = await getViewer();
  const company = viewer?.active ? viewer.companies.find((c) => c.slug === slug) : null;
  if (!company || company.role === "vendedor") return { ok: false, error: "Sem acesso à expedição." };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("logistics_set_status", { p_lead: parsed.data.leadId, p_status: parsed.data.status });
  if (error) {
    const msg = error.message;
    if (msg.includes("já entregue")) return { ok: false, error: "Este pedido já foi entregue." };
    if (msg.includes("saiu da etapa")) return { ok: false, error: "O vendedor tirou este lead da etapa de entrega. Confirme com ele." };
    return { ok: false, error: "Não foi possível atualizar o pedido." };
  }
  revalidatePath(`/${slug}/expedicao`);
  revalidatePath(`/${slug}/funil`);
  return { ok: true, message: `Pedido marcado como ${LOGISTICS_LABEL[parsed.data.status as LogisticsStatus].toLowerCase()}.` };
}
