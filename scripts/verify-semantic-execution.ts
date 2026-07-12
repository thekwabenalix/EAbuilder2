import { DEFAULT_BLUEPRINT, type FourBrainConfig, type StrategyBlueprint } from "../src/types/blueprint";
import { generateEA } from "../src/generators/gen-ea";
import { fourBrainToStrategyFlow } from "../src/lib/strategy-flow";
import { generateEaFromBlueprint } from "../src/lib/generate-ea-router";
import { validateGeneratedExecutionParity } from "../src/lib/semantic-execution-validator";
import { buildAssistantRepairPlan } from "../src/lib/assistant-repair-plan";

function assertOk(condition: unknown, label: string): void {
  if (!condition) throw new Error(`[FAIL] ${label}`);
  console.log(`[OK  ] ${label}`);
}

const config: FourBrainConfig = {
  direction: {
    modules: ["bos"],
    timeframe: "H1",
    params: { lookback: 20, pivotStrength: 5 },
  },
  setup: {
    modules: ["fvg"],
    timeframe: "H1",
    params: { expiryBars: 100 },
  },
  execution: {
    modules: ["bos"],
    timeframe: "M5",
    params: { lookback: 20, pivotStrength: 5 },
  },
  management: {
    riskPercent: 1,
    rewardRisk: 3,
    stopBuffer: 20,
    maxOpenTrades: 1,
  },
};

const blueprint: StrategyBlueprint = {
  ...DEFAULT_BLUEPRINT,
  name: "Semantic_Parity_Test",
  fourBrain: config,
};

const generated = generateEaFromBlueprint(blueprint);
assertOk(generated.path === "flow_engine", "central router generates verified Strategy Flow EA");
assertOk(generated.code.includes("#define STEP_COUNT 3"), "all configured steps are emitted");

const flow = fourBrainToStrategyFlow(config);
const validFlow = validateGeneratedExecutionParity({
  blueprint,
  flow,
  code: generated.code,
  path: "flow_engine",
});
assertOk(validFlow.ok, "valid Strategy Flow output passes semantic parity");

const missingSetupRuntime = generated.code.replace(/FVGSM_H1_/g, "REMOVED_H1_");
const brokenFlow = validateGeneratedExecutionParity({
  blueprint,
  flow,
  code: missingSetupRuntime,
  path: "flow_engine",
});
assertOk(!brokenFlow.ok, "missing configured setup module is rejected");
assertOk(
  brokenFlow.errors.some((error) => /configured module fvg/i.test(error)),
  "missing module error identifies the configured FVG step",
);

const assistantPlan = buildAssistantRepairPlan({
  blueprint,
  code: missingSetupRuntime,
});
assertOk(
  assistantPlan.layer === "generation" && assistantPlan.apply?.type === "regen_ea",
  "assistant offers deterministic regeneration for saved-code parity failure",
);

const disconnectedEntry = generated.code.replace("OpenTrade(2, dir)", "OpenTrade(99, dir)");
const brokenEntry = validateGeneratedExecutionParity({
  blueprint,
  flow,
  code: disconnectedEntry,
  path: "flow_engine",
});
assertOk(!brokenEntry.ok, "disconnected entry step is rejected");

const assemblerCode = generateEA({
  eaName: "Semantic_Assembler_Test",
  config,
  globalSymbol: "EURUSD",
  globalMagic: 990001,
});
const validAssembler = validateGeneratedExecutionParity({
  blueprint,
  flow,
  code: assemblerCode,
  path: "blueprint_assembler",
});
assertOk(validAssembler.ok, "valid assembler output passes semantic parity");

const emptyDirection = assemblerCode.replace(
  /void Direction_Brain_Execute\(\)\s*\{[\s\S]*?\n\}/,
  "void Direction_Brain_Execute() {}",
);
const brokenAssembler = validateGeneratedExecutionParity({
  blueprint,
  flow,
  code: emptyDirection,
  path: "blueprint_assembler",
});
assertOk(!brokenAssembler.ok, "configured empty Direction Brain is rejected");

const placeholderAssembler = assemblerCode.replace(
  "void Setup_Brain_Execute()",
  "// Module 'fvg' on H1: not yet implemented for Setup Brain\nvoid Setup_Brain_Execute()",
);
const placeholderResult = validateGeneratedExecutionParity({
  blueprint,
  flow,
  code: placeholderAssembler,
  path: "blueprint_assembler",
});
assertOk(!placeholderResult.ok, "unimplemented placeholder is rejected");

console.log("\nAll semantic execution parity checks passed.");

