"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import type { Option } from "@/lib/crm/types";

type Props = {
  open: boolean;
  leadName: string;
  reasons: Option[];
  onClose: () => void;
  onConfirm: (reason: string) => void;
};

/** Perda exige motivo (SPEC 4.3; o banco também bloqueia sem motivo). */
export function LostModal(props: Props) {
  return props.open ? <LostForm {...props} /> : null;
}

function LostForm({ leadName, reasons, onClose, onConfirm }: Props) {
  const [picked, setPicked] = useState("");
  const [other, setOther] = useState("");
  const reason = other.trim() || picked;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Por que ${leadName} foi perdido?`}
      actions={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!reason} onClick={() => onConfirm(reason)}>
            Confirmar perda
          </Button>
        </>
      }
    >
      <p className="m-0 text-[13px] text-muted">O motivo alimenta o relatório de perdas e ajuda a ajustar preço, estoque e abordagem.</p>
      <div className="chips" role="group" aria-label="Motivos">
        {reasons.map((r) => (
          <button
            key={r.id}
            type="button"
            className="chip"
            aria-pressed={picked === r.name && !other.trim()}
            onClick={() => {
              setPicked(r.name);
              setOther("");
            }}
          >
            {r.name}
          </button>
        ))}
      </div>
      <TextField label="Ou descreva outro motivo" value={other} onChange={(e) => setOther(e.target.value)} maxLength={200} />
    </Modal>
  );
}
