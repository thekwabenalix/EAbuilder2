/**
 * Pin Bar State Module — Phase 2
 *
 * Same detection as Pin_Bar_Detector plus 4-buffer iCustom contract:
 *   0 : BullConfirmBuf — 1.0 at bullish pin bar bar
 *   1 : BearConfirmBuf — 1.0 at bearish pin bar bar
 *   2 : BullSLBuf      — bar low (SL for longs)
 *   3 : BearSLBuf      — bar high (SL for shorts)
 */

import { PIN_BAR_DETECTOR_VERSION, generatePinBarDetector } from "./pin-bar-detector";

export const PIN_BAR_STATE_MODULE_VERSION = "1.0.0";
export const PIN_BAR_STATE_MODULE = "Pin_Bar_State_Module";

const BUFFER_HELPERS = `
void WritePinBuffers(int sh, bool bull, bool bear)
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

export function generatePinBarStateModule(): string {
  let code = generatePinBarDetector();

  code = code
    .replace(
      "//| Pin_Bar_Detector.mq5                                           ",
      `//| ${PIN_BAR_STATE_MODULE}.mq5                                      `,
    )
    .replace(
      `//| Pin Bar Detector v${PIN_BAR_DETECTOR_VERSION}                              `,
      `//| Pin Bar State Module v${PIN_BAR_STATE_MODULE_VERSION} — Phase 2: State + Buffers`,
    )
    .replace(
      "#property indicator_plots 0",
      "#property indicator_buffers 4\n#property indicator_plots   0",
    )
    .replace(
      "input bool            InpShowLog       = true;",
      `input bool            InpShowLog       = true;

double BullConfirmBuf[];
double BearConfirmBuf[];
double BullSLBuf[];
double BearSLBuf[];`,
    );

  code = code.replace("void ScanBar(int sh)", `${BUFFER_HELPERS}\nvoid ScanBar(int sh)`);

  code = code.replace(
    "void ScanBar(int sh)\n{\n   if(IsBullPin(sh))",
    "void ScanBar(int sh)\n{\n   bool _bull = IsBullPin(sh);\n   bool _bear = IsBearPin(sh);\n   WritePinBuffers(sh, _bull, _bear);\n   if(_bull)",
  );

  code = code.replace("   if(IsBearPin(sh))", "   if(_bear)");

  code = code.replace(
    "int OnInit()  { lastBarTime = 0; return INIT_SUCCEEDED; }",
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
   IndicatorSetString(INDICATOR_SHORTNAME, "PinBar_State v${PIN_BAR_STATE_MODULE_VERSION}");
   ResetBuffers();
   lastBarTime = 0;
   return INIT_SUCCEEDED;
}`,
  );

  return code;
}
