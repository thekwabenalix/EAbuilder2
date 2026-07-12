import { useMemo } from "react";
import type { StrategyBlueprint } from "@/types/blueprint";
import { previewEaGeneration } from "@/lib/generate-ea-router";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

/** Beginner-facing readiness banner — no compiler-path jargon. */
export function GenerationPathBanner({ blueprint }: { blueprint: StrategyBlueprint | null }) {
  const preview = useMemo(() => (blueprint ? previewEaGeneration(blueprint) : null), [blueprint]);

  if (!blueprint?.fourBrain) {
    return (
      <div className="rounded-lg border border-border bg-card/40 p-3 text-[11px] text-muted-foreground flex items-start gap-2">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <p>Describe or set up your strategy layers, then build the robot.</p>
      </div>
    );
  }

  if (!preview) return null;

  if (preview.validationErrors.length > 0) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1.5">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p className="text-xs font-medium">Needs a quick fix before building</p>
        </div>
        {preview.validationErrors.map((error) => (
          <p key={error} className="text-[11px] text-destructive/90 pl-6">
            {error}
          </p>
        ))}
      </div>
    );
  }

  if (!preview.path) return null;

  const actionable = preview.validationWarnings.filter(
    (w) => !/deprecated|Prefer Strategy Flow|assembler/i.test(w),
  );

  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2 text-emerald-300">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <div>
          <p className="text-xs font-medium">Ready to build</p>
          <p className="text-[11px] opacity-90">
            Your strategy can be turned into a robot and tested on history.
          </p>
        </div>
      </div>
      {actionable.map((warning) => (
        <p key={warning} className="text-[11px] opacity-80 pl-6">
          {warning}
        </p>
      ))}
    </div>
  );
}
