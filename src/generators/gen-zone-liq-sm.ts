/**
 * Inline Zone Liquidity Setup State Machine — FVG + OB + BB
 *
 * Lifecycle: detect zone → liquidity (close near, no touch) → tap → reject → entry next open
 *
 * Standard API:
 *   ZLSM_{id}_Reset()
 *   ZLSM_{id}_Tick(lookback)
 *   ZLSM_{id}_BullJustConfirmed()  — entry signal (next bar after tap+reject)
 *   ZLSM_{id}_BearJustConfirmed()
 *   ZLSM_{id}_BullConfirmSL() / BearConfirmSL()
 *   ZLSM_{id}_HasActiveBull() / HasActiveBear() — liquidity built, awaiting tap/reject
 *   ZLSM_{id}_ActiveBullSL() / ActiveBearSL() — SL hint for armed zones
 */

export function genZoneLiqSM(
  id: string,
  TF: string,
  tf: string,
  lookback = 200,
  expiryBars = 200,
  minLiqBars = 1,
  nearATR = 0.2,
  atrPeriod = 14,
  nearPoints = 0,
  dispMult = 1.5,
  obScanBack = 5,
  slBufferPts = 20,
  useFVG = true,
  useOB = true,
  useBB = true,
): string {
  const P = `ZLSM_${id}_`;

  return `
//+------------------------------------------------------------------+
//| Zone Liquidity Setup SM — ${tf} (${id})                         |
//| FVG/OB/BB → liquidity → tap → reject → entry next open          |
//+------------------------------------------------------------------+
#define ${P}DIR_BULL    1
#define ${P}DIR_BEAR   -1
#define ${P}KIND_FVG    0
#define ${P}KIND_OB     1
#define ${P}KIND_BB     2
#define ${P}ST_ACTIVE   0
#define ${P}ST_LIQ      1
#define ${P}ST_TAPPED   2
#define ${P}ST_DONE     3
#define ${P}PHASE_OB    0
#define ${P}PHASE_BB    1
#define ${P}ZONE_MAX    200

struct ${P}ZoneRec
{
   int      kind;
   int      dir;
   int      state;
   int      liqBars;
   double   zoneTop;
   double   zoneBot;
   datetime zoneLeft;
   datetime bornTime;
   double   obHi;
   double   obLo;
   double   obOpen;
   double   obClose;
   int      bbPhase;
   int      age;
   bool     dead;
   bool     pendingBuy;
   bool     pendingSell;
   double   pendingSL;
};

${P}ZoneRec ${P}zones[${P}ZONE_MAX];
int         ${P}zoneCount = 0;
bool        ${P}_seeded    = false;
bool        ${P}_bullConfirmed = false;
bool        ${P}_bearConfirmed = false;
double      ${P}_bullSL = 0.0;
double      ${P}_bearSL = 0.0;

void ${P}Reset()
{
   for(int _oi = ObjectsTotal(0) - 1; _oi >= 0; _oi--)
   {
      string _on = ObjectName(0, _oi);
      if(StringFind(_on, "4B_ZLS_${tf}_") == 0) ObjectDelete(0, _on);
   }
   ${P}zoneCount = 0;
   ${P}_seeded = false;
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   ${P}_bullSL = 0.0;
   ${P}_bearSL = 0.0;
}

double ${P}CalcATR(int sh)
{
   int avail = iBars(InpSymbol, ${TF});
   if(avail < sh + ${atrPeriod} + 2) return 0.0;
   double sum = 0.0;
   for(int k = sh + 1; k <= sh + ${atrPeriod}; k++)
   {
      double h = iHigh(InpSymbol, ${TF}, k), l = iLow(InpSymbol, ${TF}, k);
      double pc = iClose(InpSymbol, ${TF}, k + 1);
      sum += MathMax(h - l, MathMax(MathAbs(h - pc), MathAbs(l - pc)));
   }
   return sum / (double)${atrPeriod};
}

double ${P}NearDist(int sh)
{
   if(${nearPoints} > 0) return ${nearPoints} * _Point;
   return ${nearATR} * ${P}CalcATR(sh);
}

bool ${P}WickTapped(int dir, double hi, double lo, double top, double bot)
{
   if(dir == ${P}DIR_BULL) return lo <= top;
   return hi >= bot;
}

bool ${P}WickInside(double hi, double lo, double top, double bot)
{
   return lo <= top && hi >= bot;
}

bool ${P}ZoneTested(double hi, double lo, double top, double bot)
{
   if(hi < bot || lo > top) return false;
   return true;
}

bool ${P}Rejected(int dir, double cl, double top, double bot)
{
   if(dir == ${P}DIR_BULL) return cl > top;
   return cl < bot;
}

double ${P}SlForZone(int dir, double top, double bot)
{
   double buf = ${slBufferPts} * _Point;
   return (dir == ${P}DIR_BULL) ? bot - buf : top + buf;
}

void ${P}KillZone(int i) { ${P}zones[i].dead = true; }

void ${P}DrawZone(int i)
{
   string nm = StringFormat("4B_ZLS_${tf}_%d", (int)${P}zones[i].zoneLeft);
   color c = (${P}zones[i].dir == ${P}DIR_BULL) ? clrMediumSeaGreen : clrTomato;
   datetime rt = iTime(InpSymbol, ${TF}, 0) + PeriodSeconds(${TF}) * 5;
   if(ObjectFind(0, nm) < 0)
      ObjectCreate(0, nm, OBJ_RECTANGLE, 0, ${P}zones[i].zoneLeft, ${P}zones[i].zoneTop, rt, ${P}zones[i].zoneBot);
   ObjectSetInteger(0, nm, OBJPROP_TIME, 1, rt);
   ObjectSetInteger(0, nm, OBJPROP_COLOR, c);
   ObjectSetInteger(0, nm, OBJPROP_FILL, true);
   ObjectSetInteger(0, nm, OBJPROP_BACK, true);
   ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
}

int ${P}AddZone(int kind, int dir, double top, double bot, datetime leftT, datetime bornT)
{
   for(int i = 0; i < ${P}zoneCount; i++)
      if(!${P}zones[i].dead && ${P}zones[i].kind == kind && ${P}zones[i].zoneLeft == leftT && ${P}zones[i].dir == dir)
         return i;
   int idx = -1;
   for(int i = 0; i < ${P}zoneCount; i++) if(${P}zones[i].dead) { idx = i; break; }
   if(idx < 0 && ${P}zoneCount < ${P}ZONE_MAX) idx = ${P}zoneCount++;
   if(idx < 0) return -1;
   ${P}zones[idx].kind = kind;
   ${P}zones[idx].dir = dir;
   ${P}zones[idx].state = ${P}ST_ACTIVE;
   ${P}zones[idx].liqBars = 0;
   ${P}zones[idx].zoneTop = top;
   ${P}zones[idx].zoneBot = bot;
   ${P}zones[idx].zoneLeft = leftT;
   ${P}zones[idx].bornTime = bornT;
   ${P}zones[idx].bbPhase = ${P}PHASE_OB;
   ${P}zones[idx].age = 0;
   ${P}zones[idx].dead = false;
   ${P}zones[idx].pendingBuy = false;
   ${P}zones[idx].pendingSell = false;
   ${P}zones[idx].pendingSL = 0;
   ${P}DrawZone(idx);
   return idx;
}

void ${P}DetectFVG(int sh)
{
   if(!${useFVG}) return;
   int avail = iBars(InpSymbol, ${TF});
   if(sh + 2 >= avail) return;
   double c1h = iHigh(InpSymbol, ${TF}, sh + 2);
   double c1l = iLow (InpSymbol, ${TF}, sh + 2);
   double c3l = iLow (InpSymbol, ${TF}, sh);
   double c3h = iHigh(InpSymbol, ${TF}, sh);
   datetime t1 = iTime(InpSymbol, ${TF}, sh + 2);
   if(c1h < c3l) ${P}AddZone(${P}KIND_FVG, ${P}DIR_BULL, c3l, c1h, t1, iTime(InpSymbol, ${TF}, sh));
   if(c1l > c3h) ${P}AddZone(${P}KIND_FVG, ${P}DIR_BEAR, c1l, c3h, t1, iTime(InpSymbol, ${TF}, sh));
}

void ${P}DetectOB(int dispShift)
{
   if(!${useOB} && !${useBB}) return;
   if(dispShift < 1) return;
   double atr = ${P}CalcATR(dispShift);
   if(atr <= 0) return;
   double dOpn = iOpen(InpSymbol, ${TF}, dispShift);
   double dCls = iClose(InpSymbol, ${TF}, dispShift);
   if(MathAbs(dCls - dOpn) < ${dispMult} * atr) return;
   int dispDir = (dCls > dOpn) ? ${P}DIR_BULL : ${P}DIR_BEAR;
   int scanEnd = dispShift + ${obScanBack};
   int avail = iBars(InpSymbol, ${TF});
   if(scanEnd >= avail - 1) scanEnd = avail - 2;
   int kind = ${useBB} ? ${P}KIND_BB : ${P}KIND_OB;
   for(int j = dispShift + 1; j <= scanEnd; j++)
   {
      double jOpn = iOpen(InpSymbol, ${TF}, j);
      double jCls = iClose(InpSymbol, ${TF}, j);
      if(dispDir == ${P}DIR_BULL && jCls < jOpn)
      {
         int idx = ${P}AddZone(kind, ${P}DIR_BULL, MathMax(jOpn, jCls), MathMin(jOpn, jCls),
                               iTime(InpSymbol, ${TF}, j), iTime(InpSymbol, ${TF}, dispShift));
         if(idx >= 0)
         {
            ${P}zones[idx].obHi = iHigh(InpSymbol, ${TF}, j);
            ${P}zones[idx].obLo = iLow(InpSymbol, ${TF}, j);
            ${P}zones[idx].obOpen = jOpn;
            ${P}zones[idx].obClose = jCls;
         }
         break;
      }
      if(dispDir == ${P}DIR_BEAR && jCls > jOpn)
      {
         int idx = ${P}AddZone(kind, ${P}DIR_BEAR, MathMax(jOpn, jCls), MathMin(jOpn, jCls),
                               iTime(InpSymbol, ${TF}, j), iTime(InpSymbol, ${TF}, dispShift));
         if(idx >= 0)
         {
            ${P}zones[idx].obHi = iHigh(InpSymbol, ${TF}, j);
            ${P}zones[idx].obLo = iLow(InpSymbol, ${TF}, j);
            ${P}zones[idx].obOpen = jOpn;
            ${P}zones[idx].obClose = jCls;
         }
         break;
      }
   }
}

void ${P}CheckBBBreaks(int sh)
{
   if(!${useBB}) return;
   double cl = iClose(InpSymbol, ${TF}, sh);
   datetime t = iTime(InpSymbol, ${TF}, sh);
   for(int i = 0; i < ${P}zoneCount; i++)
   {
      if(${P}zones[i].dead || ${P}zones[i].kind != ${P}KIND_BB || ${P}zones[i].bbPhase != ${P}PHASE_OB) continue;
      if(${P}zones[i].bornTime >= t) continue;
      bool broke = false;
      int newDir = ${P}zones[i].dir;
      if(${P}zones[i].dir == ${P}DIR_BULL && cl < ${P}zones[i].obLo) { broke = true; newDir = ${P}DIR_BEAR; }
      else if(${P}zones[i].dir == ${P}DIR_BEAR && cl > ${P}zones[i].obHi) { broke = true; newDir = ${P}DIR_BULL; }
      if(!broke) continue;
      ${P}zones[i].dir = newDir;
      ${P}zones[i].zoneTop = MathMax(${P}zones[i].obOpen, ${P}zones[i].obClose);
      ${P}zones[i].zoneBot = MathMin(${P}zones[i].obOpen, ${P}zones[i].obClose);
      ${P}zones[i].bbPhase = ${P}PHASE_BB;
      ${P}zones[i].state = ${P}ST_ACTIVE;
      ${P}zones[i].liqBars = 0;
      ${P}zones[i].age = 0;
      ${P}DrawZone(i);
   }
}

bool ${P}LiqBarClose(int dir, double hi, double lo, double cl, double top, double bot, double near)
{
   if(near <= 0) return false;
   if(${P}WickTapped(dir, hi, lo, top, bot) || ${P}WickInside(hi, lo, top, bot)) return false;
   if(dir == ${P}DIR_BULL) { if(cl < top) return false; return (cl - top) <= near; }
   if(cl > bot) return false;
   return (bot - cl) <= near;
}

void ${P}ProcessZoneBar(int i, int sh)
{
   if(${P}zones[i].dead || ${P}zones[i].state == ${P}ST_DONE) return;
   if(${P}zones[i].bornTime >= iTime(InpSymbol, ${TF}, sh)) return;

   double hi = iHigh(InpSymbol, ${TF}, sh);
   double lo = iLow(InpSymbol, ${TF}, sh);
   double cl = iClose(InpSymbol, ${TF}, sh);
   double top = ${P}zones[i].zoneTop;
   double bot = ${P}zones[i].zoneBot;
   int dir = ${P}zones[i].dir;
   double near = ${P}NearDist(sh);

   if(${P}ZoneTested(hi, lo, top, bot))
   {
      bool hadLiq = (${P}zones[i].state >= ${P}ST_LIQ);
      bool reject = hadLiq && ${P}Rejected(dir, cl, top, bot);
      if(reject)
      {
         double sl = ${P}SlForZone(dir, top, bot);
         if(dir == ${P}DIR_BULL) { ${P}zones[i].pendingBuy = true; ${P}zones[i].pendingSL = sl; }
         else { ${P}zones[i].pendingSell = true; ${P}zones[i].pendingSL = sl; }
         PrintFormat("[ZLSM_${tf}] %s test+reject | SL=%.5f", dir == ${P}DIR_BULL ? "BULL" : "BEAR", sl);
      }
      ${P}KillZone(i);
      return;
   }

   ${P}DrawZone(i);

   if(${P}zones[i].state == ${P}ST_ACTIVE || ${P}zones[i].state == ${P}ST_LIQ)
   {
      if(${P}LiqBarClose(dir, hi, lo, cl, top, bot, near))
      {
         ${P}zones[i].liqBars++;
         if(${P}zones[i].liqBars >= ${minLiqBars}) ${P}zones[i].state = ${P}ST_LIQ;
      }
   }
}

void ${P}EmitPending()
{
   for(int i = 0; i < ${P}zoneCount; i++)
   {
      if(${P}zones[i].pendingBuy)
      {
         ${P}_bullConfirmed = true;
         ${P}_bullSL = ${P}zones[i].pendingSL;
         ${P}zones[i].pendingBuy = false;
      }
      if(${P}zones[i].pendingSell)
      {
         ${P}_bearConfirmed = true;
         ${P}_bearSL = ${P}zones[i].pendingSL;
         ${P}zones[i].pendingSell = false;
      }
   }
}

void ${P}AgeZones()
{
   if(${expiryBars} <= 0) return;
   for(int i = 0; i < ${P}zoneCount; i++)
   {
      if(${P}zones[i].dead || ${P}zones[i].state == ${P}ST_DONE) continue;
      ${P}zones[i].age++;
      if(${P}zones[i].age >= ${expiryBars}) ${P}KillZone(i);
   }
}

void ${P}ProcessBar(int sh)
{
   ${P}DetectOB(sh);
   ${P}CheckBBBreaks(sh);
   ${P}DetectFVG(sh);
   for(int i = 0; i < ${P}zoneCount; i++) ${P}ProcessZoneBar(i, sh);
   ${P}AgeZones();
}

void ${P}Tick(int lookback)
{
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   int scan = MathMin(lookback, iBars(InpSymbol, ${TF}) - ${obScanBack} - 3);
   if(scan < 2) scan = 2;
   if(!${P}_seeded)
   {
      for(int sh = scan; sh >= 2; sh--) ${P}ProcessBar(sh);
      ${P}_seeded = true;
   }
   ${P}ProcessBar(1);
   ${P}EmitPending();
}

bool   ${P}BullJustConfirmed() { return ${P}_bullConfirmed; }
bool   ${P}BearJustConfirmed() { return ${P}_bearConfirmed; }
double ${P}BullConfirmSL()     { return ${P}_bullSL; }
double ${P}BearConfirmSL()     { return ${P}_bearSL; }

bool ${P}IsArmed(int i)
{
   if(${P}zones[i].dead) return false;
   if(${P}zones[i].state != ${P}ST_ACTIVE && ${P}zones[i].state != ${P}ST_LIQ) return false;
   return true;
}

bool ${P}HasActiveBull()
{
   for(int i = 0; i < ${P}zoneCount; i++)
      if(${P}zones[i].dir == ${P}DIR_BULL && ${P}IsArmed(i)) return true;
   return false;
}

bool ${P}HasActiveBear()
{
   for(int i = 0; i < ${P}zoneCount; i++)
      if(${P}zones[i].dir == ${P}DIR_BEAR && ${P}IsArmed(i)) return true;
   return false;
}

double ${P}ActiveBullSL()
{
   for(int i = 0; i < ${P}zoneCount; i++)
      if(${P}zones[i].dir == ${P}DIR_BULL && ${P}IsArmed(i))
         return ${P}SlForZone(${P}DIR_BULL, ${P}zones[i].zoneTop, ${P}zones[i].zoneBot);
   return 0.0;
}

double ${P}ActiveBearSL()
{
   for(int i = 0; i < ${P}zoneCount; i++)
      if(${P}zones[i].dir == ${P}DIR_BEAR && ${P}IsArmed(i))
         return ${P}SlForZone(${P}DIR_BEAR, ${P}zones[i].zoneTop, ${P}zones[i].zoneBot);
   return 0.0;
}
`;
}
