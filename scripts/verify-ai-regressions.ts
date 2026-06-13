/**
 * AI wiring regression tests.
 *
 * These tests protect the boundary where trader text becomes structured wiring.
 * They do not call Claude. They exercise the local extraction, deterministic
 * adapter, and semantic validator that guard the AI route.
 */
import {
  applyZoneScopedRejectionFlowOverride,
  buildAiWiringRepairPrompt,
  buildEmaCrossTestCloseWiring,
  buildEmaTestThenIfvgFormationWiring,
  buildZoneScopedRejectionStrategyFlowWiring,
  findUnsafeAiModules,
  inferLocalSemantics,
  isZoneScopedRejectionStrategy,
  validateWiringAgainstSemantics,
  type AiBrainWiringResponse,
} from "../netlify/functions/gen-4brain-ai.mts";

interface RegressionCase {
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

function assertIncludes(haystack: string, needle: string, message: string) {
  if (!haystack.includes(needle)) throw new Error(`${message}: missing "${needle}"`);
}

const emaIfvgPrompt = `
Create an MT5 Expert Advisor.
Timeframe: M5 only.
Direction: 12 EMA crosses above 48 EMA for buys, below for sells.
After the EMA cross, price must test only the 48 EMA before any trade setup can be considered.
Only IFVGs that form after the EMA test are valid.
Enter at the open of the next candle after the IFVG is confirmed by closing through the old FVG boundary.
`;

function badSlowTargetWidenedToEither(): AiBrainWiringResponse {
  return {
    direction_brain: "void Direction_Brain_Execute() { gBias = 1; }",
    setup_brain: `
datetime gEmaIfvgTestTime_M5 = 0;
void Setup_Brain_Execute() {
   bool touchedFast = true;
   bool touchedSlow = false;
   if(touchedFast || touchedSlow) gEmaIfvgTestTime_M5 = iTime(InpSymbol, PERIOD_M5, 1);
}`,
    execution_brain: `
void Execution_Brain_Execute() {
   IFVGSM_M5_Tick(1);
   if(IFVGSM_M5_BullJustInverted() && IFVGSM_M5_BullInversionTime() > gEmaIfvgTestTime_M5) {
      gExecSignal = true;
   }
}`,
    semantics: inferLocalSemantics(emaIfvgPrompt),
    required_sms: ["IFVGSM_M5"],
    sm_configs: {
      ifvg_M5: { type: "fvg_inversion", id: "M5", TF: "PERIOD_M5", tf: "M5", params: {} },
    },
    notes: "Intentional bad fixture: widened slow-only EMA retest to either EMA.",
  };
}

function badFormationUsesRetestConfirmation(): AiBrainWiringResponse {
  const wiring = buildEmaTestThenIfvgFormationWiring(emaIfvgPrompt);
  return {
    ...wiring,
    execution_brain: wiring.execution_brain
      .replaceAll("BullJustInverted()", "BullJustConfirmed()")
      .replaceAll("BearJustInverted()", "BearJustConfirmed()"),
    notes: "Intentional bad fixture: formation entry uses IFVG retest confirmation.",
  };
}

function badMissingAfterSetupGate(): AiBrainWiringResponse {
  const wiring = buildEmaTestThenIfvgFormationWiring(emaIfvgPrompt);
  return {
    ...wiring,
    execution_brain: wiring.execution_brain
      .replaceAll(" && bullInv > gEmaIfvgTestTime_M5", "")
      .replaceAll(" && bearInv > gEmaIfvgTestTime_M5", ""),
    notes: "Intentional bad fixture: IFVG entry is no longer gated after EMA test time.",
  };
}

function badUnsafeTemplateModule(): AiBrainWiringResponse {
  return {
    direction_brain: "void Direction_Brain_Execute() { gBias = 1; }",
    setup_brain: "void Setup_Brain_Execute() { gSetupActive = true; gSetupDir = gBias; }",
    execution_brain: "void Execution_Brain_Execute() { gExecSignal = false; }",
    semantics: {
      version: 1,
      source: "ai",
      timeframe: "M5",
      modules: ["seg"],
      execution: {
        module: "seg",
        entryEvent: "eg_confirmed",
      },
      assumptions: [],
    },
    required_sms: [],
    sm_configs: {},
    notes: "Intentional bad fixture: SEG is detector-only, not AI SM-safe.",
  };
}

function goodRsiLevelFilter(): AiBrainWiringResponse {
  return {
    direction_brain: "void Direction_Brain_Execute() { gBias = 1; }",
    setup_brain: "void Setup_Brain_Execute() { gSetupActive = true; gSetupDir = gBias; }",
    execution_brain: `void Execution_Brain_Execute() {
   gExecSignal = true; gExecDir = gBias; gExecSL = iLow(InpSymbol, PERIOD_M5, 1);
   int hRsi = B4_RSI(PERIOD_M5, 14);
   double rsi = B4_Buf(hRsi, 0, 1);
   if(gExecSignal && gExecDir == 1 && rsi <= 50.0) gExecSignal = false;
   if(gExecSignal && gExecDir == -1 && rsi >= 50.0) gExecSignal = false;
}`,
    semantics: {
      version: 1,
      source: "ai",
      timeframe: "M5",
      modules: ["ema"],
      filters: [
        {
          id: "rsi_level_filter",
          role: "execution",
          indicator: "rsi",
          timeframe: "M5",
          params: { period: 14, level: 50, operator: "directional" },
        },
      ],
      assumptions: [],
    },
    required_sms: [],
    sm_configs: {},
    notes: "RSI level filter is applied as an execution gate.",
  };
}

function badRsiLevelFilterWithoutHelper(): AiBrainWiringResponse {
  return {
    ...goodRsiLevelFilter(),
    execution_brain: `void Execution_Brain_Execute() {
   gExecSignal = true; gExecDir = gBias; gExecSL = iLow(InpSymbol, PERIOD_M5, 1);
   double rsi = 55.0;
   if(gExecSignal && gExecDir == 1 && rsi <= 50.0) gExecSignal = false;
}`,
    notes: "Intentional bad fixture: declared RSI filter without using B4_RSI/B4_Buf.",
  };
}

function goodAtrVolatilityFilter(): AiBrainWiringResponse {
  return {
    direction_brain: "void Direction_Brain_Execute() { gBias = 1; }",
    setup_brain: "void Setup_Brain_Execute() { gSetupActive = true; gSetupDir = gBias; }",
    execution_brain: `void Execution_Brain_Execute() {
   gExecSignal = true; gExecDir = gBias; gExecSL = iLow(InpSymbol, PERIOD_M5, 1);
   int hAtr = B4_ATR(PERIOD_M5, 14);
   double atrPts = B4_Buf(hAtr, 0, 1) / SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   if(gExecSignal && atrPts < 100.0) gExecSignal = false;
}`,
    semantics: {
      version: 1,
      source: "ai",
      timeframe: "M5",
      modules: ["ema"],
      filters: [
        {
          id: "atr_volatility_filter",
          role: "execution",
          indicator: "atr",
          timeframe: "M5",
          params: { period: 14, minAtrPoints: 100, operator: "above" },
        },
      ],
      assumptions: [],
    },
    required_sms: [],
    sm_configs: {},
    notes: "ATR volatility filter is applied as an execution gate.",
  };
}

function badAtrVolatilityFilterWithoutPointConversion(): AiBrainWiringResponse {
  return {
    ...goodAtrVolatilityFilter(),
    execution_brain: `void Execution_Brain_Execute() {
   gExecSignal = true; gExecDir = gBias; gExecSL = iLow(InpSymbol, PERIOD_M5, 1);
   int hAtr = B4_ATR(PERIOD_M5, 14);
   double atr = B4_Buf(hAtr, 0, 1);
   if(gExecSignal && atr < 100.0) gExecSignal = false;
}`,
    notes: "Intentional bad fixture: declared ATR filter without converting ATR to points.",
  };
}

function goodMacdHistogramFilter(): AiBrainWiringResponse {
  return {
    direction_brain: "void Direction_Brain_Execute() { gBias = 1; }",
    setup_brain: "void Setup_Brain_Execute() { gSetupActive = true; gSetupDir = gBias; }",
    execution_brain: `void Execution_Brain_Execute() {
   gExecSignal = true; gExecDir = gBias; gExecSL = iLow(InpSymbol, PERIOD_M5, 1);
   int hMacd = B4_MACD(PERIOD_M5, 12, 26, 9);
   double macdMain = B4_Buf(hMacd, 0, 1);
   double macdSignal = B4_Buf(hMacd, 1, 1);
   double macdHist = macdMain - macdSignal;
   if(gExecSignal && gExecDir == 1 && macdHist <= 0.0) gExecSignal = false;
   if(gExecSignal && gExecDir == -1 && macdHist >= 0.0) gExecSignal = false;
}`,
    semantics: {
      version: 1,
      source: "ai",
      timeframe: "M5",
      modules: ["ema"],
      filters: [
        {
          id: "macd_histogram_filter",
          role: "execution",
          indicator: "macd",
          timeframe: "M5",
          params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, operator: "directional" },
        },
      ],
      assumptions: [],
    },
    required_sms: [],
    sm_configs: {},
    notes: "MACD histogram filter is applied as an execution gate.",
  };
}

