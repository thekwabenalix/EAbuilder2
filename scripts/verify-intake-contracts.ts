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

function indicatorIdsOf(blueprint: Blueprint): string[] {
  const refs = blueprint.indicatorRefs;
  assertOk(Array.isArray(refs), "expected indicatorRefs array");
  return refs.map((ref) => {
    assertOk(ref && typeof ref === "object", "expected indicator ref object");
    return String((ref as Record<string, unknown>).id);
  });
}

function filterRefsOf(blueprint: Blueprint): Array<Record<string, unknown>> {
  const refs = blueprint.filterRefs;
  assertOk(Array.isArray(refs), "expected filterRefs array");
  return refs.map((ref) => {
    assertOk(ref && typeof ref === "object", "expected filter ref object");
    return ref as Record<string, unknown>;
  });
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
      assertOk(indicatorIdsOf(blueprint).includes("ma"), "SMA should be recognized as MA built-in");
    },
  },
  {
    name: "built-in indicators are recognized without becoming fake modules",
    run: () => {
      const blueprint = normalizeBlueprint(
        clone({
          ...baseBlueprint,
          rules: [
            {
              id: "m15_rsi_macd_filter",
              type: "custom",
              side: "filter",
              label: "Use RSI above 50 and MACD histogram above zero as filters.",
              parameters: { timeframe: "M15" },
              compilable: true,
            },
            {
              id: "atr_stop",
              type: "atr_volatility",
              side: "filter",
              label: "Use ATR 14 to size the stop loss.",
              parameters: { timeframe: "M15", period: 14 },
              compilable: true,
            },
          ],
        }),
      );

      const ids = indicatorIdsOf(blueprint);
      assertOk(ids.includes("rsi"), "RSI should be recognized");
      assertOk(ids.includes("macd"), "MACD should be recognized");
      assertOk(ids.includes("atr"), "ATR should be recognized");
      const filters = filterRefsOf(blueprint);
      const filterIds = filters.map((ref) => String(ref.id));
      assertOk(filterIds.includes("rsi_level_filter"), "RSI filter should be recognized");
      assertOk(filterIds.includes("macd_histogram_filter"), "MACD filter should be recognized");
      assertOk(filterIds.includes("atr_volatility_filter"), "ATR filter should be recognized");
      assertOk(!blueprint.fourBrain, "built-in filters alone must not create a fake 4-Brain EA");
    },
  },
  {
    name: "raw text filter refs extract configured RSI ATR and MACD filters",
    run: () => {
      const blueprint = normalizeBlueprint(
        clone({
          ...baseBlueprint,
          rules: [],
          summary:
            "Use RSI 14 above 50, ATR 14 above 100 points, and MACD histogram above zero as filters on M15.",
        }),
      );

      const filters = filterRefsOf(blueprint);
      const rsi = filters.find((ref) => ref.id === "rsi_level_filter");
      const atr = filters.find((ref) => ref.id === "atr_volatility_filter");
      const macd = filters.find((ref) => ref.id === "macd_histogram_filter");
      assertOk(rsi, "RSI filter missing");
      assertOk(atr, "ATR filter missing");
      assertOk(macd, "MACD filter missing");
      assertEq((rsi.params as Record<string, unknown>).level, 50, "RSI level");
      assertEq((atr.params as Record<string, unknown>).minAtrPoints, 100, "ATR min points");
      assertEq((macd.params as Record<string, unknown>).operator, "above_zero", "MACD operator");
      assertEq(rsi.appliesTo, "execution", "default RSI placement");
      assertEq(atr.appliesTo, "execution", "default ATR placement");
      assertEq(macd.appliesTo, "execution", "default MACD placement");
      assertOk(!blueprint.fourBrain, "filter-only text must not create fake 4-Brain EA");
    },
  },
  {
    name: "raw text filter refs preserve setup versus execution placement",
    run: () => {
      const blueprint = normalizeBlueprint(
        clone({
          ...baseBlueprint,
          rules: [],
          summary:
            "RSI 14 above 50 must confirm the setup. MACD histogram above zero must pass before entry.",
        }),
      );

      const filters = filterRefsOf(blueprint);
      const rsi = filters.find((ref) => ref.id === "rsi_level_filter");
      const macd = filters.find((ref) => ref.id === "macd_histogram_filter");
      assertOk(rsi, "RSI filter missing");
      assertOk(macd, "MACD filter missing");
      assertEq(rsi.appliesTo, "setup", "RSI setup placement");
      assertEq(macd.appliesTo, "execution", "MACD execution placement");
    },
  },
  {
    name: "raw text fallback maps EMA retest then IFVG without relying on AI rules",
    run: () => {
      const prompt = `
        M5 only. The 12 EMA crosses above or below the 48 EMA to set direction.
        After the cross, price must test only the 48 EMA before any setup is valid.
        Only IFVGs that form after the EMA test are valid. Enter at the next candle.
        Take profit is 1:3. Move stop to breakeven at 1.5R. Ignore trades if stop loss exceeds 7 pips.
      `;
      const blueprint = normalizeBlueprint(
        clone({
          ...baseBlueprint,
          rules: [],
          summary: "EMA direction with IFVG entry.",
        }),
        prompt,
      );

      const fb = fourBrainOf(blueprint);
      const direction = brainOf(fb, "direction");
      const setup = brainOf(fb, "setup");
      const execution = brainOf(fb, "execution");
      const management = brainOf(fb, "management");
      assertEq(modulesOf(direction)[0], "ema", "direction module");
      assertEq(direction.timeframe, "M5", "direction timeframe");
      assertEq(paramsOf(direction).fastPeriod, 12, "direction fast EMA");
      assertEq(paramsOf(direction).slowPeriod, 48, "direction slow EMA");
      assertEq(modulesOf(setup)[0], "ema", "setup module");
      assertEq(paramsOf(setup).retestTarget, "slow", "setup retest target");
      assertEq(modulesOf(execution)[0], "fvg_inversion", "execution module");
      assertEq(execution.timeframe, "M5", "execution timeframe");
      assertEq(management.rewardRisk, 3, "reward risk");
      assertEq(management.breakEvenEnabled, true, "breakeven enabled");
      assertEq(management.breakEvenAtR, 1.5, "breakeven R");
      assertEq(management.maxStopPoints, 70, "max stop points");
    },
  },
  {
    name: "raw text extraction preserves advanced module parameters and audit",
    run: () => {
      const prompt = `
        M5 only. 12 EMA crosses 48 EMA for direction.
        Price must test only the 48 EMA within 3 points before setup is valid.
        Only IFVGs that form after the EMA test are valid. IFVG zones expire after 35 bars.
        Enter when the IFVG forms, not on a later retest.
      `;
      const blueprint = normalizeBlueprint(
        clone({
          ...baseBlueprint,
          rules: [],
          summary: "EMA IFVG strategy.",
        }),
        prompt,
      );

      const fb = fourBrainOf(blueprint);
      const setupParams = paramsOf(brainOf(fb, "setup"));
      const executionParams = paramsOf(brainOf(fb, "execution"));
      assertEq(setupParams.retestTarget, "slow", "setup retest target");
      assertEq(setupParams.retestPoints, 3, "setup retest tolerance");
      assertEq(executionParams.expiryBars, 35, "IFVG expiry bars");
      assertEq(executionParams.entryEvent, "formation", "IFVG entry event");
      assertOk(Array.isArray(blueprint.blueprintAudit), "blueprint audit missing");
      const auditCodes = (blueprint.blueprintAudit as Array<Record<string, unknown>>).map((item) =>
        String(item.code),
      );
      assertOk(auditCodes.includes("ema_retest_target_preserved"), "EMA audit missing");
      assertOk(auditCodes.includes("ifvg_entry_event_preserved"), "IFVG audit missing");
      assertOk(auditCodes.includes("expiry_bars_preserved"), "expiry audit missing");
    },
  },
  {
    name: "raw text extraction preserves BOS lookback and swing strength",
    run: () => {
      const blueprint = normalizeBlueprint(
        clone({
          ...baseBlueprint,
          rules: [
            {
              id: "d1_bos_bias",
              type: "bos",
              side: "both",
              label: "D1 BOS sets direction using lookback 80 bars and swing length 7.",
              parameters: { timeframe: "D1" },
              compilable: true,
            },
            {
              id: "m5_breakout_entry",
              type: "breakout_high",
              side: "both",
              label: "M5 breakout is the entry trigger.",
              parameters: { timeframe: "M5" },
              compilable: true,
            },
          ],
        }),
      );

      const fb = fourBrainOf(blueprint);
      const directionParams = paramsOf(brainOf(fb, "direction"));
      assertEq(directionParams.lookback, 80, "BOS lookback");
      assertEq(directionParams.swingLen, 7, "BOS swing length");
    },
  },
  {
    name: "prompt retest target overrides AI default either target",
    run: () => {
      const blueprint = normalizeBlueprint(
        clone({
          ...baseBlueprint,
          fourBrain: {
            direction: {
              modules: ["ema"],
              timeframe: "M5",
              params: { fastPeriod: 12, slowPeriod: 48, retestTarget: "either" },
              description: "EMA cross sets direction.",
            },
            setup: {
              modules: ["ema"],
              timeframe: "M5",
              params: { retestTarget: "either" },
              description: "EMA retest arms setup.",
            },
            execution: {
              modules: ["fvg_inversion"],
              timeframe: "M5",
              params: {},
              description: "IFVG entry.",
            },
          },
        }),
        "The retest must be on only the 48 EMA before any IFVG entry.",
      );

      const fb = fourBrainOf(blueprint);
      assertEq(paramsOf(brainOf(fb, "direction")).retestTarget, "slow", "direction target");
      assertEq(paramsOf(brainOf(fb, "setup")).retestTarget, "slow", "setup target");
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
