"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { TextAreaField, TextField } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { KIND_LABEL, toLocalInput } from "@/lib/crm/logistics";
import type { Schedule, StageLogistics } from "@/lib/crm/types";
import type { ScheduleInput } from "./actions";

type Props = {
  open: boolean;
  leadName: string;
  kind: StageLogistics;
  /** Agendamento atual (reagendar) ou endereço sugerido. */
  current: Schedule | null;
  defaultAddress?: string;
  pending?: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (input: ScheduleInput) => void;
};

/** Agenda a entrega ou a adaptação in loco: a expedição vê o pedido na hora. */
export function ScheduleModal(props: Props) {
  return props.open ? <ScheduleForm {...props} /> : null;
}

function ScheduleForm({ leadName, kind, current, defaultAddress, pending, error, onClose, onConfirm }: Props) {
  const [localError, setLocalError] = useState<string>();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const at = String(f.get("at") ?? "");
    if (!at) return setLocalError("Informe a data e a hora.");
    setLocalError(undefined);
    onConfirm({ at, address: String(f.get("address") ?? ""), notes: String(f.get("notes") ?? "") });
  }

  const title = kind === "adaptacao" ? `Programar adaptação de ${leadName}` : `Agendar entrega de ${leadName}`;

  return (
    <Modal open onClose={onClose} title={title}>
      <form onSubmit={onSubmit} className="grid gap-3">
        <p className="m-0 text-[13px] text-muted">
          {kind === "adaptacao"
            ? "O teste e a adaptação acontecem na casa do paciente. A expedição separa e leva o equipamento na data marcada."
            : "A expedição recebe o pedido com os produtos do lead para separar, faturar e entregar."}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label={`Data e hora (${KIND_LABEL[kind].toLowerCase()})`}
            name="at"
            type="datetime-local"
            required
            defaultValue={current ? toLocalInput(current.at) : ""}
            className="sm:col-span-2"
          />
          <TextField
            label="Endereço"
            name="address"
            required
            minLength={5}
            defaultValue={current?.address ?? defaultAddress ?? ""}
            placeholder="Rua, número, bairro, cidade e ponto de referência"
            className="sm:col-span-2"
          />
          <TextAreaField
            label="Observação para a expedição"
            name="notes"
            rows={2}
            maxLength={1000}
            defaultValue={current?.notes ?? ""}
            placeholder="Ex.: ligar antes de sair, portaria, levar máscara tamanho M"
            className="sm:col-span-2"
          />
        </div>
        <p className="m-0 text-xs text-muted">Não escreva diagnóstico ou dados da receita aqui: a expedição vê esta observação.</p>
        {(localError || error) && <Notice tone="bad">{localError ?? error}</Notice>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" loading={pending}>
            {current ? "Salvar agendamento" : kind === "adaptacao" ? "Programar adaptação" : "Agendar entrega"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
