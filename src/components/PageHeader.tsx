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
  /** Optional strip below title row, such as a workflow stepper. */
  below?: ReactNode;
}) {
  return (
    <div className="app-panel border-b border-border/70 bg-card/75 shadow-sm">
      <div className="app-page-in flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          {subtitle && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {below && (
        <div className="border-t border-border/50 bg-muted/20 px-4 pb-3 pt-0 sm:px-6">{below}</div>
      )}
    </div>
  );
}
