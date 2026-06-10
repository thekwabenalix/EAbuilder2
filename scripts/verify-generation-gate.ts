/**
 * Phase 5 — generation gate checks (validator blocks invalid blueprints).
 */
import { DEFAULT_BLUEPRINT } from "../src/types/blueprint";
import type { StrategyBlueprint } from "../src/types/blueprint";
import {
  assertBlueprintGeneratable,
  EaGenerationError,
  firstBlueprintGenerationError,
  validateBlueprintForGeneration,
} from "../src/lib/blueprint-generation-gate";
import { generateEaFromBlueprint } from "../src/lib/generate-ea-router";
import { generateMql5FromBlueprint } from "../src/lib/mql5-template-generator";
import { getGoldenSequenceCase } from "../src/lib/golden-sequences";
import { goldenSequenceBlueprint } from "../src/lib/golden-sequences";

function assertOk(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEq<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
  console.log(`[OK  ] ${message}`);
}

console.log("\nBlueprint generation gate tests\n");

const valid = goldenSequenceBlueprint(getGoldenSequenceCase("bos_fvg_bos")!);
const validGate = validateBlueprintForGeneration(valid);
assertOk(validGate.ok, "golden BOS/FVG/BOS passes gate");
assertOk(Boolean(validGate.flow?.steps.length), "gate returns resolved flow");
console.log("[OK  ] valid golden sequence passes gate");

const generated = generateEaFromBlueprint(valid);
assertOk(generated.code.includes("RegisterEvent"), "router generates after gate");
console.log("[OK  ] generateEaFromBlueprint succeeds after gate");

const noExec: StrategyBlueprint = {
  ...DEFAULT_BLUEPRINT,
  fourBrain: {
    direction: { modules: ["bos"], timeframe: "H1" },
    execution: { modules: [], timeframe: "M5" },
    management: { riskPercent: 1, rewardRisk: 2, maxOpenTrades: 1 },
  },
};
assertOk(!validateBlueprintForGeneration(noExec).ok, "empty execution blocked");
assertEq(
  firstBlueprintGenerationError(noExec),
  "Execution Brain needs at least one module and a timeframe.",
  "no execution error message",
);

const brokenFlow: StrategyBlueprint = {
  ...valid,
  strategyFlow: {
    version: 1,
    mode: "advanced_instances",
    source: "user",
    steps: [
      {
        id: "step_entry",
        name: "Entry",
        role: "entry",
        module: "bos",
        timeframe: "M5",
        event: "BOS_CONFIRMED",
        dependsOn: [{ stepId: "missing_step", relation: "after", required: true }],
      },
    ],
  },
};
assertOk(!validateBlueprintForGeneration(brokenFlow).ok, "broken explicit flow blocked");
try {
  generateEaFromBlueprint(brokenFlow);
  throw new Error("expected generateEaFromBlueprint to throw");
} catch (e: unknown) {
  assertOk(e instanceof EaGenerationError, "throws EaGenerationError");
  assertOk((e as EaGenerationError).validationErrors.length > 0, "carries validation errors");
}
console.log("[OK  ] broken strategyFlow blocked at router");

const legacy: StrategyBlueprint = { ...DEFAULT_BLUEPRINT, name: "Legacy" };
assertOk(!validateBlueprintForGeneration(legacy).ok, "legacy flat blueprint blocked");
try {
  generateMql5FromBlueprint(legacy);
  throw new Error("expected legacy generate to throw");
} catch (e: unknown) {
  assertOk(e instanceof Error, "legacy path throws");
}
console.log("[OK  ] legacy flat-rules blocked without allowLegacy");

assertOk(assertBlueprintGeneratable(valid).ok, "assertBlueprintGeneratable returns on success");
console.log("[OK  ] assertBlueprintGeneratable");

console.log("\n8 blueprint generation gate check(s) passed.\n");
