import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type FieldShellProps = {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode;
};

function FieldShell({ label, hint, error, className, children }: FieldShellProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(" ") || undefined;

  return (
    <label className={cn("field", className)} data-invalid={error ? "true" : undefined} htmlFor={id}>
      <span>{label}</span>
      {children({ id, describedBy })}
      {hint && !error && (
        <small id={hintId} className="hint">
          {hint}
        </small>
      )}
      {error && (
        <small id={errId} className="err" role="alert">
          {error}
        </small>
      )}
    </label>
  );
}

type Common = { label: string; hint?: string; error?: string; className?: string };

export function TextField({ label, hint, error, className, ...props }: Common & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell label={label} hint={hint} error={error} className={className}>
      {({ id, describedBy }) => (
        <input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...props} />
      )}
    </FieldShell>
  );
}

export function SelectField({
  label,
  hint,
  error,
  className,
  children,
  ...props
}: Common & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <FieldShell label={label} hint={hint} error={error} className={className}>
      {({ id, describedBy }) => (
        <select id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...props}>
          {children}
        </select>
      )}
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  className,
  ...props
}: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell label={label} hint={hint} error={error} className={className}>
      {({ id, describedBy }) => (
        <textarea id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...props} />
      )}
    </FieldShell>
  );
}
