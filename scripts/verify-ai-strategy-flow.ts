/**
 * Phase 6 — AI strategy_flow normalization and generation routing checks.
 */
import type { AiBrainWiring } from "../src/lib/api-client";
import {
  aiWiringHasStrategyFlow,
  mergeAiFlowIntoBlueprint,
  strategyFlowFromAiWiring,
  validateAiStrategyFlowWiring,
} from "../src/lib/ai-strategy-flow";
import { generateEaFromAiWiring } from "../src/lib/generate-ea-from-ai-wiring";
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

console.log("\nAI strategy flow tests\n");

const bosFvgBosSteps = [
  {
    id: "step_direction",
    name: "H1 BOS bias",
    role: "direction",
    module: "bos",
    timeframe: "H1",
    event: "BOS_BIAS",
    params: { lookback: 20, swingLen: 5 },
    directionSource: { mode: "own_event" as const },
  },
  {
    id: "step_setup",
    name: "H1 FVG zone",
    role: "setup",
    module: "fvg",
    timeframe: "H1",
    event: "FVG_CREATED",
    params: { expiryBars: 100 },
    dependsOn: [{ stepId: "step_direction", relation: "after" as const, required: true }],
  },
  {
    id: "step_entry",
    name: "M5 BOS entry",
    role: "entry",
    module: "bos",
    timeframe: "M5",
    event: "BOS_CONFIRMED",
    params: { lookback: 20 },
    dependsOn: [{ stepId: "step_setup", relation: "after" as const, required: true }],
  },
];

const flowWiring: AiBrainWiring = {
  output_mode: "strategy_flow",
  strategy_flow: { version: 1, steps: bosFvgBosSteps, notes: "AI BOS/FVG/BOS" },
  direction_brain: "",
  setup_brain: "",
  execution_brain: "",
  required_sms: [],
  sm_configs: {},
  notes: "Normalized flow test",
  semantics: {
    version: 1,
    source: "ai",
    timeframe: "M5",
    modules: ["bos", "fvg"],
    assumptions: [],
  },
};

assertOk(aiWiringHasStrategyFlow(flowWiring), "detects strategy_flow output");
assertEq(flowWiring.output_mode, "strategy_flow", "output_mode preserved");

const flow = strategyFlowFromAiWiring(flowWiring, {
  direction: { modules: ["bos"], timeframe: "H1" },
  setup: { modules: ["fvg"], timeframe: "H1" },
  execution: { modules: ["bos"], timeframe: "M5" },
  management: { riskPercent: 1, rewardRisk: 3, maxOpenTrades: 1 },
});
assertEq(flow.steps.length, 3, "three normalized steps");
assertEq(flow.source, "ai", "flow source is ai");
assertOk(validateStrategyFlowSchema(flow).ok, "normalized flow validates");

const flowValidation = validateAiStrategyFlowWiring(flowWiring);
assertEq(flowValidation.status, "pass", "AI flow wiring validates");

const blueprint: StrategyBlueprint = {
  ...DEFAULT_BLUEPRINT,
  name: "AI Flow Demo",
  fourBrain: {
    direction: { modules: ["bos"], timeframe: "H1", params: { lookback: 20 } },
    setup: { modules: ["fvg"], timeframe: "H1", params: { expiryBars: 100 } },
    execution: { modules: ["bos"], timeframe: "M5", params: { lookback: 20 } },
    management: { riskPercent: 1, rewardRisk: 3, maxOpenTrades: 1 },
  },
};

const merged = mergeAiFlowIntoBlueprint(blueprint, flowWiring);
assertOk(merged.strategyFlow?.steps.length === 3, "blueprint gets strategyFlow");
assertEq(merged.strategyFlow?.steps[2]?.event, "BOS_CONFIRMED", "entry event preserved");

const genResult = generateEaFromAiWiring(merged, flowWiring);
assertEq(genResult.aiMode, "strategy_flow", "routes to strategy_flow mode");
assertEq(genResult.path, "flow_engine", "BOS/FVG/BOS uses flow engine");
assertOk(genResult.code.includes("RegisterEvent"), "flow code contains RegisterEvent");

const legacyWiring: AiBrainWiring = {
  output_mode: "brain_bodies",
  direction_brain: "void Direction_Brain_Execute() { gBias = 1; }",
  setup_brain: "void Setup_Brain_Execute() { gSetupActive = false; }",
  execution_brain: "void Execution_Brain_Execute() { gExecSignal = false; }",
  required_sms: [],
  sm_configs: {},
  notes: "Legacy brain bodies",
};

assertOk(!aiWiringHasStrategyFlow(legacyWiring), "brain_bodies without steps is legacy");
const legacyResult = generateEaFromAiWiring(blueprint, legacyWiring);
assertEq(legacyResult.aiMode, "brain_bodies", "legacy path uses brain_bodies mode");
assertOk(legacyResult.code.includes("Direction_Brain_Execute"), "legacy embeds AI brain code");

console.log("\n8 ai strategy flow check(s) passed.\n");
