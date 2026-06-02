/**
 * AI wiring regression tests.
 *
 * These tests protect the boundary where trader text becomes structured wiring.
 * They do not call Claude. They exercise the local extraction, deterministic
 * adapter, and semantic validator that guard the AI route.
 */
import {
  buildEmaTestThenIfvgFormationWiring,
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
