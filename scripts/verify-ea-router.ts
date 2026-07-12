/**
 * Phase 1 - single generate router checks (flow vs blueprint vs legacy).
 */
import {
  generateEaFromBlueprint,
  previewEaGeneration,
  resolveStrategyFlow,
} from "../src/lib/generate-ea-router";
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

const pinBarBp: StrategyBlueprint = {
  ...DEFAULT_BLUEPRINT,
  name: "Pin Bar Flow",
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

const pinFlow = resolveStrategyFlow(pinBarBp)!;
assertOk(flowEaSupportsAllSteps(pinFlow), "pin_bar supported by flow engine");
assertOk(!configUsesLegacyHeuristics(pinBarBp.fourBrain!), "pin_bar uses verified SM");
const pinResult = generateEaFromBlueprint(pinBarBp);
assertEq(pinResult.path, "flow_engine", "pin_bar uses flow engine");
assertOk(pinResult.code.includes("PINSM_M5_BullJustConfirmed"), "flow code uses PINSM entry");
console.log("[OK  ] router selects flow_engine for pin_bar");

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

const mesEngulfBp: StrategyBlueprint = {
  ...DEFAULT_BLUEPRINT,
  name: "MES Engulfing",
  fourBrain: {
    direction: { modules: ["engulfing"], timeframe: "D1" },
    setup: { modules: ["engulfing"], timeframe: "H4" },
    execution: { modules: ["engulfing"], timeframe: "M15" },
    management: { riskPercent: 1, rewardRisk: 2, maxOpenTrades: 1 },
  },
};
const mesFlow = resolveStrategyFlow(mesEngulfBp)!;
assertOk(flowEaSupportsAllSteps(mesFlow), "MES engulfing admitted by flow engine");
const mesResult = generateEaFromBlueprint(mesEngulfBp);
assertEq(mesResult.path, "flow_engine", "MES multi-engulfing uses flow engine");
assertOk(mesResult.code.includes("EGSM_D1"), "embeds D1 engulfing SM");
assertOk(mesResult.code.includes("EGSM_H4"), "embeds H4 engulfing SM");
assertOk(mesResult.code.includes("EGSM_M15"), "embeds M15 engulfing SM");
assertOk(mesResult.code.includes("EGSM_D1_HasActiveBull"), "direction uses HasActive bias");
assertOk(!/Direction\s*:\s*NONE/i.test(mesResult.code), "direction is not NONE");
console.log("[OK  ] MES multi-engulfing → flow_engine with all EGSM TFs");

const preview = previewEaGeneration(flowBp);
assertEq(preview.path, "flow_engine", "preview matches flow_engine");
assertEq(preview.validationErrors.length, 0, "preview has no errors");
console.log("[OK  ] previewEaGeneration without emitting code");

console.log("\n8 ea generation router check(s) passed.\n");
