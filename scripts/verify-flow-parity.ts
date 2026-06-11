/**
 * Phase 2 — flow engine parity (filters + OR dependency groups).
 */
import { generateFlowEA } from "../src/generators/gen-flow-ea";
import { fourBrainToStrategyFlow } from "../src/lib/fourbrain-flow-adapter";
import { generateEaFromBlueprint } from "../src/lib/generate-ea-router";
import { isFlowVerifiedModule } from "../src/generators/sm-embed-registry";
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

console.log("\nFlow engine parity tests (Phase 2)\n");

const flow = fourBrainToStrategyFlow({
  direction: { modules: ["bos"], timeframe: "H1" },
  setup: { modules: ["fvg"], timeframe: "H1" },
  execution: { modules: ["bos"], timeframe: "M5" },
  management: { riskPercent: 1, rewardRisk: 3, maxOpenTrades: 1 },
});

const filters: StrategyBlueprint["filterRefs"] = [
  {
    id: "rsi_level_filter",
    label: "RSI Level Filter",
    indicatorId: "rsi",
    role: "filter",
    appliesTo: "execution",
    timeframe: "M5",
    params: { period: 14, level: 50, operator: "directional" },
    status: "builtin_filter",
    note: "test",
  },
];

const withFilters = generateFlowEA(flow, "FilterTest", filters);
assertOk(withFilters.includes("B4_RSI"), "flow EA embeds RSI helper for filters");
assertOk(withFilters.includes("rsi_level_filter blocked at entry"), "flow EA runs filter at entry gate");
assertOk(withFilters.includes("[FILTER]"), "flow EA emits filter log marker");
console.log("[OK  ] built-in filters in flow engine");

const dualSetup = fourBrainToStrategyFlow({
  direction: { modules: ["bos"], timeframe: "H1" },
  setup: { modules: ["fvg", "order_block"], timeframe: "H1" },
  execution: { modules: ["bos"], timeframe: "M5" },
  management: { riskPercent: 1, rewardRisk: 2, maxOpenTrades: 1 },
});
const orCode = generateFlowEA(dualSetup, "OrGateTest");
assertOk(orCode.includes("setup_or not satisfied"), "flow EA emits OR group gate");
console.log("[OK  ] OR dependency groups in entry gate");

const bp: StrategyBlueprint = {
  ...DEFAULT_BLUEPRINT,
  name: "Filtered Flow",
  fourBrain: {
    direction: { modules: ["bos"], timeframe: "H1" },
    setup: { modules: ["fvg"], timeframe: "H1" },
    execution: { modules: ["bos"], timeframe: "M5" },
    management: { riskPercent: 1, rewardRisk: 3, maxOpenTrades: 1 },
  },
  filterRefs: filters,
};
const routed = generateEaFromBlueprint(bp);
assertEq(routed.path, "flow_engine", "filtered BOS/FVG/BOS stays on flow engine");
assertOk(routed.code.includes("B4_RSI"), "router passes filterRefs to flow engine");
console.log("[OK  ] router passes filterRefs to flow engine");

assertOk(!isFlowVerifiedModule("pin_bar"), "pin_bar excluded from advanced flow picker");
assertOk(!isFlowVerifiedModule("bb"), "bb excluded from advanced flow picker");
assertOk(isFlowVerifiedModule("engulfing"), "engulfing is flow verified");
console.log("[OK  ] legacy heuristic modules gated from flow picker");

console.log("\n6 flow engine parity check(s) passed.\n");
