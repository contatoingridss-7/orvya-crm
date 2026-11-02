import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Panel } from "@/components/ui/panel";
import { Pill, type Tone } from "@/components/ui/pill";
import { formatBRL } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { templateCost, type TemplateCategory } from "@/lib/whatsapp/pricing";

/** Respostas livres (dentro da janela de 24 h) gratuitas por número no mês (regra da Meta desde 01/10/2026). */
const FREE_REPLIES = 1000;

const STATUS: Record<string, { text: string; tone: Tone }> = {
  connected: { text: "Conectado", tone: "ok" },
  pending: { text: "Conectando", tone: "warn" },
  error: { text: "Com erro", tone: "bad" },
  off: { text: "Desligado", tone: "neutral" },
};

type NumberRow = { id: string; label: string; display_phone: string | null; status: string; coexistence: boolean | null };
type ConvRow = { id: string; channel: string; whatsapp_number_id: string | null; created_at: string };
type MsgRow = { conversation_id: string; direction: "in" | "out"; msg_type: string; template_name: string | null };

const int = new Intl.NumberFormat("pt-BR");

/**
 * WhatsApp no Painel: situação de cada número e o movimento do mês (conversas com cliente,
 * contatos novos, respostas livres contra o limite gratuito e modelos enviados com custo estimado).
 */
export async function WhatsappPanel({ supabase, companyId, slug, monthStart }: { supabase: SupabaseClient; companyId: string; slug: string; monthStart: Date }) {
  const since = monthStart.toISOString();
  const [numbersRes, convRes, msgRes, tplRes, igRes] = await Promise.all([
    supabase.from("whatsapp_numbers").select("id, label, display_phone, status, coexistence").eq("company_id", companyId).order("slot").returns<NumberRow[]>(),
    supabase.from("conversations").select("id, channel, whatsapp_number_id, created_at").eq("company_id", companyId).limit(20000).returns<ConvRow[]>(),
    supabase
      .from("messages")
      .select("conversation_id, direction, msg_type, template_name")
      .eq("company_id", companyId)
      .gte("sent_at", since)
      .limit(50000)
      .returns<MsgRow[]>(),
    supabase.from("message_templates").select("name, category").eq("company_id", companyId).returns<{ name: string; category: TemplateCategory }[]>(),
    supabase.from("instagram_accounts").select("username, status").eq("company_id", companyId).returns<{ username: string | null; status: string }[]>(),
  ]);

  const numbers = numbersRes.data ?? [];
  const convs = convRes.data ?? [];
  const msgs = msgRes.data ?? [];
  const category = new Map((tplRes.data ?? []).map((t) => [t.name, t.category]));
  const convNumber = new Map(convs.map((c) => [c.id, c.channel === "instagram" ? "instagram" : (c.whatsapp_number_id ?? "")]));

  const stats = (key: string) => {
    const mine = msgs.filter((m) => convNumber.get(m.conversation_id) === key);
    const withClient = new Set(mine.filter((m) => m.direction === "in").map((m) => m.conversation_id)).size;
    const replies = mine.filter((m) => m.direction === "out" && m.msg_type !== "template").length;
    const templates = mine.filter((m) => m.direction === "out" && m.msg_type === "template");
    const cost = templates.reduce((s, m) => s + templateCost(category.get(m.template_name ?? "") ?? "MARKETING"), 0);
    const newContacts = convs.filter((c) => (key === "instagram" ? c.channel === "instagram" : c.whatsapp_number_id === key) && c.created_at >= since).length;
    return { withClient, replies, templates: templates.length, cost, newContacts };
  };

  const ig = (igRes.data ?? []).find((a) => a.status === "connected");
  const failed = numbersRes.error || convRes.error || msgRes.error;

  return (
    <Panel
      title="WhatsApp"
      subtitle="Mês atual. Respostas dentro de 24 h da mensagem do cliente são grátis até 1.000 por número no mês; modelos enviados fora da janela são cobrados pela Meta."
      actions={
        <Link className="btn sm" href={`/${slug}/config/canais`}>
          Canais
        </Link>
      }
    >
      {failed ? (
        <div className="empty">Não foi possível carregar os números. Recarregue a página.</div>
      ) : numbers.length === 0 ? (
        <div className="empty">Nenhum número de WhatsApp cadastrado. Conecte em Configurações → Canais.</div>
      ) : (
        <div className="grid gap-3">
          {numbers.map((n) => {
            const st = STATUS[n.status] ?? STATUS.off!;
            const s = stats(n.id);
            const used = Math.min(1, s.replies / FREE_REPLIES);
            return (
              <div key={n.id} className="grid gap-2.5 rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="font-semibold text-title">{n.label}</b>
                  <small className="text-xs text-muted">{n.display_phone ? formatPhone(n.display_phone) : "sem número"}</small>
                  {n.coexistence && <Pill tone="ind">Também no celular</Pill>}
                  <Pill tone={st.tone} className="ml-auto">
                    {st.text}
                  </Pill>
                </div>
                {n.status === "connected" && (
                  <>
                    <div className="grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-4">
                      <Stat label="Conversas com cliente" value={int.format(s.withClient)} />
                      <Stat label="Contatos novos" value={int.format(s.newContacts)} />
                      <Stat label="Modelos enviados" value={int.format(s.templates)} />
                      <Stat label="Custo estimado" value={formatBRL(s.cost)} />
                    </div>
                    <div className="grid gap-1">
                      <div className="flex justify-between text-xs text-muted">
                        <span>Respostas livres no mês</span>
                        <span className="tabular-nums">
                          {int.format(s.replies)} de {int.format(FREE_REPLIES)} grátis
                        </span>
                      </div>
                      <span className="relative h-1.5 overflow-hidden rounded-full" style={{ background: "var(--tint)" }}>
                        <span
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{ width: `${Math.max(1, used * 100)}%`, background: used >= 0.9 ? "var(--lost)" : used >= 0.7 ? "var(--amber)" : "var(--accent)" }}
                        />
                      </span>
                    </div>
                  </>
                )}
              </div>
            );
          })}
          {ig && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-3 text-[13px]">
              <b className="font-semibold text-title">Instagram{ig.username ? ` @${ig.username}` : ""}</b>
              <span className="text-muted">
                {int.format(stats("instagram").withClient)} conversas com cliente · {int.format(stats("instagram").newContacts)} contatos novos
              </span>
              <Pill tone="ok" className="ml-auto">
                Conectado
              </Pill>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <small className="text-xs text-muted">{label}</small>
      <b className="text-[16px] font-semibold text-title tabular-nums">{value}</b>
    </div>
  );
}
