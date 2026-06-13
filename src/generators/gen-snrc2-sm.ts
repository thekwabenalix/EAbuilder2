/**
 * Inline SNRC2 State Machine Generator
 *
 * Support & Resistance Continuation 2 — continuation after Classic SNR break
 * with manipulation pullback across the broken level.
 *
 * Standard API:
 *   SNRC2SM_{id}_Reset()
 *   SNRC2SM_{id}_Tick(lookback)
 *   SNRC2SM_{id}_BullJustConfirmed() / BearJustConfirmed()
 *   SNRC2SM_{id}_BullConfirmSL() / BearConfirmSL()
 *   SNRC2SM_{id}_HasActiveBull() / HasActiveBear()
 *   SNRC2SM_{id}_ActiveBullSL() / ActiveBearSL()
 */

import { emitSnrc2Core } from "@/lib/smc-modules/snrc2-inline-core";

export function genSnrc2SM(
  id: string,
  TF: string,
  tf: string,
  lookback = 400,
  swingStrength = 2,
  htfTF = "PERIOD_H4",
  htfLookback = 4,
  expiryBars = 250,
): string {
  const P = `SNRC2SM_${id}_`;
  const core = emitSnrc2Core({
    p: P,
    sym: "InpSymbol",
    tf: TF,
    htf: htfTF,
    lookback: String(lookback),
    swingStrength: String(swingStrength),
    htfLookback: String(htfLookback),
    expiryBars: String(expiryBars),
    draw: "false",
    objPrefix: `4B_SNRC2_${tf}_`,
    showLog: "false",
  });

  return `
//+------------------------------------------------------------------+
//| SNRC2 State Machine — ${tf} (${id})                              |
//| Classic SNR continuation with HTF engulfing filter              |
//+------------------------------------------------------------------+
${core}

bool   ${P}_bullConfirmed = false;
bool   ${P}_bearConfirmed = false;
double ${P}_bullSL        = 0.0;
double ${P}_bearSL        = 0.0;
double ${P}_bullEntry     = 0.0;
double ${P}_bearEntry     = 0.0;

void ${P}AddRec(int dir, double entry, double sl, double secondExt, double contExt, double resLevel,
            datetime t1, datetime tRes, datetime tManip, datetime tConf)
{
   for(int _k = 0; _k < ${P}recTotal; _k++)
      if(${P}recs[_k].t1 == t1 && ${P}recs[_k].dir == dir) return;

   if(${P}recTotal >= ${P}MAX_REC) return;
   int idx = ${P}recTotal++;

   ${P}recs[idx].id         = ${P}nextId++;
   ${P}recs[idx].dir        = dir;
   ${P}recs[idx].entry      = entry;
   ${P}recs[idx].sl         = sl;
   ${P}recs[idx].secondExt  = secondExt;
   ${P}recs[idx].contExt    = contExt;
   ${P}recs[idx].resLevel   = resLevel;
   ${P}recs[idx].t1         = t1;
   ${P}recs[idx].tRes       = tRes;
   ${P}recs[idx].tManip     = tManip;
   ${P}recs[idx].tConf      = tConf;
   ${P}recs[idx].touched    = false;
   ${P}recs[idx].endT       = iTime(InpSymbol, ${TF}, 0);
   ${P}recs[idx].dead       = false;
   ${P}recs[idx].ageCounter = 0;

   datetime bar1 = iTime(InpSymbol, ${TF}, 1);
   if(tConf == bar1) {
      if(dir == ${P}DIR_BULL) {
         ${P}_bullConfirmed = true;
         ${P}_bullSL        = sl;
         ${P}_bullEntry     = entry;
      } else {
         ${P}_bearConfirmed = true;
         ${P}_bearSL        = sl;
         ${P}_bearEntry     = entry;
      }
   }
}

void ${P}Reset()
{
   ${P}recTotal        = 0;
   ${P}nextId          = 0;
   ${P}pvCount         = 0;
   ${P}_bullConfirmed  = false;
   ${P}_bearConfirmed  = false;
   ${P}_bullSL         = 0.0;
   ${P}_bearSL         = 0.0;
   ${P}_bullEntry      = 0.0;
   ${P}_bearEntry      = 0.0;
}

void ${P}Tick(int scanBars)
{
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   ${P}_bullSL        = 0.0;
   ${P}_bearSL        = 0.0;
   ${P}_bullEntry     = 0.0;
   ${P}_bearEntry     = 0.0;
   ${P}Rebuild(scanBars);
}

bool   ${P}BullJustConfirmed() { return ${P}_bullConfirmed; }
bool   ${P}BearJustConfirmed() { return ${P}_bearConfirmed; }
double ${P}BullConfirmSL()     { return ${P}_bullSL; }
double ${P}BearConfirmSL()     { return ${P}_bearSL; }

bool ${P}HasActiveBull()
{
   for(int i = ${P}recTotal - 1; i >= 0; i--)
      if(!${P}recs[i].dead && ${P}recs[i].dir == ${P}DIR_BULL) return true;
   return false;
}

bool ${P}HasActiveBear()
{
   for(int i = ${P}recTotal - 1; i >= 0; i--)
      if(!${P}recs[i].dead && ${P}recs[i].dir == ${P}DIR_BEAR) return true;
   return false;
}

double ${P}ActiveBullSL()
{
   for(int i = ${P}recTotal - 1; i >= 0; i--)
      if(!${P}recs[i].dead && ${P}recs[i].dir == ${P}DIR_BULL) return ${P}recs[i].sl;
   return 0.0;
}

double ${P}ActiveBearSL()
{
   for(int i = ${P}recTotal - 1; i >= 0; i--)
      if(!${P}recs[i].dead && ${P}recs[i].dir == ${P}DIR_BEAR) return ${P}recs[i].sl;
   return 0.0;
}
`;
}
