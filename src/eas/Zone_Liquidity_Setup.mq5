//+------------------------------------------------------------------+
//| Zone_Liquidity_Setup.mq5                                       |
//| FVG + OB + BB liquidity detectors v2.0.0              |
//| Three independent pools — same logic as FLq/OLq/BLq indicators  |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SMC Liquidity"
#property version   "2.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define DIR_BULL    1
#define DIR_BEAR   -1
#define PHASE_OB    0
#define PHASE_BB    1
#define LVL_MAX    400

input ENUM_TIMEFRAMES InpTF           = PERIOD_CURRENT;
input int             InpLookback     = 500;
input bool            InpUseFVG       = true;
input bool            InpUseOB        = true;
input bool            InpUseBB        = true;
input double          InpDispMult     = 1.5;
input int             InpDispAtrPer   = 14;
input int             InpObScanBack   = 5;
input double          InpNearATR      = 0.20;
input int             InpNearAtrPer   = 14;
input int             InpNearPoints   = 0;
input int             InpExpiryBars   = 200;
input int             InpObExpiry     = 300;
input int             InpBBExpiry     = 200;
input bool            InpDrawZones    = true;
input bool            InpDrawLabels   = true;
input bool            InpHideUntilLiq = false;
input string          InpLabelFVG     = "FLq";
input string          InpLabelOB      = "OLq";
input string          InpLabelBB      = "BLq";
input int             InpFontSize     = 8;
input color           InpBullColor    = clrMediumSeaGreen;
input color           InpBearColor    = clrTomato;
input bool            InpShowLog      = false;

datetime gLastBar = 0;

//+------------------------------------------------------------------+
//| FVG pool (FVG_Liquidity_Detector)                                |
//+------------------------------------------------------------------+
#define FVG_PREFIX "ZLS_FVG_"

struct FvgRec
{
   int      id;
   int      dir;
   double   nearEdge;
   double   farEdge;
   double   zoneTop;
   double   zoneBot;
   datetime zoneStart;
   datetime levelTime;
   bool     dead;
   int      ageCounter;
   double   bestLiqDist;
};

FvgRec gFvg[LVL_MAX];
int    gFvgTotal = 0;
int    gFvgNextId = 0;

string FvgLb(int id)  { return FVG_PREFIX + IntegerToString(id) + "_lb"; }
string FvgZn(int id)  { return FVG_PREFIX + IntegerToString(id) + "_zn"; }

double FvgCalcATR(int sh)
{
   int avail = iBars(_Symbol, InpTF);
   if(avail < sh + InpNearAtrPer + 2) return 0.0;
   double sum = 0.0;
   for(int k = sh + 1; k <= sh + InpNearAtrPer; k++)
   {
      double h = iHigh(_Symbol, InpTF, k), l = iLow(_Symbol, InpTF, k);
      double pc = iClose(_Symbol, InpTF, k + 1);
      sum += MathMax(h - l, MathMax(MathAbs(h - pc), MathAbs(l - pc)));
   }
   return sum / (double)InpNearAtrPer;
}

void FvgDrawZone(int i)
{
   if(!InpDrawZones) return;
   if(InpHideUntilLiq && gFvg[i].bestLiqDist >= DBL_MAX) return;
   string nm = FvgZn(gFvg[i].id);
   color  c  = (gFvg[i].dir == DIR_BULL) ? InpBullColor : InpBearColor;
   if(ObjectFind(0, nm) < 0)
   {
      if(ObjectCreate(0, nm, OBJ_RECTANGLE, 0,
                      gFvg[i].zoneStart, gFvg[i].zoneTop,
                      gFvg[i].levelTime, gFvg[i].zoneBot))
      {
         ObjectSetInteger(0, nm, OBJPROP_COLOR, c);
         ObjectSetInteger(0, nm, OBJPROP_FILL, true);
         ObjectSetInteger(0, nm, OBJPROP_BACK, true);
         ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
      }
   }
}

void FvgExtendZone(int i, datetime t)
{
   if(!InpDrawZones) return;
   if(InpHideUntilLiq && gFvg[i].bestLiqDist >= DBL_MAX) return;
   string nm = FvgZn(gFvg[i].id);
   if(ObjectFind(0, nm) >= 0) ObjectSetInteger(0, nm, OBJPROP_TIME, 1, t);
}

