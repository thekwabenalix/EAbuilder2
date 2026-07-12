import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  actions,
  below,
  className,
  sticky = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Optional strip below title row, such as a workflow stepper. */
  below?: ReactNode;
  className?: string;
  /** Keep the header visible while the page scrolls. */
  sticky?: boolean;
}) {
  return (
    <div
      className={cn(
        "app-panel border-b border-border/70 bg-card/75 shadow-sm",
        sticky &&
          "sticky top-0 z-20 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80",
        className,
      )}
    >
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
