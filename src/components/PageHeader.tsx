import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions,
  below,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Optional strip below title row (e.g. workflow stepper). */
  below?: ReactNode;
}) {
  return (
    <div className="border-b border-border bg-card/40">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 sm:px-6 py-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold tracking-tight truncate">{title}</h1>
          {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>
        )}
      </div>
      {below && (
        <div className="px-4 sm:px-6 pb-3 pt-0 border-t border-border/50 bg-muted/10">
          {below}
        </div>
      )}
    </div>
  );
}