void FvgKill(int i)
{
   ObjectDelete(0, FvgLb(gFvg[i].id));
   ObjectDelete(0, FvgZn(gFvg[i].id));
   gFvg[i].dead = true;
}

void FvgAdd(int dir, double nearEdge, double farEdge, datetime zoneStart, datetime t)
{
   for(int i = 0; i < gFvgTotal; i++)
      if(!gFvg[i].dead && MathAbs(gFvg[i].nearEdge - nearEdge) < _Point && gFvg[i].dir == dir) return;
   int idx = -1;
   for(int i = 0; i < gFvgTotal; i++) if(gFvg[i].dead) { idx = i; break; }
   if(idx < 0 && gFvgTotal < LVL_MAX) idx = gFvgTotal++;
   if(idx < 0) return;
   gFvg[idx].id = gFvgNextId++;
   gFvg[idx].dir = dir;
   gFvg[idx].nearEdge = nearEdge;
   gFvg[idx].farEdge = farEdge;
   gFvg[idx].zoneTop = MathMax(nearEdge, farEdge);
   gFvg[idx].zoneBot = MathMin(nearEdge, farEdge);
   gFvg[idx].zoneStart = zoneStart;
   gFvg[idx].levelTime = t;
   gFvg[idx].dead = false;
   gFvg[idx].ageCounter = 0;
   gFvg[idx].bestLiqDist = DBL_MAX;
   FvgDrawZone(idx);
}

void FvgDetect(int sh)
{
   int avail = iBars(_Symbol, InpTF);
   if(sh + 2 >= avail) return;
   double c1h = iHigh(_Symbol, InpTF, sh + 2);
   double c1l = iLow (_Symbol, InpTF, sh + 2);
   double c3l = iLow (_Symbol, InpTF, sh);
   double c3h = iHigh(_Symbol, InpTF, sh);
   datetime t1 = iTime(_Symbol, InpTF, sh + 2);
   datetime t3 = iTime(_Symbol, InpTF, sh);
   if(c1h < c3l) FvgAdd(DIR_BULL, c3l, c1h, t1, t3);
   if(c1l > c3h) FvgAdd(DIR_BEAR, c3h, c1l, t1, t3);
}

void FvgUpdateLabel(int i, int dir, double wickExtreme, datetime t)
{
   if(!InpDrawLabels) return;
   string nm = FvgLb(gFvg[i].id);
   ObjectDelete(0, nm);
   color c = (dir == DIR_BULL) ? InpBullColor : InpBearColor;
   if(ObjectCreate(0, nm, OBJ_TEXT, 0, t, wickExtreme))
   {
      ObjectSetString (0, nm, OBJPROP_TEXT, InpLabelFVG);
      ObjectSetInteger(0, nm, OBJPROP_COLOR, c);
      ObjectSetInteger(0, nm, OBJPROP_FONTSIZE, InpFontSize);
      ObjectSetInteger(0, nm, OBJPROP_ANCHOR, dir == DIR_BULL ? ANCHOR_UPPER : ANCHOR_LOWER);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
   }
}

void FvgCheckLiquidity(int sh)
{
   double hi = iHigh(_Symbol, InpTF, sh);
   double lo = iLow (_Symbol, InpTF, sh);
   datetime t = iTime(_Symbol, InpTF, sh);
   double near = (InpNearPoints > 0) ? InpNearPoints * _Point : InpNearATR * FvgCalcATR(sh);

   for(int i = 0; i < gFvgTotal; i++)
   {
      if(gFvg[i].dead) continue;
      if(gFvg[i].levelTime >= t) continue;
      FvgExtendZone(i, t);
      double edge = gFvg[i].nearEdge;
      if(near <= 0) continue;

      if(gFvg[i].dir == DIR_BULL)
      {
         if(lo <= edge) { FvgKill(i); continue; }
         double dist = lo - edge;
         if(dist <= near && dist < gFvg[i].bestLiqDist)
         {
            gFvg[i].bestLiqDist = dist;
            FvgUpdateLabel(i, DIR_BULL, lo, t);
            if(InpHideUntilLiq) FvgDrawZone(i);
            if(InpShowLog) PrintFormat("ZLS FVG BULL | edge=%.5f | low=%.5f | %s", edge, lo, TimeToString(t, TIME_DATE|TIME_MINUTES));
         }
      }
      else
      {
         if(hi >= edge) { FvgKill(i); continue; }
         double dist = edge - hi;
         if(dist <= near && dist < gFvg[i].bestLiqDist)
         {
            gFvg[i].bestLiqDist = dist;
            FvgUpdateLabel(i, DIR_BEAR, hi, t);
            if(InpHideUntilLiq) FvgDrawZone(i);
            if(InpShowLog) PrintFormat("ZLS FVG BEAR | edge=%.5f | high=%.5f | %s", edge, hi, TimeToString(t, TIME_DATE|TIME_MINUTES));
         }
      }
   }
}

