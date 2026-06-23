/**
 * MEF State Module — Phase 2
 *
 * Same detection as MEF_Detector plus 4-buffer iCustom contract:
 *   0 : BullConfirmBuf — 1.0 at bullish MEF bar
 *   1 : BearConfirmBuf — 1.0 at bearish MEF bar
 *   2 : BullSLBuf      — engulfing low (SL hint for longs)
 *   3 : BearSLBuf      — engulfing high (SL hint for shorts)
 */

import { MEF_DETECTOR_VERSION, generateMefDetector } from "./mef-detector";

export const MEF_STATE_MODULE_VERSION = "1.0.0";
export const MEF_STATE_MODULE = "MEF_State_Module";

const BUFFER_HELPERS = `
void WriteMefBuffers(int idx, int sh)
{
   if(sh < 0) return;
   int n = ArraySize(BullConfirmBuf);
   if(sh >= n) return;
   if(mefs[idx].dir == DIR_BULL) {
      BullConfirmBuf[sh] = 1.0;
      BullSLBuf[sh]      = mefs[idx].engLo;
   } else {
      BearConfirmBuf[sh] = 1.0;
      BearSLBuf[sh]      = mefs[idx].engHi;
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

export function generateMefStateModule(): string {
  let code = generateMefDetector();

  code = code
    .replace(
      "//| MEF_Detector.mq5 — Manipulation Entry Formula                   ",
      `//| ${MEF_STATE_MODULE}.mq5 — Manipulation Entry Formula              `,
    )
    .replace(
      `//| MEF Candle Detector v${MEF_DETECTOR_VERSION}                             `,
      `//| MEF State Module v${MEF_STATE_MODULE_VERSION} — Phase 2: State + Buffers`,
    )
    .replace(
      "//| Detection only — no trade logic.                                ",
      "//| Detection + 4-buffer iCustom contract — no trade logic.         ",
    )
    .replace(
      "#property indicator_plots 0",
      "#property indicator_buffers 4\n#property indicator_plots   0",
    )
    .replace(
      "input bool   InpShowLog       = true;",
      `input bool   InpShowLog       = true;

double BullConfirmBuf[];
double BearConfirmBuf[];
double BullSLBuf[];
double BearSLBuf[];`,
    );

  code = code.replace("void KillMef(int i)", `${BUFFER_HELPERS}\nvoid KillMef(int i)`);

  code = code.replace(
    "   DrawMef(idx);\n   if(InpShowLog)",
    "   DrawMef(idx);\n   WriteMefBuffers(idx, s);\n   if(InpShowLog)",
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
   IndicatorSetString(INDICATOR_SHORTNAME, "MEF_State v${MEF_STATE_MODULE_VERSION}");
   lastMainBar = 0;
   Rebuild();
   return INIT_SUCCEEDED;
}`,
  );

  return code;
}
