/**
 * Unicorn State Module — Phase 2
 *
 * Same detection as Unicorn_Detector plus 4-buffer iCustom contract:
 *   0 : BullConfirmBuf — 1.0 when a bullish Unicorn (BB + FVG overlap) forms
 *   1 : BearConfirmBuf — 1.0 when a bearish Unicorn forms
 *   2 : BullSLBuf      — breaker zone low (invalidation for longs)
 *   3 : BearSLBuf      — breaker zone high (invalidation for shorts)
 */

import { UNICORN_DETECTOR_VERSION, generateUnicornDetector } from "./unicorn-detector";

export const UNICORN_STATE_MODULE_VERSION = "1.0.0";
export const UNICORN_STATE_MODULE = "Unicorn_State_Module";

const BUFFER_HELPERS = `
void WriteUnicornBuffers(int idx, int sh)
{
   if(sh < 0) return;
   int n = ArraySize(BullConfirmBuf);
   if(sh >= n) return;
   if(obList[idx].dir == DIR_BULL) {
      BullConfirmBuf[sh] = 1.0;
      BullSLBuf[sh]      = obList[idx].lo;
   } else {
      BearConfirmBuf[sh] = 1.0;
      BearSLBuf[sh]      = obList[idx].hi;
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

export function generateUnicornStateModule(): string {
  let code = generateUnicornDetector();

  code = code
    .replace(
      "//| Unicorn_Detector.mq5                                           ",
      `//| ${UNICORN_STATE_MODULE}.mq5                                      `,
    )
    .replace(
      `//| SMC Combination v${UNICORN_DETECTOR_VERSION} — Unicorn (Breaker + FVG)   `,
      `//| Unicorn State Module v${UNICORN_STATE_MODULE_VERSION} — Phase 2: State + Buffers`,
    )
    .replace(
      "#property indicator_plots 0",
      "#property indicator_buffers 4\n#property indicator_plots   0",
    )
    .replace(
      "input bool            InpShowLog      = true;",
      `input bool            InpShowLog      = true;

double BullConfirmBuf[];
double BearConfirmBuf[];
double BullSLBuf[];
double BearSLBuf[];`,
    );

  code = code.replace(
    "// Match active breakers against same-dir overlapping FVGs → Unicorn.\nvoid MatchPass()",
    `${BUFFER_HELPERS}\n// Match active breakers against same-dir overlapping FVGs → Unicorn.\nvoid MatchPass(int sh)`,
  );

  code = code.replace(
    "         obList[i].matched = true;\n         fvgList[f].used   = true;\n         DrawUnicorn(i);",
    `         obList[i].matched = true;
         fvgList[f].used   = true;
         WriteUnicornBuffers(i, sh);
         DrawUnicorn(i);`,
  );

  code = code.replace(
    "void Rebuild()\n{\n   ObjectsDeleteAll(0, OBJ_PREFIX);",
    "void Rebuild()\n{\n   ResetBuffers();\n   ObjectsDeleteAll(0, OBJ_PREFIX);",
  );

  code = code.replace(/MatchPass\(\)/g, "MatchPass(sh)");

  code = code.replace(
    "int OnInit()  { lastBarTime = 0; Rebuild(); return INIT_SUCCEEDED; }",
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
   IndicatorSetString(INDICATOR_SHORTNAME, "Unicorn_State v${UNICORN_STATE_MODULE_VERSION}");
   lastBarTime = 0;
   Rebuild();
   return INIT_SUCCEEDED;
}`,
  );

  code = code.replace(
    "      DetectOB(1); DetectFVG(1); CheckBreaks(1); MatchPass(); Lifecycle(1); AgeLevels();",
    "      DetectOB(1); DetectFVG(1); CheckBreaks(1); MatchPass(1); Lifecycle(1); AgeLevels();",
  );

  return code;
}