void FvgAge()
{
   if(InpExpiryBars <= 0) return;
   for(int i = 0; i < gFvgTotal; i++)
   {
      if(gFvg[i].dead) continue;
      gFvg[i].ageCounter++;
      if(gFvg[i].ageCounter >= InpExpiryBars) FvgKill(i);
   }
}

//+------------------------------------------------------------------+
//| OB pool (OB_Liquidity_Detector)                                  |
//+------------------------------------------------------------------+
#define OB_PREFIX "ZLS_OB_"

struct ObRec
{
   int      id;
   int      dir;
   double   bodyEdge;
   double   bodyFar;
   double   zoneTop;
   double   zoneBot;
   datetime obTime;
   datetime confirmTime;
   bool     dead;
   int      ageCounter;
   double   bestLiqDist;
};

ObRec gOb[LVL_MAX];
int   gObTotal = 0;
int   gObNextId = 0;

string ObLb(int id)  { return OB_PREFIX + IntegerToString(id) + "_lb"; }
string ObZn(int id)  { return OB_PREFIX + IntegerToString(id) + "_zn"; }

double ObCalcATR(int sh, int period)
{
   int avail = iBars(_Symbol, InpTF);
   if(avail < sh + period + 2) return 0.0;
   double sum = 0.0;
   for(int k = sh + 1; k <= sh + period; k++)
   {
      double h = iHigh(_Symbol, InpTF, k), l = iLow(_Symbol, InpTF, k);
      double pc = iClose(_Symbol, InpTF, k + 1);
      sum += MathMax(h - l, MathMax(MathAbs(h - pc), MathAbs(l - pc)));
   }
   return sum / (double)period;
}

void ObDrawZone(int i)
{
   if(!InpDrawZones) return;
   if(InpHideUntilLiq && gOb[i].bestLiqDist >= DBL_MAX) return;
   string nm = ObZn(gOb[i].id);
   color  c  = (gOb[i].dir == DIR_BULL) ? InpBullColor : InpBearColor;
   if(ObjectFind(0, nm) < 0)
   {
      if(ObjectCreate(0, nm, OBJ_RECTANGLE, 0,
                      gOb[i].obTime, gOb[i].zoneTop,
                      gOb[i].confirmTime, gOb[i].zoneBot))
      {
         ObjectSetInteger(0, nm, OBJPROP_COLOR, c);
         ObjectSetInteger(0, nm, OBJPROP_FILL, true);
         ObjectSetInteger(0, nm, OBJPROP_BACK, true);
         ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
      }
   }
}

void ObExtendZone(int i, datetime t)
{
   if(!InpDrawZones) return;
   if(InpHideUntilLiq && gOb[i].bestLiqDist >= DBL_MAX) return;
   string nm = ObZn(gOb[i].id);
   if(ObjectFind(0, nm) >= 0) ObjectSetInteger(0, nm, OBJPROP_TIME, 1, t);
}

void ObKill(int i)
{
   ObjectDelete(0, ObLb(gOb[i].id));
   ObjectDelete(0, ObZn(gOb[i].id));
   gOb[i].dead = true;
}