function badMacdHistogramFilterWithoutBuffers(): AiBrainWiringResponse {
  return {
    ...goodMacdHistogramFilter(),
    execution_brain: `void Execution_Brain_Execute() {
   gExecSignal = true; gExecDir = gBias; gExecSL = iLow(InpSymbol, PERIOD_M5, 1);
   int hMacd = B4_MACD(PERIOD_M5, 12, 26, 9);
   double macdHist = 1.0;
   if(gExecSignal && macdHist <= 0.0) gExecSignal = false;
}`,
    notes: "Intentional bad fixture: declared MACD filter without reading MACD buffers.",
  };
}

function goodBosObEngulfingWiring(): AiBrainWiringResponse {
  return {
    direction_brain: `void Direction_Brain_Execute() {
   BOSSM_D1_Tick(20);
   if(BOSSM_D1_IsBull()) gBias = 1;
   else if(BOSSM_D1_IsBear()) gBias = -1;
}`,
    setup_brain: `void Setup_Brain_Execute() {
   OBSM_H4_Tick(50);
   if(gBias == 1 && OBSM_H4_HasActiveBull()) { gSetupActive = true; gSetupDir = 1; gSetupSLHint = OBSM_H4_LatestBullLL(); }
   else if(gBias == -1 && OBSM_H4_HasActiveBear()) { gSetupActive = true; gSetupDir = -1; gSetupSLHint = OBSM_H4_LatestBearUL(); }
}`,
    execution_brain: `void Execution_Brain_Execute() {
   EGSM_M5_Tick(3);
   if(gSetupActive && gSetupDir == 1 && EGSM_M5_BullJustConfirmed()) { gExecSignal = true; gExecDir = 1; gExecSL = EGSM_M5_BullConfirmSL(); }
   else if(gSetupActive && gSetupDir == -1 && EGSM_M5_BearJustConfirmed()) { gExecSignal = true; gExecDir = -1; gExecSL = EGSM_M5_BearConfirmSL(); }
}`,
    semantics: {
      version: 1,
      source: "ai",
      timeframe: "M5",
      modules: ["bos", "order_block", "engulfing"],
      direction: { module: "bos", event: "bias" },
      setup: { gate: "active_zone", mustOccurAfter: "direction_event" },
      execution: { module: "engulfing", entryEvent: "eg_confirmed", mustOccurAfter: "setup_gate" },
      assumptions: [],
    },
    required_sms: ["BOSSM_D1", "OBSM_H4", "EGSM_M5"],
    sm_configs: {
      bos_D1: { type: "bos", id: "D1", TF: "PERIOD_D1", tf: "D1", params: {} },
      ob_H4: { type: "ob", id: "H4", TF: "PERIOD_H4", tf: "H4", params: {} },
      eg_M5: { type: "engulfing", id: "M5", TF: "PERIOD_M5", tf: "M5", params: {} },
    },
    notes: "BOS direction, OB setup, engulfing execution.",
  };
}

