"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { ComingSoon } from "@/components/app-shell/coming-soon";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import { connectNumber, disconnectNumber, saveNumberSettings, type ActionResult } from "./actions";

export type NumberSlot = {
  slot: 1 | 2;
  label: string;
  displayPhone: string | null;
  phoneNumberId: string | null;
  wabaId: string | null;
  defaultPipelineId: string | null;
  status: "off" | "pending" | "connected" | "error";
  qualityRating: string | null;
  connectedAt: string | null;
  conversationsThisMonth: number;
  openLeads: number;
};

type Props = {
  slug: string;
  companyName: string;
  slots: NumberSlot[];
  pipelines: { id: string; name: string }[];
  canEdit: boolean;
  webhookUrl: string;
  env: { appSecret: boolean; verifyToken: boolean; graphVersion: string } | null;
};

const STATUS: Record<NumberSlot["status"], { label: string; tone: "ok" | "warn" | "bad" | "neutral" }> = {
  connected: { label: "Conectado", tone: "ok" },
  pending: { label: "Em configuração", tone: "warn" },
  error: { label: "Com erro", tone: "bad" },
  off: { label: "Não conectado", tone: "neutral" },
};

const QUALITY: Record<string, string> = { GREEN: "Alta", YELLOW: "Média", RED: "Baixa" };

export function ChannelsManager({ slug, companyName, slots, pipelines, canEdit, webhookUrl, env }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [connecting, setConnecting] = useState<NumberSlot | null>(null);
  const [editing, setEditing] = useState<NumberSlot | null>(null);
  const [disconnecting, setDisconnecting] = useState<NumberSlot | null>(null);
  const [pending, start] = useTransition();
  const pipelineName = (id: string | null) => pipelines.find((p) => p.id === id)?.name ?? "Primeiro funil";

  function run(fn: () => Promise<ActionResult>, after?: () => void) {
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast(r.message, "ok");
        after?.();
        router.refresh();
      } else toast(r.error, "bad");
    });
  }

  return (
    <>
      {env && (
        <Panel title="Webhook da Meta" subtitle="Configure no app da Meta: WhatsApp → Configuração → Webhook.">
          <dl className="m-0 grid gap-2.5 text-[13px] sm:grid-cols-[180px_minmax(0,1fr)]">
            <dt className="text-muted">URL de retorno (callback)</dt>
            <dd className="m-0 flex flex-wrap items-center gap-2">
              <code className="rounded-md bg-surface-2 px-2 py-1 break-all">{webhookUrl}</code>
              <Button
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(webhookUrl);
                  toast("Endereço copiado.", "ok");
                }}
              >
                Copiar
              </Button>
            </dd>
            <dt className="text-muted">Token de verificação</dt>
            <dd className="m-0">
              {env.verifyToken ? <Pill tone="ok">Configurado na Vercel</Pill> : <Pill tone="bad">Falta META_WEBHOOK_VERIFY_TOKEN na Vercel</Pill>}{" "}
              <span className="text-xs text-muted">use o mesmo valor no campo “Verificar token” da Meta</span>
            </dd>
            <dt className="text-muted">Chave secreta do app</dt>
            <dd className="m-0">{env.appSecret ? <Pill tone="ok">Configurada na Vercel</Pill> : <Pill tone="bad">Falta META_APP_SECRET na Vercel</Pill>}</dd>
            <dt className="text-muted">Campos a assinar</dt>
            <dd className="m-0">
              <code className="rounded-md bg-surface-2 px-1.5 py-0.5">messages</code>{" "}
              <span className="text-xs text-muted">
                e, para números que também ficam no celular (coexistência): <code>smb_message_echoes</code>, <code>history</code>, <code>smb_app_state_sync</code>
              </span>
            </dd>
            <dt className="text-muted">Versão da Graph API</dt>
            <dd className="m-0">{env.graphVersion}</dd>
          </dl>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {slots.map((n) => (
          <section key={n.slot} className="panel grid gap-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2>{n.label}</h2>
                <p className="m-0 text-xs text-muted">
                  Número {n.slot} da {companyName} · leads novos vão para o funil {pipelineName(n.defaultPipelineId)}
                </p>
              </div>
              <Pill tone={STATUS[n.status].tone}>{STATUS[n.status].label}</Pill>
            </div>

            <div className={n.displayPhone && n.status === "connected" ? "text-xl font-bold tracking-[-0.02em] text-title tabular-nums" : "text-sm text-muted"}>
              {n.status === "connected" ? (n.displayPhone ?? "Número conectado") : "Nenhum número conectado nesta vaga"}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                ["Conversas no mês", String(n.conversationsThisMonth)],
                ["Leads abertos", String(n.openLeads)],
                ["Qualidade", n.qualityRating ? (QUALITY[n.qualityRating] ?? n.qualityRating) : "—"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[10px] border border-line bg-surface-2 px-2.5 py-2">
                  <span className="block text-[11px] text-muted">{label}</span>
                  <b className="text-sm text-title">{value}</b>
                </div>
              ))}
            </div>
            {n.connectedAt && <small className="text-xs text-muted">Conectado desde {formatDate(n.connectedAt)}</small>}

            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={n.status === "connected" ? "default" : "primary"} onClick={() => setConnecting(n)}>
                  {n.status === "connected" ? "Reconectar" : "Conectar"}
                </Button>
                <Button size="sm" onClick={() => setEditing(n)}>
                  Nome e funil
                </Button>
                {n.status === "connected" && (
                  <Button size="sm" variant="ghost" className="danger" onClick={() => setDisconnecting(n)}>
                    Desconectar
                  </Button>
                )}
              </div>
            )}
          </section>
        ))}
      </div>

      <Panel title="Modelos de mensagem" subtitle="Mensagens aprovadas pela Meta para falar com o cliente fora da janela de 24 horas.">
        <ComingSoon phase="Fase 3b">Cadastro, envio para aprovação e sincronização dos modelos.</ComingSoon>
      </Panel>

      <Panel title="Anúncios, site e outros canais" subtitle="Meta Ads, Google Ads, formulário do site, Instagram e Messenger.">
        <ComingSoon phase="Fase 6">Integrações de anúncios e do site.</ComingSoon>
      </Panel>

      {connecting && (
        <ConnectModal
          slot={connecting}
          pipelines={pipelines}
          pending={pending}
          onClose={() => setConnecting(null)}
          onSubmit={(input) => run(() => connectNumber(slug, input), () => setConnecting(null))}
        />
      )}

      {editing && (
        <SettingsModal
          slot={editing}
          pipelines={pipelines}
          pending={pending}
          onClose={() => setEditing(null)}
          onSubmit={(input) => run(() => saveNumberSettings(slug, input), () => setEditing(null))}
        />
      )}

      <Modal
        open={!!disconnecting}
        onClose={() => setDisconnecting(null)}
        title={`Desconectar “${disconnecting?.label ?? ""}”?`}
        actions={
          <>
            <Button onClick={() => setDisconnecting(null)}>Cancelar</Button>
            <Button variant="primary" loading={pending} onClick={() => disconnecting && run(() => disconnectNumber(slug, disconnecting.slot), () => setDisconnecting(null))}>
              Desconectar
            </Button>
          </>
        }
      >
        <p className="m-0 text-[13.5px]">
          O Orvya para de receber e enviar mensagens por este número. As conversas e os leads continuam aqui. O número continua funcionando na Meta e no celular.
        </p>
      </Modal>
    </>
  );
}

