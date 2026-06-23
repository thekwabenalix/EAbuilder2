/**
 * Emit Unicorn Pocket preset EA for MT5 backtest (matches /build preset + adapter).
 */
import { writeFileSync } from "fs";
import { fourBrainToStrategyFlow } from "../src/lib/fourbrain-flow-adapter";
import { generateFlowEA } from "../src/generators/gen-flow-ea";
import { lintMql5 } from "../src/lib/mql5-static-lint";

const flow = fourBrainToStrategyFlow({
  setup: {
    modules: ["unicorn"],
    timeframe: "H1",
    params: { lookback: 500, pairWindow: 15, uniExpiry: 250, drawZones: true },
  },
  execution: { modules: ["rejection"], timeframe: "H1" },
  management: {
    riskPercent: 1,
    rewardRisk: 2,
    breakEvenEnabled: true,
    breakEvenAtR: 1,
    maxOpenTrades: 1,
    stopBuffer: 0,
    maxStopPoints: 0,
  },
});

const code = generateFlowEA(flow, "Unicorn_Pocket_Preset");
const out = "src/eas/Unicorn_Pocket_Preset.mq5";
writeFileSync(out, code);

const lint = lintMql5(code, { label: out, strict: true });
const lines = code.split("\n").length;

console.log(`Wrote ${out} (${lines} lines)`);
console.log(`  UNISMSM_H1_Tick(500): ${code.includes("UNISMSM_H1_Tick(500)")}`);
console.log(`  DrawUni: ${code.includes("DrawUni")}`);
console.log(`  EvaluateEntry_2 only: ${code.includes("void EvaluateEntry_2()") && !code.includes("void EvaluateEntry_1()")}`);

if (!lint.ok) {
  console.error("MQL5 lint warnings:", lint.warnings);
  process.exit(1);
}
console.log("MQL5 static lint: OK");
