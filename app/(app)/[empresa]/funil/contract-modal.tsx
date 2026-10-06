"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import type { CatalogOption } from "@/lib/crm/types";
import { addMonthsMinusDay, nextDay, todayISO, type RentalContract } from "@/lib/crm/rentals";
import { saveContract } from "./rental-actions";

type Props = {
  open: boolean;
  slug: string;
  leadId: string;
  leadName: string;
  catalog: CatalogOption[];
  /** Endereço sugerido (campo "Endereço de entrega" do funil Locação). */
  defaultAddress?: string;
  /** Contrato que está sendo renovado. */
  renewing?: RentalContract | null;
  onClose: () => void;
  onSaved: () => void;
};

export function ContractModal(props: Props) {
  return props.open ? <ContractForm key={props.renewing?.id ?? "novo"} {...props} /> : null;
}

const moneyText = (v: number) => v.toFixed(2).replace(".", ",");

function ContractForm({ slug, leadId, leadName, catalog, defaultAddress, renewing, onClose, onSaved }: Props) {
  const toast = useToast();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const initialStart = renewing ? nextDay(renewing.endDate) : todayISO();
  const [startDate, setStartDate] = useState(initialStart);
  const [endDate, setEndDate] = useState(addMonthsMinusDay(initialStart, 1));

  // Itens de locação primeiro; os demais ficam disponíveis (o catálogo pode não ter marcado tudo).
  const options = [...catalog].sort((a, b) => Number(b.isRental) - Number(a.isRental) || a.name.localeCompare(b.name, "pt-BR"));

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    setError(undefined);
    start(async () => {
      const r = await saveContract(slug, leadId, {
        productId: get("productId"),
        serialNumber: get("serialNumber"),
        startDate,
        endDate,
        monthlyValue: get("monthlyValue"),
        deliveryAddress: get("deliveryAddress"),
        renewOf: renewing?.id,
      });
      if (r.ok) {
        toast(r.message, "ok");
        onSaved();
      } else setError(r.error);
    });
  }

  return (
    <Modal open onClose={onClose} title={renewing ? `Renovar locação de ${leadName}` : `Contrato de locação de ${leadName}`}>
      <form onSubmit={onSubmit} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Equipamento" name="productId" defaultValue={renewing?.productId ?? ""} className="sm:col-span-2">
            <option value="">Não está no catálogo</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.code ? ` (${p.code})` : ""}
              </option>
            ))}
          </SelectField>
          <TextField label="Número de série" name="serialNumber" defaultValue={renewing?.serialNumber ?? ""} />
          <TextField
            label="Valor mensal combinado"
            name="monthlyValue"
            inputMode="decimal"
            required
            defaultValue={renewing ? moneyText(renewing.monthlyValue) : ""}
            placeholder="0,00"
          />
          <TextField
            label="Início"
            type="date"
            required
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              if (e.target.value && endDate < e.target.value) setEndDate(addMonthsMinusDay(e.target.value, 1));
            }}
          />
          <TextField label="Fim" type="date" required min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <div className="flex flex-wrap items-center gap-1.5 sm:col-span-2">
            <span className="text-xs text-muted">Duração:</span>
            {[1, 2, 3, 6, 12].map((m) => (
              <button
                key={m}
                type="button"
                className="chip"
                aria-pressed={endDate === addMonthsMinusDay(startDate, m)}
                onClick={() => startDate && setEndDate(addMonthsMinusDay(startDate, m))}
              >
                {m} {m === 1 ? "mês" : "meses"}
              </button>
            ))}
          </div>
          <TextField
            label="Endereço de entrega"
            name="deliveryAddress"
            defaultValue={renewing?.deliveryAddress ?? defaultAddress ?? ""}
            placeholder="Rua, número, bairro, cidade"
            className="sm:col-span-2"
          />
        </div>
        {error && <Notice tone="bad">{error}</Notice>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose}>{renewing ? "Cancelar" : "Registrar depois"}</Button>
          <Button type="submit" variant="primary" loading={pending}>
            {renewing ? "Renovar contrato" : "Registrar contrato"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
