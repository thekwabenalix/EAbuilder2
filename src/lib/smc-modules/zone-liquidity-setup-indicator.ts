/**
 * Unified Zone Liquidity Setup — FVG + OB + Breaker Block
 *
 * Unified FVG + OB + BB liquidity — same semantics as the three liquidity detectors.
 * Fresh zones: removed when the near edge is touched (not full-box overlap).
 */

export const ZONE_LIQ_SETUP_VERSION = "1.2.0";
export const ZONE_LIQ_SETUP_MODULE = "Zone_Liquidity_Setup";

export function generateZoneLiquiditySetupIndicator(): string {
  return `//+------------------------------------------------------------------+
//| Zone_Liquidity_Setup.mq5                                       |
//| Unified FVG + OB + BB liquidity setup v${ZONE_LIQ_SETUP_VERSION}          |
//|                                                                  |
//| Liquidity build → tap zone → reject close → entry next open   |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SMC Setup"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_buffers 4
#property indicator_plots   2

#property indicator_label1  "Buy setup"
#property indicator_type1   DRAW_ARROW
#property indicator_color1  clrDodgerBlue
#property indicator_width1  2

#property indicator_label2  "Sell setup"
#property indicator_type2   DRAW_ARROW
#property indicator_color2  clrOrangeRed
#property indicator_width2  2

double BullSetupBuf[];
double BearSetupBuf[];
double BullSLBuf[];
double BearSLBuf[];

#define DIR_BULL    1
#define DIR_BEAR   -1
#define KIND_FVG    0
#define KIND_OB     1
#define KIND_BB     2
#define ST_ACTIVE   0
#define ST_LIQ      1
#define ST_TAPPED   2
#define ST_DONE     3
#define PHASE_OB    0
#define PHASE_BB    1
#define ZONE_MAX    400
#define OBJ_PREFIX  "ZLS_"

input ENUM_TIMEFRAMES InpTF           = PERIOD_CURRENT;
input int             InpLookback     = 500;
input bool            InpUseFVG       = true;
input bool            InpUseOB        = true;
input bool            InpUseBB        = true;
input double          InpDispMult     = 1.5;
input int             InpObScanBack   = 5;
input double          InpNearATR      = 0.20;
input int             InpATRPeriod    = 14;
input int             InpNearPoints   = 0;
input int             InpMinLiqBars   = 1;
input int             InpSlBufferPts  = 20;
input int             InpExpiryBars   = 200;
input bool            InpDrawZones    = true;
input bool            InpDrawLabels   = true;
input string          InpLabelFVG     = "FLq";
input string          InpLabelOB      = "OLq";
input string          InpLabelBB      = "BLq";
input int             InpFontSize     = 8;
input bool            InpDrawSL       = true;
input bool            InpShowLog      = true;

struct ZoneRec
{
   int      id;
   int      kind;
   int      dir;
   int      state;
   int      liqBars;
   double   zoneTop;
   double   zoneBot;
   double   nearEdge;
   double   bestLiqDist;
   datetime zoneLeft;
   datetime bornTime;
   datetime validAfter;
   datetime breakTime;
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

ZoneRec gZones[ZONE_MAX];
int     gZoneTotal = 0;
int     gNextId    = 0;
datetime gLastBar   = 0;

string Zn(int id)   { return OBJ_PREFIX + IntegerToString(id) + "_zn"; }
string Sl(int id)   { return OBJ_PREFIX + IntegerToString(id) + "_sl"; }
string Lb(int id)   { return OBJ_PREFIX + IntegerToString(id) + "_lb"; }

double CalcATR(int sh)
{
   int avail = iBars(_Symbol, InpTF);
   if(avail < sh + InpATRPeriod + 2) return 0.0;
   double sum = 0.0;
   for(int k = sh + 1; k <= sh + InpATRPeriod; k++)
   {
      double h = iHigh(_Symbol, InpTF, k), l = iLow(_Symbol, InpTF, k);
      double pc = iClose(_Symbol, InpTF, k + 1);
      sum += MathMax(h - l, MathMax(MathAbs(h - pc), MathAbs(l - pc)));
   }
   return sum / (double)InpATRPeriod;
}

double NearDist(int sh)
{
   if(InpNearPoints > 0) return InpNearPoints * _Point;
   return InpNearATR * CalcATR(sh);
}

// Touch at the near edge (same as FVG/OB/BB liquidity detectors) — not full-box overlap.
bool TouchKills(int i, double hi, double lo)
{
   if(gZones[i].kind == KIND_BB && gZones[i].bbPhase != PHASE_BB) return false;
   double edge = gZones[i].nearEdge;
   if(gZones[i].dir == DIR_BULL) return lo <= edge;
   return hi >= edge;
}

string LiqLabelText(int kind)
{
   if(kind == KIND_FVG) return InpLabelFVG;
   if(kind == KIND_OB)  return InpLabelOB;
   return InpLabelBB;
}

void UpdateLiqLabel(int i, double wickExtreme, datetime t)
{
   if(!InpDrawLabels) return;
   string nm = Lb(gZones[i].id);
   ObjectDelete(0, nm);
   color c = (gZones[i].dir == DIR_BULL) ? clrMediumSeaGreen : clrTomato;
   if(ObjectCreate(0, nm, OBJ_TEXT, 0, t, wickExtreme))
   {
      ObjectSetString (0, nm, OBJPROP_TEXT, LiqLabelText(gZones[i].kind));
      ObjectSetInteger(0, nm, OBJPROP_COLOR, c);
      ObjectSetInteger(0, nm, OBJPROP_FONTSIZE, InpFontSize);
      ObjectSetInteger(0, nm, OBJPROP_ANCHOR, gZones[i].dir == DIR_BULL ? ANCHOR_UPPER : ANCHOR_LOWER);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
   }
}

bool Rejected(int dir, double cl, double top, double bot)
{
   if(dir == DIR_BULL) return cl > top;
   return cl < bot;
}

double SlForZone(int dir, double top, double bot)
{
   double buf = InpSlBufferPts * _Point;
   return (dir == DIR_BULL) ? bot - buf : top + buf;
}

void KillZone(int i)
{
   ObjectDelete(0, Zn(gZones[i].id));
   ObjectDelete(0, Sl(gZones[i].id));
   ObjectDelete(0, Lb(gZones[i].id));
   gZones[i].dead = true;
}

void DrawZone(int i)
{
   if(!InpDrawZones) return;
   if(gZones[i].kind == KIND_BB && gZones[i].bbPhase == PHASE_OB) return;
   string nm = Zn(gZones[i].id);
   color c = (gZones[i].dir == DIR_BULL) ? clrMediumSeaGreen : clrTomato;
   datetime rt = (gZones[i].breakTime > 0) ? gZones[i].breakTime : gZones[i].bornTime;
   if(gZones[i].kind != KIND_FVG) rt = gZones[i].bornTime;
   datetime rEnd = gZones[i].bornTime;
   if(ObjectCreate(0, nm, OBJ_RECTANGLE, 0, gZones[i].zoneLeft, gZones[i].zoneTop, rEnd, gZones[i].zoneBot))
   {
      ObjectSetInteger(0, nm, OBJPROP_COLOR, c);
      ObjectSetInteger(0, nm, OBJPROP_FILL, true);
      ObjectSetInteger(0, nm, OBJPROP_BACK, true);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      if(gZones[i].kind == KIND_BB && gZones[i].bbPhase == PHASE_BB)
         ObjectSetInteger(0, nm, OBJPROP_STYLE, STYLE_DASH);
   }
}

void ExtendZone(int i, datetime t)
{
   if(!InpDrawZones) return;
   if(gZones[i].kind == KIND_BB && gZones[i].bbPhase == PHASE_OB) return;
   string nm = Zn(gZones[i].id);
   if(ObjectFind(0, nm) >= 0)
      ObjectSetInteger(0, nm, OBJPROP_TIME, 1, t);
}

void DrawSL(int i, double sl)
{
   if(!InpDrawSL) return;
   string nm = Sl(gZones[i].id);
   datetime t1 = iTime(_Symbol, InpTF, 1);
   datetime t2 = iTime(_Symbol, InpTF, 0) + PeriodSeconds(InpTF) * 8;
   if(ObjectCreate(0, nm, OBJ_TREND, 0, t1, sl, t2, sl))
   {
      ObjectSetInteger(0, nm, OBJPROP_COLOR, clrGold);
      ObjectSetInteger(0, nm, OBJPROP_STYLE, STYLE_DOT);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
   }
}

int AddZone(int kind, int dir, double top, double bot, datetime leftT, datetime bornT)
{
   for(int i = 0; i < gZoneTotal; i++)
      if(!gZones[i].dead && gZones[i].kind == kind && gZones[i].zoneLeft == leftT && gZones[i].dir == dir)
         return i;
   int idx = -1;
   for(int i = 0; i < gZoneTotal; i++) if(gZones[i].dead) { idx = i; break; }
   if(idx < 0 && gZoneTotal < ZONE_MAX) idx = gZoneTotal++;
   if(idx < 0) return -1;
   gZones[idx].id = gNextId++;
   gZones[idx].kind = kind;
   gZones[idx].dir = dir;
   gZones[idx].state = ST_ACTIVE;
   gZones[idx].liqBars = 0;
   gZones[idx].zoneTop = top;
   gZones[idx].zoneBot = bot;
   gZones[idx].zoneLeft = leftT;
   gZones[idx].bornTime = bornT;
   gZones[idx].validAfter = bornT;
   gZones[idx].nearEdge = top;
   gZones[idx].bestLiqDist = DBL_MAX;
   gZones[idx].breakTime = 0;
   gZones[idx].bbPhase = PHASE_OB;
   gZones[idx].age = 0;
   gZones[idx].dead = false;
   gZones[idx].pendingBuy = false;
   gZones[idx].pendingSell = false;
   gZones[idx].pendingSL = 0;
   DrawZone(idx);
   return idx;
}

void DetectFVG(int sh)
{
   if(!InpUseFVG) return;
   int avail = iBars(_Symbol, InpTF);
   if(sh + 2 >= avail) return;
   double c1h = iHigh(_Symbol, InpTF, sh + 2);
   double c1l = iLow (_Symbol, InpTF, sh + 2);
   double c3l = iLow (_Symbol, InpTF, sh);
   double c3h = iHigh(_Symbol, InpTF, sh);
   datetime t1 = iTime(_Symbol, InpTF, sh + 2);
   datetime t3 = iTime(_Symbol, InpTF, sh);
   if(c1h < c3l)
   {
      int idx = AddZone(KIND_FVG, DIR_BULL, c3l, c1h, t1, t3);
      if(idx >= 0) { gZones[idx].nearEdge = c3l; gZones[idx].validAfter = t3; }
   }
   if(c1l > c3h)
   {
      int idx = AddZone(KIND_FVG, DIR_BEAR, c1l, c3h, t1, t3);
      if(idx >= 0) { gZones[idx].nearEdge = c3h; gZones[idx].validAfter = t3; }
   }
}

void DetectDisplacementOB(int dispShift, int kind)
{
   if(dispShift < 1) return;
   if(kind == KIND_OB && !InpUseOB) return;
   if(kind == KIND_BB && !InpUseBB) return;
   double atr = CalcATR(dispShift);
   if(atr <= 0) return;
   double dOpn = iOpen(_Symbol, InpTF, dispShift);
   double dCls = iClose(_Symbol, InpTF, dispShift);
   if(MathAbs(dCls - dOpn) < InpDispMult * atr) return;
   int dispDir = (dCls > dOpn) ? DIR_BULL : DIR_BEAR;
   int scanEnd = dispShift + InpObScanBack;
   int avail = iBars(_Symbol, InpTF);
   if(scanEnd >= avail - 1) scanEnd = avail - 2;
   datetime confT = iTime(_Symbol, InpTF, dispShift);
   for(int j = dispShift + 1; j <= scanEnd; j++)
   {
      double jOpn = iOpen(_Symbol, InpTF, j);
      double jCls = iClose(_Symbol, InpTF, j);
      datetime obT = iTime(_Symbol, InpTF, j);
      if(dispDir == DIR_BULL && jCls < jOpn)
      {
         int idx = AddZone(kind, DIR_BULL, MathMax(jOpn, jCls), MathMin(jOpn, jCls), obT, confT);
         if(idx >= 0)
         {
            gZones[idx].obHi = iHigh(_Symbol, InpTF, j);
            gZones[idx].obLo = iLow(_Symbol, InpTF, j);
            gZones[idx].obOpen = jOpn;
            gZones[idx].obClose = jCls;
            gZones[idx].nearEdge = jOpn;
            gZones[idx].validAfter = confT;
            gZones[idx].bbPhase = PHASE_OB;
            if(kind == KIND_BB) ObjectDelete(0, Zn(gZones[idx].id));
         }
         break;
      }
      if(dispDir == DIR_BEAR && jCls > jOpn)
      {
         int idx = AddZone(kind, DIR_BEAR, MathMax(jOpn, jCls), MathMin(jOpn, jCls), obT, confT);
         if(idx >= 0)
         {
            gZones[idx].obHi = iHigh(_Symbol, InpTF, j);
            gZones[idx].obLo = iLow(_Symbol, InpTF, j);
            gZones[idx].obOpen = jOpn;
            gZones[idx].obClose = jCls;
            gZones[idx].nearEdge = jOpn;
            gZones[idx].validAfter = confT;
            gZones[idx].bbPhase = PHASE_OB;
            if(kind == KIND_BB) ObjectDelete(0, Zn(gZones[idx].id));
         }
         break;
      }
   }
}

void CheckBBBreaks(int sh)
{
   if(!InpUseBB) return;
   double cl = iClose(_Symbol, InpTF, sh);
   datetime t = iTime(_Symbol, InpTF, sh);
   for(int i = 0; i < gZoneTotal; i++)
   {
      if(gZones[i].dead || gZones[i].kind != KIND_BB || gZones[i].bbPhase != PHASE_OB) continue;
      if(gZones[i].bornTime >= t) continue;
      bool broke = false;
      int newDir = gZones[i].dir;
      if(gZones[i].dir == DIR_BULL && cl < gZones[i].obLo) { broke = true; newDir = DIR_BEAR; }
      else if(gZones[i].dir == DIR_BEAR && cl > gZones[i].obHi) { broke = true; newDir = DIR_BULL; }
      if(!broke) continue;
      gZones[i].dir = newDir;
      gZones[i].zoneTop = MathMax(gZones[i].obOpen, gZones[i].obClose);
      gZones[i].zoneBot = MathMin(gZones[i].obOpen, gZones[i].obClose);
      gZones[i].nearEdge = gZones[i].obClose;
      gZones[i].bbPhase = PHASE_BB;
      gZones[i].breakTime = t;
      gZones[i].state = ST_ACTIVE;
      gZones[i].liqBars = 0;
      gZones[i].age = 0;
      gZones[i].bestLiqDist = DBL_MAX;
      ObjectDelete(0, Zn(gZones[i].id));
      DrawZone(i);
      if(InpShowLog)
         PrintFormat("ZLS BB formed | tradeDir=%d | %s", newDir, TimeToString(t, TIME_DATE|TIME_MINUTES));
   }
}

void CheckLiquidity(int sh)
{
   double hi = iHigh(_Symbol, InpTF, sh);
   double lo = iLow(_Symbol, InpTF, sh);
   double cl = iClose(_Symbol, InpTF, sh);
   datetime t = iTime(_Symbol, InpTF, sh);
   double near = NearDist(sh);

   for(int i = 0; i < gZoneTotal; i++)
   {
      if(gZones[i].dead) continue;
      if(gZones[i].validAfter >= t) continue;
      if(gZones[i].kind == KIND_BB && gZones[i].bbPhase != PHASE_BB) continue;

      ExtendZone(i, t);
      if(near <= 0) continue;
      double edge = gZones[i].nearEdge;
      int dir = gZones[i].dir;
      double top = gZones[i].zoneTop;
      double bot = gZones[i].zoneBot;

      if(TouchKills(i, hi, lo))
      {
         bool hadLiq = (gZones[i].bestLiqDist < DBL_MAX);
         bool reject = hadLiq && Rejected(dir, cl, top, bot);
         if(reject)
         {
            double sl = SlForZone(dir, top, bot);
            if(dir == DIR_BULL) { gZones[i].pendingBuy = true; gZones[i].pendingSL = sl; }
            else { gZones[i].pendingSell = true; gZones[i].pendingSL = sl; }
            if(InpShowLog)
               PrintFormat("ZLS %s | kind=%d | edge touch+reject | SL=%.5f | %s",
                  dir == DIR_BULL ? "BUY" : "SELL", gZones[i].kind, sl, TimeToString(t, TIME_DATE|TIME_MINUTES));
         }
         KillZone(i);
         continue;
      }

      if(dir == DIR_BULL)
      {
         double dist = lo - edge;
         if(dist <= near && dist < gZones[i].bestLiqDist)
         {
            gZones[i].bestLiqDist = dist;
            gZones[i].liqBars++;
            if(gZones[i].liqBars >= InpMinLiqBars) gZones[i].state = ST_LIQ;
            UpdateLiqLabel(i, lo, t);
         }
      }
      else
      {
         double dist = edge - hi;
         if(dist <= near && dist < gZones[i].bestLiqDist)
         {
            gZones[i].bestLiqDist = dist;
            gZones[i].liqBars++;
            if(gZones[i].liqBars >= InpMinLiqBars) gZones[i].state = ST_LIQ;
            UpdateLiqLabel(i, hi, t);
         }
      }
   }
}

void EmitPendingSignals(int sh)
{
   datetime t = iTime(_Symbol, InpTF, sh);
   for(int i = 0; i < gZoneTotal; i++)
   {
      if(gZones[i].pendingBuy)
      {
         BullSetupBuf[sh] = iLow(_Symbol, InpTF, sh) - 5 * _Point;
         BullSLBuf[sh] = gZones[i].pendingSL;
         gZones[i].pendingBuy = false;
      }
      if(gZones[i].pendingSell)
      {
         BearSetupBuf[sh] = iHigh(_Symbol, InpTF, sh) + 5 * _Point;
         BearSLBuf[sh] = gZones[i].pendingSL;
         gZones[i].pendingSell = false;
      }
   }
}

void AgeZones()
{
   if(InpExpiryBars <= 0) return;
   for(int i = 0; i < gZoneTotal; i++)
   {
      if(gZones[i].dead || gZones[i].state == ST_DONE) continue;
      gZones[i].age++;
      if(gZones[i].age >= InpExpiryBars) KillZone(i);
   }
}

void ProcessBar(int sh)
{
   DetectFVG(sh);
   DetectDisplacementOB(sh, KIND_OB);
   DetectDisplacementOB(sh, KIND_BB);
   CheckBBBreaks(sh);
   CheckLiquidity(sh);
   AgeZones();
}

void Rebuild()
{
   ObjectsDeleteAll(0, OBJ_PREFIX);
   gZoneTotal = 0;
   gNextId = 0;
   ArrayInitialize(BullSetupBuf, EMPTY_VALUE);
   ArrayInitialize(BearSetupBuf, EMPTY_VALUE);
   ArrayInitialize(BullSLBuf, EMPTY_VALUE);
   ArrayInitialize(BearSLBuf, EMPTY_VALUE);
   int scan = MathMin(InpLookback, iBars(_Symbol, InpTF) - InpObScanBack - 3);
   if(scan < 2) return;
   for(int sh = scan; sh >= 1; sh--)
   {
      ProcessBar(sh);
      if(sh > 1) EmitPendingSignals(sh - 1);
   }
}

int OnInit()
{
   SetIndexBuffer(0, BullSetupBuf, INDICATOR_DATA);
   SetIndexBuffer(1, BearSetupBuf, INDICATOR_DATA);
   SetIndexBuffer(2, BullSLBuf, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, BearSLBuf, INDICATOR_CALCULATIONS);
   PlotIndexSetInteger(0, PLOT_ARROW, 233);
   PlotIndexSetInteger(1, PLOT_ARROW, 234);
   PlotIndexSetDouble(0, PLOT_EMPTY_VALUE, EMPTY_VALUE);
   PlotIndexSetDouble(1, PLOT_EMPTY_VALUE, EMPTY_VALUE);
   ArraySetAsSeries(BullSetupBuf, true);
   ArraySetAsSeries(BearSetupBuf, true);
   ArraySetAsSeries(BullSLBuf, true);
   ArraySetAsSeries(BearSLBuf, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "Zone Liq Setup");
   gLastBar = 0;
   Rebuild();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { ObjectsDeleteAll(0, OBJ_PREFIX); }

int OnCalculate(const int rates_total, const int prev_calculated,
                const datetime &time[], const double &open[],
                const double &high[], const double &low[],
                const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
{
   datetime cur = iTime(_Symbol, InpTF, 0);
   if(cur != gLastBar)
   {
      gLastBar = cur;
      ProcessBar(1);
      EmitPendingSignals(0);
   }
   return rates_total;
}
`;
}
