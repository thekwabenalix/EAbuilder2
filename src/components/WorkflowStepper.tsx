import type { LucideIcon } from "lucide-react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type WorkflowStep = {
  id: string;
  label: string;
  shortLabel?: string;
  icon?: LucideIcon;
};

export function WorkflowStepper({
  steps,
  currentId,
  onStepClick,
  className,
}: {
  steps: WorkflowStep[];
  currentId: string;
  onStepClick?: (id: string) => void;
  className?: string;
}) {
  const currentIndex = steps.findIndex((s) => s.id === currentId);

  return (
    <nav
      aria-label="Strategy workflow"
      className={cn("flex items-center gap-1 sm:gap-2 overflow-x-auto pb-1", className)}
    >
      {steps.map((step, index) => {
        const done = index < currentIndex;
        const active = step.id === currentId;
        const Icon = step.icon;
        const clickable = Boolean(onStepClick);
        const label = step.shortLabel ?? step.label;

        return (
          <div key={step.id} className="flex items-center shrink-0">
            {index > 0 && (
              <div
                className={cn(
                  "hidden sm:block w-6 lg:w-10 h-px mx-1",
                  done ? "bg-primary/60" : "bg-border",
                )}
              />
            )}
            <button
              type="button"
              disabled={!clickable}
              onClick={() => onStepClick?.(step.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors",
                clickable && "hover:bg-muted/60 cursor-pointer",
                !clickable && "cursor-default",
                active && "bg-primary/15 text-primary ring-1 ring-primary/30",
                done && !active && "text-primary/80",
                !active && !done && "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold shrink-0",
                  active && "bg-primary text-primary-foreground",
                  done && !active && "bg-primary/20 text-primary",
                  !active && !done && "bg-muted text-muted-foreground",
                )}
              >
                {done ? (
                  <Check className="h-3 w-3" />
                ) : Icon ? (
                  <Icon className="h-3 w-3" />
                ) : (
                  index + 1
                )}
              </span>
              <span className="whitespace-nowrap hidden sm:inline">{label}</span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}
