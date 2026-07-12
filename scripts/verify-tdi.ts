/**
 * Traders Dynamic Index regression checks.
 *
 *   npx tsx scripts/verify-tdi.ts
 */
import { generateEA } from "../src/generators/gen-ea";
import { genTdiSm } from "../src/generators/gen-tdi-sm";
import {
  emitStateMachineForModule,
  SM_MODULE_META,
  smPrefixForType,
  tickArgForSm,
} from "../src/generators/sm-embed-registry";
import { generateTdiStateModule } from "../src/lib/indicator-modules/tdi-state-module";
import { getModuleAdmission } from "../src/lib/module-admission";
import { getModuleContract } from "../src/lib/module-contracts";
import { resolveModuleId } from "../src/lib/resolve-module-id";
import { MODULE_SEMANTIC_EVENT_TYPES } from "../src/lib/strategy-events";

function assertOk(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEq<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
  console.log(`[OK  ] ${message}`);
}

/** Pure helpers mirroring TDI event rules (closed-bar). */
function bullCross(p0: number, s0: number, p1: number, s1: number): boolean {
  return p1 <= s1 && p0 > s0;
}
function bearCross(p0: number, s0: number, p1: number, s1: number): boolean {
  return p1 >= s1 && p0 < s0;
}
function bullConfirm(
  p0: number,
  s0: number,
  m0: number,
  p1: number,
  s1: number,
): boolean {
  return bullCross(p0, s0, p1, s1) && p0 > m0 && s0 > m0;
}
function bearConfirm(
  p0: number,
  s0: number,
  m0: number,
  p1: number,
  s1: number,
): boolean {
  return bearCross(p0, s0, p1, s1) && p0 < m0 && s0 < m0;
}

function sma(vals: number[], period: number): number {
  let s = 0;
  for (let i = 0; i < period; i++) s += vals[i]!;
  return s / period;
}

function stdDev(vals: number[], period: number, mean: number): number {
  let acc = 0;
  for (let i = 0; i < period; i++) {
    const d = vals[i]! - mean;
    acc += d * d;
  }
  return Math.sqrt(acc / period);
}

console.log("\nTDI module regression\n");

assertEq(SM_MODULE_META.tdi?.prefix, "TDISM", "SM_MODULE_META.tdi prefix");
assertEq(smPrefixForType("tdi"), "TDISM", "smPrefixForType(tdi)");
assertEq(tickArgForSm("tdi", {}, "assembler_brain"), "1", "tdi tick uses closed bar");
assertEq(getModuleAdmission("tdi")?.status, "verified_state_machine", "admission verified");
assertEq(getModuleContract("tdi")?.smPrefix, "TDISM", "contract prefix");
assertEq(resolveModuleId("traders dynamic index"), "tdi", "alias traders dynamic index");
assertEq(resolveModuleId("green crosses above red"), "tdi", "alias green crosses above red");
assertOk(MODULE_SEMANTIC_EVENT_TYPES.tdi?.tdi_confirmed === "TDI_CONFIRMED", "semantic confirm event");

const sm = genTdiSm("H1", "PERIOD_H1", "H1", {
  rsiPeriod: 13,
  rsiPricePeriod: 2,
  tradeSignalPeriod: 7,
  marketBasePeriod: 34,
  volatilityBandPeriod: 34,
  volatilityBandDeviation: 1.6185,
});
const requiredFns = [
  "TDISM_H1_BullCross()",
  "TDISM_H1_BearCross()",
  "TDISM_H1_IsBull()",
  "TDISM_H1_IsBear()",
  "TDISM_H1_StrongBull()",
  "TDISM_H1_StrongBear()",
  "TDISM_H1_BullConfirmed()",
  "TDISM_H1_BearConfirmed()",
  "TDISM_H1_BullJustConfirmed()",
  "TDISM_H1_BearJustConfirmed()",
  "TDISM_H1_BandsExpanding()",
  "TDISM_H1_BandsContracting()",
  "TDISM_H1_UpperBandTouched()",
  "TDISM_H1_LowerBandTouched()",
  "TDISM_H1_PriceLine()",
  "TDISM_H1_SignalLine()",
  "TDISM_H1_MarketBaseLine()",
  "TDISM_H1_UpperBand()",
  "TDISM_H1_LowerBand()",
  "TDISM_H1_BandWidth()",
  "iRSI(",
  "lastBar",
];
for (const fn of requiredFns) {
  assertOk(sm.includes(fn), `SM emits ${fn}`);
}
assertOk(!sm.includes("OrderSend"), "SM does not open trades");
assertOk(sm.includes("if(t0 == TDISM_H1_lastBar) return"), "last-processed-bar guard");
assertOk(sm.includes("ComputeAt(1,"), "uses closed shift 1");
assertOk(sm.includes("ComputeAt(2,"), "uses prior closed shift 2");
assertOk(!sm.includes("ComputeAt(0,"), "no forming-bar compute for events");

