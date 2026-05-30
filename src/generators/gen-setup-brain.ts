/**
 * Setup Brain Generator
 *
 * Takes a BrainConfig and generates the complete Setup_Brain_Execute() function
 * that detects zones and returns a SetupBrainState.
 */

import type { BrainConfig } from "@/types/blueprint";
import { SETUP_BRAIN_TEMPLATE } from "@/templates/brain-setup.mql5";

export function genSetupBrain(brain: BrainConfig | undefined): string {
  if (!brain) {
    return `
// No Setup Brain configured — all areas are valid
SetupBrainState gSetupState = {true, 0, 0, 0, "No setup filter"};
SetupBrainState Setup_Brain_Execute() { return gSetupState; }
`;
  }

  const modules = brain.modules || [];
  const timeframe = brain.timeframe || "H4";
  const modulesLabel = modules.map((m) => m.toUpperCase()).join(" + ");

  let globals = "";
  let detectionLogic = "";

  for (const module of modules) {
    if (module === "order_block") {
      globals += `
// Order Block globals
#define OB_MAX 50
struct OBZone { double hi; double lo; int dir; datetime time; bool active; };
OBZone obZones[OB_MAX];
int obCount = 0;
`;
      detectionLogic += `
   // Order Block detection (placeholder — real logic in next phase)
   state.active = false;
   state.description = "OB zone detection (not yet implemented)";
`;
    } else if (module === "fvg") {
      globals += `
// FVG globals
#define FVG_MAX 100
struct FVGZone { double ul; double ll; int dir; datetime time; bool active; };
FVGZone fvgZones[FVG_MAX];
int fvgCount = 0;
`;
      detectionLogic += `
   // FVG detection (placeholder)
   state.active = false;
   state.description = "FVG zone detection (not yet implemented)";
`;
    } else if (module === "snr") {
      detectionLogic += `
   // S/R Level detection (placeholder)
   state.active = false;
   state.description = "SNR level detection (not yet implemented)";
`;
    }
  }

  return SETUP_BRAIN_TEMPLATE.replace(
    "{{ modulesLabel }}",
    modulesLabel
  )
    .replace("{{ timeframe }}", timeframe)
    .replace("{{ setupGlobals }}", globals)
    .replace("{{ setupDetectionLogic }}", detectionLogic);
}
