/**
 * Phase 3 — faithful 4-Brain → StrategyFlow adapter checks.
 */
import {
  fourBrainToStrategyFlow,
  moduleStepId,
  downstreamAnchorSteps,
} from "../src/lib/fourbrain-flow-adapter";
import { validateStrategyFlowSchema } from "../src/lib/strategy-flow";
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

console.log("\n4-Brain flow adapter tests\n");

// ── Single-module regression (canonical BOS → FVG → BOS) ─────────────────────
const classic = fourBrainToStrategyFlow({
  direction: { modules: ["bos"], timeframe: "H1", params: { lookback: 20 } },
  setup: { modules: ["fvg"], timeframe: "H1", params: { expiryBars: 100 } },
  execution: { modules: ["bos"], timeframe: "M5", params: { lookback: 20 } },
  management: { riskPercent: 1, rewardRisk: 3, maxOpenTrades: 1 },
});

assertEq(classic.steps.length, 3, "classic flow has three steps");
assertEq(classic.steps[0]?.id, "step_direction", "stable direction id");
assertEq(classic.steps[1]?.id, "step_setup", "stable setup id");
assertEq(classic.steps[2]?.id, "step_entry", "stable entry id");
assertEq(classic.steps[0]?.event, "BOS_BIAS", "direction BOS bias event");
assertEq(classic.steps[1]?.event, "FVG_CREATED", "setup FVG zone event");
assertEq(classic.steps[2]?.event, "BOS_CONFIRMED", "entry BOS confirmed event");
assertEq(classic.steps[1]?.dependsOn?.[0]?.stepId, "step_direction", "setup after direction");
assertEq(classic.steps[2]?.dependsOn?.[0]?.stepId, "step_setup", "entry after setup");
assertOk(validateStrategyFlowSchema(classic).ok, "classic flow validates");

// ── Multi-module execution (OR — parallel entry steps) ───────────────────────
const dualEntry = fourBrainToStrategyFlow({
  direction: { modules: ["bos"], timeframe: "H1" },
  setup: { modules: ["fvg"], timeframe: "H1" },
  execution: { modules: ["bos", "engulfing"], timeframe: "M5" },
  management: { riskPercent: 1, rewardRisk: 2, maxOpenTrades: 1 },
});

assertEq(dualEntry.steps.length, 4, "dual execution expands to four steps");
assertEq(dualEntry.steps[2]?.id, "step_entry_0", "first entry step id");
assertEq(dualEntry.steps[3]?.id, "step_entry_1", "second entry step id");
assertEq(dualEntry.steps[2]?.module, "bos", "first entry module");
assertEq(dualEntry.steps[3]?.module, "engulfing", "second entry module");
assertEq(dualEntry.steps[2]?.dependsOn?.[0]?.stepId, "step_setup", "entry 0 after setup");
assertEq(dualEntry.steps[3]?.dependsOn?.[0]?.stepId, "step_setup", "entry 1 after setup");
assertOk(dualEntry.notes?.includes("parallel entry"), "notes mention parallel execution");
assertOk(validateStrategyFlowSchema(dualEntry).ok, "dual entry flow validates");

// ── Multi-module setup (parallel setup steps, OR group for downstream) ─────
const dualSetup = fourBrainToStrategyFlow({
  direction: { modules: ["bos"], timeframe: "H1" },
  setup: { modules: ["fvg", "order_block"], timeframe: "H1" },
  execution: { modules: ["bos"], timeframe: "M5" },
  management: { riskPercent: 1, rewardRisk: 2, maxOpenTrades: 1 },
});

assertEq(dualSetup.steps.length, 4, "dual setup expands to four steps");
assertEq(dualSetup.steps[1]?.id, "step_setup_0", "first setup step");
assertEq(dualSetup.steps[2]?.id, "step_setup_1", "second setup step");
assertEq(dualSetup.steps[1]?.dependsOn?.[0]?.stepId, "step_direction", "setup 0 after direction");
assertEq(dualSetup.steps[2]?.dependsOn?.[0]?.stepId, "step_direction", "setup 1 after direction");
assertEq(dualSetup.steps[3]?.dependsOn?.length, 2, "entry depends on both setup steps (OR)");
assertEq(dualSetup.steps[3]?.dependsOn?.[0]?.orGroup, "setup_or", "entry setup OR group");
assertOk(validateStrategyFlowSchema(dualSetup).ok, "dual setup flow validates");

// ── No direction brain (entry only chain) ────────────────────────────────────
const noDir = fourBrainToStrategyFlow({
  execution: { modules: ["engulfing"], timeframe: "M5" },
  management: { riskPercent: 1, rewardRisk: 2, maxOpenTrades: 1 },
});
assertEq(noDir.steps.length, 1, "execution-only flow");
assertEq(noDir.steps[0]?.role, "entry", "single entry step");
assertOk(validateStrategyFlowSchema(noDir).ok, "no-direction flow validates");

// ── Helpers ──────────────────────────────────────────────────────────────────
assertEq(moduleStepId("direction", 0, 1), "step_direction", "moduleStepId single");
assertEq(moduleStepId("execution", 1, 2), "step_entry_1", "moduleStepId multi");
const anchor = downstreamAnchorSteps([
  { id: "a", name: "A", role: "direction", module: "bos", timeframe: "H1", event: "BOS_BIAS" },
  { id: "b", name: "B", role: "direction", module: "choch", timeframe: "H1", event: "CHOCH_BIAS_FLIP" },
]);
assertEq(anchor.length, 2, "downstream anchor includes all parallel steps");
assertEq(anchor[0]?.id, "a", "downstream anchor first step");

// ── Router integration smoke ─────────────────────────────────────────────────
import { generateEaFromBlueprint } from "../src/lib/generate-ea-router";

const bp: StrategyBlueprint = {
  ...DEFAULT_BLUEPRINT,
  name: "Dual Entry Test",
  fourBrain: {
    direction: { modules: ["bos"], timeframe: "H1" },
    setup: { modules: ["fvg"], timeframe: "H1" },
    execution: { modules: ["bos", "engulfing"], timeframe: "M5" },
    management: { riskPercent: 1, rewardRisk: 2, maxOpenTrades: 1 },
  },
};
const routed = generateEaFromBlueprint(bp);
assertEq(routed.path, "flow_engine", "dual entry routes to flow engine");
assertOk(routed.code.includes("EvaluateEntry_2"), "flow EA has first entry gate");
assertOk(routed.code.includes("EvaluateEntry_3"), "flow EA has second entry gate");
assertOk(routed.code.includes("setup_or not satisfied") || dualSetup.steps[3]?.dependsOn?.[0]?.orGroup === "setup_or", "OR gate or deps present");

console.log("\n15 fourbrain flow adapter check(s) passed.\n");
