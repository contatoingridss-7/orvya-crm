"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import type { Option, Person, Pipeline, Stage } from "@/lib/crm/types";
import { createLead } from "./actions";

type Props = {
  open: boolean;
  onClose: () => void;
  slug: string;
  companyName: string;
  pipelines: Pipeline[];
  pipeline: Pipeline;
  stages: Stage[];
  sources: Option[];
  people: Person[];
  manager: boolean;
  onCreated: (id: string) => void;
};

export function NewLeadModal(props: Props) {
  return props.open ? <NewLeadForm {...props} /> : null;
}

function NewLeadForm({ onClose, slug, companyName, pipelines, pipeline, stages, sources, people, manager, onCreated }: Props) {
  const toast = useToast();
  const [pipelineId, setPipelineId] = useState(pipeline.id);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const sameBoard = pipelineId === pipeline.id;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    setError(undefined);
    startTransition(async () => {
      const result = await createLead(slug, {
        name: get("name"),
        phone: get("phone"),
        email: get("email"),
        org: get("org"),
        customerType: get("customerType") === "B2B" ? "B2B" : "B2C",
        pipelineId,
        stageId: sameBoard ? get("stageId") : "",
        value: get("value"),
        temperature: (get("temperature") || "morno") as "quente" | "morno" | "frio",
        sourceId: get("sourceId"),
        ownerId: get("ownerId"),
      });
      if (result.ok && result.data) {
        toast(result.message ?? "Lead criado.", "ok");
        if (sameBoard) onCreated(result.data.id);
        else onClose();
      } else if (!result.ok) setError(result.error);
    });
  }

  return (
    <Modal open onClose={onClose} title={`Novo lead na ${companyName}`}>
      <form onSubmit={onSubmit} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Nome do contato" name="name" required autoComplete="off" className="sm:col-span-2" />
          <TextField label="Telefone (WhatsApp)" name="phone" inputMode="tel" placeholder="(86) 99999-0000" autoComplete="off" />
          <TextField label="E-mail" name="email" type="email" autoComplete="off" />
          <TextField label="Empresa ou instituição" name="org" autoComplete="off" />
          <SelectField label="Tipo de cliente" name="customerType" defaultValue="B2C">
            <option value="B2C">Paciente / família (B2C)</option>
            <option value="B2B">Instituição (B2B)</option>
          </SelectField>
          <SelectField label="Funil" name="pipelineId" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          {sameBoard ? (
            <SelectField label="Etapa" name="stageId" defaultValue={stages.find((s) => s.kind === "open")?.id}>
              {stages
                .filter((s) => s.kind !== "lost")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </SelectField>
          ) : (
            <TextField label="Etapa" value="Primeira etapa do funil" disabled readOnly />
          )}
          <TextField label="Valor estimado" name="value" inputMode="decimal" placeholder="0,00" />
          <SelectField label="Temperatura" name="temperature" defaultValue="morno">
            <option value="quente">Quente</option>
            <option value="morno">Morno</option>
            <option value="frio">Frio</option>
          </SelectField>
          <SelectField label="Origem" name="sourceId" defaultValue="">
            <option value="">Não informada</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
          {manager ? (
            <SelectField label="Responsável" name="ownerId" defaultValue="">
              <option value="">Sem responsável (fila)</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SelectField>
          ) : (
            <TextField label="Responsável" value="Você" disabled readOnly />
          )}
        </div>
        {error && <Notice tone="bad">{error}</Notice>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" loading={pending}>
            Criar lead
          </Button>
        </div>
      </form>
    </Modal>
  );
}
