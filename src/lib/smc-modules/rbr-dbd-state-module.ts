/**
 * RBR / DBD State Module — Phase 2
 *
 * Same detection as RBR_DBD_Detector plus 4-buffer iCustom contract:
 *   0 : BullConfirmBuf — 1.0 at RBR (demand) zone confirmation bar
 *   1 : BearConfirmBuf — 1.0 at DBD (supply) zone confirmation bar
 *   2 : BullSLBuf      — demand zone low (SL below base)
 *   3 : BearSLBuf      — supply zone high (SL above base)
 */

import { RBR_DBD_DETECTOR_VERSION, generateRbrDbdDetector } from "./rbr-dbd-detector";

export const RBR_DBD_STATE_MODULE_VERSION = "1.0.0";
export const RBR_DBD_STATE_MODULE = "RBR_DBD_State_Module";

const BUFFER_HELPERS = `
void WriteRbrDbdBuffers(int idx, int sh)
{
   if(sh < 0) return;
   int n = ArraySize(BullConfirmBuf);
   if(sh >= n) return;
   if(zones[idx].dir == DIR_DEMAND) {
      BullConfirmBuf[sh] = 1.0;
      BullSLBuf[sh]      = zones[idx].lo;
   } else {
      BearConfirmBuf[sh] = 1.0;
      BearSLBuf[sh]      = zones[idx].hi;
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

export function generateRbrDbdStateModule(): string {
  let code = generateRbrDbdDetector();

  code = code
    .replace(
      "//| RBR_DBD_Detector.mq5 — Supply & Demand base zones               ",
      `//| ${RBR_DBD_STATE_MODULE}.mq5 — Supply & Demand base zones          `,
    )
    .replace(
      `//| RBR/DBD Detector v${RBR_DBD_DETECTOR_VERSION}                            `,
      `//| RBR/DBD State Module v${RBR_DBD_STATE_MODULE_VERSION} — Phase 2: State + Buffers`,
    )
    .replace("#property indicator_plots 0", "#property indicator_buffers 4\n#property indicator_plots   0")
    .replace(
      "input bool            InpShowLog      = true;",
      `input bool            InpShowLog      = true;

double BullConfirmBuf[];
double BearConfirmBuf[];
double BullSLBuf[];
double BearSLBuf[];`,
    );

  code = code.replace("void KillZone(int i)", `${BUFFER_HELPERS}\nvoid KillZone(int i)`);

  code = code.replace(
    "   DrawZone(idx);\n   if(InpShowLog)",
    "   DrawZone(idx);\n   WriteRbrDbdBuffers(idx, sh);\n   if(InpShowLog)",
  );

  code = code.replace(
    "void Rebuild()\n{\n   ObjectsDeleteAll(0, OBJ_PREFIX);",
    "void Rebuild()\n{\n   ResetBuffers();\n   ObjectsDeleteAll(0, OBJ_PREFIX);",
  );

  code = code.replace(
    `int OnInit()  {
   lastBarTime = 0;
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
   IndicatorSetString(INDICATOR_SHORTNAME, "RBR_DBD_State v${RBR_DBD_STATE_MODULE_VERSION}");
   lastBarTime = 0;
   Rebuild();
   return INIT_SUCCEEDED;
}`,
  );

  return code;
}
