/**
 * Direction Brain Generator
 *
 * Generates Direction_Brain_Execute() function with module-specific detection logic.
 * Returns inline MQL5 code (no templates).
 */

import type { BrainConfig } from "@/types/blueprint";

export function genDirectionBrain(brain: BrainConfig | undefined): string {
  if (!brain) {
    return `
// Direction Brain disabled
int gBias = 0;
void Direction_Brain_Init() {}
void Direction_Brain_Execute() { gBias = 0; }
`;
  }

  const modules = brain.modules || [];
  const timeframe = brain.timeframe || "D1";

  // Build module-specific logic
  let detectionCode = "";

  for (const module of modules) {
    if (module === "choch") {
      detectionCode += `
   // CHoCH Detection: Break of Previous Swing High/Low
   double swH = iHigh(InpSymbol, InpDirectionTF, 2);
   double swL = iLow(InpSymbol, InpDirectionTF, 2);
   for(int i = 3; i <= 20; i++) {
      swH = MathMax(swH, iHigh(InpSymbol, InpDirectionTF, i));
      swL = MathMin(swL, iLow(InpSymbol, InpDirectionTF, i));
   }
   double close1 = iClose(InpSymbol, InpDirectionTF, 1);
   if(close1 > swH) gBias = 1;      // BULL break
   else if(close1 < swL) gBias = -1; // BEAR break
`;
    } else if (module === "bos") {
      detectionCode += `
   // BOS Detection: Break of Structure
   double swH = iHigh(InpSymbol, InpDirectionTF, 2);
   double swL = iLow(InpSymbol, InpDirectionTF, 2);
   for(int i = 3; i <= 20; i++) {
      swH = MathMax(swH, iHigh(InpSymbol, InpDirectionTF, i));
      swL = MathMin(swL, iLow(InpSymbol, InpDirectionTF, i));
   }
   double close1 = iClose(InpSymbol, InpDirectionTF, 1);
   if(close1 > swH) gBias = 1;      // BULL break
   else if(close1 < swL) gBias = -1; // BEAR break
`;
    } else if (module === "fvg_inversion") {
      detectionCode += `
   // FVG Inversion Detection
   double o0 = iOpen(InpSymbol, InpDirectionTF, 0);
   double h1 = iHigh(InpSymbol, InpDirectionTF, 1);
   double l1 = iLow(InpSymbol, InpDirectionTF, 1);
   double h2 = iHigh(InpSymbol, InpDirectionTF, 2);
   double l2 = iLow(InpSymbol, InpDirectionTF, 2);

   // Bullish inversion: gap down (low0 > high2)
   if(l1 > h2) gBias = 1;
   // Bearish inversion: gap up (high0 < low2)
   else if(o0 < l2) gBias = -1;
`;
    }
  }

  return `
// Direction Brain: ${modules.join(" + ").toUpperCase()} @ ${timeframe}
int gBias = 0;

void Direction_Brain_Init() {
   // Initialization if needed
}

void Direction_Brain_Execute() {
   gBias = 0;  // Reset before detection
${detectionCode}
}
`;
}
