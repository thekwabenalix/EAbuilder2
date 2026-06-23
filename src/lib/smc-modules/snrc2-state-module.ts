/**
 * SNRC2 State Module — Phase 2
 *
 * Same detection and chart visuals as SNRC2_Detector, plus the standard
 * 4-buffer iCustom contract for Setup Brain / Phase 3 EA attachment.
 *
 * Phase 3 buffer contract (read via iCustom):
 *   0 : BullConfirmBuf — 1.0 at bullish SNRC2 confirmation bar (Cont HH pivot)
 *   1 : BearConfirmBuf — 1.0 at bearish SNRC2 confirmation bar (Cont LL pivot)
 *   2 : BullSLBuf      — manipulation low (SL for bull entries)
 *   3 : BearSLBuf      — manipulation high (SL for bear entries)
 *
 * NO trading logic — state tracking, signal buffers, and visualisation only.
 */

import { SNRC2_DETECTOR_VERSION, generateSnrc2Detector } from "./snrc2-detector";

export const SNRC2_STATE_MODULE_VERSION = "1.0.0";
export const SNRC2_STATE_MODULE = "SNRC2_State_Module";

const BUFFER_HELPERS = `
//+------------------------------------------------------------------+
// Phase 2 — iCustom buffer writers
void WriteConfirmBuffers(int idx)
{
   int sh = iBarShift(_Symbol, InpTF, recs[idx].tConf);
   if(sh < 0) return;
   int n = ArraySize(BullConfirmBuf);
   if(sh >= n) return;
   if(recs[idx].dir == DIR_BULL) {
      BullConfirmBuf[sh] = 1.0;
      BullSLBuf[sh]      = recs[idx].sl;
   } else {
      BearConfirmBuf[sh] = 1.0;
      BearSLBuf[sh]      = recs[idx].sl;
   }
}

void ClearConfirmBuffers(datetime tConf, int dir)
{
   int sh = iBarShift(_Symbol, InpTF, tConf);
   if(sh < 0) return;
   int n = ArraySize(BullConfirmBuf);
   if(sh >= n) return;
   if(dir == DIR_BULL) {
      BullConfirmBuf[sh] = 0.0;
      BullSLBuf[sh]      = 0.0;
   } else {
      BearConfirmBuf[sh] = 0.0;
      BearSLBuf[sh]      = 0.0;
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

export function generateSnrc2StateModule(): string {
  let code = generateSnrc2Detector();

  code = code
    .replace(
      "//| SNRC2_Detector.mq5 — Support & Resistance Continuation 2        ",
      `//| ${SNRC2_STATE_MODULE}.mq5 — Support & Resistance Continuation 2`,
    )
    .replace(
      `//| SNRC2 Detector v${SNRC2_DETECTOR_VERSION}                                `,
      `//| SNRC2 State Module v${SNRC2_STATE_MODULE_VERSION} — Phase 2: State + Buffers`,
    )
    .replace(
      "//| Detection only — no trade logic.                                ",
      "//| Detection + 4-buffer iCustom contract — no trade logic.         ",
    )
    .replace(
      "#property indicator_plots 0",
      "#property indicator_buffers 4\n#property indicator_plots   0",
    )
    .replace('#define OBJ_PREFIX  "SMSNRC2_"', '#define OBJ_PREFIX  "SMCSNRC2_"')
    .replace(
      "input bool            InpShowLog     = true;",
      `input bool            InpShowLog     = true;

//--- Phase 2 buffers (iCustom contract)
double BullConfirmBuf[];
double BearConfirmBuf[];
double BullSLBuf[];
double BearSLBuf[];`,
    );

  code = code.replace("void KillRec(int i)", `${BUFFER_HELPERS}\nvoid KillRec(int i)`);

  code = code.replace(
    "void KillRec(int i)\n{\n   ObjectDelete(0, ObjEntry(recs[i].id));",
    `void KillRec(int i)
{
   if(!recs[i].dead) ClearConfirmBuffers(recs[i].tConf, recs[i].dir);
   ObjectDelete(0, ObjEntry(recs[i].id));`,
  );

  code = code.replace(
    "   DrawRec(idx);\n   if(InpShowLog)",
    "   DrawRec(idx);\n   WriteConfirmBuffers(idx);\n   if(InpShowLog)",
  );

  code = code.replace(
    "void Rebuild()\n{\n   ObjectsDeleteAll(0, OBJ_PREFIX);",
    "void Rebuild()\n{\n   ResetBuffers();\n   ObjectsDeleteAll(0, OBJ_PREFIX);",
  );

  code = code.replace(
    `int OnInit()
{
   Rebuild();
   lastBarTime = iTime(_Symbol, InpTF, 0);  // avoid an immediate re-Detect on the first tick
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
   IndicatorSetString(INDICATOR_SHORTNAME, "SNRC2_State v${SNRC2_STATE_MODULE_VERSION}");
   lastBarTime = iTime(_Symbol, InpTF, 0);
   return INIT_SUCCEEDED;
}`,
  );

  code = code.replace(
    `int OnCalculate(const int rates_total, const int prev_calculated,
                const datetime &time[], const double &open[],
                const double &high[], const double &low[],
                const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
{
   datetime curBar = iTime(_Symbol, InpTF, 0);
   if(curBar != lastBarTime) {
      lastBarTime = curBar;
      // Full rebuild each new bar: re-detect + replay every bar of the lookback.
      // This guarantees a setup whose SL was traded through (possibly several bars
      // before its final pivot confirmed, due to swing-confirmation lag) is always
      // re-validated against the whole history and removed — never left extending.
      Rebuild();
   }
   return rates_total;
}`,
    `int OnCalculate(const int rates_total, const int prev_calculated,
                const datetime &time[], const double &open[],
                const double &high[], const double &low[],
                const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
{
   if(rates_total < 3) return 0;

   if(prev_calculated == 0)
   {
      Rebuild();
      lastBarTime = iTime(_Symbol, InpTF, 0);
      return rates_total;
   }

   datetime curBar = iTime(_Symbol, InpTF, 0);
   if(curBar != lastBarTime) {
      lastBarTime = curBar;
      Rebuild();
   }
   return rates_total;
}`,
  );

  return code;
}
