/**
 * EA Assembler Generator
 *
 * Generates the OnTick event loop that orchestrates all three brains.
 * KEY: Each brain runs independently on its own timeframe with FULL VISIBILITY logging.
 */

import type { FourBrainConfig } from "@/types/blueprint";
import { ONTICK_ASSEMBLER_TEMPLATE } from "@/templates/ontick-assembler.mql5";

export function genEAAssembler(config: FourBrainConfig): string {
  const directionTF = config.direction?.timeframe || "D1";
  const setupTF = config.setup?.timeframe || "H4";
  const executionTF = config.execution?.timeframe || "H1";
  const hasSetup = config.setup ? "true" : "false";

  // Setup brain check: if enabled, run on its own timeframe
  let setupBrainCheck = "";
  if (config.setup) {
    setupBrainCheck = `
   datetime setupBar = iTime(InpSymbol, InpSetupTF, 0);
   if(setupBar != lastSetupBar)
   {
      lastSetupBar = setupBar;
      gSetupState = Setup_Brain_Execute();
      PrintFormat("[S${setupTF}] active=%d zones=%d %s", gSetupState.active, gSetupState.zoneCount, gSetupState.description);
   }
`;
  } else {
    setupBrainCheck = `
   // Setup Brain disabled — always active
   gSetupState.active = true;
`;
  }

  return ONTICK_ASSEMBLER_TEMPLATE.replace(
    "{{ directionTF }}",
    directionTF
  )
    .replace("{{ setupTF }}", setupTF)
    .replace("{{ executionTF }}", executionTF)
    .replace("{{ setupBrainCheck }}", setupBrainCheck)
    .replace("{{ hasSetup }}", hasSetup);
}
