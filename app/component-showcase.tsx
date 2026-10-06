"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { formatBRL, formatDateTime } from "@/lib/format";

export function ComponentShowcase() {
  const toast = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [aiOn, setAiOn] = useState(true);

  return (
    <>
      <Panel title="Componentes base" subtitle="Botões, campos, etiquetas, avisos, modal e painel lateral do protótipo.">
        <div className="grid gap-5">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary">Botão primário</Button>
            <Button>Padrão</Button>
            <Button variant="soft">Suave</Button>
            <Button variant="ghost">Discreto</Button>
            <Button variant="danger">Excluir</Button>
            <Button size="sm">Pequeno</Button>
            <Button loading>Salvando</Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Pill>Neutro</Pill>
            <Pill tone="ok">Venda fechada</Pill>
            <Pill tone="bad">Precisa de você</Pill>
            <Pill tone="warn">Vence em 7 dias</Pill>
            <Pill tone="ind">IA respondendo</Pill>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Nome do contato" placeholder="Maria da Silva" />
            <SelectField label="Temperatura" defaultValue="morno">
              <option value="quente">Quente</option>
              <option value="morno">Morno</option>
              <option value="frio">Frio</option>
            </SelectField>
            <TextField label="Telefone" placeholder="(86) 99999-0000" error="Informe um telefone válido" />
            <TextField label="Valor" defaultValue={formatBRL(1290.5)} hint="Moeda em reais, formato brasileiro" />
            <TextAreaField label="Anotação" rows={2} className="sm:col-span-2" placeholder="O que foi conversado..." />
          </div>

          <label className="flex items-center gap-3">
            <Switch label="Agente de IA ligado" checked={aiOn} onChange={(e) => setAiOn(e.target.checked)} />
            <span>Agente de IA {aiOn ? "ligado" : "desligado"}</span>
          </label>

          <div className="grid gap-2">
            <Notice>Janela aberta até {formatDateTime(new Date(Date.now() + 6 * 3600_000)).slice(-5)}.</Notice>
            <Notice tone="warn">Janela de 24 h fechada: só é possível enviar modelo aprovado.</Notice>
            <Notice tone="ok">Número conectado.</Notice>
            <Notice tone="bad">Falha ao enviar a mensagem.</Notice>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setModalOpen(true)}>Abrir modal</Button>
            <Button onClick={() => setDrawerOpen(true)}>Abrir painel lateral</Button>
            <Button onClick={() => toast("Lead movido para Orçamento enviado")}>Aviso</Button>
            <Button onClick={() => toast('Automação criou a tarefa "Cobrar retorno do orçamento"', "auto")}>
              Aviso de automação
            </Button>
          </div>

          <div className="empty">Nenhuma tarefa para hoje.</div>
        </div>
      </Panel>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Por que Maria foi perdido?"
        actions={
          <>
            <Button onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button
              variant="primary"
              onClick={() => {
                setModalOpen(false);
                toast("Motivo registrado", "ok");
              }}
            >
              Confirmar perda
            </Button>
          </>
        }
      >
        <SelectField label="Motivo" defaultValue="">
          <option value="" disabled>
            Escolha um motivo
          </option>
          <option>Preço acima do esperado</option>
          <option>Comprou na concorrência</option>
          <option>Não respondeu mais</option>
        </SelectField>
      </Modal>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Maria da Silva"
        subtitle="IC Supra · Varejo · Orçamento enviado"
        footer={
          <>
            <Button variant="primary">Abrir conversa</Button>
            <Button>Marcar ganho</Button>
          </>
        }
      >
        <section>
          <h3 className="mb-2.5 text-[13px] font-[650]">Negócio</h3>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <TextField label="Valor" defaultValue={formatBRL(389.9)} />
            <SelectField label="Temperatura" defaultValue="quente">
              <option value="quente">Quente</option>
              <option value="morno">Morno</option>
              <option value="frio">Frio</option>
            </SelectField>
          </div>
        </section>
      </Drawer>
    </>
  );
}