void ObAdd(int dir, double bodyEdge, double bodyFar, datetime obT, datetime confT)
{
   for(int i = 0; i < gObTotal; i++)
      if(!gOb[i].dead && gOb[i].obTime == obT && gOb[i].dir == dir) return;
   int idx = -1;
   for(int i = 0; i < gObTotal; i++) if(gOb[i].dead) { idx = i; break; }
   if(idx < 0 && gObTotal < LVL_MAX) idx = gObTotal++;
   if(idx < 0) return;
   gOb[idx].id = gObNextId++;
   gOb[idx].dir = dir;
   gOb[idx].bodyEdge = bodyEdge;
   gOb[idx].bodyFar = bodyFar;
   gOb[idx].zoneTop = MathMax(bodyEdge, bodyFar);
   gOb[idx].zoneBot = MathMin(bodyEdge, bodyFar);
   gOb[idx].obTime = obT;
   gOb[idx].confirmTime = confT;
   gOb[idx].dead = false;
   gOb[idx].ageCounter = 0;
   gOb[idx].bestLiqDist = DBL_MAX;
   ObDrawZone(idx);
}

void ObDetect(int dispShift)
{
   if(dispShift < 1) return;
   double atr = ObCalcATR(dispShift, InpDispAtrPer);
   if(atr <= 0.0) return;
   double dOpn = iOpen (_Symbol, InpTF, dispShift);
   double dCls = iClose(_Symbol, InpTF, dispShift);
   if(MathAbs(dCls - dOpn) < InpDispMult * atr) return;
   int dispDir = (dCls > dOpn) ? DIR_BULL : DIR_BEAR;
   int available = iBars(_Symbol, InpTF);
   int scanEnd = dispShift + InpObScanBack;
   if(scanEnd >= available - 1) scanEnd = available - 2;
   for(int j = dispShift + 1; j <= scanEnd; j++)
   {
      double jOpn = iOpen (_Symbol, InpTF, j);
      double jCls = iClose(_Symbol, InpTF, j);
      if(dispDir == DIR_BULL && jCls < jOpn)
      {
         ObAdd(DIR_BULL, jOpn, jCls, iTime(_Symbol, InpTF, j), iTime(_Symbol, InpTF, dispShift));
         break;
      }
      if(dispDir == DIR_BEAR && jCls > jOpn)
      {
         ObAdd(DIR_BEAR, jOpn, jCls, iTime(_Symbol, InpTF, j), iTime(_Symbol, InpTF, dispShift));
         break;
      }
   }
}

void ObUpdateLabel(int i, int dir, double wickExtreme, datetime t)
{
   if(!InpDrawLabels) return;
   string nm = ObLb(gOb[i].id);
   ObjectDelete(0, nm);
   color c = (dir == DIR_BULL) ? InpBullColor : InpBearColor;
   if(ObjectCreate(0, nm, OBJ_TEXT, 0, t, wickExtreme))
   {
      ObjectSetString (0, nm, OBJPROP_TEXT, InpLabelOB);
      ObjectSetInteger(0, nm, OBJPROP_COLOR, c);
      ObjectSetInteger(0, nm, OBJPROP_FONTSIZE, InpFontSize);
      ObjectSetInteger(0, nm, OBJPROP_ANCHOR, dir == DIR_BULL ? ANCHOR_UPPER : ANCHOR_LOWER);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
   }
}

void ObCheckLiquidity(int sh)
{
   double hi = iHigh(_Symbol, InpTF, sh);
   double lo = iLow (_Symbol, InpTF, sh);
   datetime t = iTime(_Symbol, InpTF, sh);
   double near = (InpNearPoints > 0) ? InpNearPoints * _Point : InpNearATR * ObCalcATR(sh, InpNearAtrPer);

   for(int i = 0; i < gObTotal; i++)
   {
      if(gOb[i].dead) continue;
      if(gOb[i].confirmTime >= t) continue;
      ObExtendZone(i, t);
      double edge = gOb[i].bodyEdge;
      if(near <= 0) continue;

      if(gOb[i].dir == DIR_BULL)
      {
         if(lo <= edge) { ObKill(i); continue; }
         double dist = lo - edge;
         if(dist <= near && dist < gOb[i].bestLiqDist)
         {
            gOb[i].bestLiqDist = dist;
            ObUpdateLabel(i, DIR_BULL, lo, t);
            if(InpHideUntilLiq) ObDrawZone(i);
            if(InpShowLog) PrintFormat("ZLS OB BULL | body=%.5f | low=%.5f | %s", edge, lo, TimeToString(t, TIME_DATE|TIME_MINUTES));
         }
      }
      else
      {
         if(hi >= edge) { ObKill(i); continue; }
         double dist = edge - hi;
         if(dist <= near && dist < gOb[i].bestLiqDist)
         {
            gOb[i].bestLiqDist = dist;
            ObUpdateLabel(i, DIR_BEAR, hi, t);
            if(InpHideUntilLiq) ObDrawZone(i);
            if(InpShowLog) PrintFormat("ZLS OB BEAR | body=%.5f | high=%.5f | %s", edge, hi, TimeToString(t, TIME_DATE|TIME_MINUTES));
         }
      }
   }
}

