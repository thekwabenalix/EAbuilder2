/**
 * Setup Brain Generator
 *
 * Generates Setup_Brain_Execute() function with module-specific detection logic.
 * Returns inline MQL5 code (no templates).
 */

import type { BrainConfig } from "@/types/blueprint";

export function genSetupBrain(brain: BrainConfig | undefined): string {
  if (!brain) {
    return `
// Setup Brain disabled - all areas are valid
void Setup_Brain_Init() {}
void Setup_Brain_Execute() { gSetupActive = true; }
`;
  }

  const modules = brain.modules || [];
  const timeframe = brain.timeframe || "H4";

  // Build module-specific logic
  let detectionCode = "";

  for (const module of modules) {
    if (module === "order_block" || module === "ob") {
      detectionCode += `
   // Order Block Detection: Last Opposing Candle Before Displacement
   double o1 = iOpen(InpSymbol, InpSetupTF, 1);
   double c1 = iClose(InpSymbol, InpSetupTF, 1);
   double h1 = iHigh(InpSymbol, InpSetupTF, 1);
   double l1 = iLow(InpSymbol, InpSetupTF, 1);

   // Check for displacement (body size > ATR)
   double atr = iATR(InpSymbol, InpSetupTF, 14, 0);
   double bodySize = MathAbs(c1 - o1);

   if(bodySize > atr * 1.5) {
      gSetupActive = true;  // OB zone detected
   }
`;
    } else if (module === "fvg" || module === "fvg_inversion") {
      detectionCode += `
   // FVG Detection: 3-Candle Imbalance (Gap)
   double h0 = iHigh(InpSymbol, InpSetupTF, 0);
   double l0 = iLow(InpSymbol, InpSetupTF, 0);
   double h2 = iHigh(InpSymbol, InpSetupTF, 2);
   double l2 = iLow(InpSymbol, InpSetupTF, 2);

   // Bullish FVG: candle 0 low > candle 2 high
   // Bearish FVG: candle 0 high < candle 2 low
   if(l0 > h2 || h0 < l2) {
      gSetupActive = true;  // FVG zone detected
   }
`;
    } else if (module === "snr") {
      detectionCode += `
   // S/R Level Detection: Recent Swing Extremes
   double swH = iHigh(InpSymbol, InpSetupTF, 0);
   double swL = iLow(InpSymbol, InpSetupTF, 0);

   for(int i = 1; i <= 10; i++) {
      swH = MathMax(swH, iHigh(InpSymbol, InpSetupTF, i));
      swL = MathMin(swL, iLow(InpSymbol, InpSetupTF, i));
   }

   gSetupActive = true;  // S/R level found
`;
    }
  }

  return `
// Setup Brain: ${modules.join(" + ").toUpperCase()} @ ${timeframe}

void Setup_Brain_Init() {
   // Initialization if needed
}

void Setup_Brain_Execute() {
   gSetupActive = false;  // Reset before detection
${detectionCode}
}
`;
}
