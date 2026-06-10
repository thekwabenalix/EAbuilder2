/**
 * Phase 7 — Strategy Flow Builder UI helper checks.
 */
import {
  attachUserFlowToBlueprint,
  blueprintUsesAdvancedFlow,
  builderModeFromBlueprint,
  createDefaultStep,
  nameFromFlowSteps,
  reorderSteps,
  removeStepAt,
  seedAdvancedFlow,
  syncLinearDependencies,
  validateFlowForBuilder,
} from "../src/lib/strategy-flow-ui";
import { eventsForStepRole } from "../src/lib/strategy-flow-events";
import { fourBrainToStrategyFlow } from "../src/lib/fourbrain-flow-adapter";
import { DEFAULT_BLUEPRINT } from "../src/types/blueprint";
import type { StrategyBlueprint } from "../src/types/blueprint";

function assertOk(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEq<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
  console.log(`[OK  ] ${message}`);
}

console.log("\nStrategy Flow Builder UI tests\n");

const fourBrain = {
  direction: { modules: ["bos"], timeframe: "H1", params: { lookback: 20 } },
  setup: { modules: ["fvg"], timeframe: "H1", params: { expiryBars: 100 } },
  execution: { modules: ["bos"], timeframe: "M5", params: { lookback: 20 } },
  management: { riskPercent: 1, rewardRisk: 3, maxOpenTrades: 1 },
};

const bp: StrategyBlueprint = {
  ...DEFAULT_BLUEPRINT,
  name: "Classic",
  fourBrain,
};

assertEq(builderModeFromBlueprint(bp), "simple", "4-Brain only is simple mode");

const seeded = seedAdvancedFlow(bp, fourBrain);
assertEq(seeded.steps.length, 3, "seed from 4-Brain yields three steps");
assertEq(seeded.mode, "advanced_instances", "seeded flow is advanced_instances");

const chained = syncLinearDependencies(seeded.steps);
assertEq(chained[1]?.dependsOn?.[0]?.stepId, "step_direction", "setup after direction");
assertEq(chained[2]?.dependsOn?.[0]?.stepId, "step_setup", "entry after setup");

const reordered = reorderSteps(chained, 2, 0);
assertEq(reordered[0]?.id, chained[2]?.id, "reorder moves entry to front");

const withNew = [...chained, createDefaultStep(chained, "entry")];
assertEq(withNew.length, 4, "add default step");

const removed = removeStepAt(withNew, 1);
assertEq(removed.length, 3, "remove step");

const attached = attachUserFlowToBlueprint(bp, {
  version: 1,
  mode: "advanced_instances",
  source: "user",
  steps: chained,
});
assertOk(blueprintUsesAdvancedFlow(attached), "attached user flow is advanced");
assertEq(attached.strategyFlow?.source, "user", "source is user");

const flowName = nameFromFlowSteps(chained);
assertOk(flowName.includes("H1") && flowName.includes("M5"), "name from flow steps");

const bosEvents = eventsForStepRole("bos", "direction");
assertOk(bosEvents.some((e) => e.eventType === "BOS_BIAS"), "BOS direction events listed");

const validation = validateFlowForBuilder(fourBrainToStrategyFlow(fourBrain));
assertOk(validation.schemaOk, "classic flow validates in builder");
assertOk(validation.flowEngineOk, "classic flow supported by flow engine");

console.log("\n12 strategy flow builder UI check(s) passed.\n");
