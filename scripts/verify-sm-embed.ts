/**
 * Phase 2 — shared SM embed registry checks.
 */
import { generateEA } from "../src/generators/gen-ea";
import { generateFlowEA } from "../src/generators/gen-flow-ea";
import {
  emitStateMachine,
  emitStateMachineForModule,
  periodConst,
  SM_MODULE_META,
  smPrefixForType,
  tickArgForSm,
} from "../src/generators/sm-embed-registry";
import { fourBrainToStrategyFlow } from "../src/lib/strategy-flow";
import type { FourBrainConfig } from "../src/types/blueprint";

function assertOk(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEq<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
  console.log(`[OK  ] ${message}`);
}

console.log("\nSM embed registry tests\n");

const params = { expiryBars: 100, lookback: 20, swingLen: 5 };
const viaModule = emitStateMachineForModule("fvg", "H1", params);
const viaType = emitStateMachine("fvg", "H1", periodConst("H1"), "H1", params);
assertEq(viaModule, viaType, "module and type emitters agree for FVG");
assertOk(viaModule.includes("void FVGSM_H1_Tick"), "FVG SM embedded");

assertEq(smPrefixForType("ob"), "OBSM", "order_block type maps to OBSM");
assertEq(SM_MODULE_META.order_block.type, "ob", "order_block module meta");
assertEq(
  tickArgForSm("bos", { lookback: 30 }, "flow_bar"),
  "30",
  "flow tick arg uses lookback",
);
assertEq(tickArgForSm("ema", {}, "assembler_brain"), "gBias", "assembler EMA tick uses gBias");

const classicFlow = fourBrainToStrategyFlow({
  direction: { modules: ["bos"], timeframe: "H1", params: { lookback: 20 } },
  setup: { modules: ["fvg"], timeframe: "H1", params: { expiryBars: 100 } },
  execution: { modules: ["bos"], timeframe: "M5", params: { lookback: 20 } },
  management: { riskPercent: 1, rewardRisk: 3, maxOpenTrades: 1 },
} as FourBrainConfig);

const flowCode = generateFlowEA(classicFlow, "SM_Embed_Flow_Test");
const assemblerCode = generateEA({
  eaName: "SM_Embed_Assembler_Test",
  config: {
    direction: { modules: ["bos"], timeframe: "H1", params: { lookback: 20 } },
    setup: { modules: ["fvg"], timeframe: "H1", params: { expiryBars: 100 } },
    execution: { modules: ["bos"], timeframe: "M5", params: { lookback: 20 } },
    management: { riskPercent: 1, rewardRisk: 3, maxOpenTrades: 1 },
  },
});

for (const [label, code, prefix] of [
  ["flow", flowCode, "FVGSM_H1"],
  ["assembler", assemblerCode, "FVGSM_H1"],
  ["flow", flowCode, "BOSSM_M5"],
  ["assembler", assemblerCode, "BOSSM_M5"],
] as const) {
  assertOk(code.includes(prefix), `${label} EA embeds ${prefix}`);
}

assertOk(flowCode.includes("RegisterEvent"), "flow EA uses event runtime");
assertOk(assemblerCode.includes("Blueprint wiring"), "assembler EA uses blueprint wiring");
assertOk(assemblerCode.includes("gBias"), "assembler EA has direction brain state");

console.log("\n10 sm embed registry check(s) passed.\n");
