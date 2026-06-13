/**
 * Swing Structure State Module — Phase 2
 *
 * Same detection as Swing_Structure_Detector plus 4-buffer iCustom contract:
 *   0 : BullConfirmBuf — 1.0 when a swing HIGH is confirmed
 *   1 : BearConfirmBuf — 1.0 when a swing LOW is confirmed
 *   2 : BullSLBuf      — last swing low (SL hint for longs)
 *   3 : BearSLBuf      — last swing high (SL hint for shorts)
 */

import {
  SWING_STRUCTURE_DETECTOR_VERSION,
  generateSwingStructureDetector,
} from "./swing-structure-detector";

export const SWING_STRUCTURE_STATE_MODULE_VERSION = "1.0.0";
export const SWING_STRUCTURE_STATE_MODULE = "Swing_Structure_State_Module";

const BUFFER_HELPERS = `
void WriteSwingBuffers(int type, int sh)
{
   if(sh < 0) return;
   int n = ArraySize(BullConfirmBuf);
   if(sh >= n) return;
   if(type == SWING_HIGH) {
      BullConfirmBuf[sh] = 1.0;
      double sl = 0.0;
      for(int i = swingTotal - 1; i >= 0; i--)
         if(swingList[i].type == SWING_LOW) { sl = swingList[i].price; break; }
      if(sl > 0.0) BullSLBuf[sh] = sl;
   } else {
      BearConfirmBuf[sh] = 1.0;
      double sl = 0.0;
      for(int i = swingTotal - 1; i >= 0; i--)
         if(swingList[i].type == SWING_HIGH) { sl = swingList[i].price; break; }
      if(sl > 0.0) BearSLBuf[sh] = sl;
   }
}

void ResetBuffers()
{
   ArrayInitialize(BullConfirmBuf, 0.0);
   ArrayInitialize(BearConfirmBuf, 0.0);
   ArrayInitialize(BullSLBuf,      0.0);
   ArrayInitialize(BearSLBuf,      0.0);
}
`;

export function generateSwingStructureStateModule(): string {
  let code = generateSwingStructureDetector();

  code = code
    .replace(
      "//| Swing_Structure_Detector.mq5                                    ",
      `//| ${SWING_STRUCTURE_STATE_MODULE}.mq5                               `,
    )
    .replace(
      `//| SMC Module Library v${SWING_STRUCTURE_DETECTOR_VERSION} — Phase 1: Detection Only  `,
      `//| Swing Structure State Module v${SWING_STRUCTURE_STATE_MODULE_VERSION} — Phase 2`,
    )
    .replace("#property indicator_plots 0", "#property indicator_buffers 4\n#property indicator_plots   0")
    .replace(
      "input bool InpShowLog = true; // Print swing events to journal",
      `input bool InpShowLog = true; // Print swing events to journal

double BullConfirmBuf[];
double BearConfirmBuf[];
double BullSLBuf[];
double BearSLBuf[];`,
    );

  code = code.replace(
    "void SWING_DrawMarker(int idx)",
    `${BUFFER_HELPERS}\nvoid SWING_DrawMarker(int idx)`,
  );

  code = code.replace(
    `         swingList[idx].drawn = false;
         if(InpShowLog)
            PrintFormat("SWING_HIGH_FORMED | id=%d | price=%.5f | time=%s",
               swingList[idx].id, hi, TimeToString(t, TIME_DATE|TIME_MINUTES));`,
    `         swingList[idx].drawn = false;
         WriteSwingBuffers(SWING_HIGH, sh);
         if(InpShowLog)
            PrintFormat("SWING_HIGH_FORMED | id=%d | price=%.5f | time=%s",
               swingList[idx].id, hi, TimeToString(t, TIME_DATE|TIME_MINUTES));`,
  );

  code = code.replace(
    `         swingList[idx].drawn = false;
         if(InpShowLog)
            PrintFormat("SWING_LOW_FORMED | id=%d | price=%.5f | time=%s",
               swingList[idx].id, lo, TimeToString(t, TIME_DATE|TIME_MINUTES));`,
    `         swingList[idx].drawn = false;
         WriteSwingBuffers(SWING_LOW, sh);
         if(InpShowLog)
            PrintFormat("SWING_LOW_FORMED | id=%d | price=%.5f | time=%s",
               swingList[idx].id, lo, TimeToString(t, TIME_DATE|TIME_MINUTES));`,
  );

  code = code.replace(
    "int OnInit()\n{\n   DeleteAll();",
    "int OnInit()\n{\n   SetIndexBuffer(0, BullConfirmBuf, INDICATOR_DATA);\n   SetIndexBuffer(1, BearConfirmBuf, INDICATOR_DATA);\n   SetIndexBuffer(2, BullSLBuf,      INDICATOR_DATA);\n   SetIndexBuffer(3, BearSLBuf,      INDICATOR_DATA);\n   ArraySetAsSeries(BullConfirmBuf, true);\n   ArraySetAsSeries(BearConfirmBuf, true);\n   ArraySetAsSeries(BullSLBuf,      true);\n   ArraySetAsSeries(BearSLBuf,      true);\n   IndicatorSetString(INDICATOR_SHORTNAME, \"SwingStruct_State v" +
      SWING_STRUCTURE_STATE_MODULE_VERSION +
      "\");\n   ResetBuffers();\n   DeleteAll();",
  );

  return code;
}
