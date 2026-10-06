import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type PanelProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
};

export function Panel({ title, subtitle, actions, className, children, ...props }: PanelProps) {
  return (
    <section className={cn("panel", className)} {...props}>
      {(title || actions) && (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {title && <h2>{title}</h2>}
            {subtitle && <p className="sub">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
