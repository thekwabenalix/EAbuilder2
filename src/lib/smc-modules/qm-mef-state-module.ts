/**
 * QM_MEF State Module — Phase 2
 *
 * Same detection as QM_MEF_Detector plus 4-buffer iCustom contract:
 *   0 : BullConfirmBuf — 1.0 when bullish left shoulder is touched (entry)
 *   1 : BearConfirmBuf — 1.0 when bearish left shoulder is touched (entry)
 *   2 : BullSLBuf      — head level (SL beyond head for longs)
 *   3 : BearSLBuf      — head level (SL beyond head for shorts)
 */

import { QM_MEF_DETECTOR_VERSION, generateQmMefDetector } from "./qm-mef-detector";

export const QM_MEF_STATE_MODULE_VERSION = "1.0.0";
export const QM_MEF_STATE_MODULE = "QM_MEF_State_Module";

const BUFFER_HELPERS = `
void WriteQmBuffers(int idx, int sh)
{
   if(sh < 0) return;
   int n = ArraySize(BullConfirmBuf);
   if(sh >= n) return;
   if(qms[idx].dir == DIR_BULL) {
      BullConfirmBuf[sh] = 1.0;
      BullSLBuf[sh]      = qms[idx].headLevel;
   } else {
      BearConfirmBuf[sh] = 1.0;
      BearSLBuf[sh]      = qms[idx].headLevel;
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

export function generateQmMefStateModule(): string {
  let code = generateQmMefDetector();

  code = code
    .replace(
      "//| QM_MEF_Detector.mq5 — Quasimodo Manipulation Entry Formula      ",
      `//| ${QM_MEF_STATE_MODULE}.mq5 — Quasimodo Manipulation Entry Formula `,
    )
    .replace(
      `//| QM_MEF Detector v${QM_MEF_DETECTOR_VERSION}                              `,
      `//| QM_MEF State Module v${QM_MEF_STATE_MODULE_VERSION} — Phase 2: State + Buffers`,
    )
    .replace(
      "//| Quasimodo uses candle CLOSES, not wicks. Detection only.       ",
      "//| Quasimodo + 4-buffer iCustom contract — detection only.        ",
    )
    .replace(
      "#property indicator_plots 0",
      "#property indicator_buffers 4\n#property indicator_plots   0",
    )
    .replace(
      "input bool   InpShowLog        = true;",
      `input bool   InpShowLog        = true;

double BullConfirmBuf[];
double BearConfirmBuf[];
double BullSLBuf[];
double BearSLBuf[];`,
    );

  code = code.replace("void KillQm(int i)", `${BUFFER_HELPERS}\nvoid KillQm(int i)`);

  code = code.replace(
    `         if(touched) {
            qms[i].lsTouched = true;
            ObjectSetInteger(0, ObjRS(qms[i].id), OBJPROP_TIME, 0, t); // RS label at the tap`,
    `         if(touched) {
            qms[i].lsTouched = true;
            WriteQmBuffers(i, s);
            ObjectSetInteger(0, ObjRS(qms[i].id), OBJPROP_TIME, 0, t); // RS label at the tap`,
  );

  code = code.replace(
    "void Rebuild()\n{\n   ObjectsDeleteAll(0, OBJ_PREFIX);",
    "void Rebuild()\n{\n   ResetBuffers();\n   ObjectsDeleteAll(0, OBJ_PREFIX);",
  );

  code = code.replace(
    `int OnInit()
{
   lastMainBar = 0;
   Rebuild();
   return INIT_SUCCEEDED;
}`,
    `int OnInit()
{
   SetIndexBuffer(0, BullConfirmBuf, INDICATOR_DATA);
   SetIndexBuffer(1, BearConfirmBuf, INDICATOR_DATA);
   SetIndexBuffer(2, BullSLBuf,      INDICATOR_DATA);
   SetIndexBuffer(3, BearSLBuf,      INDICATOR_DATA);
   ArraySetAsSeries(BullConfirmBuf, true);
   ArraySetAsSeries(BearConfirmBuf, true);
   ArraySetAsSeries(BullSLBuf,      true);
   ArraySetAsSeries(BearSLBuf,      true);
   IndicatorSetString(INDICATOR_SHORTNAME, "QM_MEF_State v${QM_MEF_STATE_MODULE_VERSION}");
   lastMainBar = 0;
   Rebuild();
   return INIT_SUCCEEDED;
}`,
  );

  return code;
}
