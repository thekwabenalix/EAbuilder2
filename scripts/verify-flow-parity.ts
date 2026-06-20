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
assertOk(
  withFilters.includes("rsi_level_filter blocked at entry"),
  "flow EA runs filter at entry gate",
);
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

assertOk(isFlowVerifiedModule("pin_bar"), "pin_bar is flow verified");
assertOk(isFlowVerifiedModule("bb"), "bb is flow verified");
assertOk(isFlowVerifiedModule("engulfing"), "engulfing is flow verified");
console.log("[OK  ] promoted modules available in flow picker");

function assertOnTickOrder(
  code: string,
  directionIdx: number,
  setupIdx: number,
  smTickNeedle: string,
): void {
  const onTickStart = code.indexOf("void OnTick()");
  assertOk(onTickStart >= 0, "OnTick handler present");
  const onTickBody = code.slice(onTickStart);
  const dirPos = onTickBody.indexOf(`DetectStep_${directionIdx}();`);
  const tickPos = onTickBody.indexOf(smTickNeedle);
  const setupPos = onTickBody.indexOf(`DetectStep_${setupIdx}();`);
  assertOk(dirPos >= 0, `direction DetectStep_${directionIdx} present in OnTick`);
  assertOk(tickPos >= 0, `${smTickNeedle} present in OnTick`);
  assertOk(setupPos >= 0, `setup DetectStep_${setupIdx} present in OnTick`);
  assertOk(dirPos < tickPos, `DetectStep_${directionIdx} runs before ${smTickNeedle} on each bar`);
  assertOk(tickPos < setupPos, `${smTickNeedle} runs before DetectStep_${setupIdx} on each bar`);
}

const bosEmaFlow = {
  version: 1 as const,
  mode: "advanced_instances" as const,
  source: "user" as const,
  management: { riskPercent: 1, rewardRisk: 2, maxOpenTrades: 1 },
  steps: [
    {
      id: "dir_bos",
      name: "Direction BOS M30",
      role: "direction" as const,
      module: "bos",
      timeframe: "M30",
      event: "BOS_BIAS",
      params: { lookback: 20 },
      enabled: true,
    },
    {
      id: "setup_ema",
      name: "Setup EMA M30",
      role: "setup" as const,
      module: "ema",
      timeframe: "M30",
      event: "EMA_CROSS",
      params: { fastPeriod: 12, slowPeriod: 48 },
      dependsOn: [{ stepId: "dir_bos" }],
      enabled: true,
    },
    {
      id: "conf_ema",
      name: "Confirmation EMA M30",
      role: "confirmation" as const,
      module: "ema",
      timeframe: "M30",
      event: "EMA_CLOSE_CONFIRMED",
      params: { fastPeriod: 12, slowPeriod: 48 },
      dependsOn: [{ stepId: "setup_ema" }],
      enabled: true,
    },
    {
      id: "entry_ema",
      name: "Entry EMA M30",
      role: "entry" as const,
      module: "ema",
      timeframe: "M30",
      event: "EMA_CLOSE_CONFIRMED",
      params: { fastPeriod: 12, slowPeriod: 48 },
      dependsOn: [{ stepId: "conf_ema" }],
      enabled: true,
    },
  ],
};
const bosEmaCode = generateFlowEA(bosEmaFlow, "BOS_EMA_Bias_Test");
assertOk(bosEmaCode.includes("EMASM_M30_Tick(gDir[0])"), "EMA SM uses BOS direction bias");
assertOk(bosEmaCode.includes("_confT"), "EMA entry waits for bar after confirmation");
assertOnTickOrder(bosEmaCode, 0, 1, "EMASM_M30_Tick");
console.log("[OK  ] BOS direction feeds EMA state machine bias");

const emaSameTfFlow = {
  version: 1 as const,
  mode: "advanced_instances" as const,
  source: "user" as const,
  management: { riskPercent: 1, rewardRisk: 2, maxOpenTrades: 1 },
  steps: [
    {
      id: "dir_ema",
      name: "Direction EMA M15",
      role: "direction" as const,
      module: "ema",
      timeframe: "M15",
      event: "EMA_BIAS",
      params: { fastPeriod: 12, slowPeriod: 48 },
      enabled: true,
    },
    {
      id: "setup_ema",
      name: "Setup EMA M15",
      role: "setup" as const,
      module: "ema",
      timeframe: "M15",
      event: "EMA_CROSS",
      params: { fastPeriod: 12, slowPeriod: 48 },
      dependsOn: [{ stepId: "dir_ema", relation: "after" as const }],
      enabled: true,
    },
    {
      id: "entry_ema",
      name: "Entry EMA M15",
      role: "entry" as const,
      module: "ema",
      timeframe: "M15",
      event: "EMA_CLOSE_CONFIRMED",
      params: { fastPeriod: 12, slowPeriod: 48 },
      dependsOn: [{ stepId: "setup_ema", relation: "same_or_after" as const }],
      enabled: true,
    },
  ],
};
const emaSameTfCode = generateFlowEA(emaSameTfFlow, "EmaSameTfTickOrderTest");
assertOk(
  emaSameTfCode.includes("EMASM_M15_Tick(gDir[0])"),
  "same-TF EMA chain uses direction gDir for tick",
);
assertOk(
  emaSameTfCode.includes("InpSetupExpiryBars = 0"),
  "EMA flow disables setup expiry by default",
);
assertOk(
  emaSameTfCode.includes("InpSetupExpiryBars > 0 &&"),
  "setup expiry gate skipped when expiry bars is 0",
);
assertOk(
  !emaSameTfCode.includes("cl < s1"),
  "slow EMA close-through does not invalidate bull setup",
);
assertOnTickOrder(emaSameTfCode, 0, 1, "EMASM_M15_Tick");
console.log("[OK  ] EMA direction detect runs before EMA SM tick on same timeframe");

