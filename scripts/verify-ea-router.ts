/**
 * Phase 1 — single generate router checks (flow vs blueprint vs legacy).
 */
import { generateEaFromBlueprint, resolveStrategyFlow } from "../src/lib/generate-ea-router";
import { flowEaSupportsAllSteps } from "../src/generators/gen-flow-ea";
import { configUsesLegacyHeuristics } from "../src/generators/gen-blueprint-wiring";
import type { StrategyBlueprint } from "../src/types/blueprint";
import { DEFAULT_BLUEPRINT } from "../src/types/blueprint";

function assertOk(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEq<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
  console.log(`[OK  ] ${message}`);
}

const flowBp: StrategyBlueprint = {
  ...DEFAULT_BLUEPRINT,
  name: "Flow Demo",
  fourBrain: {
    direction: { modules: ["bos"], timeframe: "H1", params: { lookback: 20 } },
    setup: { modules: ["fvg"], timeframe: "H1", params: { expiryBars: 100 } },
    execution: { modules: ["bos"], timeframe: "M5", params: { lookback: 20 } },
    management: { riskPercent: 1, rewardRisk: 3, maxOpenTrades: 1 },
  },
};

const assemblerBp: StrategyBlueprint = {
  ...DEFAULT_BLUEPRINT,
  name: "Assembler Fallback",
  fourBrain: {
    direction: { modules: ["bos"], timeframe: "H1" },
    execution: { modules: ["pin_bar"], timeframe: "M5" },
    management: { riskPercent: 1, rewardRisk: 2, maxOpenTrades: 1 },
  },
};

console.log("\nEA generation router tests\n");

const flow = resolveStrategyFlow(flowBp);
assertOk(flow, "resolved flow from 4-Brain");
assertOk(flowEaSupportsAllSteps(flow!), "BOS/FVG/BOS supported by flow engine");
console.log("[OK  ] flow resolution + support check");

const flowResult = generateEaFromBlueprint(flowBp);
assertEq(flowResult.path, "flow_engine", "BOS/FVG/BOS uses flow engine");
assertOk(flowResult.code.includes("RegisterEvent"), "flow code contains RegisterEvent");
console.log("[OK  ] router selects flow_engine");

const asmFlow = resolveStrategyFlow(assemblerBp)!;
assertOk(!flowEaSupportsAllSteps(asmFlow), "pin_bar blocks flow engine");
assertOk(configUsesLegacyHeuristics(assemblerBp.fourBrain!), "pin_bar uses legacy heuristics");
const asmResult = generateEaFromBlueprint(assemblerBp);
assertEq(asmResult.path, "legacy_heuristic", "pin_bar falls back to legacy heuristic");
console.log("[OK  ] router selects legacy_heuristic for pin_bar");

const noSetupBp: StrategyBlueprint = {
  ...DEFAULT_BLUEPRINT,
  fourBrain: {
    direction: { modules: ["bos"], timeframe: "H1" },
    execution: { modules: ["engulfing"], timeframe: "M5" },
    management: { riskPercent: 1, rewardRisk: 2, maxOpenTrades: 1 },
  },
};
const noSetupResult = generateEaFromBlueprint(noSetupBp);
assertEq(noSetupResult.path, "flow_engine", "BOS + engulfing uses flow without setup brain");
console.log("[OK  ] router flow without setup brain");

console.log("\n5 ea generation router check(s) passed.\n");