function badObSetupWithoutObQuery(): AiBrainWiringResponse {
  return {
    ...goodBosObEngulfingWiring(),
    setup_brain: `void Setup_Brain_Execute() {
   if(gBias != 0) { gSetupActive = true; gSetupDir = gBias; }
}`,
    notes: "Intentional bad fixture: OB setup semantics without OB query usage.",
  };
}

function goodGapRejectionWiring(): AiBrainWiringResponse {
  return {
    direction_brain: `void Direction_Brain_Execute() {
   BOSSM_H4_Tick(20);
   if(BOSSM_H4_IsBull()) gBias = 1;
   else if(BOSSM_H4_IsBear()) gBias = -1;
}`,
    setup_brain: `void Setup_Brain_Execute() {
   GSNRSM_H1_Tick(50);
   if(gBias == 1 && GSNRSM_H1_HasActiveBull()) { gSetupActive = true; gSetupDir = 1; gSetupSLHint = GSNRSM_H1_BullConfirmSL(); }
   else if(gBias == -1 && GSNRSM_H1_HasActiveBear()) { gSetupActive = true; gSetupDir = -1; gSetupSLHint = GSNRSM_H1_BearConfirmSL(); }
}`,
    execution_brain: `void Execution_Brain_Execute() {
   REJSM_M5_Tick(20);
   if(gSetupActive && gSetupDir == 1 && REJSM_M5_BullJustConfirmed()) { gExecSignal = true; gExecDir = 1; gExecSL = REJSM_M5_BullConfirmSL(); }
   else if(gSetupActive && gSetupDir == -1 && REJSM_M5_BearJustConfirmed()) { gExecSignal = true; gExecDir = -1; gExecSL = REJSM_M5_BearConfirmSL(); }
}`,
    semantics: {
      version: 1,
      source: "ai",
      timeframe: "M5",
      modules: ["bos", "gap_snr", "rejection"],
      direction: { module: "bos", event: "bias" },
      setup: { gate: "gap_level_touch", mustOccurAfter: "direction_event" },
      execution: { module: "rejection", entryEvent: "rejection", mustOccurAfter: "setup_gate" },
      assumptions: [],
    },
    required_sms: ["BOSSM_H4", "GSNRSM_H1", "REJSM_M5"],
    sm_configs: {
      bos_H4: { type: "bos", id: "H4", TF: "PERIOD_H4", tf: "H4", params: {} },
      gsnr_H1: { type: "gap_snr", id: "H1", TF: "PERIOD_H1", tf: "H1", params: {} },
      rej_M5: { type: "rejection", id: "M5", TF: "PERIOD_M5", tf: "M5", params: {} },
    },
    notes: "Gap S/R setup with rejection execution.",
  };
}

