/**
 * Execution Brain Generator
 *
 * Generates Execution_Brain_Execute() function with module-specific entry logic.
 * Returns inline MQL5 code (no templates).
 */

import type { BrainConfig } from "@/types/blueprint";

export function genExecutionBrain(brain: BrainConfig | undefined): string {
  if (!brain) {
    return `
// Execution Brain disabled
void Execution_Brain_Init() {}
void Execution_Brain_Execute() { gExecSignal = false; }
`;
  }

  const modules = brain.modules || [];
  const timeframe = brain.timeframe || "H1";

  // Build module-specific entry logic
  let detectionCode = "";

  for (const module of modules) {
    if (module === "engulfing") {
      detectionCode += `
   // Engulfing Pattern Detection
   double o1 = iOpen(InpSymbol, InpExecTF, 1);
   double c1 = iClose(InpSymbol, InpExecTF, 1);
   double o2 = iOpen(InpSymbol, InpExecTF, 2);
   double c2 = iClose(InpSymbol, InpExecTF, 2);

   // Bullish engulfing: candle1 close > candle2 open AND candle1 open < candle2 close
   if(c1 > o2 && o1 < c2) {
      gExecSignal = true;
   }
   // Bearish engulfing
   else if(c1 < o2 && o1 > c2) {
      gExecSignal = true;
   }
`;
    } else if (module === "pin_bar") {
      detectionCode += `
   // Pin Bar Detection: Long wick rejection
   double h = iHigh(InpSymbol, InpExecTF, 1);
   double l = iLow(InpSymbol, InpExecTF, 1);
   double o = iOpen(InpSymbol, InpExecTF, 1);
   double c = iClose(InpSymbol, InpExecTF, 1);
   double range = h - l;

   // Check if wick is 2x the body
   if(range > 0) {
      double bodySize = MathAbs(c - o);
      if(bodySize < range / 2.0) {
         gExecSignal = true;  // Pin bar detected
      }
   }
`;
    } else if (module === "fvg_inversion") {
      detectionCode += `
   // FVG Inversion Entry: Retest after gap
   double h0 = iHigh(InpSymbol, InpExecTF, 0);
   double l0 = iLow(InpSymbol, InpExecTF, 0);
   double h1 = iHigh(InpSymbol, InpExecTF, 1);
   double l1 = iLow(InpSymbol, InpExecTF, 1);
   double h2 = iHigh(InpSymbol, InpExecTF, 2);
   double l2 = iLow(InpSymbol, InpExecTF, 2);

   // Bullish setup: retest after down gap
   if(l1 > h2 && l0 < h2) {
      gExecSignal = true;
   }
   // Bearish setup: retest after up gap
   else if(h1 < l2 && h0 > l2) {
      gExecSignal = true;
   }
`;
    }
  }

  return `
// Execution Brain: ${modules.join(" + ").toUpperCase()} @ ${timeframe}

void Execution_Brain_Init() {
   // Initialization if needed
}

void Execution_Brain_Execute() {
   gExecSignal = false;  // Reset before detection
${detectionCode}
}
`;
}
