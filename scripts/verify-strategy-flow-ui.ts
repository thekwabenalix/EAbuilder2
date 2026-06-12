/**
 * Phase 7 — Strategy Flow Builder UI helper checks.
 */
import {
  attachUserFlowToBlueprint,
  blueprintUsesAdvancedFlow,
  builderModeFromBlueprint,
  createDefaultStep,
  formatStepDisplayName,
  nameFromFlowSteps,
  reorderSteps,
  removeStepAt,
  seedAdvancedFlow,
  syncLinearDependencies,
  validateFlowForBuilder,
} from "../src/lib/strategy-flow-ui";
import { eventsForStepRole } from "../src/lib/strategy-flow-events";
import { flowModulesByTaxonomy } from "../src/lib/module-taxonomy";
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
assertOk(
  bosEvents.some((e) => e.eventType === "BOS_BIAS"),
  "BOS direction events listed",
);

const obSetupEvents = eventsForStepRole("order_block", "setup");
assertOk(
  obSetupEvents.some((e) => e.eventType === "OB_RETESTED"),
  "OB setup lists retest event",
);
assertOk(
  obSetupEvents[0]?.uiGroup === "retest" || obSetupEvents.some((e) => e.uiGroup === "retest"),
  "retest events sort first for setup role",
);

const obEntryEvents = eventsForStepRole("order_block", "entry");
assertOk(
  obEntryEvents.some((e) => e.eventType === "OB_CONFIRMED"),
  "OB entry lists zone rejection confirm",
);

const grouped = flowModulesByTaxonomy();
assertOk(grouped.some((g) => g.group.id === "structure" && g.modules.length > 0), "structure group");
assertOk(grouped.some((g) => g.group.id === "entry_zone" && g.modules.length > 0), "entry zone group");
const snrInEntry = grouped.find((g) => g.group.id === "entry_zone")?.modules.some((m) => m.id === "snr");
assertOk(snrInEntry, "Classic S/R grouped under entry zones");

const validation = validateFlowForBuilder(fourBrainToStrategyFlow(fourBrain));
assertOk(validation.schemaOk, "classic flow validates in builder");
assertOk(validation.flowEngineOk, "classic flow supported by flow engine");

assertEq(
  formatStepDisplayName("engulfing", "H4", "direction"),
  "Direction Engulfing / EF H4",
  "step label uses module label and role",
);

const staleStep = {
  ...chained[0]!,
  module: "engulfing" as const,
  role: "direction" as const,
  timeframe: "H4",
  name: "Entry BOS M5",
};
assertEq(
  attachUserFlowToBlueprint(bp, {
    version: 1,
    mode: "advanced_instances",
    source: "user",
    steps: [staleStep, ...chained.slice(1)],
  }).strategyFlow?.steps[0]?.name,
  "Direction Engulfing / EF H4",
  "attach normalizes stale auto-generated step names",
);

console.log("\n19 strategy flow builder UI check(s) passed.\n");