function badExecutionIgnoresSetupGate(): AiBrainWiringResponse {
  return {
    ...goodGapRejectionWiring(),
    execution_brain: `void Execution_Brain_Execute() {
   REJSM_M5_Tick(20);
   if(REJSM_M5_BullJustConfirmed()) { gExecSignal = true; gExecDir = 1; gExecSL = REJSM_M5_BullConfirmSL(); }
   else if(REJSM_M5_BearJustConfirmed()) { gExecSignal = true; gExecDir = -1; gExecSL = REJSM_M5_BearConfirmSL(); }
}`,
    notes: "Intentional bad fixture: execution ignores setup gate.",
  };
}

function goodRsiObFvgWiring(): AiBrainWiringResponse {
  return {
    direction_brain: `void Direction_Brain_Execute() {
   BOSSM_H4_Tick(20);
   if(BOSSM_H4_IsBull()) gBias = 1;
   else if(BOSSM_H4_IsBear()) gBias = -1;
}`,
    setup_brain: `void Setup_Brain_Execute() {
   RSIHDSM_H1_Tick(50);
   if(gBias == 1 && RSIHDSM_H1_HasActiveBull()) { gSetupActive = true; gSetupDir = 1; gSetupSLHint = RSIHDSM_H1_ActiveBullSL(); }
   else if(gBias == -1 && RSIHDSM_H1_HasActiveBear()) { gSetupActive = true; gSetupDir = -1; gSetupSLHint = RSIHDSM_H1_ActiveBearSL(); }
}`,
    execution_brain: `void Execution_Brain_Execute() {
   OBFVGSM_M15_Tick(50);
   if(gSetupActive && gSetupDir == 1 && OBFVGSM_M15_BullJustConfirmed()) { gExecSignal = true; gExecDir = 1; gExecSL = OBFVGSM_M15_BullConfirmSL(); }
   else if(gSetupActive && gSetupDir == -1 && OBFVGSM_M15_BearJustConfirmed()) { gExecSignal = true; gExecDir = -1; gExecSL = OBFVGSM_M15_BearConfirmSL(); }
}`,
    semantics: {
      version: 1,
      source: "ai",
      timeframe: "M15",
      modules: ["bos", "rsi_hd", "ob_fvg"],
      direction: { module: "bos", event: "bias" },
      setup: { gate: "hidden_divergence", mustOccurAfter: "direction_event" },
      execution: { module: "ob_fvg", entryEvent: "entry", mustOccurAfter: "setup_gate" },
      assumptions: [],
    },
    required_sms: ["BOSSM_H4", "RSIHDSM_H1", "OBFVGSM_M15"],
    sm_configs: {
      bos_H4: { type: "bos", id: "H4", TF: "PERIOD_H4", tf: "H4", params: {} },
      rsihd_H1: { type: "rsi_hd", id: "H1", TF: "PERIOD_H1", tf: "H1", params: {} },
      obfvg_M15: { type: "ob_fvg", id: "M15", TF: "PERIOD_M15", tf: "M15", params: {} },
    },
    notes: "RSI hidden divergence setup with OB/FVG execution.",
  };
}

function badRsiSetupWithoutRsiQuery(): AiBrainWiringResponse {
  return {
    ...goodRsiObFvgWiring(),
    setup_brain: `void Setup_Brain_Execute() {
   if(gBias != 0) { gSetupActive = true; gSetupDir = gBias; }
}`,
    notes: "Intentional bad fixture: RSI HD setup semantics without RSI HD query usage.",
  };
}

