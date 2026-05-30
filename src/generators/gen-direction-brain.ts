/**
 * Direction Brain Generator
 *
 * Takes a BrainConfig and generates the complete Direction_Brain_Execute() function
 * that detects market bias and returns a DirectionBrainState.
 */

import type { BrainConfig } from "@/types/blueprint";
import { DIRECTION_BRAIN_TEMPLATE } from "@/templates/brain-direction.mql5";

export function genDirectionBrain(brain: BrainConfig | undefined): string {
  if (!brain) {
    return `
// No Direction Brain configured — gBias stays NEUTRAL
DirectionBrainState gDirState = {0, 0, "No direction filter"};
DirectionBrainState Direction_Brain_Execute() { return gDirState; }
`;
  }

  const modules = brain.modules || [];
  const timeframe = brain.timeframe || "D1";
  const modulesLabel = modules.map((m) => m.toUpperCase()).join(" + ");

  // Build module-specific globals and detection logic
  let globals = "";
  let detectionLogic = "";

  for (const module of modules) {
    if (module === "choch" || module === "bos") {
      globals += `
// ${module.toUpperCase()} globals
double swH_${module} = 0, swL_${module} = 0;
`;
      detectionLogic += `
   // ${module.toUpperCase()} detection
   double swH = iHigh(InpSymbol, InpDirectionTF, 2), swL = iLow(InpSymbol, InpDirectionTF, 2);
   for(int i = 3; i <= 20; i++) {
      swH = MathMax(swH, iHigh(InpSymbol, InpDirectionTF, i));
      swL = MathMin(swL, iLow(InpSymbol, InpDirectionTF, i));
   }
   double c1 = iClose(InpSymbol, InpDirectionTF, 1);
   if(c1 > swH) {
      state.bias = 1;
      state.reason = "${module.toUpperCase()} BULL break @ " + DoubleToString(swH, 5);
   } else if(c1 < swL) {
      state.bias = -1;
      state.reason = "${module.toUpperCase()} BEAR break @ " + DoubleToString(swL, 5);
   }
`;
    } else if (module === "ema") {
      globals += `
// EMA globals
int emaHandle9 = INVALID_HANDLE, emaHandle21 = INVALID_HANDLE;
`;
      detectionLogic += `
   // EMA detection (placeholder — full logic in next phase)
   state.reason = "EMA trend detection (not yet implemented)";
`;
    }
  }

  return DIRECTION_BRAIN_TEMPLATE.replace(
    "{{ modulesLabel }}",
    modulesLabel
  )
    .replace("{{ timeframe }}", timeframe)
    .replace("{{ directionGlobals }}", globals)
    .replace("{{ directionDetectionLogic }}", detectionLogic);
}
