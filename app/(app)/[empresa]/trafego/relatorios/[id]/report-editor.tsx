"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import type { ReportData, ReportKind } from "@/lib/ads/traffic-report";
import { deleteReport, refreshReport, saveReport, type ActionResult } from "../../actions";

type EditorReport = {
  id: string;
  kind: ReportKind;
  status: "rascunho" | "liberado";
  notesDone: string;
  notesNext: string;
  hiddenAlerts: string[];
  alerts: ReportData["alerts"];
};

/** Observações da gestora, alertas que vão para o cliente e liberação do link. */
export function ReportEditor({ slug, report, url, text }: { slug: string; report: EditorReport; url: string; text: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [notesDone, setNotesDone] = useState(report.notesDone);
  const [notesNext, setNotesNext] = useState(report.notesNext);
  const [hidden, setHidden] = useState<string[]>(report.hiddenAlerts);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const released = report.status === "liberado";
  const dirty = notesDone !== report.notesDone || notesNext !== report.notesNext || hidden.join() !== report.hiddenAlerts.join();
  const daily = report.kind === "diario";

  function run(fn: () => Promise<ActionResult>, after?: () => void) {
    start(async () => {
      const r = await fn();
      toast(r.ok ? r.message : r.error, r.ok ? "ok" : "bad");
      if (r.ok) (after ?? router.refresh)();
    });
  }
  const input = { id: report.id, notesDone, notesNext, hiddenAlerts: hidden };

  function copy(value: string, what: string) {
    void navigator.clipboard.writeText(value).then(
      () => toast(`${what} copiado.`, "ok"),
      () => toast("Não foi possível copiar. Selecione e copie manualmente.", "bad"),
    );
  }

  return (
    <div className="grid gap-4 lg:sticky lg:top-4">
      <Panel title="Sua revisão" actions={<Pill tone={released ? "ok" : "warn"}>{released ? "Liberado" : "Rascunho"}</Pill>}>
        <div className="grid gap-3">
          <TextAreaField
            label={daily ? "Observação do dia" : "O que fizemos"}
            rows={3}
            maxLength={2000}
            value={notesDone}
            onChange={(e) => setNotesDone(e.target.value)}
            placeholder={daily ? "Ex.: Pausamos o anúncio com custo alto e reforçamos o de melhor resultado." : "Ex.: Trocamos os criativos saturados e ajustamos o público."}
          />
          <TextAreaField
            label="Próximos passos"
            rows={3}
            maxLength={2000}
            value={notesNext}
            onChange={(e) => setNotesNext(e.target.value)}
            placeholder="Ex.: Testar nova chamada para CPAP na quarta."
          />

          {report.alerts.length > 0 && (
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="mb-1 text-[13px] font-semibold text-title">Leituras automáticas que o cliente vê</legend>
              {report.alerts.map((a) => (
                <label key={a.id} className="flex items-start gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={!hidden.includes(a.id)}
                    onChange={(e) => setHidden((h) => (e.target.checked ? h.filter((x) => x !== a.id) : [...h, a.id]))}
                  />
                  <span>{a.text}</span>
                </label>
              ))}
            </fieldset>
          )}

          <div className="flex flex-wrap gap-2">
            {!released && (
              <Button variant="primary" loading={pending} onClick={() => run(() => saveReport(slug, input, true))}>
                Liberar para o cliente
              </Button>
            )}
            <Button variant={released ? "primary" : "default"} disabled={pending || !dirty} onClick={() => run(() => saveReport(slug, input))}>
              Salvar
            </Button>
            {!released && (
              <Button variant="ghost" disabled={pending} onClick={() => run(() => refreshReport(slug, report.id))}>
                Atualizar números
              </Button>
            )}
          </div>
          {!released && <p className="m-0 text-[12px] text-muted">Até liberar, o link não abre para o cliente. Depois de liberado, os números ficam congelados.</p>}
        </div>
      </Panel>

      {released && (
        <Panel title="Enviar ao cliente" subtitle="Copie o texto e cole na conversa do cliente no WhatsApp.">
          <div className="grid gap-3">
            {dirty && <p className="m-0 text-[12px] font-semibold" style={{ color: "var(--warn-fg)" }}>Salve para o texto e o link mostrarem as últimas alterações.</p>}
            <textarea readOnly value={text} rows={12} className="w-full rounded-xl border border-line bg-surface-2 p-3 text-[13px] leading-[1.5]" />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => copy(text, "Texto")}>
                Copiar texto
              </Button>
              <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
                Abrir no WhatsApp
              </a>
              <Button variant="ghost" onClick={() => copy(url, "Link")}>
                Copiar só o link
              </Button>
            </div>
            <a href={url} target="_blank" rel="noreferrer" className="text-[12px] break-all text-muted">
              {url}
            </a>
          </div>
        </Panel>
      )}

      <div>
        {confirmDelete ? (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span>{released ? "O link deixa de abrir para o cliente." : "Apagar este rascunho?"}</span>
            <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => deleteReport(slug, report.id), () => router.push(`/${slug}/trafego`))}>
              Apagar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
            Apagar relatório
          </Button>
        )}
      </div>
    </div>
  );
}
