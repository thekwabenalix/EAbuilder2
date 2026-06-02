/**
 * Strategy intake contract tests.
 *
 * These tests protect the stage where interview/parse output becomes a normalized
 * StrategyBlueprint with a FourBrainConfig. They intentionally avoid network/AI
 * calls and use fixture blueprints that represent what the interview may return.
 */
import { normalizeBlueprint } from "../netlify/functions/parse-strategy.mts";

type Blueprint = Record<string, unknown>;

interface ContractCase {
  name: string;
  run: () => void;
}

function assertOk(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEq<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function fourBrainOf(blueprint: Blueprint): Record<string, unknown> {
  const fb = blueprint.fourBrain;
  assertOk(fb && typeof fb === "object", "expected fourBrain to be present");
  return fb as Record<string, unknown>;
}

function brainOf(fb: Record<string, unknown>, key: string): Record<string, unknown> {
  const brain = fb[key];
  assertOk(brain && typeof brain === "object", `expected ${key} brain to be present`);
  return brain as Record<string, unknown>;
}

function modulesOf(brain: Record<string, unknown>): string[] {
  assertOk(Array.isArray(brain.modules), "expected brain.modules array");
  return brain.modules as string[];
}

function paramsOf(brain: Record<string, unknown>): Record<string, unknown> {
  assertOk(brain.params && typeof brain.params === "object", "expected brain.params object");
  return brain.params as Record<string, unknown>;
}

const baseBlueprint = {
  version: "2.0",
  name: "Fixture",
  strategyType: [],
  marketPhilosophy: "",
  rules: [],
  risk: {
    riskPercent: 1,
    rewardRisk: 2,
    lotSizingMethod: "equity_percent",
    stopType: "candle_extreme",
    stopBufferPoints: 20,
    trailingStop: false,
    breakevenEnabled: false,
    partialClose: false,
    maxOpenTrades: 1,
  },
  execution: {
    symbol: "ANY",
    setupTimeframe: "H4",
    entryTimeframe: "M5",
    orderType: "market",
    setupExpiryBars: 24,
    sessionFilter: [],
    spreadFilterPoints: 25,
    magicNumber: 990001,
  },
  compilable: true,
  compilableRuleIds: [],
  subjectiveRuleIds: [],
  pendingClarifications: [],
  confidence: 90,
  summary: "",
};

const cases: ContractCase[] = [
  {
    name: "explicit 4-Brain config preserves IFVG module and EMA params",
    run: () => {
      const blueprint = normalizeBlueprint(
        clone({
          ...baseBlueprint,
          fourBrain: {
            direction: {
              modules: ["ema"],
              timeframe: "M5",
              params: { fastPeriod: 12, slowPeriod: 48, retestTarget: "slow" },
              description: "12 EMA crosses 48 EMA for direction.",
            },
            setup: {
              modules: ["ema"],
              timeframe: "M5",
              params: { retestTarget: "slow" },
              description: "Price must test only the 48 EMA.",
            },
            execution: {
              modules: ["fvg_inversion"],
              timeframe: "M5",
              params: { expiryBars: 100 },
              description: "Only IFVGs that form after the EMA test are valid.",
            },
            management: { riskPercent: 1, rewardRisk: 3, stopBuffer: 20, maxOpenTrades: 1 },
          },
        }),
      );

      const fb = fourBrainOf(blueprint);
      const direction = brainOf(fb, "direction");
      const setup = brainOf(fb, "setup");
      const execution = brainOf(fb, "execution");
      assertEq(modulesOf(direction)[0], "ema", "direction module");
      assertEq(paramsOf(direction).fastPeriod, 12, "direction fast EMA");
      assertEq(paramsOf(direction).slowPeriod, 48, "direction slow EMA");
      assertEq(paramsOf(setup).retestTarget, "slow", "setup retest target");
      assertEq(modulesOf(execution)[0], "fvg_inversion", "execution module");
    },
  },
  {
    name: "rules infer BOS direction, order-block setup, engulfing execution",
    run: () => {
      const blueprint = normalizeBlueprint(
        clone({
          ...baseBlueprint,
          risk: { ...baseBlueprint.risk, rewardRisk: 3, maxOpenTrades: 1 },
          rules: [
            {
              id: "d1_bos_bias",
              type: "bos",
              side: "both",
              label: "D1 break of structure sets direction bias.",
              parameters: { timeframe: "D1", swingLen: 3, lookback: 80 },
              compilable: true,
            },
            {
              id: "h4_order_block_setup",
              type: "order_block_bullish",
              side: "both",
              label: "H4 order block creates the setup zone.",
              parameters: { timeframe: "H4", expiryBars: 120 },
              compilable: true,
            },
            {
              id: "m5_engulfing_entry",
              type: "engulfing_bullish",
              side: "both",
              label: "M5 engulfing candle is the entry trigger.",
              parameters: { timeframe: "M5" },
              compilable: true,
            },
          ],
        }),
      );

      const fb = fourBrainOf(blueprint);
      assertEq(modulesOf(brainOf(fb, "direction"))[0], "bos", "direction module");
      assertEq(brainOf(fb, "direction").timeframe, "D1", "direction timeframe");
      assertEq(modulesOf(brainOf(fb, "setup"))[0], "order_block", "setup module");
      assertEq(brainOf(fb, "setup").timeframe, "H4", "setup timeframe");
      assertEq(modulesOf(brainOf(fb, "execution"))[0], "engulfing", "execution module");
      assertEq(brainOf(fb, "execution").timeframe, "M5", "execution timeframe");
    },
  },
  {
    name: "supply and demand zones map to order-block family",
    run: () => {
      const blueprint = normalizeBlueprint(
        clone({
          ...baseBlueprint,
          rules: [
            {
              id: "h1_demand_setup",
              type: "demand_zone",
              side: "buy",
              label: "H1 demand zone is the setup zone.",
              parameters: { timeframe: "H1", expiryBars: 90 },
              compilable: true,
            },
            {
              id: "m5_liquidity_entry",
              type: "liquidity_sweep_low",
              side: "buy",
              label: "M5 liquidity sweep into demand triggers the buy entry.",
              parameters: { timeframe: "M5", lookback: 50 },
              compilable: true,
            },
          ],
        }),
      );

      const fb = fourBrainOf(blueprint);
      assertOk(!fb.direction, "demand-zone strategy should not invent a direction brain");
      assertEq(modulesOf(brainOf(fb, "setup"))[0], "order_block", "setup module");
      assertEq(brainOf(fb, "setup").timeframe, "H1", "setup timeframe");
      assertEq(modulesOf(brainOf(fb, "execution"))[0], "liqsweep", "execution module");
      assertEq(brainOf(fb, "execution").timeframe, "M5", "execution timeframe");
    },
  },
  {
    name: "IFVG rules infer fvg_inversion, not generic FVG",
    run: () => {
      const blueprint = normalizeBlueprint(
        clone({
          ...baseBlueprint,
          rules: [
            {
              id: "m5_ifvg_entry",
              type: "custom",
              side: "both",
              label:
                "M5 IFVG formation is the entry trigger after price closes through the old FVG boundary.",
              parameters: { timeframe: "M5", expiryBars: 100 },
              compilable: true,
            },
          ],
        }),
      );

      const fb = fourBrainOf(blueprint);
      assertEq(modulesOf(brainOf(fb, "execution"))[0], "fvg_inversion", "execution module");
    },
  },
  {
    name: "unsupported SMA does not silently become EMA",
    run: () => {
      const blueprint = normalizeBlueprint(
        clone({
          ...baseBlueprint,
          rules: [
            {
              id: "m15_sma_cross",
              type: "sma_cross",
              side: "both",
              label: "20 SMA crosses 50 SMA on M15.",
              parameters: { timeframe: "M15", fastPeriod: 20, slowPeriod: 50 },
              compilable: true,
            },
          ],
        }),
      );

      assertOk(
        !blueprint.fourBrain,
        "SMA must not be mapped to EMA until SMA has a verified module",
      );
    },
  },
];

console.log("\nStrategy intake contract tests\n");
let failed = 0;
for (const test of cases) {
  try {
    test.run();
    console.log(`[OK  ] ${test.name}`);
  } catch (error) {
    failed++;
    console.log(`[FAIL] ${test.name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failed > 0) {
  console.log(`\n${failed} intake contract test(s) failed.`);
  process.exit(1);
}

console.log(`\n${cases.length} intake contract test(s) passed.`);
