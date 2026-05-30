/**
 * Main EA Generator (gen-ea.ts)
 *
 * Orchestrates all modular generators:
 * 1. gen-direction-brain.ts
 * 2. gen-setup-brain.ts
 * 3. gen-execution-brain.ts
 * 4. gen-management-brain.ts
 * 5. gen-ea-assembler.ts
 *
 * Then assembles them into the complete EA using EA_SCAFFOLD_TEMPLATE.
 */

import type { FourBrainConfig, MQL5CodeGenParams } from "@/types/blueprint";
import { genDirectionBrain } from "./gen-direction-brain";
import { genSetupBrain } from "./gen-setup-brain";
import { genExecutionBrain } from "./gen-execution-brain";
import { genManagementBrain } from "./gen-management-brain";
import { genEAAssembler } from "./gen-ea-assembler";
import { EA_SCAFFOLD_TEMPLATE } from "@/templates/ea-scaffold.mql5";
import { genInputs } from "./gen-inputs";
import { genHelpers } from "./gen-helpers";
import { genBrainStateTypes } from "./gen-brain-state-types";

export function generateEA(params: MQL5CodeGenParams): string {
  const {
    eaName,
    config: fourBrainConfig,
    globalSymbol = "EURUSD",
    globalMagic = 123456,
  } = params;

  // Step 1: Generate all brain implementations
  const directionBrainCode = genDirectionBrain(fourBrainConfig.direction);
  const setupBrainCode = genSetupBrain(fourBrainConfig.setup);
  const executionBrainCode = genExecutionBrain(fourBrainConfig.execution);
  const managementBrainCode = genManagementBrain(fourBrainConfig.management);

  // Step 2: Generate assembler (OnTick event loop)
  const assemblerCode = genEAAssembler(fourBrainConfig);

  // Step 3: Generate inputs
  const inputsCode = genInputs(fourBrainConfig, globalSymbol, globalMagic);

  // Step 4: Generate helper functions
  const helpersCode = genHelpers();

  // Step 5: Generate brain state type definitions
  const brainStateTypesCode = genBrainStateTypes();

  // Step 6: Assemble globals (brain state declarations + helper globals)
  const globalStatesCode = `
DirectionBrainState gDirState = {0, 0, "Initializing..."};
SetupBrainState gSetupState = {false, 0, 0, 0, "Initializing..."};
ExecutionBrainState gExecState = {false, 0, 0, 0, 0, 0, "Initializing..."};
ManagementBrainState gMgmtState;
ConfluenceGate gGate = {false, {}, 0, "Not evaluated"};
`;

  const globalHelpersCode = `
// Global helpers for bar tracking, logging, etc.
int lastTickTime = 0;
`;

  // Step 7: Build brain descriptions (include user's multi-module descriptions)
  const directionDesc = fourBrainConfig.direction
    ? `${fourBrainConfig.direction.modules?.join(" + ").toUpperCase()} @ ${fourBrainConfig.direction.timeframe}${
        fourBrainConfig.direction.description ? ` — ${fourBrainConfig.direction.description}` : ""
      }`
    : "DISABLED";

  const setupDesc = fourBrainConfig.setup
    ? `${fourBrainConfig.setup.modules?.join(" + ").toUpperCase()} @ ${fourBrainConfig.setup.timeframe}${
        fourBrainConfig.setup.description ? ` — ${fourBrainConfig.setup.description}` : ""
      }`
    : "DISABLED";

  const executionDesc = fourBrainConfig.execution
    ? `${fourBrainConfig.execution.modules?.join(" + ").toUpperCase()} @ ${fourBrainConfig.execution.timeframe}${
        fourBrainConfig.execution.description ? ` — ${fourBrainConfig.execution.description}` : ""
      }`
    : "DISABLED";

  const managementDesc = fourBrainConfig.management
    ? `Risk: ${fourBrainConfig.management.riskPercent}% | R:R: ${fourBrainConfig.management.rewardRisk}`
    : "DEFAULT";

  // Step 8: Fill in the master EA scaffold
  let ea = EA_SCAFFOLD_TEMPLATE.replace("{{ eaName }}", eaName)
    .replace("{{ directionDesc }}", directionDesc)
    .replace("{{ setupDesc }}", setupDesc)
    .replace("{{ executionDesc }}", executionDesc)
    .replace("{{ managementDesc }}", managementDesc)
    .replace("{{ inputs }}", inputsCode)
    .replace("{{ globalStates }}", globalStatesCode)
    .replace("{{ globalHelpers }}", globalHelpersCode)
    .replace("{{ brainStateTypes }}", brainStateTypesCode)
    .replace("{{ helpers }}", helpersCode)
    .replace("{{ directionBrain }}", directionBrainCode)
    .replace("{{ setupBrain }}", setupBrainCode)
    .replace("{{ executionBrain }}", executionBrainCode)
    .replace("{{ managementBrain }}", managementBrainCode)
    .replace("{{ ontickAssembler }}", assemblerCode);

  return ea;
}
