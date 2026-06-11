/**
 * Phase 4 — blessed patterns route through flow engine; assembler is deprecated.
 */
import { buildBlessedAdapterWiring } from "../src/lib/blessed-ema-adapters";
import { adaptBlessedWiringToFlow, blessedFlowSupportsAllSteps } from "../src/lib/blessed-flow-adapter";
import { BLUEPRINT_ASSEMBLER_DEPRECATION } from "../src/lib/ea-generation-policy";
import { generateEaFromAiWiring } from "../src/lib/generate-ea-from-ai-wiring";
import { generateEaFromBlueprint } from "../src/lib/generate-ea-router";
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

console.log("\nAssembler retire / blessed flow tests (Phase 4)\n");

const emaIfvgPrompt = `On M5, wait for 12 EMA to cross above 48 EMA. After the cross, price must test the 48 EMA only.
Only after that EMA test, watch for an iFVG to form. Enter when the iFVG inverts (formation), not on retest.`;

const emaCtcPrompt =
  "M5 EMA cross test close: 12/48 EMA cross, slow EMA retest, then close back beyond fast EMA for entry.";

const blueprint = (prompt: string, modules: StrategyBlueprint["fourBrain"]): StrategyBlueprint => ({
  ...DEFAULT_BLUEPRINT,
  name: "Blessed Flow Test",
  fourBrain: modules,
});

const ifvgBp = blueprint(emaIfvgPrompt, {
  direction: { modules: ["ema"], timeframe: "M5", params: { fastPeriod: 12, slowPeriod: 48 } },
  setup: { modules: ["fvg_inversion"], timeframe: "M5", params: { expiryBars: 100 } },
  execution: { modules: ["fvg_inversion"], timeframe: "M5", params: {} },
  management: { riskPercent: 1, rewardRisk: 2, maxOpenTrades: 1 },
});

const ctcBp = blueprint(emaCtcPrompt, {
  direction: { modules: ["ema"], timeframe: "M5", params: { fastPeriod: 12, slowPeriod: 48 } },
  setup: { modules: ["ema"], timeframe: "M5", params: {} },
  execution: { modules: ["ema"], timeframe: "M5", params: {} },
  management: { riskPercent: 1, rewardRisk: 2, maxOpenTrades: 1 },
});

const ifvgWiring = buildBlessedAdapterWiring("ema_ifvg", emaIfvgPrompt);
assertOk(blessedFlowSupportsAllSteps(ifvgWiring, emaIfvgPrompt), "EMA+IFVG blessed flow supported");

const ifvgFlow = adaptBlessedWiringToFlow(ifvgWiring, emaIfvgPrompt);
assertOk(ifvgFlow?.steps.length === 3, "EMA+IFVG flow has three steps");
assertEq(ifvgFlow?.steps[2]?.event, "IFVG_FORMED", "EMA+IFVG entry is IFVG formation");

const ifvgGen = generateEaFromAiWiring(ifvgBp, ifvgWiring);
assertEq(ifvgGen.aiMode, "blessed_flow", "EMA+IFVG AI routes to blessed_flow");
assertEq(ifvgGen.path, "flow_engine", "EMA+IFVG compiles via flow engine");
assertOk(ifvgGen.code.includes("BullJustInverted"), "EMA+IFVG flow uses IFVG formation entry");
assertOk(ifvgGen.code.includes("RegisterEvent"), "EMA+IFVG flow uses ordered event gate");

const ctcWiring = buildBlessedAdapterWiring("ema_ctc", emaCtcPrompt);
assertOk(blessedFlowSupportsAllSteps(ctcWiring, emaCtcPrompt), "EMA CTC blessed flow supported");

const ctcGen = generateEaFromAiWiring(ctcBp, ctcWiring);
assertEq(ctcGen.aiMode, "blessed_flow", "EMA CTC AI routes to blessed_flow");
assertEq(ctcGen.path, "flow_engine", "EMA CTC compiles via flow engine");
assertOk(ctcGen.code.includes("EMASM_M5_Tick(gDir[0])"), "EMA CTC flow ticks EMA SM with direction bias");

const bosBp: StrategyBlueprint = {
  ...DEFAULT_BLUEPRINT,
  name: "BOS only fallback check",
  fourBrain: {
    direction: { modules: ["bos"], timeframe: "H1" },
    setup: { modules: ["fvg"], timeframe: "H1" },
    execution: { modules: ["bos"], timeframe: "M5" },
    management: { riskPercent: 1, rewardRisk: 2, maxOpenTrades: 1 },
  },
};
const bosResult = generateEaFromBlueprint(bosBp);
assertEq(bosResult.path, "flow_engine", "standard BOS/FVG/BOS stays on flow engine");

assertOk(BLUEPRINT_ASSEMBLER_DEPRECATION.includes("deprecated"), "assembler deprecation message defined");

console.log("\nAll Phase 4 assembler retire checks passed.\n");
