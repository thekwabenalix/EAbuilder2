/**
 * Shared SNRC2 pattern-detection MQL5 core for the standalone detector and inline SM.
 * All globals and functions are prefixed via `p` (empty string for the detector).
 */

export type Snrc2CoreOpts = {
  /** Variable/function prefix, e.g. "SNRC2SM_H1_" or "" for detector. */
  p: string;
  sym: string;
  tf: string;
  htf: string;
  lookback: string;
  swingStrength: string;
  htfLookback: string;
  expiryBars: string;
  draw: string;
  objPrefix: string;
  showLog: string;
};

export function emitSnrc2Core(o: Snrc2CoreOpts): string {
  const {
    p,
    sym,
    tf,
    htf,
    lookback,
    swingStrength,
    htfLookback,
    expiryBars,
    draw,
    objPrefix,
    showLog,
  } = o;

  return `
#define ${p}DIR_BULL    1
#define ${p}DIR_BEAR   -1
#define ${p}PV_HIGH     1
#define ${p}PV_LOW     -1
#define ${p}MAX_PIV     400
#define ${p}MAX_REC     600

int      ${p}pvType[${p}MAX_PIV];
double   ${p}pvPrice[${p}MAX_PIV];
datetime ${p}pvTime[${p}MAX_PIV];
int      ${p}pvCount = 0;

struct ${p}Rec
{
   int      id;
   int      dir;
   double   entry;
   double   sl;
   double   secondExt;
   double   contExt;
   double   resLevel;
   datetime t1;
   datetime tRes;
   datetime tManip;
   datetime tConf;
   bool     touched;
   datetime endT;
   bool     dead;
   int      ageCounter;
};

${p}Rec      ${p}recs[${p}MAX_REC];
int          ${p}recTotal = 0;
int          ${p}nextId    = 0;

bool ${p}IsPivotHigh(int sh, int k)
{
   double h = iHigh(${sym}, ${tf}, sh);
   for(int j = 1; j <= k; j++) {
      if(iHigh(${sym}, ${tf}, sh + j) >= h) return false;
      if(iHigh(${sym}, ${tf}, sh - j) >= h) return false;
   }
   return true;
}
bool ${p}IsPivotLow(int sh, int k)
{
   double l = iLow(${sym}, ${tf}, sh);
   for(int j = 1; j <= k; j++) {
      if(iLow(${sym}, ${tf}, sh + j) <= l) return false;
      if(iLow(${sym}, ${tf}, sh - j) <= l) return false;
   }
   return true;
}

void ${p}BuildPivots()
{
   ${p}pvCount = 0;
   int k = MathMax(1, ${swingStrength});
   int avail = iBars(${sym}, ${tf});
   int hi = MathMin(${lookback}, avail - 1 - k);

   for(int sh = hi; sh >= k + 1; sh--)
   {
      bool ph = ${p}IsPivotHigh(sh, k);
      bool pl = ${p}IsPivotLow(sh, k);
      if(!ph && !pl) continue;

      int    typ = ph ? ${p}PV_HIGH : ${p}PV_LOW;
      double prc = ph ? iHigh(${sym}, ${tf}, sh) : iLow(${sym}, ${tf}, sh);
      datetime tm = iTime(${sym}, ${tf}, sh);

      if(${p}pvCount == 0) {
         ${p}pvType[0] = typ; ${p}pvPrice[0] = prc; ${p}pvTime[0] = tm; ${p}pvCount = 1;
         continue;
      }
      int last = ${p}pvCount - 1;
      if(${p}pvType[last] == typ) {
         bool replace = (typ == ${p}PV_HIGH) ? (prc > ${p}pvPrice[last]) : (prc < ${p}pvPrice[last]);
         if(replace) { ${p}pvPrice[last] = prc; ${p}pvTime[last] = tm; }
      } else if(${p}pvCount < ${p}MAX_PIV) {
         ${p}pvType[${p}pvCount] = typ; ${p}pvPrice[${p}pvCount] = prc; ${p}pvTime[${p}pvCount] = tm; ${p}pvCount++;
      }
   }
}

string ${p}ObjEntry(int id) { return "${objPrefix}" + IntegerToString(id) + "_e"; }
string ${p}ObjSL(int id)    { return "${objPrefix}" + IntegerToString(id) + "_sl"; }

void ${p}KillRec(int i)
{
   if(${draw}) {
      ObjectDelete(0, ${p}ObjEntry(${p}recs[i].id));
      ObjectDelete(0, ${p}ObjSL(${p}recs[i].id));
   }
   ${p}recs[i].dead = true;
}

bool ${p}StrongEngulf(ENUM_TIMEFRAMES _tf, int e, int dir)
{
   int avail = iBars(${sym}, _tf);
   if(e + 1 >= avail) return false;
   double c2o = iOpen (${sym}, _tf, e);
   double c2c = iClose(${sym}, _tf, e);
   double c1o = iOpen (${sym}, _tf, e + 1);
   double c1c = iClose(${sym}, _tf, e + 1);
   double c1h = iHigh (${sym}, _tf, e + 1);
   double c1l = iLow  (${sym}, _tf, e + 1);
   if(dir == ${p}DIR_BULL) return (c1c < c1o) && (c2c > c2o) && (c2c > c1h);
   return (c1c > c1o) && (c2c < c2o) && (c2c < c1l);
}

double ${p}ClassicLevel(datetime pivT, int dir)
{
   int pBar = iBarShift(${sym}, ${tf}, pivT);
   if(pBar < 1) return 0.0;
   int hiS = pBar + 3;
   int loS = MathMax(1, pBar - 1);
   for(int s = hiS; s >= loS; s--)
   {
      if(s - 1 < 0) continue;
      bool aBull = iClose(${sym}, ${tf}, s)   > iOpen(${sym}, ${tf}, s);
      bool aBear = iClose(${sym}, ${tf}, s)   < iOpen(${sym}, ${tf}, s);
      bool bBull = iClose(${sym}, ${tf}, s-1) > iOpen(${sym}, ${tf}, s-1);
      bool bBear = iClose(${sym}, ${tf}, s-1) < iOpen(${sym}, ${tf}, s-1);
      if(dir == ${p}DIR_BEAR && aBull && bBear) return iClose(${sym}, ${tf}, s);
      if(dir == ${p}DIR_BULL && aBear && bBull) return iClose(${sym}, ${tf}, s);
   }
   return 0.0;
}

bool ${p}HtfEngulfingPresent(int dir, datetime tPatternStart)
{
   int e0 = iBarShift(${sym}, ${htf}, tPatternStart);
   if(e0 < 0) return false;
   for(int e = e0; e <= e0 + ${htfLookback}; e++)
      if(${p}StrongEngulf(${htf}, e, dir)) return true;
   return false;
}

void ${p}Detect()
{
   for(int i = 0; i + 5 < ${p}pvCount; i++)
   {
      if(${p}pvType[i]   == ${p}PV_HIGH && ${p}pvType[i+1] == ${p}PV_LOW  &&
         ${p}pvType[i+2] == ${p}PV_HIGH && ${p}pvType[i+3] == ${p}PV_LOW  &&
         ${p}pvType[i+4] == ${p}PV_HIGH && ${p}pvType[i+5] == ${p}PV_LOW)
      {
         double L1 = ${p}pvPrice[i+1], L2 = ${p}pvPrice[i+3],
                H2 = ${p}pvPrice[i+4], L3 = ${p}pvPrice[i+5];
         double res   = ${p}ClassicLevel(${p}pvTime[i],   ${p}DIR_BEAR);
         double entry = ${p}ClassicLevel(${p}pvTime[i+1], ${p}DIR_BULL);
         if(res > 0.0 && entry > 0.0 && L2 < L1 && L3 < L2 && H2 > entry && H2 < res
            && ${p}HtfEngulfingPresent(${p}DIR_BEAR, ${p}pvTime[i+1]))
            ${p}AddRec(${p}DIR_BEAR, entry, H2, L2, L3, res,
                   ${p}pvTime[i+1], ${p}pvTime[i], ${p}pvTime[i+4], ${p}pvTime[i+5]);
      }
      if(${p}pvType[i]   == ${p}PV_LOW  && ${p}pvType[i+1] == ${p}PV_HIGH &&
         ${p}pvType[i+2] == ${p}PV_LOW  && ${p}pvType[i+3] == ${p}PV_HIGH &&
         ${p}pvType[i+4] == ${p}PV_LOW  && ${p}pvType[i+5] == ${p}PV_HIGH)
      {
         double R1 = ${p}pvPrice[i+1], R2 = ${p}pvPrice[i+3],
                ML = ${p}pvPrice[i+4], R3 = ${p}pvPrice[i+5];
         double sup   = ${p}ClassicLevel(${p}pvTime[i],   ${p}DIR_BULL);
         double entry = ${p}ClassicLevel(${p}pvTime[i+1], ${p}DIR_BEAR);
         if(sup > 0.0 && entry > 0.0 && R2 > R1 && R3 > R2 && ML < entry && ML > sup
            && ${p}HtfEngulfingPresent(${p}DIR_BULL, ${p}pvTime[i+1]))
            ${p}AddRec(${p}DIR_BULL, entry, ML, R2, R3, sup,
                   ${p}pvTime[i+1], ${p}pvTime[i], ${p}pvTime[i+4], ${p}pvTime[i+5]);
      }
   }
}

void ${p}Maintain(int sh)
{
   datetime t  = iTime(${sym}, ${tf}, sh);
   double   bl = iLow (${sym}, ${tf}, sh);
   double   bh = iHigh(${sym}, ${tf}, sh);
   for(int i = 0; i < ${p}recTotal; i++) {
      if(${p}recs[i].dead) continue;
      if(${p}recs[i].tConf >= t) continue;

      if(!${p}recs[i].touched) {
         bool touched = (${p}recs[i].dir == ${p}DIR_BEAR) ? (bh >= ${p}recs[i].entry)
                                                          : (bl <= ${p}recs[i].entry);
         ${p}recs[i].endT = t;
         if(touched) ${p}recs[i].touched = true;
      }

      if(${p}recs[i].dir == ${p}DIR_BEAR && bh >= ${p}recs[i].sl) {
         ${p}KillRec(i);
         continue;
      }
      if(${p}recs[i].dir == ${p}DIR_BULL && bl <= ${p}recs[i].sl) {
         ${p}KillRec(i);
         continue;
      }

      ${p}recs[i].ageCounter++;
      if(${p}recs[i].ageCounter >= ${expiryBars}) ${p}KillRec(i);
   }
}

void ${p}Rebuild(int scanBars)
{
   if(${draw}) ObjectsDeleteAll(0, "${objPrefix}");
   ${p}recTotal = 0; ${p}nextId = 0;
   ${p}BuildPivots();
   ${p}Detect();
   int scan = MathMin(scanBars, iBars(${sym}, ${tf}) - 2);
   for(int sh = scan; sh >= 1; sh--) ${p}Maintain(sh);
}
`;
}
