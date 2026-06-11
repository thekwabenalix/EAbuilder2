import { useMemo } from "react";
import type { StrategyBlueprint } from "@/types/blueprint";
import {
  generationPathLabel,
  previewEaGeneration,
  type EaGenerationPath,
} from "@/lib/generate-ea-router";
import { AlertTriangle, CheckCircle2, Cpu, Info } from "lucide-react";

function pathTone(path: EaGenerationPath): string {
  switch (path) {
    case "flow_engine":
      return "border-emerald-500/30 bg-emerald-500/5 text-emerald-300";
    case "blueprint_assembler":
      return "border-amber-500/30 bg-amber-500/5 text-amber-300";
    case "legacy_heuristic":
      return "border-orange-500/30 bg-orange-500/5 text-orange-300";
  }
}

export function GenerationPathBanner({ blueprint }: { blueprint: StrategyBlueprint | null }) {
  const preview = useMemo(
    () => (blueprint ? previewEaGeneration(blueprint) : null),
    [blueprint],
  );

  if (!blueprint?.fourBrain) {
    return (
      <div className="rounded-lg border border-border bg-card/40 p-3 text-[11px] text-muted-foreground flex items-start gap-2">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <p>
          Configure a 4-Brain or Strategy Flow blueprint to preview which verified compiler will
          generate your EA.
        </p>
      </div>
    );
  }

  if (!preview) return null;

  if (preview.validationErrors.length > 0) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1.5">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p className="text-xs font-medium">Generation blocked</p>
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

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${pathTone(preview.path)}`}>
      <div className="flex items-center gap-2">
        {preview.path === "flow_engine" ? (
          <CheckCircle2 className="h-4 w-4 shrink-0" />
        ) : (
          <Cpu className="h-4 w-4 shrink-0" />
        )}
        <div>
          <p className="text-xs font-medium">Compiler path</p>
          <p className="text-[11px] opacity-90">{generationPathLabel(preview.path)}</p>
        </div>
      </div>
      {preview.validationWarnings.map((warning) => (
        <p key={warning} className="text-[11px] opacity-80 pl-6">
          {warning}
        </p>
      ))}
    </div>
  );
}
