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
    name: "strong engulfing wording maps to guarded SEG instead of EG/EF",
    run: () => {
      const blueprint = normalizeBlueprint(
        clone({
          ...baseBlueprint,
          rules: [
            {
              id: "m5_strong_engulfing_entry",
              type: "strong_engulfing",
              side: "both",
              label: "M5 strong engulfing candle is the entry trigger.",
              parameters: { timeframe: "M5" },
              compilable: true,
            },
          ],
        }),
      );

      const fb = fourBrainOf(blueprint);
      assertEq(modulesOf(brainOf(fb, "execution"))[0], "seg", "execution module");
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
    name: "implicit FVG inversion wording repairs execution to IFVG formation",
    run: () => {
      const prompt = `
        H1 12 EMA crossing 48 EMA determines bullish or bearish direction.
        After direction EMA cross, price must test 48 EMA. During the test price must create a Fair Value Gap.
        The Fair Value Gap created during the retest must be inverted, creating an iFVG.
        Execute a trade at the open of the new candle after the iFVG.
        Risk 1% and TP is 3R.
      `;
      const blueprint = normalizeBlueprint(
        clone({
          ...baseBlueprint,
          fourBrain: {
            direction: {
              modules: ["ema"],
              timeframe: "H1",
              params: { fastPeriod: 12, slowPeriod: 48 },
              description: "EMA cross sets direction.",
            },
            setup: {
              modules: ["ema", "fvg"],
              timeframe: "H1",
              params: { fastPeriod: 12, slowPeriod: 48, eemaPeriod: 48 },
              description: "EMA retest plus Fair Value Gap.",
            },
            execution: {
              modules: ["fvg"],
              timeframe: "H1",
              params: {},
              description: "Fair Value Gap executes at the next bar open.",
            },
          },
        }),
        prompt,
      );

      const fb = fourBrainOf(blueprint);
      const execution = brainOf(fb, "execution");
      assertEq(modulesOf(execution)[0], "fvg_inversion", "execution module");
      assertEq(paramsOf(execution).entryEvent, "formation", "IFVG entry event");
      const auditCodes = ((blueprint.blueprintAudit ?? []) as Array<Record<string, unknown>>).map(
        (item) => String(item.code),
      );
      assertOk(auditCodes.includes("ifvg_entry_event_preserved"), "IFVG audit missing");
      const severities = ((blueprint.blueprintAudit ?? []) as Array<Record<string, unknown>>).map(
        (item) => String(item.severity),
      );
      assertOk(!severities.includes("error"), "IFVG repair should not leave audit errors");
    },
  },
  {
    name: "EMA retest before FVG repairs setup into EMA plus FVG gate",
    run: () => {
      const prompt = `
        H1 12 EMA crossing 48 EMA determines bullish or bearish direction.
        After direction EMA cross, price must test 48 EMA. During the test price must create a Fair Value Gap.
        The Fair Value Gap created during the retest must be inverted, creating an iFVG.
        Execute a trade at the open of the new candle after the iFVG.
      `;
      const blueprint = normalizeBlueprint(
        clone({
          ...baseBlueprint,
          fourBrain: {
            direction: {
              modules: ["ema"],
              timeframe: "H1",
              params: { fastPeriod: 12, slowPeriod: 48, retestTarget: "slow" },
              description: "EMA cross sets direction.",
            },
            setup: {
              modules: ["fvg"],
              timeframe: "H1",
              params: { expiryBars: 50, slBuffer: 20 },
              description: "Fair Value Gap created during the retest.",
            },
            execution: {
              modules: ["fvg_inversion"],
              timeframe: "H1",
              params: { entryEvent: "formation" },
              description: "Inversion FVG entry.",
            },
          },
        }),
        prompt,
      );

      const fb = fourBrainOf(blueprint);
      const setup = brainOf(fb, "setup");
      assertEq(modulesOf(setup)[0], "ema", "setup first module");
      assertEq(modulesOf(setup)[1], "fvg", "setup confluence module");
      assertEq(paramsOf(setup).retestTarget, "slow", "setup retest target");
      assertEq(paramsOf(setup).expiryBars, 50, "setup FVG expiry");
      const auditCodes = ((blueprint.blueprintAudit ?? []) as Array<Record<string, unknown>>).map(
        (item) => String(item.code),
      );
      assertOk(auditCodes.includes("ema_retest_target_preserved"), "EMA audit missing");
      const severities = ((blueprint.blueprintAudit ?? []) as Array<Record<string, unknown>>).map(
        (item) => String(item.severity),
      );
      assertOk(!severities.includes("error"), "EMA setup repair should not leave audit errors");
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
    name: "raw text fallback maps EMA Cross-Test-Close sequence",
    run: () => {
      const prompt = `
        Create a Cross-Test-Close strategy. Default timeframe M30.
        The 12 EMA crosses above or below the 48 EMA to set direction.
        After a valid EMA cross, price must retrace to the 48 EMA.
        Only the first valid 48 EMA test after the cross should be considered.
        After the test, a candle must close above the 12 EMA for buys or below the 12 EMA for sells.
        Enter at the open of the next candle after the close confirmation.
        Risk 1%. Risk reward is 1:3. Move stop to breakeven at 1.5R.
      `;
      const blueprint = normalizeBlueprint(
        clone({
          ...baseBlueprint,
          rules: [],
          summary: "Cross-Test-Close EMA strategy.",
        }),
        prompt,
      );

      const fb = fourBrainOf(blueprint);
      const direction = brainOf(fb, "direction");
      const setup = brainOf(fb, "setup");
      const execution = brainOf(fb, "execution");
      const management = brainOf(fb, "management");
      assertEq(modulesOf(direction)[0], "ema", "direction module");
      assertEq(direction.timeframe, "M30", "direction timeframe");
      assertEq(paramsOf(direction).fastPeriod, 12, "direction fast EMA");
      assertEq(paramsOf(direction).slowPeriod, 48, "direction slow EMA");
      assertEq(modulesOf(setup)[0], "ema", "setup module");
      assertEq(setup.timeframe, "M30", "setup timeframe");
      assertEq(paramsOf(setup).retestTarget, "slow", "setup 48 EMA retest target");
      assertEq(paramsOf(setup).sequenceMode, "cross_test_close", "setup sequence mode");
      assertEq(modulesOf(execution)[0], "ema", "execution module");
      assertEq(execution.timeframe, "M30", "execution timeframe");
      assertEq(paramsOf(execution).sequenceMode, "cross_test_close", "execution sequence mode");
      assertEq(paramsOf(execution).retestTarget, "slow", "execution 48 EMA retest target");
      assertEq(management.rewardRisk, 3, "reward risk");
      assertEq(management.breakEvenEnabled, true, "breakeven enabled");
      assertEq(management.breakEvenAtR, 1.5, "breakeven R");
      assertEq(management.maxStopPoints, 0, "stop buffer must not become max stop");
    },
  },
  {
    name: "CTC stop buffer and max stop do not become EMA retest tolerance",
    run: () => {
      const prompt = `
        Cross-Test-Close on M30.
        The 12 EMA crosses above or below the 48 EMA to set direction.
        After the cross, price must test the 48 EMA.
        After the test, a candle must close above the 12 EMA for buys or below it for sells.
        Enter at the open of the next candle.
        Default Stop Loss Buffer: 20 points.
        Ignore trades if stop loss exceeds 15 pips.
      `;
      const blueprint = normalizeBlueprint(
        clone({
          ...baseBlueprint,
          rules: [],
          summary: "Cross-Test-Close EMA strategy.",
        }),
        prompt,
      );

      const fb = fourBrainOf(blueprint);
      const setupParams = paramsOf(brainOf(fb, "setup"));
      const executionParams = paramsOf(brainOf(fb, "execution"));
      const management = brainOf(fb, "management");
      assertOk(!("retestPoints" in setupParams), "setup must not inherit stop buffer as tolerance");
      assertOk(
        !("retestPoints" in executionParams),
        "execution must not inherit max stop as tolerance",
      );
      assertEq(management.maxStopPoints, 150, "max stop remains a management filter");
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
    name: "intent contract captures EMA retest then IFVG formation sequence",
    run: () => {
      const prompt = `
        M5 only. 12 EMA crosses 48 EMA for direction.
        Price must test only the 48 EMA before setup is valid.
        Only IFVGs that form after the EMA test are valid.
        Enter when the IFVG forms. Take profit is 1:3.
      `;
      const blueprint = normalizeBlueprint(
        clone({
          ...baseBlueprint,
          rules: [],
          summary: "EMA IFVG strategy.",
        }),
        prompt,
      );

      const contract = blueprint.intentContract as Record<string, unknown>;
      assertOk(contract, "intent contract missing");
      assertEq(
        (contract.setup as Record<string, unknown>).target,
        "slow",
        "contract retest target",
      );
      assertEq(
        (contract.execution as Record<string, unknown>).entryEvent,
        "formation",
        "contract IFVG entry event",
      );
      assertEq(
        (contract.execution as Record<string, unknown>).mustOccurAfter,
        "setup_gate",
        "contract sequence gate",
      );
      assertOk(
        (contract.sequence as string[]).join(" -> ").includes("fvg_inversion:execution"),
        "contract sequence missing IFVG execution",
      );
      const constraintCodes = (contract.constraints as Array<Record<string, unknown>>).map((item) =>
        String(item.code),
      );
      assertOk(constraintCodes.includes("ema_retest_target"), "contract EMA target missing");
      assertOk(constraintCodes.includes("ifvg_entry_event"), "contract IFVG event missing");
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
    name: "module expansion maps OB+FVG setup and liquidity sweep execution",
    run: () => {
      const blueprint = normalizeBlueprint(
        clone({
          ...baseBlueprint,
          rules: [
            {
              id: "h1_ob_fvg_setup",
              type: "custom",
              side: "buy",
              label:
                "H1 order block with FVG confluence creates the setup zone and expires after 60 bars.",
              parameters: { timeframe: "H1" },
              compilable: true,
            },
            {
              id: "m5_liq_sweep_entry",
              type: "custom",
              side: "buy",
              label:
                "M5 liquidity sweep entry using swing length 4 and lookback 30 bars triggers the trade.",
              parameters: { timeframe: "M5" },
              compilable: true,
            },
          ],
        }),
      );

      const fb = fourBrainOf(blueprint);
      const setup = brainOf(fb, "setup");
      const execution = brainOf(fb, "execution");
      assertEq(modulesOf(setup)[0], "ob_fvg", "setup module");
      assertEq(paramsOf(setup).expiryBars, 60, "OB+FVG expiry");
      assertEq(modulesOf(execution)[0], "liqsweep", "execution module");
      assertEq(paramsOf(execution).swingLen, 4, "liquidity sweep swing length");
      assertEq(paramsOf(execution).lookback, 30, "liquidity sweep lookback");
    },
  },
  {
    name: "module expansion preserves RSI hidden divergence parameters",
    run: () => {
      const blueprint = normalizeBlueprint(
        clone({
          ...baseBlueprint,
          rules: [
            {
              id: "m15_rsi_hd_setup",
              type: "custom",
              side: "both",
              label:
                "M15 RSI 21 hidden divergence setup using pivot strength 4 and lookback 80 bars.",
              parameters: { timeframe: "M15" },
              compilable: true,
            },
            {
              id: "m5_engulf_entry",
              type: "custom",
              side: "both",
              label: "M5 engulfing entry expires after 40 bars.",
              parameters: { timeframe: "M5" },
              compilable: true,
            },
          ],
        }),
      );

      const fb = fourBrainOf(blueprint);
      const setup = brainOf(fb, "setup");
      const execution = brainOf(fb, "execution");
      assertEq(modulesOf(setup)[0], "rsi_hd", "setup module");
      assertEq(paramsOf(setup).rsiPeriod, 21, "RSI period");
      assertEq(paramsOf(setup).pivotLeft, 4, "RSI HD pivot left");
      assertEq(paramsOf(setup).pivotRight, 4, "RSI HD pivot right");
      assertEq(paramsOf(setup).lookback, 80, "RSI HD lookback");
      assertEq(modulesOf(execution)[0], "engulfing", "execution module");
      assertEq(paramsOf(execution).expiryBars, 40, "engulfing expiry");
    },
  },
  {
    name: "module expansion maps gap S/R setup and rejection entry",
    run: () => {
      const blueprint = normalizeBlueprint(
        clone({
          ...baseBlueprint,
          rules: [
            {
              id: "h4_gap_snr_setup",
              type: "custom",
              side: "both",
              label: "H4 gap support setup with lookback 70 bars.",
              parameters: { timeframe: "H4" },
              compilable: true,
            },
            {
              id: "m5_rejection_entry",
              type: "custom",
              side: "both",
              label: "M5 wick rejection entry from support with lookback 25 bars.",
              parameters: { timeframe: "M5" },
              compilable: true,
            },
          ],
        }),
      );

      const fb = fourBrainOf(blueprint);
      const setup = brainOf(fb, "setup");
      const execution = brainOf(fb, "execution");
      assertEq(modulesOf(setup)[0], "gap_snr", "setup module");
      assertEq(paramsOf(setup).lookback, 70, "gap S/R lookback");
      assertEq(modulesOf(execution)[0], "rejection", "execution module");
      assertEq(paramsOf(execution).lookback, 25, "rejection lookback");
    },
  },
  {
    name: "module expansion preserves missed-level distance parameters",
    run: () => {
      const blueprint = normalizeBlueprint(
        clone({
          ...baseBlueprint,
          rules: [
            {
              id: "m15_miss_setup",
              type: "custom",
              side: "both",
              label:
                "M15 missed level setup within 6 pips using swing length 5 and lookback 90 bars.",
              parameters: { timeframe: "M15" },
              compilable: true,
            },
            {
              id: "m5_breakout_entry",
              type: "custom",
              side: "both",
              label: "M5 breakout entry.",
              parameters: { timeframe: "M5" },
              compilable: true,
            },
          ],
        }),
      );

      const fb = fourBrainOf(blueprint);
      const setup = brainOf(fb, "setup");
      assertEq(modulesOf(setup)[0], "miss", "setup module");
      assertEq(paramsOf(setup).nearPoints, 60, "miss distance points");
      assertEq(paramsOf(setup).swingLen, 5, "miss swing length");
      assertEq(paramsOf(setup).lookback, 90, "miss lookback");
      assertEq(modulesOf(brainOf(fb, "execution"))[0], "breakout", "execution module");
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
  {
    name: "intent audit repairs prompt-specific EMA and IFVG constraints",
    run: () => {
      const blueprint = normalizeBlueprint(
        clone({
          ...baseBlueprint,
          fourBrain: {
            direction: {
              modules: ["ema"],
              timeframe: "M5",
              params: { fastPeriod: 12, slowPeriod: 48 },
              description: "EMA cross sets direction.",
            },
            setup: {
              modules: ["ema"],
              timeframe: "M5",
              params: {},
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
        "The retest must be on only the 48 EMA. Enter when the IFVG forms.",
      );

      const auditCodes = ((blueprint.blueprintAudit ?? []) as Array<Record<string, unknown>>).map(
        (item) => String(item.code),
      );
      assertOk(
        auditCodes.includes("ema_retest_target_preserved"),
        "normalization should repair and preserve EMA target",
      );
      assertOk(
        auditCodes.includes("ifvg_entry_event_preserved"),
        "normalization should repair and preserve IFVG event",
      );
      const severities = ((blueprint.blueprintAudit ?? []) as Array<Record<string, unknown>>).map(
        (item) => String(item.severity),
      );
      assertOk(!severities.includes("error"), "repaired intent should not leave audit errors");
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
