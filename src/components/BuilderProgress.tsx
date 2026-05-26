import { Check, Loader2, Circle } from "lucide-react";

export type StepState = "pending" | "running" | "done";

export interface BuilderStep {
  key: string;
  label: string;
  state: StepState;
}

export const BUILDER_STEPS: { key: string; label: string }[] = [
  { key: "parse", label: "Parse trader prompt" },
  { key: "normalize", label: "Normalize strategy rules" },
  { key: "inputs", label: "Generate MQL5 inputs" },
  { key: "modules", label: "Assemble EA modules" },
  { key: "validate", label: "Validate risk controls" },
  { key: "package", label: "Prepare export package" },
];

export function BuilderProgress({ steps }: { steps: BuilderStep[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((s) => (
        <li key={s.key} className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5">
          <span className="shrink-0">
            {s.state === "done" && <Check className="h-4 w-4 text-emerald-400" />}
            {s.state === "running" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            {s.state === "pending" && <Circle className="h-4 w-4 text-muted-foreground/50" />}
          </span>
          <span className={`text-sm ${s.state === "pending" ? "text-muted-foreground" : "text-foreground"}`}>
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