void ObAge()
{
   if(InpExpiryBars <= 0) return;
   for(int i = 0; i < gObTotal; i++)
   {
      if(gOb[i].dead) continue;
      gOb[i].ageCounter++;
      if(gOb[i].ageCounter >= InpExpiryBars) ObKill(i);
   }
}

//+------------------------------------------------------------------+
//| BB pool (BB_Liquidity_Detector)                                  |
//+------------------------------------------------------------------+
#define BB_PREFIX "ZLS_BB_"

struct BbRec
{
   int      id;
   int      phase;
   int      dir;
   double   obHi;
   double   obLo;
   double   obOpen;
   double   obClose;
   double   bodyEdge;
   double   zoneTop;
   double   zoneBot;
   datetime obTime;
   datetime confirmTime;
   datetime breakTime;
   bool     dead;
   int      obAge;
   int      bbAge;
   double   bestLiqDist;
};

BbRec gBb[LVL_MAX];
int   gBbTotal = 0;
int   gBbNextId = 0;

string BbLb(int id)  { return BB_PREFIX + IntegerToString(id) + "_lb"; }
string BbZn(int id)  { return BB_PREFIX + IntegerToString(id) + "_zn"; }

void BbDrawZone(int i)
{
   if(!InpDrawZones) return;
   if(gBb[i].phase != PHASE_BB) return;
   if(InpHideUntilLiq && gBb[i].bestLiqDist >= DBL_MAX) return;
   string nm = BbZn(gBb[i].id);
   color  c  = (gBb[i].dir == DIR_BULL) ? InpBullColor : InpBearColor;
   if(ObjectFind(0, nm) < 0)
   {
      if(ObjectCreate(0, nm, OBJ_RECTANGLE, 0,
                      gBb[i].obTime, gBb[i].zoneTop,
                      gBb[i].breakTime, gBb[i].zoneBot))
      {
         ObjectSetInteger(0, nm, OBJPROP_COLOR, c);
         ObjectSetInteger(0, nm, OBJPROP_STYLE, STYLE_DASH);
         ObjectSetInteger(0, nm, OBJPROP_FILL, true);
         ObjectSetInteger(0, nm, OBJPROP_BACK, true);
         ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
      }
   }
}

void BbExtendZone(int i, datetime t)
{
   if(!InpDrawZones) return;
   if(gBb[i].phase != PHASE_BB) return;
   if(InpHideUntilLiq && gBb[i].bestLiqDist >= DBL_MAX) return;
   string nm = BbZn(gBb[i].id);
   if(ObjectFind(0, nm) >= 0) ObjectSetInteger(0, nm, OBJPROP_TIME, 1, t);
}

void BbKill(int i)
{
   ObjectDelete(0, BbLb(gBb[i].id));
   ObjectDelete(0, BbZn(gBb[i].id));
   gBb[i].dead = true;
}

void BbAddOB(int dir, double hi, double lo, double opn, double cls, datetime obT, datetime confT)
{
   for(int i = 0; i < gBbTotal; i++)
      if(!gBb[i].dead && gBb[i].obTime == obT) return;
   int idx = -1;
   for(int i = 0; i < gBbTotal; i++) if(gBb[i].dead) { idx = i; break; }
   if(idx < 0 && gBbTotal < LVL_MAX) idx = gBbTotal++;
   if(idx < 0) return;
   gBb[idx].id = gBbNextId++;
   gBb[idx].phase = PHASE_OB;
   gBb[idx].dir = dir;
   gBb[idx].obHi = hi;
   gBb[idx].obLo = lo;
   gBb[idx].obOpen = opn;
   gBb[idx].obClose = cls;
   gBb[idx].bodyEdge = 0.0;
   gBb[idx].zoneTop = 0.0;
   gBb[idx].zoneBot = 0.0;
   gBb[idx].obTime = obT;
   gBb[idx].confirmTime = confT;
   gBb[idx].breakTime = 0;
   gBb[idx].dead = false;
   gBb[idx].obAge = 0;
   gBb[idx].bbAge = 0;
   gBb[idx].bestLiqDist = DBL_MAX;
}