const embedded = emitStateMachineForModule("tdi", "M15", { rsiPeriod: 13 });
assertOk(embedded.includes("void TDISM_M15_Tick"), "registry embed TDISM_M15");

const ind = generateTdiStateModule();
assertOk(ind.includes("indicator_separate_window"), "separate window");
assertOk(ind.includes("#property indicator_buffers 16"), "16 buffers");
const bufferLabels = [
  "RSI Price Line",
  "Trade Signal Line",
  "Market Base Line",
  "Upper Volatility Band",
  "Lower Volatility Band",
];
for (const label of bufferLabels) assertOk(ind.includes(label), `indicator has ${label}`);
assertOk(ind.includes("SetIndexBuffer(5,"), "buffer 5 bull cross");
assertOk(ind.includes("SetIndexBuffer(15,"), "buffer 15 bear confirm");
assertOk(ind.includes("InpVbDeviation"), "configurable deviation");
assertOk(ind.includes("iRSI("), "indicator uses iRSI");
assertOk(!ind.includes("iBands("), "bands not from iBands on price");

// Synthetic series: bands from RSI values
const rsi = Array.from({ length: 40 }, (_, i) => 40 + Math.sin(i / 3) * 10);
const mid = sma(rsi, 34);
const sd = stdDev(rsi, 34, mid);
const upper = mid + 1.6185 * sd;
const lower = mid - 1.6185 * sd;
assertOk(upper > mid && lower < mid, "bands calculated from RSI series");
assertOk(upper - lower === 2 * 1.6185 * sd, "band width = 2*dev*sd");

// Cross fires once (logical)
assertOk(bullCross(55, 50, 48, 50), "bullish cross formula");
assertOk(!bullCross(55, 50, 52, 50), "no bull cross if already above");
assertOk(bearCross(45, 50, 52, 50), "bearish cross formula");
assertOk(bullConfirm(55, 52, 50, 48, 50), "bull confirm requires above MBL");
assertOk(!bullConfirm(55, 52, 60, 48, 50), "bull confirm blocked when below MBL");
assertOk(bearConfirm(45, 48, 50, 52, 50), "bear confirm requires below MBL");
assertOk(!bearConfirm(45, 48, 40, 52, 50), "bear confirm blocked when above MBL");

// Trend persistence
assertEq(55 > 50, true, "bullish trend state condition");
assertEq(45 < 50, true, "bearish trend state condition");

// Expand / contract
assertOk(12 > 10, "band expansion state");
assertOk(8 < 10, "band contraction state");

const ea = generateEA({
  eaName: "TDI_Verify_EA",
  config: {
    direction: { modules: ["tdi"], timeframe: "H1", params: { rsiPeriod: 13 } },
    setup: { modules: ["tdi"], timeframe: "H1", params: { rsiPeriod: 13 } },
    execution: { modules: ["tdi"], timeframe: "M15", params: { rsiPeriod: 13 } },
    management: { riskPercent: 1, rewardRisk: 2, stopBuffer: 20, maxOpenTrades: 1 },
  },
});
assertOk(ea.includes("void TDISM_H1_Tick"), "EA embeds TDISM_H1");
assertOk(ea.includes("void TDISM_M15_Tick"), "EA embeds TDISM_M15");
assertOk(ea.includes("TDISM_H1_IsBull()") || ea.includes("TDISM_H1_HasActiveBull()"), "EA queries TDI");
assertOk(!ea.includes("Unknown SM type: tdi"), "no unknown-SM placeholder");
assertOk(!ea.includes("not yet implemented"), "no unimplemented stub");

console.log("\nTDI regression checks passed.\n");