const sameBarGateFlow = {
  version: 1 as const,
  mode: "advanced_instances" as const,
  source: "user" as const,
  management: { riskPercent: 1, rewardRisk: 2, maxOpenTrades: 1 },
  steps: [
    {
      id: "dir_bos",
      name: "Direction BOS H1",
      role: "direction" as const,
      module: "bos",
      timeframe: "H1",
      event: "BOS_BIAS",
      params: { lookback: 20 },
      enabled: true,
    },
    {
      id: "setup_fvg",
      name: "Setup FVG H1",
      role: "setup" as const,
      module: "fvg",
      timeframe: "H1",
      event: "FVG_CREATED",
      params: { expiryBars: 100 },
      dependsOn: [{ stepId: "dir_bos", relation: "after" as const }],
      enabled: true,
    },
    {
      id: "entry_bos",
      name: "Entry BOS M5",
      role: "entry" as const,
      module: "bos",
      timeframe: "M5",
      event: "BOS_CONFIRMED",
      params: { lookback: 20 },
      dependsOn: [
        { stepId: "dir_bos", relation: "after" as const },
        { stepId: "setup_fvg", relation: "same_or_after" as const },
      ],
      enabled: true,
    },
  ],
};
const sameBarCode = generateFlowEA(sameBarGateFlow, "SameBarGateTest");
assertOk(sameBarCode.includes("gTime[1] <= gTime[2]"), "same_or_after dependency uses <=");
assertOk(sameBarCode.includes("gTime[0] < gTime[2]"), "after dependency uses strict <");
assertOk(
  sameBarCode.includes("not same bar or before entry"),
  "same_or_after gate message emitted",
);
console.log("[OK  ] flow entry gate honors after vs same_or_after");

const unicornFlow = {
  version: 1 as const,
  mode: "advanced_instances" as const,
  source: "user" as const,
  management: { riskPercent: 1, rewardRisk: 2, maxOpenTrades: 1 },
  steps: [
    {
      id: "setup_uni",
      name: "Setup Unicorn H1",
      role: "setup" as const,
      module: "unicorn",
      timeframe: "H1",
      event: "UNICORN_ACTIVE",
      params: { lookback: 500, uniExpiry: 250, drawZones: true },
      enabled: true,
    },
    {
      id: "conf_uni",
      name: "Confirm Unicorn H1",
      role: "confirmation" as const,
      module: "unicorn",
      timeframe: "H1",
      event: "UNICORN_CONFIRMED",
      params: { lookback: 500, uniExpiry: 250 },
      dependsOn: [{ stepId: "setup_uni", relation: "after" as const }],
      enabled: true,
    },
    {
      id: "entry_next",
      name: "Entry Next Bar H1",
      role: "entry" as const,
      module: "unicorn",
      timeframe: "H1",
      event: "BAR_AFTER_CONFIRM",
      params: { lookback: 500, uniExpiry: 250 },
      dependsOn: [{ stepId: "conf_uni", relation: "after" as const }],
      enabled: true,
    },
  ],
};
const unicornCode = generateFlowEA(unicornFlow, "Unicorn_ZoneReject_Test");
assertOk(unicornCode.includes("UNISMSM_H1_BullJustRetested"), "unicorn SM exposes pocket retest");
assertOk(unicornCode.includes("UNISMSM_H1_BullJustConfirmed"), "unicorn SM exposes zone rejection confirm");
assertOk(unicornCode.includes("_confT"), "unicorn next-bar entry waits for bar after confirmation");
assertOk(unicornCode.includes("UNISMSM_H1_HasActiveBull"), "unicorn setup arms on active pocket");
assertOk(unicornCode.includes("UNISMSM_H1_Tick(500)"), "unicorn flow tick uses 500-bar lookback");
assertOk(!unicornCode.includes("void EvaluateEntry_1()"), "confirmation step must not open trades");
assertOk(unicornCode.includes("void EvaluateEntry_2()"), "entry step opens trades after confirm");
assertOk(unicornCode.includes("DrawUni"), "unicorn flow draws overlap pockets on chart");
console.log("[OK  ] unicorn setup → zone rejection → next-bar entry flow");

console.log("\n10 flow engine parity check(s) passed.\n");