void BbDetectOB(int dispShift)
{
   if(dispShift < 1) return;
   double atr = ObCalcATR(dispShift, InpDispAtrPer);
   if(atr <= 0.0) return;
   double dOpn = iOpen (_Symbol, InpTF, dispShift);
   double dCls = iClose(_Symbol, InpTF, dispShift);
   if(MathAbs(dCls - dOpn) < InpDispMult * atr) return;
   int dispDir = (dCls > dOpn) ? DIR_BULL : DIR_BEAR;
   int available = iBars(_Symbol, InpTF);
   int scanEnd = dispShift + InpObScanBack;
   if(scanEnd >= available - 1) scanEnd = available - 2;
   for(int j = dispShift + 1; j <= scanEnd; j++)
   {
      double jOpn = iOpen (_Symbol, InpTF, j);
      double jCls = iClose(_Symbol, InpTF, j);
      if(dispDir == DIR_BULL && jCls < jOpn)
      {
         BbAddOB(DIR_BULL, iHigh(_Symbol, InpTF, j), iLow(_Symbol, InpTF, j), jOpn, jCls,
                 iTime(_Symbol, InpTF, j), iTime(_Symbol, InpTF, dispShift));
         break;
      }
      if(dispDir == DIR_BEAR && jCls > jOpn)
      {
         BbAddOB(DIR_BEAR, iHigh(_Symbol, InpTF, j), iLow(_Symbol, InpTF, j), jOpn, jCls,
                 iTime(_Symbol, InpTF, j), iTime(_Symbol, InpTF, dispShift));
         break;
      }
   }
}

void BbCheckBreaks(int sh)
{
   double barClose = iClose(_Symbol, InpTF, sh);
   datetime t = iTime(_Symbol, InpTF, sh);
   for(int i = 0; i < gBbTotal; i++)
   {
      if(gBb[i].dead || gBb[i].phase != PHASE_OB) continue;
      if(gBb[i].confirmTime >= t) continue;
      bool broke = false;
      int newDir = 0;
      if(gBb[i].dir == DIR_BULL && barClose < gBb[i].obLo) { broke = true; newDir = DIR_BEAR; }
      else if(gBb[i].dir == DIR_BEAR && barClose > gBb[i].obHi) { broke = true; newDir = DIR_BULL; }
      if(!broke) continue;
      gBb[i].phase = PHASE_BB;
      gBb[i].dir = newDir;
      gBb[i].bodyEdge = gBb[i].obClose;
      gBb[i].zoneTop = MathMax(gBb[i].obOpen, gBb[i].obClose);
      gBb[i].zoneBot = MathMin(gBb[i].obOpen, gBb[i].obClose);
      gBb[i].breakTime = t;
      gBb[i].bbAge = 0;
      gBb[i].bestLiqDist = DBL_MAX;
      BbDrawZone(i);
      if(InpShowLog)
         PrintFormat("ZLS BB formed | dir=%d | edge=%.5f | %s", newDir, gBb[i].bodyEdge, TimeToString(t, TIME_DATE|TIME_MINUTES));
   }
}

void BbUpdateLabel(int i, int dir, double wickExtreme, datetime t)
{
   if(!InpDrawLabels) return;
   string nm = BbLb(gBb[i].id);
   ObjectDelete(0, nm);
   color c = (dir == DIR_BULL) ? InpBullColor : InpBearColor;
   if(ObjectCreate(0, nm, OBJ_TEXT, 0, t, wickExtreme))
   {
      ObjectSetString (0, nm, OBJPROP_TEXT, InpLabelBB);
      ObjectSetInteger(0, nm, OBJPROP_COLOR, c);
      ObjectSetInteger(0, nm, OBJPROP_FONTSIZE, InpFontSize);
      ObjectSetInteger(0, nm, OBJPROP_ANCHOR, dir == DIR_BULL ? ANCHOR_UPPER : ANCHOR_LOWER);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
   }
}

