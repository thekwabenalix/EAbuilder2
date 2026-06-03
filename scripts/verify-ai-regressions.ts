/**
 * AI wiring regression tests.
 *
 * These tests protect the boundary where trader text becomes structured wiring.
 * They do not call Claude. They exercise the local extraction, deterministic
 * adapter, and semantic validator that guard the AI route.
 */
import {
  buildEmaTestThenIfvgFormationWiring,
  findUnsafeAiModules,
  inferLocalSemantics,
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
      modules: ["bb"],
      execution: {
        module: "bb",
        entryEvent: "band_touch",
      },
      assumptions: [],
    },
    required_sms: [],
    sm_configs: {},
    notes: "Intentional bad fixture: Bollinger Bands are template-only, not AI SM-safe.",
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
      const unsafe = findUnsafeAiModules(["ema", "bb", "swing_structure", "rbr_dbd"]);
      assertEq(unsafe.length, 3, "unsafe module count");
      assertOk(
        unsafe.some((item) => item.startsWith("bb:")),
        "expected bb to be unsafe",
      );
      assertOk(
        unsafe.some((item) => item.startsWith("swing_structure:")),
        "expected swing_structure to be unsafe",
      );
      assertOk(
        unsafe.some((item) => item.startsWith("rbr_dbd:")),
        "expected rbr_dbd to be unsafe",
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