type SettingsInput = { slot: 1 | 2; label: string; defaultPipelineId: string };

function SettingsFields({ slot, pipelines }: { slot: NumberSlot; pipelines: Props["pipelines"] }) {
  return (
    <>
      <TextField label="Nome interno" name="label" defaultValue={slot.label} required placeholder="Ex.: Atendimento e vendas" />
      <SelectField label="Funil dos leads novos" name="defaultPipelineId" defaultValue={slot.defaultPipelineId ?? pipelines[0]?.id}>
        {pipelines.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </SelectField>
    </>
  );
}

function SettingsModal({ slot, pipelines, pending, onClose, onSubmit }: { slot: NumberSlot; pipelines: Props["pipelines"]; pending: boolean; onClose: () => void; onSubmit: (i: SettingsInput) => void }) {
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    onSubmit({ slot: slot.slot, label: String(f.get("label") ?? ""), defaultPipelineId: String(f.get("defaultPipelineId") ?? "") });
  }
  return (
    <Modal open onClose={onClose} title="Nome e funil do número">
      <form onSubmit={submit} className="grid gap-3">
        <SettingsFields slot={slot} pipelines={pipelines} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" loading={pending}>
            Salvar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ConnectModal({
  slot,
  pipelines,
  pending,
  onClose,
  onSubmit,
}: {
  slot: NumberSlot;
  pipelines: Props["pipelines"];
  pending: boolean;
  onClose: () => void;
  onSubmit: (i: SettingsInput & { phoneNumberId: string; wabaId: string; token: string }) => void;
}) {
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    onSubmit({
      slot: slot.slot,
      label: get("label"),
      defaultPipelineId: get("defaultPipelineId"),
      phoneNumberId: get("phoneNumberId"),
      wabaId: get("wabaId"),
      token: get("token"),
    });
  }
  const reconnecting = slot.status === "connected";

  return (
    <Modal open onClose={onClose} title={`Conectar “${slot.label}” pela API oficial`}>
      <form onSubmit={submit} className="grid gap-3">
        <Notice>
          Os dados ficam no app da Meta, em <b>WhatsApp → Configuração da API</b>. O token é guardado só no servidor e nunca aparece de novo na tela.
        </Notice>
        <SettingsFields slot={slot} pipelines={pipelines} />
        <TextField label="Identificação do número de telefone" name="phoneNumberId" defaultValue={slot.phoneNumberId ?? ""} required inputMode="numeric" placeholder="Phone number ID" />
        <TextField label="Identificação da conta do WhatsApp Business" name="wabaId" defaultValue={slot.wabaId ?? ""} required inputMode="numeric" placeholder="WhatsApp Business Account ID" />
        <TextField
          label="Token de acesso"
          name="token"
          type="password"
          autoComplete="off"
          required={!reconnecting}
          placeholder={reconnecting ? "Deixe em branco para manter o atual" : "Token de usuário do sistema"}
          hint="Use um token permanente (usuário do sistema). O token temporário da Meta expira em 24 horas."
        />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" loading={pending}>
            Conferir e conectar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
