/**
 * Phase 3 — AI convergence checks (blessed adapters + resolver + flow enrich).
 */
import type { AiBrainWiring } from "../src/lib/api-client";
import { enrichBlueprintWithStrategyFlow } from "../src/lib/blueprint-flow-enrich";
import {
  buildBlessedAdapterWiring,
  detectBlessedAdapterId,
  isBlessedAdapterWiring,
} from "../src/lib/blessed-ema-adapters";
import { generateEaFromAiWiring } from "../src/lib/generate-ea-from-ai-wiring";
import { resolveAiWiring } from "../src/lib/resolve-ai-wiring";
import { validateStrategyFlowSchema } from "../src/lib/strategy-flow";
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

console.log("\nAI convergence tests (Phase 3)\n");

const emaIfvgPrompt = `On M5, wait for 12 EMA to cross above 48 EMA. After the cross, price must test the 48 EMA only.
Only after that EMA test, watch for an iFVG to form. Enter when the iFVG inverts (formation), not on retest.`;

assertEq(detectBlessedAdapterId(emaIfvgPrompt), "ema_ifvg", "detects EMA+IFVG blessed pattern");

const ctcPrompt =
  "M5 EMA cross test close: 12/48 EMA cross, slow EMA retest, then close back beyond fast EMA for entry.";
assertEq(detectBlessedAdapterId(ctcPrompt), "ema_ctc", "detects EMA CTC blessed pattern");

const blessed = buildBlessedAdapterWiring("ema_ifvg", emaIfvgPrompt);
assertOk(isBlessedAdapterWiring(blessed), "blessed wiring flagged");
assertOk(blessed.required_sms?.includes("IFVGSM_M5"), "EMA+IFVG requires IFVG SM");
assertOk(blessed.direction_brain.includes("Direction_Brain_Execute"), "blessed has direction body");

const resolvedBlessed = resolveAiWiring({
  wiring: {
    direction_brain: "",
    setup_brain: "",
    execution_brain: "",
    required_sms: [],
    sm_configs: {},
    notes: "empty AI stub",
  },
  text: emaIfvgPrompt,
});
assertEq(resolvedBlessed.mode, "blessed_adapter", "resolver picks blessed adapter from text");
assertOk(isBlessedAdapterWiring(resolvedBlessed.wiring), "resolved wiring is blessed");

const flowWiring: AiBrainWiring = {
  output_mode: "strategy_flow",
  strategy_flow: {
    version: 1,
    steps: [
      {
        id: "step_direction",
        role: "direction",
        module: "bos",
        timeframe: "H1",
        event: "BOS_BIAS",
      },
      {
        id: "step_setup",
        role: "setup",
        module: "fvg",
        timeframe: "H1",
        event: "FVG_CREATED",
        dependsOn: [{ stepId: "step_direction", relation: "after", required: true }],
      },
      {
        id: "step_entry",
        role: "entry",
        module: "bos",
        timeframe: "M5",
        event: "BOS_CONFIRMED",
        dependsOn: [{ stepId: "step_setup", relation: "after", required: true }],
      },
    ],
  },
  direction_brain: "",
  setup_brain: "",
  execution_brain: "",
  required_sms: [],
  sm_configs: {},
  notes: "flow priority test",
};

assertEq(resolveAiWiring({ wiring: flowWiring }).mode, "strategy_flow", "strategy_flow wins over blessed");

const legacyWiring: AiBrainWiring = {
  output_mode: "brain_bodies",
  direction_brain: "void Direction_Brain_Execute() { gBias = 1; }",
  setup_brain: "void Setup_Brain_Execute() { gSetupActive = true; gSetupDir = gBias; }",
  execution_brain: "void Execution_Brain_Execute() { gExecSignal = false; }",
  required_sms: [],
  sm_configs: {},
  notes: "generic legacy",
};

const resolvedLegacy = resolveAiWiring({ wiring: legacyWiring, text: "BOS then FVG entry on M5" });
assertEq(resolvedLegacy.mode, "brain_bodies", "unmatched text stays brain_bodies");
assertOk(resolvedLegacy.warnings.length > 0, "legacy path emits deprecation warning");

const blueprint: StrategyBlueprint = {
  ...DEFAULT_BLUEPRINT,
  name: "EMA IFVG Convergence",
  fourBrain: {
    direction: { modules: ["ema"], timeframe: "M5", params: { fastPeriod: 12, slowPeriod: 48 } },
    setup: { modules: ["fvg_inversion"], timeframe: "M5", params: { expiryBars: 100 } },
    execution: { modules: ["fvg_inversion"], timeframe: "M5", params: {} },
    management: { riskPercent: 1, rewardRisk: 2, maxOpenTrades: 1 },
  },
};

const enriched = enrichBlueprintWithStrategyFlow(blueprint);
assertOk((enriched.strategyFlow?.steps.length ?? 0) >= 3, "4-Brain config seeds strategyFlow");
assertOk(validateStrategyFlowSchema(enriched.strategyFlow!).ok, "enriched flow validates");

const genBlessed = generateEaFromAiWiring(blueprint, blessed);
assertEq(genBlessed.aiMode, "blessed_flow", "generate routes blessed adapter through flow");
assertEq(genBlessed.path, "flow_engine", "blessed EMA+IFVG uses flow engine");
assertOk(genBlessed.code.includes("IFVGSM_M5"), "blessed flow EA embeds IFVG state machine");
assertOk(genBlessed.code.includes("RegisterEvent"), "blessed flow uses ordered gate");

console.log("\nAll AI convergence checks passed.\n");
