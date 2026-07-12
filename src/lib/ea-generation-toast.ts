import { toast } from "sonner";
import type { GenerateEaFromBlueprintResult } from "@/lib/generate-ea-router";

/** Success toast for unified blueprint generation — beginner-friendly, no engine jargon. */
export function toastEaGenerationSuccess(
  result: GenerateEaFromBlueprintResult,
  prefix = "Robot built",
): void {
  toast.success(`${prefix}. Next: test it on history.`);
  // Only surface actionable generation blocks — skip deprecated-path warnings.
  for (const warning of result.validationWarnings) {
    if (/deprecated|Prefer Strategy Flow|assembler/i.test(warning)) continue;
    toast.warning(warning, { duration: 7000 });
  }
}

/** Short label for internal/debug use (assistant context). Not for primary UI toasts. */
export function generationPathLabelFriendly(path: string): string {
  if (path === "flow_engine") return "ready";
  if (path === "blueprint_assembler") return "ready";
  if (path === "legacy_heuristic") return "basic mode";
  return "ready";
}