void BbCheckLiquidity(int sh)
{
   double hi = iHigh(_Symbol, InpTF, sh);
   double lo = iLow (_Symbol, InpTF, sh);
   datetime t = iTime(_Symbol, InpTF, sh);
   double near = (InpNearPoints > 0) ? InpNearPoints * _Point : InpNearATR * ObCalcATR(sh, InpNearAtrPer);

   for(int i = 0; i < gBbTotal; i++)
   {
      if(gBb[i].dead || gBb[i].phase != PHASE_BB) continue;
      BbExtendZone(i, t);
      double edge = gBb[i].bodyEdge;
      if(near <= 0) continue;

      if(gBb[i].dir == DIR_BULL)
      {
         if(lo <= edge) { BbKill(i); continue; }
         double dist = lo - edge;
         if(dist <= near && dist < gBb[i].bestLiqDist)
         {
            gBb[i].bestLiqDist = dist;
            BbUpdateLabel(i, DIR_BULL, lo, t);
            if(InpHideUntilLiq) BbDrawZone(i);
            if(InpShowLog) PrintFormat("ZLS BB BULL | body=%.5f | low=%.5f | %s", edge, lo, TimeToString(t, TIME_DATE|TIME_MINUTES));
         }
      }
      else
      {
         if(hi >= edge) { BbKill(i); continue; }
         double dist = edge - hi;
         if(dist <= near && dist < gBb[i].bestLiqDist)
         {
            gBb[i].bestLiqDist = dist;
            BbUpdateLabel(i, DIR_BEAR, hi, t);
            if(InpHideUntilLiq) BbDrawZone(i);
            if(InpShowLog) PrintFormat("ZLS BB BEAR | body=%.5f | high=%.5f | %s", edge, hi, TimeToString(t, TIME_DATE|TIME_MINUTES));
         }
      }
   }
}

void BbAge()
{
   for(int i = 0; i < gBbTotal; i++)
   {
      if(gBb[i].dead) continue;
      if(gBb[i].phase == PHASE_OB)
      {
         if(InpObExpiry <= 0) continue;
         gBb[i].obAge++;
         if(gBb[i].obAge >= InpObExpiry) gBb[i].dead = true;
      }
      else
      {
         if(InpBBExpiry <= 0) continue;
         gBb[i].bbAge++;
         if(gBb[i].bbAge >= InpBBExpiry) BbKill(i);
      }
   }
}

//+------------------------------------------------------------------+
void ProcessBar(int sh)
{
   if(InpUseFVG) { FvgDetect(sh); FvgCheckLiquidity(sh); FvgAge(); }
   if(InpUseOB)  { ObDetect(sh); ObCheckLiquidity(sh); ObAge(); }
   if(InpUseBB)  { BbDetectOB(sh); BbCheckBreaks(sh); BbCheckLiquidity(sh); BbAge(); }
}

void Rebuild()
{
   ObjectsDeleteAll(0, FVG_PREFIX);
   ObjectsDeleteAll(0, OB_PREFIX);
   ObjectsDeleteAll(0, BB_PREFIX);
   gFvgTotal = 0; gFvgNextId = 0;
   gObTotal = 0; gObNextId = 0;
   gBbTotal = 0; gBbNextId = 0;
   int scanFvg = MathMin(InpLookback, iBars(_Symbol, InpTF) - 3);
   int scanOb  = MathMin(InpLookback, iBars(_Symbol, InpTF) - InpObScanBack - 2);
   int scan = MathMax(scanFvg, scanOb);
   if(scan < 2) return;
   for(int sh = scan; sh >= 1; sh--) ProcessBar(sh);
}

int OnInit()
{
   IndicatorSetString(INDICATOR_SHORTNAME, "Zone Liq (FVG+OB+BB)");
   gLastBar = 0;
   Rebuild();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   ObjectsDeleteAll(0, FVG_PREFIX);
   ObjectsDeleteAll(0, OB_PREFIX);
   ObjectsDeleteAll(0, BB_PREFIX);
}

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
   }
   return rates_total;
}