const cases: RegressionCase[] = [
  {
    name: "extracts slow-only EMA retest from raw text",
    run: () => {
      const semantics = inferLocalSemantics(emaIfvgPrompt);
      assertEq(semantics.setup?.target, "slow", "EMA retest target");
      assertEq(semantics.setup?.targetLabel, "slow EMA (48)", "EMA retest target label");
      assertEq(semantics.execution?.entryEvent, "formation", "IFVG entry event");
    },
  },
  {
    name: "extracts either EMA only when trader says either",
    run: () => {
      const semantics = inferLocalSemantics(
        emaIfvgPrompt.replace("only the 48 EMA", "either the 12 EMA or the 48 EMA"),
      );
      assertEq(semantics.setup?.target, "either", "EMA retest target");
      assertEq(semantics.setup?.targetLabel, "either EMA (12 or 48)", "EMA retest target label");
    },
  },
  {
    name: "deterministic adapter preserves slow-only target and formation entry",
    run: () => {
      const wiring = buildEmaTestThenIfvgFormationWiring(emaIfvgPrompt);
      assertEq(wiring.validation?.status, "pass", "adapter validation status");
      assertEq(wiring.semantics?.setup?.target, "slow", "adapter retest target");
      assertEq(wiring.semantics?.execution?.entryEvent, "formation", "adapter entry event");
      assertIncludes(wiring.setup_brain, "touchedSlow", "setup uses slow touch");
      assertOk(
        !/touchedFast\s*\|\|\s*touchedSlow/.test(wiring.setup_brain),
        "setup must not allow either EMA",
      );
      assertIncludes(wiring.execution_brain, "BullJustInverted()", "execution uses IFVG formation");
      assertIncludes(
        wiring.execution_brain,
        "> gEmaIfvgTestTime_M5",
        "execution gates after EMA test",
      );
    },
  },
  {
    name: "deterministic adapter builds EMA Cross-Test-Close with EMASM",
    run: () => {
      const wiring = buildEmaCrossTestCloseWiring(`
        Create the Cross-Test-Close strategy. Default timeframe M30.
        The 12 EMA crosses the 48 EMA for direction.
        After the cross, price must test the 48 EMA.
        Then a candle closes above the 12 EMA for buys or below it for sells.
        Enter at the open of the next candle.
      `);
      assertEq(wiring.validation?.status, "pass", "CTC adapter validation status");
      assertEq(wiring.semantics?.timeframe, "M30", "CTC timeframe");
      assertEq(wiring.semantics?.setup?.target, "slow", "CTC retest target");
      assertEq(wiring.semantics?.execution?.module, "ema", "CTC execution module");
      assertIncludes(wiring.setup_brain, "EMASM_M30_SetupActive()", "setup uses EMASM");
      assertIncludes(
        wiring.execution_brain,
        "EMASM_M30_JustConfirmed()",
        "execution uses EMASM confirmation",
      );
      assertOk(Boolean(wiring.sm_configs.ema_M30), "EMASM config missing");
      assertEq(
        (wiring.sm_configs.ema_M30.params as Record<string, unknown>).repeatAfterConfirmation,
        true,
        "default CTC repeat mode keeps cross active until opposite cross",
      );
      const singleShot = buildEmaCrossTestCloseWiring(`
        Cross-Test-Close on M30. Only the first valid 48 EMA test after the cross counts.
      `);
      assertEq(
        (singleShot.sm_configs.ema_M30.params as Record<string, unknown>).repeatAfterConfirmation,
        false,
        "single-test CTC disables repeat mode",
      );
    },
  },
  {
    name: "CTC adapter preserves repeated retest opportunities after one cross",
    run: () => {
      const wiring = buildEmaCrossTestCloseWiring(`
        Create the Cross-Test-Close strategy. Default timeframe M30.
        The 12 EMA crosses the 48 EMA for direction.
        After a valid EMA cross, the EA must continuously monitor for 48 EMA tests.
        Do not limit the strategy to only the first test after the cross.
        Multiple valid trades are allowed after one EMA cross, as long as each trade has its own separate 48 EMA test and confirmation close.
        After trade closes, continue watching for another valid 48 EMA test in the same direction until an opposite EMA cross occurs.
      `);
      const params = wiring.sm_configs.ema_M30?.params as Record<string, unknown>;
      assertEq(params.repeatAfterConfirmation, true, "repeat CTC mode");
      assertIncludes(wiring.notes ?? "", "repeats slow-EMA", "repeat mode note");
      assertOk(
        !(wiring.notes ?? "").includes("first slow-EMA"),
        "repeat CTC notes must not claim first-test-only behavior",
      );
    },
  },
  {
    name: "CTC adapter does not turn stop rules into EMA retest tolerance",
    run: () => {
      const wiring = buildEmaCrossTestCloseWiring(`
        Create the Cross-Test-Close strategy. Default timeframe M30.
        The 12 EMA crosses the 48 EMA for direction.
        After the cross, price must test the 48 EMA.
        Then a candle closes above the 12 EMA for buys or below it for sells.
        Default Stop Loss Buffer: 20 points.
        Ignore trades if stop loss exceeds 15 pips.
      `);
      const params = wiring.sm_configs.ema_M30?.params as Record<string, unknown>;
      assertEq(params.retestPoints, 0, "CTC retest tolerance");
    },
  },
  {
    name: "deterministic adapter applies EMA retest tolerance in points",
    run: () => {
      const wiring = buildEmaTestThenIfvgFormationWiring(
        `${emaIfvgPrompt} The 48 EMA test can be within 3 points.`,
      );
      assertEq(wiring.validation?.status, "pass", "validation status");
      assertIncludes(wiring.setup_brain, "double retestTol = 3", "retest tolerance emitted");
      assertIncludes(wiring.setup_brain, "fastMa + retestTol", "fast tolerance upper bound");
      assertIncludes(wiring.setup_brain, "slowMa - retestTol", "slow tolerance lower bound");
    },
  },
  {
    name: "local semantics extract built-in filter contracts from raw text",
    run: () => {
      const semantics = inferLocalSemantics(
        `${emaIfvgPrompt} Use RSI above 50, ATR above 100 points, and MACD histogram above zero as filters.`,
      );
      const filterIds = (semantics.filters ?? []).map((filter) => filter.id);
      assertOk(filterIds.includes("rsi_level_filter"), "RSI filter missing");
      assertOk(filterIds.includes("atr_volatility_filter"), "ATR filter missing");
      assertOk(filterIds.includes("macd_histogram_filter"), "MACD filter missing");
    },
  },
  {
    name: "local semantics preserve setup versus execution filter roles",
    run: () => {
      const semantics = inferLocalSemantics(
        `${emaIfvgPrompt} RSI above 50 must confirm the setup. MACD histogram above zero must pass before entry.`,
      );
      const rsi = (semantics.filters ?? []).find((filter) => filter.id === "rsi_level_filter");
      const macd = (semantics.filters ?? []).find(
        (filter) => filter.id === "macd_histogram_filter",
      );
      assertOk(rsi, "RSI filter missing");
      assertOk(macd, "MACD filter missing");
      assertEq(rsi.role, "setup", "RSI filter role");
      assertEq(macd.role, "execution", "MACD filter role");
    },
  },
  {
    name: "deterministic adapter applies built-in filter gates to execution wiring",
    run: () => {
      const wiring = buildEmaTestThenIfvgFormationWiring(
        `${emaIfvgPrompt} Use RSI above 50, ATR above 100 points, and MACD histogram above zero as filters.`,
      );
      assertEq(wiring.validation?.status, "pass", "validation status");
      assertIncludes(wiring.execution_brain, "B4_RSI", "RSI filter applied");
      assertIncludes(wiring.execution_brain, "B4_ATR", "ATR filter applied");
      assertIncludes(wiring.execution_brain, "B4_MACD", "MACD filter applied");
      assertIncludes(wiring.execution_brain, "gExecSignal = false", "filters gate execution");
    },
  },
  {
    name: "deterministic adapter injects setup filters into setup brain",
    run: () => {
      const wiring = buildEmaTestThenIfvgFormationWiring(
        `${emaIfvgPrompt} RSI above 50 must confirm the setup. MACD histogram above zero must pass before entry.`,
      );
      assertEq(wiring.validation?.status, "pass", "validation status");
      assertIncludes(wiring.setup_brain, "B4_RSI", "setup RSI filter applied");
      assertIncludes(wiring.setup_brain, "gSetupActive = false", "setup filter blocks setup");
      assertIncludes(wiring.execution_brain, "B4_MACD", "execution MACD filter applied");
      assertIncludes(
        wiring.execution_brain,
        "gExecSignal = false",
        "execution filter blocks signal",
      );
    },
  },
  {
    name: "validator rejects slow-only target widened to either EMA",
    run: () => {
      const validation = validateWiringAgainstSemantics(badSlowTargetWidenedToEither());
      assertEq(validation.status, "fail", "validation status");
      assertOk(
        validation.errors.some((error) => error.includes("slow EMA only")),
        `expected slow-only error, got: ${validation.errors.join(" | ")}`,
      );
    },
  },
  {
    name: "validator rejects IFVG formation wired to retest confirmation",
    run: () => {
      const validation = validateWiringAgainstSemantics(badFormationUsesRetestConfirmation());
      assertEq(validation.status, "fail", "validation status");
      assertOk(
        validation.errors.some((error) => error.includes("uses IFVG retest confirmation")),
        `expected IFVG retest-confirmation error, got: ${validation.errors.join(" | ")}`,
      );
    },
  },
  {
    name: "validator rejects IFVG entry without after-EMA-test gate",
    run: () => {
      const validation = validateWiringAgainstSemantics(badMissingAfterSetupGate());
      assertEq(validation.status, "fail", "validation status");
      assertOk(
        validation.errors.some((error) => error.includes("does not compare IFVG time")),
        `expected missing time-gate error, got: ${validation.errors.join(" | ")}`,
      );
    },
  },
  {
    name: "module admission blocks template and guarded modules for AI wiring",
    run: () => {
      const unsafe = findUnsafeAiModules(["ema", "bb", "swing_structure", "rbr_dbd", "seg"]);
      assertEq(unsafe.length, 1, "unsafe module count");
      assertOk(
        unsafe.some((item) => item.startsWith("seg:")),
        "expected seg to be unsafe",
      );
    },
  },
  {
    name: "validator rejects unsafe module semantics returned by AI",
    run: () => {
      const validation = validateWiringAgainstSemantics(badUnsafeTemplateModule());
      assertEq(validation.status, "fail", "validation status");
      assertOk(
        validation.errors.some((error) => error.includes("not admitted for AI 4-Brain")),
        `expected unsafe admission error, got: ${validation.errors.join(" | ")}`,
      );
    },
  },
  {
    name: "validator accepts verified RSI level filter contract",
    run: () => {
      const validation = validateWiringAgainstSemantics(goodRsiLevelFilter());
      assertEq(validation.status, "pass", "validation status");
    },
  },
  {
    name: "validator rejects RSI level filter without verified helper usage",
    run: () => {
      const validation = validateWiringAgainstSemantics(badRsiLevelFilterWithoutHelper());
      assertEq(validation.status, "fail", "validation status");
      assertOk(
        validation.errors.some((error) => error.includes("rsi_level_filter")),
        `expected RSI filter error, got: ${validation.errors.join(" | ")}`,
      );
    },
  },
  {
    name: "validator accepts verified ATR volatility filter contract",
    run: () => {
      const validation = validateWiringAgainstSemantics(goodAtrVolatilityFilter());
      assertEq(validation.status, "pass", "validation status");
    },
  },
  {
    name: "validator rejects ATR volatility filter without point conversion",
    run: () => {
      const validation = validateWiringAgainstSemantics(
        badAtrVolatilityFilterWithoutPointConversion(),
      );
      assertEq(validation.status, "fail", "validation status");
      assertOk(
        validation.errors.some((error) => error.includes("atr_volatility_filter")),
        `expected ATR filter error, got: ${validation.errors.join(" | ")}`,
      );
    },
  },
  {
    name: "validator accepts verified MACD histogram filter contract",
    run: () => {
      const validation = validateWiringAgainstSemantics(goodMacdHistogramFilter());
      assertEq(validation.status, "pass", "validation status");
    },
  },
  {
    name: "validator rejects MACD histogram filter without buffer reads",
    run: () => {
      const validation = validateWiringAgainstSemantics(badMacdHistogramFilterWithoutBuffers());
      assertEq(validation.status, "fail", "validation status");
      assertOk(
        validation.errors.some((error) => error.includes("macd_histogram_filter")),
        `expected MACD filter error, got: ${validation.errors.join(" | ")}`,
      );
    },
  },
  {
    name: "validator accepts BOS direction, OB setup, and engulfing execution wiring",
    run: () => {
      const validation = validateWiringAgainstSemantics(goodBosObEngulfingWiring());
      assertEq(validation.status, "pass", `validation errors: ${validation.errors.join(" | ")}`);
    },
  },
  {
    name: "validator rejects OB setup semantics without OB query wiring",
    run: () => {
      const validation = validateWiringAgainstSemantics(badObSetupWithoutObQuery());
      assertEq(validation.status, "fail", "validation status");
      assertOk(
        validation.errors.some((error) => error.includes("order_block setup event")),
        `expected OB setup error, got: ${validation.errors.join(" | ")}`,
      );
    },
  },
  {
    name: "validator accepts gap S/R setup and rejection execution wiring",
    run: () => {
      const validation = validateWiringAgainstSemantics(goodGapRejectionWiring());
      assertEq(validation.status, "pass", `validation errors: ${validation.errors.join(" | ")}`);
    },
  },
  {
    name: "validator rejects non-IFVG execution that ignores setup gate",
    run: () => {
      const validation = validateWiringAgainstSemantics(badExecutionIgnoresSetupGate());
      assertEq(validation.status, "fail", "validation status");
      assertOk(
        validation.errors.some((error) => error.includes("does not reference gSetupActive")),
        `expected setup-gate error, got: ${validation.errors.join(" | ")}`,
      );
    },
  },
  {
    name: "validator accepts RSI hidden divergence setup and OB/FVG execution wiring",
    run: () => {
      const validation = validateWiringAgainstSemantics(goodRsiObFvgWiring());
      assertEq(validation.status, "pass", `validation errors: ${validation.errors.join(" | ")}`);
    },
  },
  {
    name: "validator rejects RSI HD setup semantics without RSI HD query wiring",
    run: () => {
      const validation = validateWiringAgainstSemantics(badRsiSetupWithoutRsiQuery());
      assertEq(validation.status, "fail", "validation status");
      assertOk(
        validation.errors.some((error) => error.includes("rsi_hd setup event")),
        `expected RSI HD setup error, got: ${validation.errors.join(" | ")}`,
      );
    },
  },
  {
    name: "repair prompt includes validator errors and preserves JSON-only boundary",
    run: () => {
      const invalid = badObSetupWithoutObQuery();
      const validation = validateWiringAgainstSemantics(invalid);
      assertEq(validation.status, "fail", "validation status");
      const prompt = buildAiWiringRepairPrompt({
        originalRequest: "Use BOS for direction, OB for setup, engulfing for entry.",
        invalidResponse: invalid,
        validation,
      });
      assertIncludes(prompt, "Return ONLY the corrected JSON object", "JSON-only repair boundary");
      assertIncludes(prompt, "VALIDATION ERRORS", "validator error section");
      assertIncludes(prompt, "order_block setup event", "specific validator error");
      assertIncludes(
        prompt,
        "Use only the verified module contracts",
        "verified contract boundary",
      );
      assertIncludes(prompt, "INVALID JSON TO REPAIR", "invalid JSON section");
      assertIncludes(prompt, "OBSM_H4", "invalid wiring context");
    },
  },
  {
    name: "detects unicorn + rejection as zone-scoped rejection strategy",
    run: () => {
      const config = {
        setup: { modules: ["unicorn"], timeframe: "H1", params: { lookback: 500 } },
        execution: { modules: ["rejection"], timeframe: "M5", params: {} },
      };
      assertOk(
        isZoneScopedRejectionStrategy("Unicorn pocket reject and enter next bar", config),
        "unicorn+rejection detected",
      );
    },
  },
  {
    name: "deterministic adapter builds unicorn zone-scoped strategy_flow",
    run: () => {
      const wiring = buildZoneScopedRejectionStrategyFlowWiring(
        "ICT unicorn overlap pocket on H1, reject wick into pocket, enter next candle on M5",
        {
          setup: { modules: ["unicorn"], timeframe: "H1", params: { lookback: 500, uniExpiry: 250 } },
          execution: { modules: ["rejection"], timeframe: "M5", params: {} },
        },
      );
      assertEq(wiring.output_mode, "strategy_flow", "uses strategy_flow mode");
      assertEq(wiring.strategy_flow?.steps?.length, 3, "three flow steps");
      assertEq(wiring.strategy_flow?.steps?.[0]?.event, "UNICORN_ACTIVE", "setup event");
      assertEq(wiring.strategy_flow?.steps?.[1]?.event, "UNICORN_CONFIRMED", "confirm event");
      assertEq(wiring.strategy_flow?.steps?.[2]?.event, "BAR_AFTER_CONFIRM", "entry event");
      assertOk(!wiring.execution_brain.includes("REJSM_"), "must not emit REJSM brain code");
    },
  },
  {
    name: "post-process overrides AI REJSM wiring for unicorn zone rejection",
    run: () => {
      const badAi: AiBrainWiringResponse = {
        output_mode: "brain_bodies",
        direction_brain: "void Direction_Brain_Execute() { gBias = 1; }",
        setup_brain: "void Setup_Brain_Execute() { gSetupActive = true; }",
        execution_brain: `void Execution_Brain_Execute() {
   REJSM_M5_Tick(20);
   if(REJSM_M5_BullJustConfirmed()) { gExecSignal = true; gExecDir = 1; }
}`,
        required_sms: ["REJSM_M5"],
        sm_configs: { rej_M5: { type: "rejection", id: "M5", TF: "PERIOD_M5", tf: "M5", params: {} } },
        notes: "Bad AI used REJSM for unicorn pocket",
      };
      const fixed = applyZoneScopedRejectionFlowOverride(badAi, "Unicorn pocket rejection next bar", {
        setup: { modules: ["unicorn"], timeframe: "H1", params: {} },
        execution: { modules: ["rejection"], timeframe: "M5", params: {} },
      });
      assertEq(fixed.output_mode, "strategy_flow", "overridden to strategy_flow");
      assertEq(fixed.strategy_flow?.steps?.[1]?.event, "UNICORN_CONFIRMED", "zone confirm step");
      assertOk(!fixed.execution_brain.includes("REJSM_"), "REJSM stripped from brain bodies");
    },
  },
];

console.log("\nAI wiring regression tests\n");
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
  console.log(`\n${failed} regression test(s) failed.`);
  process.exit(1);
}

console.log(`\n${cases.length} regression test(s) passed.`);
