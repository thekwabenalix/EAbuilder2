/**
 * Execution Brain Generator
 *
 * Takes a BrainConfig and generates:
 * 1. Execution_Brain_Execute() — detects entry signals
 * 2. Execution_Brain_ExecuteEntry() — implements confluence gate and executes trade
 */

import type { BrainConfig } from "@/types/blueprint";
import { EXECUTION_BRAIN_TEMPLATE } from "@/templates/brain-execution.mql5";

export function genExecutionBrain(brain: BrainConfig | undefined): string {
  if (!brain) {
    return `
// No Execution Brain configured
ExecutionBrainState gExecState = {false, 0, 0, 0, 0, 0, "No entry filter"};
ExecutionBrainState Execution_Brain_Execute(DirectionBrainState dir, SetupBrainState setup) { return gExecState; }
void Execution_Brain_ExecuteEntry(ExecutionBrainState exec, DirectionBrainState dir, SetupBrainState setup) {}
`;
  }

  const modules = brain.modules || [];
  const timeframe = brain.timeframe || "H1";
  const modulesLabel = modules.map((m) => m.toUpperCase()).join(" + ");

  let globals = "";
  let detectionLogic = "";
  let entryLogic = "";

  for (const module of modules) {
    if (module === "bullish_engulfing" || module === "bearish_engulfing") {
      globals += `
// Engulfing globals
int engulfingCount = 0;
`;
      detectionLogic += `
   // Engulfing detection (placeholder)
   state.signalReady = false;
   state.description = "Engulfing entry signal (not yet implemented)";
`;
    } else if (module === "impulse_break") {
      detectionLogic += `
   // Impulse Break detection (placeholder)
   state.signalReady = false;
   state.description = "Impulse break entry signal (not yet implemented)";
`;
    }
  }

  entryLogic += `
   // Confluence gate: Dir + Setup + Exec all firing?
   bool canTrade = (dir.bias != 0) && (setup.active || !{{ hasSetup }}) && exec.signalReady;

   if(canTrade && exec.entryPrice > 0)
   {
      // Execute the trade
      double sl = exec.stopLossLevel;
      double tp = exec.takeProfitLevel;

      if(exec.direction > 0)
      {
         trade.Buy(0.1, InpSymbol, exec.entryPrice, sl, tp, "4-Brain Entry");
      }
      else if(exec.direction < 0)
      {
         trade.Sell(0.1, InpSymbol, exec.entryPrice, sl, tp, "4-Brain Entry");
      }

      PrintFormat("[ENTRY] Gate OPENED: dir=%d setup=%d exec=%d → TRADE EXECUTED", dir.bias, setup.active, exec.signalReady);
   }
`;

  return EXECUTION_BRAIN_TEMPLATE.replace(
    "{{ modulesLabel }}",
    modulesLabel
  )
    .replace("{{ timeframe }}", timeframe)
    .replace("{{ executionGlobals }}", globals)
    .replace("{{ executionDetectionLogic }}", detectionLogic)
    .replace("{{ executionEntryLogic }}", entryLogic);
}
