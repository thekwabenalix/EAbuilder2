/**
 * Phase 8 — trade audit parser and expected-path checks.
 */
import { generateFlowEA } from "../src/generators/gen-flow-ea";
import { fourBrainToStrategyFlow } from "../src/lib/fourbrain-flow-adapter";
import {
  buildExpectedTradePath,
  parseTesterLogForTradeAudit,
  summarizeTradeAudit,
} from "../src/lib/trade-audit";
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

console.log("\nTrade audit tests\n");

const bp: StrategyBlueprint = {
  ...DEFAULT_BLUEPRINT,
  name: "Audit Demo",
  fourBrain: {
    direction: { modules: ["bos"], timeframe: "H1", params: { lookback: 20 } },
    setup: { modules: ["fvg"], timeframe: "H1", params: { expiryBars: 100 } },
    execution: { modules: ["bos"], timeframe: "M5", params: { lookback: 20 } },
    management: { riskPercent: 1, rewardRisk: 3, maxOpenTrades: 1 },
  },
};

const expected = buildExpectedTradePath(bp);
assertEq(expected.length, 3, "expected path has three steps");
assertOk(expected[0]?.isEntry === false, "first step is not entry");
assertOk(expected[2]?.isEntry === true, "last step is entry");

const sampleLog = `
2024.03.01 10:00:00   [EVENT] Direction BOS H1 | dir=1 | 2024.03.01 09:00 | sl=0.00000
2024.03.01 11:00:00   [EVENT] Setup FVG H1 | dir=1 | 2024.03.01 10:00 | sl=1.08500
2024.03.01 12:00:00   [GATE] BLOCKED: no exec signal
2024.03.01 13:00:00   ===== TRADE AUDIT =====
  Direction BOS H1 : BULL @ 2024.03.01 09:00
  Setup FVG H1 : BULL @ 2024.03.01 10:00
  Entry BOS M5 : BULL @ 2024.03.01 13:00
  ENTRY BUY lots=0.10 SL=1.08200 TP=1.08800
=======================
2024.03.01 14:00:00   EA_BUILDER_EQUITY|time=2024.03.01 14:00|balance=10100.00|equity=10100.00|profit=100.00|deal=123
`;

const parsed = parseTesterLogForTradeAudit(sampleLog);
assertOk(parsed.hasAuditMarkers, "log has audit markers");
assertEq(parsed.flowEvents.length, 2, "two flow events parsed");
assertEq(parsed.tradeChains.length, 1, "one trade chain parsed");
assertEq(parsed.tradesOpened, 1, "one trade opened");
assertEq(parsed.gateBlocks[0]?.reason, "No execution signal", "dominant block normalized");
assertEq(parsed.equitySnapshots, 1, "equity snapshot parsed");

const summary = summarizeTradeAudit(expected, parsed);
assertEq((summary.observed as { tradesOpened: number }).tradesOpened, 1, "summary includes trades");

const flow = fourBrainToStrategyFlow(bp.fourBrain!);
const code = generateFlowEA(flow, "Audit_Test");
assertOk(code.includes("===== TRADE AUDIT ====="), "generated flow EA emits trade audit");
assertOk(code.includes("InpAudit"), "generated flow EA has InpAudit input");

console.log("\n11 trade audit check(s) passed.\n");
