"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import { connectInstagram, disconnectInstagram, listIgPages, saveInstagramSettings, type ActionResult, type IgPageOption } from "./instagram-actions";

export type IgAccountItem = {
  id: string;
  username: string | null;
  name: string | null;
  status: "connected" | "error" | "off";
  lastError: string | null;
  defaultPipelineId: string | null;
  connectedAt: string;
  conversationsThisMonth: number;
};

/** Instagram Direct da empresa: conectar pela Página do Facebook, funil dos leads e desconectar. */
export function InstagramPanel({
  slug,
  companyName,
  account,
  pipelines,
  canEdit,
  webhookUrl,
}: {
  slug: string;
  companyName: string;
  account: IgAccountItem | null;
  pipelines: { id: string; name: string }[];
  canEdit: boolean;
  webhookUrl: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [token, setToken] = useState("");
  const [pages, setPages] = useState<IgPageOption[] | null>(null);
  const [pageId, setPageId] = useState("");
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? "");
  const [error, setError] = useState<string>();
  const [confirmOff, setConfirmOff] = useState(false);
  const connected = account?.status === "connected";

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

  function findPages() {
    setError(undefined);
    start(async () => {
      const r = await listIgPages(slug, token);
      if (r.ok) {
        setPages(r.pages);
        setPageId(r.pages[0]?.pageId ?? "");
      } else setError(r.error);
    });
  }

  return (
    <Panel title="Instagram Direct" subtitle={`${companyName}: mensagens do Direct e comentários entram em Conversas, com lead no funil.`}>
      {account && connected ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
            <b className="font-semibold text-title">@{account.username ?? account.name}</b>
            <Pill tone="ok">Conectado</Pill>
            <span className="text-xs text-muted">
              desde {formatDate(account.connectedAt)} · {account.conversationsThisMonth} conversa(s) neste mês
            </span>
          </div>
          {account.lastError && <Notice tone="warn">Último erro da Meta: {account.lastError}</Notice>}
          {canEdit && (
            <div className="flex flex-wrap items-end gap-2">
              <SelectField
                label="Funil dos leads do Instagram"
                value={account.defaultPipelineId ?? ""}
                onChange={(e) => run(() => saveInstagramSettings(slug, { accountId: account.id, pipelineId: e.target.value }))}
                disabled={pending}
              >
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </SelectField>
              {confirmOff ? (
                <>
                  <span className="text-xs">Desconectar? As conversas antigas continuam.</span>
                  <Button size="sm" variant="danger" loading={pending} onClick={() => run(() => disconnectInstagram(slug, account.id), () => setConfirmOff(false))}>
                    Desconectar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmOff(false)}>
                    Cancelar
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setConfirmOff(true)}>
                  Desconectar
                </Button>
              )}
            </div>
          )}
          <p className="m-0 text-xs text-muted">
            Respostas automáticas (boas-vindas, palavra-chave e comentário que vira mensagem privada) ficam em Automações.
          </p>
        </div>
      ) : !canEdit ? (
        <p className="m-0 text-[13px] text-muted">O Instagram desta empresa ainda não está conectado. A conexão é feita pelo administrador.</p>
      ) : (
        <div className="grid gap-3">
          <ol className="m-0 grid gap-1 pl-5 text-[13px] text-muted">
            <li>
              No app da Meta desta empresa, adicione o caso de uso <b className="text-ink">Instagram</b> (mensagens e comentários) e, em Webhooks, o objeto{" "}
              <b className="text-ink">Instagram</b> com <code>messages</code> e <code>comments</code> na mesma URL: <code className="break-all">{webhookUrl}</code>
            </li>
            <li>Atribua a Página do Facebook (ligada ao Instagram profissional) ao usuário do sistema e gere um token com as permissões do Instagram.</li>
            <li>No Instagram, em Configurações → Mensagens, ative &ldquo;Permitir acesso às mensagens&rdquo;.</li>
          </ol>
          <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <TextField
              label="Token do usuário do sistema (com acesso à Página)"
              type="password"
              autoComplete="off"
              placeholder="Cole o token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <Button loading={pending && !pages} disabled={token.trim().length < 20} onClick={findPages}>
              Buscar contas
            </Button>
          </div>
          {pages && (
            <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <SelectField label="Conta do Instagram" value={pageId} onChange={(e) => setPageId(e.target.value)}>
                {pages.map((p) => (
                  <option key={p.pageId} value={p.pageId}>
                    @{p.username ?? p.name} · Página {p.pageName}
                  </option>
                ))}
              </SelectField>
              <SelectField label="Funil dos leads" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </SelectField>
              <Button
                variant="primary"
                loading={pending}
                disabled={!pageId || !pipelineId}
                onClick={() =>
                  run(
                    () => connectInstagram(slug, { token, pageId, pipelineId }),
                    () => {
                      setToken("");
                      setPages(null);
                    },
                  )
                }
              >
                Conectar
              </Button>
            </div>
          )}
          {error && <Notice tone="bad">{error}</Notice>}
          <p className="m-0 text-xs text-muted">
            O token fica guardado só no servidor e não aparece de novo. Enquanto a Meta não aprovar o acesso avançado do app, só pessoas com função no
            app conseguem conversar pelo Direct (bom para testar).
          </p>
        </div>
      )}
    </Panel>
  );
}
