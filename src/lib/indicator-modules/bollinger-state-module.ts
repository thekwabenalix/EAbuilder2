/**
 * Bollinger State Module — Phase 2
 *
 *   0 : BullConfirmBuf — 1.0 at lower-band touch rejection or upper breakout (bull)
 *   1 : BearConfirmBuf — 1.0 at upper-band touch rejection or lower breakout (bear)
 *   2 : BullSLBuf      — bar low
 *   3 : BearSLBuf      — bar high
 */

import { BOLL_DETECTOR_VERSION, generateBollingerDetector } from "./bollinger-detector";

export const BOLL_STATE_MODULE_VERSION = "1.0.0";
export const BOLL_STATE_MODULE = "Bollinger_State_Module";

const BUFFER_HELPERS = `
void WriteBollBuffers(int sh, bool bull, bool bear)
{
   if(sh < 0) return;
   int n = ArraySize(BullConfirmBuf);
   if(sh >= n) return;
   if(bull) {
      BullConfirmBuf[sh] = 1.0;
      BullSLBuf[sh]      = iLow(_Symbol, InpTF, sh);
   }
   if(bear) {
      BearConfirmBuf[sh] = 1.0;
      BearSLBuf[sh]      = iHigh(_Symbol, InpTF, sh);
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

export function generateBollingerStateModule(): string {
  let code = generateBollingerDetector();

  code = code
    .replace(
      "//| Bollinger_Detector.mq5                                         ",
      `//| ${BOLL_STATE_MODULE}.mq5                                       `,
    )
    .replace(
      `//| Bollinger Bands v${BOLL_DETECTOR_VERSION} — touch & breakout marks     `,
      `//| Bollinger State Module v${BOLL_STATE_MODULE_VERSION} — Phase 2: State + Buffers`,
    )
    .replace(
      "#property indicator_plots 0",
      "#property indicator_buffers 4\n#property indicator_plots   0",
    )
    .replace(
      "input bool            InpShowLog   = true;",
      `input bool            InpShowLog   = true;

double BullConfirmBuf[];
double BearConfirmBuf[];
double BullSLBuf[];
double BearSLBuf[];`,
    );

  code = code.replace("void ScanBar(int sh)", `${BUFFER_HELPERS}\nvoid ScanBar(int sh)`);

  code = code.replace(
    `void ScanBar(int sh)
{
   double mid = BandVal(0, sh);`,
    `void ScanBar(int sh)
{
   bool _bull = false, _bear = false;
   double mid = BandVal(0, sh);`,
  );

  code = code.replace("   if(l <= lo && c > lo)\n   {", "   if(l <= lo && c > lo) { _bull = true;");
  code = code.replace("   if(h >= up && c < up)\n   {", "   if(h >= up && c < up) { _bear = true;");
  code = code.replace("   if(c > up)\n   {", "   if(c > up) { _bull = true;");
  code = code.replace("   if(c < lo)\n   {", "   if(c < lo) { _bear = true;");

  code = code.replace(
    '      if(InpShowLog && sh == 1) PrintFormat("BB_BREAKOUT_BEAR | lo=%.5f | %s", lo, TimeToString(t, TIME_DATE|TIME_MINUTES));\n   }\n}',
    '      if(InpShowLog && sh == 1) PrintFormat("BB_BREAKOUT_BEAR | lo=%.5f | %s", lo, TimeToString(t, TIME_DATE|TIME_MINUTES));\n   }\n   WriteBollBuffers(sh, _bull, _bear);\n}',
  );

  code = code.replace(
    `int OnInit()
{
   hBands = iBands(_Symbol, InpTF, InpPeriod, 0, InpDeviation, PRICE_CLOSE);
   if(hBands == INVALID_HANDLE) return INIT_FAILED;
   lastBarTime = 0;
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
   IndicatorSetString(INDICATOR_SHORTNAME, "Bollinger_State v${BOLL_STATE_MODULE_VERSION}");
   hBands = iBands(_Symbol, InpTF, InpPeriod, 0, InpDeviation, PRICE_CLOSE);
   if(hBands == INVALID_HANDLE) return INIT_FAILED;
   ResetBuffers();
   lastBarTime = 0;
   return INIT_SUCCEEDED;
}`,
  );

  return code;
}
