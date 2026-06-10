/**
 * Phase 0 — generation policy helpers.
 *
 * Centralizes rules for which codegen paths are allowed and when AI surgical
 * fixes may touch assembler-generated EAs.
 */

import type { StrategyBlueprint } from "@/types/blueprint";

export type EaCodegenKind =
  | "fourbrain_assembler"
  | "flow_engine"
  | "legacy_flat_rules"
  | "unknown";

export const LEGACY_FLAT_RULES_MESSAGE =
  "Legacy flat-rules EAs are deprecated for new strategies. Use the 4-Brain / Strategy Flow builder, or open /build to configure modules.";

export const APPLY_FIX_BLOCKED_MESSAGE =
  "This EA was built by the verified assembler (blueprint or flow engine). Use Regen from Blueprint or AI Rebuild for strategy logic changes. Apply-fix is only for MetaEditor compile errors.";

export function isLegacyFlatRulesBlueprint(bp: StrategyBlueprint): boolean {
  return !bp.fourBrain;
}

export { blueprintReadyForGeneration } from "@/lib/blueprint-generation-gate";

export function detectEaCodegenKind(code: string, blueprint?: StrategyBlueprint): EaCodegenKind {
  if (
    code.includes("RegisterEvent(") ||
    code.includes("DetectStep_") ||
    code.includes("Strategy Flow") ||
    code.includes("ordered event gate")
  ) {
    return "flow_engine";
  }
  if (
    code.includes("4-Brain Architecture") ||
    code.includes("(blueprint SM)") ||
    code.includes("(AI mode)") ||
    code.includes("template mode — always compiles")
  ) {
    return "fourbrain_assembler";
  }
  if (blueprint?.fourBrain && code.length > 0) {
    return "fourbrain_assembler";
  }
  if (blueprint && isLegacyFlatRulesBlueprint(blueprint)) {
    return "legacy_flat_rules";
  }
  return "unknown";
}

export function isStructuredAssemblerEa(code: string, blueprint?: StrategyBlueprint): boolean {
  const kind = detectEaCodegenKind(code, blueprint);
  return kind === "fourbrain_assembler" || kind === "flow_engine";
}

export function compileLogHasErrors(compileLog: string | null | undefined): boolean {
  if (!compileLog?.trim()) return false;
  const lower = compileLog.toLowerCase();
  return (
    lower.includes("error") &&
    !lower.includes("0 error") &&
    !lower.includes("no error")
  );
}

export function canApplyAiSurgicalFix(
  code: string,
  blueprint: StrategyBlueprint,
  compileLog?: string | null,
): { allowed: boolean; reason?: string } {
  if (!isStructuredAssemblerEa(code, blueprint)) {
    return { allowed: true };
  }
  if (!compileLogHasErrors(compileLog)) {
    return { allowed: false, reason: APPLY_FIX_BLOCKED_MESSAGE };
  }
  return { allowed: true };
}

export function prefersBlueprintRegen(code: string, blueprint?: StrategyBlueprint): boolean {
  return isStructuredAssemblerEa(code, blueprint);
}
