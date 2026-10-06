import type { InputHTMLAttributes } from "react";

type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string };

/** Liga/desliga. O rótulo é obrigatório para leitores de tela. */
export function Switch({ label, ...props }: SwitchProps) {
  return (
    <span className="switch">
      <input type="checkbox" role="switch" aria-label={label} {...props} />
      <span aria-hidden />
    </span>
  );
}
