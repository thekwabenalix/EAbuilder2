/**
 * Inline QM_MEF (Quasimodo Manipulation Entry Formula) State Machine Generator
 *
 * HTF strong engulfing → LTF close-based Quasimodo → left shoulder entry.
 * Optional Gap SNR / RBR / DBD confluence near the left shoulder.
 *
 * Standard API:
 *   QMMEFSM_{id}_Reset()
 *   QMMEFSM_{id}_Tick(lookback)
 *   QMMEFSM_{id}_BullJustConfirmed() / BearJustConfirmed()  — LS touched this bar
 *   QMMEFSM_{id}_BullConfirmSL() / BearConfirmSL()          — beyond head
 *   QMMEFSM_{id}_HasActiveBull() / HasActiveBear()        — live QM awaiting LS retest
 *   QMMEFSM_{id}_ActiveBullSL() / ActiveBearSL()
 */

export function genQmMefSM(
  id: string,
  mainTF: string,
  tf: string,
  qmTF: string,
  confTF: string,
  lookback = 300,
  expiryBars = 150,
  impulseRatio = 0.5,
  baseMaxRatio = 0.5,
  maxBaseCandles = 6,
  legBaseMult = 1.3,
  confTolFrac = 0.3,
): string {
  const P = `QMMEFSM_${id}_`;

  return `
//+------------------------------------------------------------------+
//| QM_MEF State Machine — ${tf} HTF (${id})                           |
//| HTF engulfing → LTF Quasimodo → left shoulder entry             |
//+------------------------------------------------------------------+
#define ${P}DIR_BULL  1
#define ${P}DIR_BEAR -1
#define ${P}CONF_NONE 0
#define ${P}CONF_GAP  1
#define ${P}CONF_RBR  2
#define ${P}CONF_DBD  3

struct ${P}QmRec
{
   int      dir;
   double   engHi;
   double   engLo;
   datetime engTime;
   datetime engEnd;
   double   lsLevel;
   double   headLevel;
   double   pbLevel;
   double   confirmLevel;
   int      conf;
   bool     strong;
   bool     lsTouched;
   bool     dead;
   int      ageCounter;
};

#define ${P}MAX_QM 120
${P}QmRec ${P}qms[${P}MAX_QM];
int       ${P}qmCount = 0;
bool      ${P}_bullConfirmed = false;
bool      ${P}_bearConfirmed = false;
double    ${P}_bullSL = 0.0;
double    ${P}_bearSL = 0.0;

void ${P}Reset()
{
   ${P}qmCount = 0;
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   ${P}_bullSL = 0.0;
   ${P}_bearSL = 0.0;
}

double ${P}BR(ENUM_TIMEFRAMES _tf, int sh)
{
   double o = iOpen (InpSymbol, _tf, sh);
   double c = iClose(InpSymbol, _tf, sh);
   double r = iHigh (InpSymbol, _tf, sh) - iLow(InpSymbol, _tf, sh);
   if(r <= 0.0) return 0.0;
   return MathAbs(c - o) / r;
}
double ${P}RNG (ENUM_TIMEFRAMES _tf, int sh) { return iHigh(InpSymbol, _tf, sh) - iLow(InpSymbol, _tf, sh); }
bool   ${P}BULL(ENUM_TIMEFRAMES _tf, int sh) { return iClose(InpSymbol, _tf, sh) > iOpen(InpSymbol, _tf, sh); }
bool   ${P}BEAR(ENUM_TIMEFRAMES _tf, int sh) { return iClose(InpSymbol, _tf, sh) < iOpen(InpSymbol, _tf, sh); }
bool   ${P}STRONG(ENUM_TIMEFRAMES _tf, int sh) { return ${P}BR(_tf, sh) >= ${impulseRatio}; }
bool   ${P}SMALL (ENUM_TIMEFRAMES _tf, int sh) { return ${P}BR(_tf, sh) <= ${baseMaxRatio}; }

bool ${P}DetectQM(int dir, datetime wStart, datetime wEnd,
                double &lsLevel, double &confirmLevel, double &headLevel, double &pbLevel)
{
   int shOld = iBarShift(InpSymbol, ${qmTF}, wStart);
   int shNew = iBarShift(InpSymbol, ${qmTF}, wEnd);
   if(shOld < 0 || shNew < 0) return false;
   int n = shOld - shNew + 1;
   if(n < 4 || n > 1000) return false;

   if(dir == ${P}DIR_BULL)
   {
      int pLL = -1; double minC = 1e18;
      for(int i = 0; i < n; i++) {
         double c = iClose(InpSymbol, ${qmTF}, shOld - i);
         if(c < minC) { minC = c; pLL = i; }
      }
      if(pLL < 2) return false;
      int pPBH = -1; double maxC = -1e18;
      for(int i = 0; i < pLL; i++) {
         double c = iClose(InpSymbol, ${qmTF}, shOld - i);
         if(c > maxC) { maxC = c; pPBH = i; }
      }
      if(pPBH < 1) return false;
      int pLS = -1; double minLS = 1e18;
      for(int i = 0; i < pPBH; i++) {
         double c = iClose(InpSymbol, ${qmTF}, shOld - i);
         if(c < minLS) { minLS = c; pLS = i; }
      }
      if(pLS < 0) return false;
      if(!(minC < minLS)) return false;
      if(!(maxC > minLS)) return false;
      int q = -1;
      for(int i = pLL + 1; i < n; i++)
         if(iClose(InpSymbol, ${qmTF}, shOld - i) > maxC) { q = i; break; }
      if(q < 0) return false;

      lsLevel      = minLS;
      confirmLevel = iClose(InpSymbol, ${qmTF}, shOld - q);
      headLevel    = minC;
      pbLevel      = maxC;
      return true;
   }
   else
   {
      int pHH = -1; double maxC = -1e18;
      for(int i = 0; i < n; i++) {
         double c = iClose(InpSymbol, ${qmTF}, shOld - i);
         if(c > maxC) { maxC = c; pHH = i; }
      }
      if(pHH < 2) return false;
      int pPBL = -1; double minC = 1e18;
      for(int i = 0; i < pHH; i++) {
         double c = iClose(InpSymbol, ${qmTF}, shOld - i);
         if(c < minC) { minC = c; pPBL = i; }
      }
      if(pPBL < 1) return false;
      int pLS = -1; double maxLS = -1e18;
      for(int i = 0; i < pPBL; i++) {
         double c = iClose(InpSymbol, ${qmTF}, shOld - i);
         if(c > maxLS) { maxLS = c; pLS = i; }
      }
      if(pLS < 0) return false;
      if(!(maxC > maxLS)) return false;
      if(!(minC < maxLS)) return false;
      int q = -1;
      for(int i = pHH + 1; i < n; i++)
         if(iClose(InpSymbol, ${qmTF}, shOld - i) < minC) { q = i; break; }
      if(q < 0) return false;

      lsLevel      = maxLS;
      confirmLevel = iClose(InpSymbol, ${qmTF}, shOld - q);
      headLevel    = maxC;
      pbLevel      = minC;
      return true;
   }
}

double ${P}FindGapSnrNear(int dir, datetime wStart, datetime wEnd, double level, double tol)
{
   int shOld = iBarShift(InpSymbol, ${confTF}, wStart);
   int shNew = iBarShift(InpSymbol, ${confTF}, wEnd);
   if(shOld < 1 || shNew < 0) return 0.0;
   for(int a = shOld; a >= shNew + 1; a--)
   {
      int b = a - 1;
      if(b < 0) break;
      datetime tA = iTime(InpSymbol, ${confTF}, a);
      datetime tB = iTime(InpSymbol, ${confTF}, b);
      if(tA < wStart || tB > wEnd) continue;
      bool match = (dir == ${P}DIR_BULL) ? (${P}BULL(${confTF}, a) && ${P}BULL(${confTF}, b))
                                         : (${P}BEAR(${confTF}, a) && ${P}BEAR(${confTF}, b));
      if(!match) continue;
      double lvl = iClose(InpSymbol, ${confTF}, a);
      if(MathAbs(lvl - level) <= tol) return lvl;
   }
   return 0.0;
}

bool ${P}FindRbrDbdNear(int dir, datetime wStart, datetime wEnd, double level, double tol,
                       double &outHi, double &outLo)
{
   int avail = iBars(InpSymbol, ${confTF});
   int shOld = iBarShift(InpSymbol, ${confTF}, wStart);
   int shNew = iBarShift(InpSymbol, ${confTF}, wEnd);
   if(shOld < 0 || shNew < 0) return false;

   for(int b = shNew; b <= shOld; b++)
   {
      if(b + 2 >= avail) continue;
      datetime tb = iTime(InpSymbol, ${confTF}, b);
      if(tb < wStart || tb > wEnd) continue;
      if(!${P}STRONG(${confTF}, b)) continue;
      if(dir == ${P}DIR_BULL && !${P}BULL(${confTF}, b)) continue;
      if(dir == ${P}DIR_BEAR && !${P}BEAR(${confTF}, b)) continue;

      int baseLen = 0;
      while(baseLen < ${maxBaseCandles}
            && (b + 1 + baseLen) < avail
            && ${P}SMALL(${confTF}, b + 1 + baseLen))
         baseLen++;
      if(baseLen < 1) continue;
      int legIn = b + 1 + baseLen;
      if(legIn >= avail) continue;
      if(!${P}STRONG(${confTF}, legIn)) continue;
      if(dir == ${P}DIR_BULL && !${P}BULL(${confTF}, legIn)) continue;
      if(dir == ${P}DIR_BEAR && !${P}BEAR(${confTF}, legIn)) continue;

      double bHi = -1.0, bLo = 1e18, sumR = 0.0;
      for(int k = 0; k < baseLen; k++) {
         int bb = b + 1 + k;
         double h = iHigh(InpSymbol, ${confTF}, bb);
         double l = iLow (InpSymbol, ${confTF}, bb);
         if(h > bHi) bHi = h;
         if(l < bLo) bLo = l;
         sumR += (h - l);
      }
      double avgR = sumR / baseLen;
      if(avgR <= 0.0) continue;
      if(${P}RNG(${confTF}, b)     < ${legBaseMult} * avgR) continue;
      if(${P}RNG(${confTF}, legIn) < ${legBaseMult} * avgR) continue;
      double lc = iClose(InpSymbol, ${confTF}, b);
      if(dir == ${P}DIR_BULL && lc <= bHi) continue;
      if(dir == ${P}DIR_BEAR && lc >= bLo) continue;
      if(level < bLo - tol || level > bHi + tol) continue;

      outHi = bHi; outLo = bLo;
      return true;
   }
   return false;
}

void ${P}DetectQmMef(int s)
{
   int avail = iBars(InpSymbol, ${mainTF});
   if(s + 1 >= avail) return;

   double c2o = iOpen (InpSymbol, ${mainTF}, s);
   double c2c = iClose(InpSymbol, ${mainTF}, s);
   double c2h = iHigh (InpSymbol, ${mainTF}, s);
   double c2l = iLow  (InpSymbol, ${mainTF}, s);
   double c1o = iOpen (InpSymbol, ${mainTF}, s + 1);
   double c1c = iClose(InpSymbol, ${mainTF}, s + 1);
   double c1h = iHigh (InpSymbol, ${mainTF}, s + 1);
   double c1l = iLow  (InpSymbol, ${mainTF}, s + 1);

   bool isBull = (c1c < c1o) && (c2c > c2o) && (c2c > c1h);
   bool isBear = (c1c > c1o) && (c2c < c2o) && (c2c < c1l);
   if(!isBull && !isBear) return;
   int dir = isBull ? ${P}DIR_BULL : ${P}DIR_BEAR;

   datetime engTime = iTime(InpSymbol, ${mainTF}, s + 1);
   datetime engEnd  = iTime(InpSymbol, ${mainTF}, s) + PeriodSeconds(${mainTF});

   for(int _k = 0; _k < ${P}qmCount; _k++)
      if(!${P}qms[_k].dead && ${P}qms[_k].engTime == engTime) return;

   double lsLevel = 0.0, confirmLevel = 0.0, headLevel = 0.0, pbLevel = 0.0;
   if(!${P}DetectQM(dir, engTime, engEnd, lsLevel, confirmLevel, headLevel, pbLevel)) return;

   double tol = MathAbs(confirmLevel - lsLevel) * ${confTolFrac};
   if(tol <= 0.0) tol = (c2h - c2l) * ${confTolFrac};
   int conf = ${P}CONF_NONE;
   double confGap = 0.0, baseHi = 0.0, baseLo = 0.0;
   double g = ${P}FindGapSnrNear(dir, engTime, engEnd, lsLevel, tol);
   if(g != 0.0) conf = ${P}CONF_GAP;
   else if(${P}FindRbrDbdNear(dir, engTime, engEnd, lsLevel, tol, baseHi, baseLo))
      conf = (dir == ${P}DIR_BULL) ? ${P}CONF_RBR : ${P}CONF_DBD;

   int idx = -1;
   for(int _k = 0; _k < ${P}qmCount; _k++)
      if(${P}qms[_k].dead) { idx = _k; break; }
   if(idx < 0 && ${P}qmCount < ${P}MAX_QM) idx = ${P}qmCount++;
   if(idx < 0) return;

   ${P}qms[idx].dir          = dir;
   ${P}qms[idx].engHi        = c2h;
   ${P}qms[idx].engLo        = c2l;
   ${P}qms[idx].engTime      = engTime;
   ${P}qms[idx].engEnd       = engEnd;
   ${P}qms[idx].lsLevel      = lsLevel;
   ${P}qms[idx].headLevel    = headLevel;
   ${P}qms[idx].pbLevel      = pbLevel;
   ${P}qms[idx].confirmLevel = confirmLevel;
   ${P}qms[idx].conf         = conf;
   ${P}qms[idx].strong       = (conf != ${P}CONF_NONE);
   ${P}qms[idx].lsTouched    = false;
   ${P}qms[idx].dead         = false;
   ${P}qms[idx].ageCounter   = 0;
}

void ${P}Maintain(int s)
{
   datetime t  = iTime (InpSymbol, ${mainTF}, s);
   double   cl = iClose(InpSymbol, ${mainTF}, s);
   double   bl = iLow  (InpSymbol, ${mainTF}, s);
   double   bh = iHigh (InpSymbol, ${mainTF}, s);

   for(int i = 0; i < ${P}qmCount; i++)
   {
      if(${P}qms[i].dead) continue;
      if(${P}qms[i].engEnd >= t) continue;

      if(!${P}qms[i].lsTouched) {
         bool touched = (${P}qms[i].dir == ${P}DIR_BULL) ? (bl <= ${P}qms[i].lsLevel)
                                                        : (bh >= ${P}qms[i].lsLevel);
         if(touched) {
            ${P}qms[i].lsTouched = true;
            if(s == 1) {
               if(${P}qms[i].dir == ${P}DIR_BULL) {
                  ${P}_bullConfirmed = true;
                  ${P}_bullSL = ${P}qms[i].headLevel;
               } else {
                  ${P}_bearConfirmed = true;
                  ${P}_bearSL = ${P}qms[i].headLevel;
               }
            }
         }
      }

      if(${P}qms[i].dir == ${P}DIR_BULL && cl < ${P}qms[i].headLevel) {
         ${P}qms[i].dead = true;
         continue;
      }
      if(${P}qms[i].dir == ${P}DIR_BEAR && cl > ${P}qms[i].headLevel) {
         ${P}qms[i].dead = true;
         continue;
      }

      ${P}qms[i].ageCounter++;
      if(${P}qms[i].ageCounter >= ${expiryBars}) ${P}qms[i].dead = true;
   }
}

void ${P}Tick(int scanBars)
{
   ${P}Reset();
   int scan = (int)MathMin((long)scanBars, (long)(iBars(InpSymbol, ${mainTF}) - 2));
   if(scan < 2) return;
   for(int s = scan; s >= 1; s--) {
      ${P}DetectQmMef(s);
      ${P}Maintain(s);
   }
}

bool   ${P}BullJustConfirmed() { return ${P}_bullConfirmed; }
bool   ${P}BearJustConfirmed() { return ${P}_bearConfirmed; }
double ${P}BullConfirmSL()     { return ${P}_bullSL; }
double ${P}BearConfirmSL()     { return ${P}_bearSL; }

bool ${P}HasActiveBull()
{
   for(int i = ${P}qmCount - 1; i >= 0; i--)
      if(!${P}qms[i].dead && !${P}qms[i].lsTouched && ${P}qms[i].dir == ${P}DIR_BULL) return true;
   return false;
}

bool ${P}HasActiveBear()
{
   for(int i = ${P}qmCount - 1; i >= 0; i--)
      if(!${P}qms[i].dead && !${P}qms[i].lsTouched && ${P}qms[i].dir == ${P}DIR_BEAR) return true;
   return false;
}

double ${P}ActiveBullSL()
{
   for(int i = ${P}qmCount - 1; i >= 0; i--)
      if(!${P}qms[i].dead && !${P}qms[i].lsTouched && ${P}qms[i].dir == ${P}DIR_BULL)
         return ${P}qms[i].headLevel;
   return 0.0;
}

double ${P}ActiveBearSL()
{
   for(int i = ${P}qmCount - 1; i >= 0; i--)
      if(!${P}qms[i].dead && !${P}qms[i].lsTouched && ${P}qms[i].dir == ${P}DIR_BEAR)
         return ${P}qms[i].headLevel;
   return 0.0;
}
`;
}
