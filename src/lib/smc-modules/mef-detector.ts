/**
 * MEF Candle Detector — Manipulation Entry Formula
 *
 * A MEF candle is a multi-timeframe engulfing confluence (detection only):
 *
 *   Main TF      : a STRONG (2-candle) engulfing candle
 *   1 TF lower   : a Gap SNR forms INSIDE that engulfing candle
 *   2 TF lower   : an RBR (bull) / DBD (bear) forms inside the same area
 *
 *   Bullish MEF = strong bullish engulfing + Gap Support + RBR
 *   Bearish MEF = strong bearish engulfing + Gap Resistance + DBD
 *
 * Strong engulfing (main TF, 2 candles only):
 *   Bullish : C1 bearish, C2 bullish, C2.close > C1.high
 *   Bearish : C1 bullish, C2 bearish, C2.close < C1.low
 *
 * Gap SNR (1 TF lower, from gap-snr module):
 *   Gap Support    : bullish A → bullish B, level = A.close
 *   Gap Resistance : bearish A → bearish B, level = A.close
 *
 * RBR / DBD (2 TF lower):
 *   strong impulse leg → 1–6 small base candles → strong impulse leg (same dir)
 *   breaking out of the base. Zone = base high..low.
 *
 * The Gap SNR level and the RBR/DBD base must fall within the engulfing candle's
 * time window and price range ("inside the engulfing candle").
 *
 * Detection only — NO trade execution, SL, TP, or breakeven.
 */

export const MEF_DETECTOR_VERSION = "1.0.0";
export const MEF_DETECTOR_MODULE = "MEF_Detector";

export function generateMefDetector(): string {
  return `//+------------------------------------------------------------------+
//| MEF_Detector.mq5 — Manipulation Entry Formula                   |
//| MEF Candle Detector v${MEF_DETECTOR_VERSION}                             |
//|                                                                  |
//| MEF = strong engulfing (main TF) + Gap SNR (1 TF lower) +        |
//|       RBR/DBD (2 TF lower), all inside the engulfing candle.    |
//|   Bullish MEF = bull engulfing + Gap Support + RBR              |
//|   Bearish MEF = bear engulfing + Gap Resistance + DBD          |
//| Detection only — no trade logic.                                |
//+------------------------------------------------------------------+
#property copyright "EA Builder — MEF (Manipulation Entry Formula)"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define DIR_BULL    1
#define DIR_BEAR   -1
#define MAX_MEF     300
#define OBJ_PREFIX  "SMMEF_"

//--- Timeframes (main → 1 lower → 2 lower). Defaults mirror H4/H1/M30.
input ENUM_TIMEFRAMES InpMainTF = PERIOD_H4;    // engulfing timeframe
input ENUM_TIMEFRAMES InpGapTF  = PERIOD_H1;    // Gap SNR timeframe (1 lower)
input ENUM_TIMEFRAMES InpBaseTF = PERIOD_M30;   // RBR/DBD timeframe (2 lower)

input int    InpLookback      = 300;   // main-TF bars to scan
input int    InpExpiryBars    = 150;   // main-TF bars until a MEF mark is removed

//--- RBR/DBD tuning (applied on the base TF)
input double InpImpulseRatio  = 0.5;   // leg candle: body/range >= this
input double InpBaseMaxRatio  = 0.5;   // base candle: body/range <= this
input int    InpMaxBaseCandles = 6;    // max candles in a base
input double InpLegBaseMult   = 1.3;   // leg range >= this * avg base range

input bool   InpDraw          = true;
input int    InpFontSize      = 9;
input color  InpBullColor     = clrLimeGreen;
input color  InpBearColor     = clrOrangeRed;
input color  InpGapColor      = clrGold;
input color  InpBaseColor     = clrMediumPurple;
input bool   InpShowLog       = true;

struct MefRec
{
   int      id;
   int      dir;          // 1 = bull, -1 = bear
   double   engHi;        // engulfing candle high (zone upper)
   double   engLo;        // engulfing candle low  (zone lower)
   datetime engTime;      // engulfing candle (C2) time
   datetime engEnd;       // end of the engulfing candle window
   double   gapLevel;     // Gap SNR level (1 TF lower)
   double   baseHi;       // RBR/DBD base high (2 TF lower)
   double   baseLo;       // RBR/DBD base low
   bool     dead;
   int      ageCounter;
};

MefRec   mefs[MAX_MEF];
int      mefTotal    = 0;
int      nextId      = 0;
datetime lastMainBar = 0;

//+------------------------------------------------------------------+
// Generic per-timeframe candle helpers.
double BR(ENUM_TIMEFRAMES tf, int sh)
{
   double o = iOpen (_Symbol, tf, sh);
   double c = iClose(_Symbol, tf, sh);
   double r = iHigh (_Symbol, tf, sh) - iLow(_Symbol, tf, sh);
   if(r <= 0.0) return 0.0;
   return MathAbs(c - o) / r;
}
double RNG (ENUM_TIMEFRAMES tf, int sh) { return iHigh(_Symbol, tf, sh) - iLow(_Symbol, tf, sh); }
bool   BULL(ENUM_TIMEFRAMES tf, int sh) { return iClose(_Symbol, tf, sh) > iOpen(_Symbol, tf, sh); }
bool   BEAR(ENUM_TIMEFRAMES tf, int sh) { return iClose(_Symbol, tf, sh) < iOpen(_Symbol, tf, sh); }
bool   STRONG(ENUM_TIMEFRAMES tf, int sh) { return BR(tf, sh) >= InpImpulseRatio; }
bool   SMALL (ENUM_TIMEFRAMES tf, int sh) { return BR(tf, sh) <= InpBaseMaxRatio; }

//+------------------------------------------------------------------+
// Find a Gap SNR of the given direction inside [wStart,wEnd] with the level
// within [pLo,pHi]. Returns the level, or 0.0 if none.
//   dir = +1 → Gap Support (bull A → bull B); dir = -1 → Gap Resistance.
double FindGapSnr(int dir, datetime wStart, datetime wEnd, double pLo, double pHi)
{
   int shOld = iBarShift(_Symbol, InpGapTF, wStart);  // older edge (larger shift)
   int shNew = iBarShift(_Symbol, InpGapTF, wEnd);    // newer edge (smaller shift)
   if(shOld < 1) return 0.0;
   if(shNew < 0) shNew = 0;

   for(int a = shOld; a >= shNew + 1; a--)
   {
      int b = a - 1;
      if(b < 0) break;
      datetime tA = iTime(_Symbol, InpGapTF, a);
      datetime tB = iTime(_Symbol, InpGapTF, b);
      if(tA < wStart || tB > wEnd) continue;

      if(dir == DIR_BULL && BULL(InpGapTF, a) && BULL(InpGapTF, b)) {
         double lvl = iClose(_Symbol, InpGapTF, a);
         if(lvl >= pLo && lvl <= pHi) return lvl;
      }
      if(dir == DIR_BEAR && BEAR(InpGapTF, a) && BEAR(InpGapTF, b)) {
         double lvl = iClose(_Symbol, InpGapTF, a);
         if(lvl >= pLo && lvl <= pHi) return lvl;
      }
   }
   return 0.0;
}

//+------------------------------------------------------------------+
// Find an RBR (dir=+1) / DBD (dir=-1) inside [wStart,wEnd] with the base within
// [pLo,pHi]. Returns true and fills base hi/lo.
bool FindRbrDbd(int dir, datetime wStart, datetime wEnd, double pLo, double pHi,
                double &outHi, double &outLo)
{
   int avail = iBars(_Symbol, InpBaseTF);
   int shOld = iBarShift(_Symbol, InpBaseTF, wStart);
   int shNew = iBarShift(_Symbol, InpBaseTF, wEnd);
   if(shOld < 0) return false;
   if(shNew < 0) shNew = 0;

   // leg-out candidate scans newest→oldest within the window
   for(int b = shNew; b <= shOld; b++)
   {
      if(b + 2 >= avail) continue;
      datetime tb = iTime(_Symbol, InpBaseTF, b);
      if(tb < wStart || tb > wEnd) continue;

      if(!STRONG(InpBaseTF, b)) continue;
      if(dir == DIR_BULL && !BULL(InpBaseTF, b)) continue;
      if(dir == DIR_BEAR && !BEAR(InpBaseTF, b)) continue;

      // consecutive small base candles before the leg-out
      int baseLen = 0;
      while(baseLen < InpMaxBaseCandles
            && (b + 1 + baseLen) < avail
            && SMALL(InpBaseTF, b + 1 + baseLen))
         baseLen++;
      if(baseLen < 1) continue;

      int legIn = b + 1 + baseLen;
      if(legIn >= avail) continue;
      if(!STRONG(InpBaseTF, legIn)) continue;
      if(dir == DIR_BULL && !BULL(InpBaseTF, legIn)) continue;
      if(dir == DIR_BEAR && !BEAR(InpBaseTF, legIn)) continue;

      double bHi = -1.0, bLo = 1e18, sumR = 0.0;
      for(int k = 0; k < baseLen; k++) {
         int bb = b + 1 + k;
         double h = iHigh(_Symbol, InpBaseTF, bb);
         double l = iLow (_Symbol, InpBaseTF, bb);
         if(h > bHi) bHi = h;
         if(l < bLo) bLo = l;
         sumR += (h - l);
      }
      double avgR = sumR / baseLen;
      if(avgR <= 0.0) continue;
      if(RNG(InpBaseTF, b)     < InpLegBaseMult * avgR) continue;
      if(RNG(InpBaseTF, legIn) < InpLegBaseMult * avgR) continue;

      double lc = iClose(_Symbol, InpBaseTF, b);
      if(dir == DIR_BULL && lc <= bHi) continue;   // must break out
      if(dir == DIR_BEAR && lc >= bLo) continue;

      // base must sit inside the engulfing candle's price range
      if(bLo < pLo || bHi > pHi) continue;

      outHi = bHi; outLo = bLo;
      return true;
   }
   return false;
}

//+------------------------------------------------------------------+
string ObjBox(int id)   { return OBJ_PREFIX + IntegerToString(id) + "_eng"; }
string ObjLbl(int id)   { return OBJ_PREFIX + IntegerToString(id) + "_lbl"; }
string ObjGap(int id)   { return OBJ_PREFIX + IntegerToString(id) + "_gap"; }
string ObjBase(int id)  { return OBJ_PREFIX + IntegerToString(id) + "_base"; }

void DrawMef(int i)
{
   if(!InpDraw) return;
   color c = (mefs[i].dir == DIR_BULL) ? InpBullColor : InpBearColor;

   // Engulfing candle zone
   string box = ObjBox(mefs[i].id);
   if(ObjectCreate(0, box, OBJ_RECTANGLE, 0, mefs[i].engTime, mefs[i].engHi,
                   mefs[i].engEnd, mefs[i].engLo)) {
      ObjectSetInteger(0, box, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, box, OBJPROP_WIDTH,      2);
      ObjectSetInteger(0, box, OBJPROP_FILL,       false);
      ObjectSetInteger(0, box, OBJPROP_BACK,       true);
      ObjectSetInteger(0, box, OBJPROP_SELECTABLE, false);
   }
   string lbl = ObjLbl(mefs[i].id);
   double anchor = (mefs[i].dir == DIR_BULL) ? mefs[i].engHi : mefs[i].engLo;
   if(ObjectCreate(0, lbl, OBJ_TEXT, 0, mefs[i].engTime, anchor)) {
      ObjectSetString (0, lbl, OBJPROP_TEXT,
                       mefs[i].dir == DIR_BULL ? "Bull MEF" : "Bear MEF");
      ObjectSetInteger(0, lbl, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, lbl, OBJPROP_FONTSIZE,   InpFontSize);
      ObjectSetInteger(0, lbl, OBJPROP_ANCHOR,
                       mefs[i].dir == DIR_BULL ? ANCHOR_LOWER : ANCHOR_UPPER);
      ObjectSetInteger(0, lbl, OBJPROP_SELECTABLE, false);
   }
   // Gap SNR level
   string gap = ObjGap(mefs[i].id);
   if(ObjectCreate(0, gap, OBJ_TREND, 0, mefs[i].engTime, mefs[i].gapLevel,
                   mefs[i].engEnd, mefs[i].gapLevel)) {
      ObjectSetInteger(0, gap, OBJPROP_COLOR,      InpGapColor);
      ObjectSetInteger(0, gap, OBJPROP_STYLE,      STYLE_DASH);
      ObjectSetInteger(0, gap, OBJPROP_WIDTH,      1);
      ObjectSetInteger(0, gap, OBJPROP_RAY_RIGHT,  false);
      ObjectSetInteger(0, gap, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, gap, OBJPROP_BACK,       true);
   }
   // RBR/DBD base zone
   string bz = ObjBase(mefs[i].id);
   if(ObjectCreate(0, bz, OBJ_RECTANGLE, 0, mefs[i].engTime, mefs[i].baseHi,
                   mefs[i].engEnd, mefs[i].baseLo)) {
      ObjectSetInteger(0, bz, OBJPROP_COLOR,      InpBaseColor);
      ObjectSetInteger(0, bz, OBJPROP_WIDTH,      1);
      ObjectSetInteger(0, bz, OBJPROP_FILL,       true);
      ObjectSetInteger(0, bz, OBJPROP_BACK,       true);
      ObjectSetInteger(0, bz, OBJPROP_SELECTABLE, false);
   }
}

void KillMef(int i)
{
   ObjectDelete(0, ObjBox (mefs[i].id));
   ObjectDelete(0, ObjLbl (mefs[i].id));
   ObjectDelete(0, ObjGap (mefs[i].id));
   ObjectDelete(0, ObjBase(mefs[i].id));
   mefs[i].dead = true;
}

//+------------------------------------------------------------------+
// Detect a MEF whose main-TF strong engulfing completes at bar s (C2=s,C1=s+1).
void DetectMef(int s)
{
   int avail = iBars(_Symbol, InpMainTF);
   if(s + 1 >= avail) return;

   double c2o = iOpen (_Symbol, InpMainTF, s);
   double c2c = iClose(_Symbol, InpMainTF, s);
   double c2h = iHigh (_Symbol, InpMainTF, s);
   double c2l = iLow  (_Symbol, InpMainTF, s);
   double c1o = iOpen (_Symbol, InpMainTF, s + 1);
   double c1c = iClose(_Symbol, InpMainTF, s + 1);
   double c1h = iHigh (_Symbol, InpMainTF, s + 1);
   double c1l = iLow  (_Symbol, InpMainTF, s + 1);

   // STRONG (2-candle) engulfing only.
   bool isBull = (c1c < c1o) && (c2c > c2o) && (c2c > c1h);
   bool isBear = (c1c > c1o) && (c2c < c2o) && (c2c < c1l);
   if(!isBull && !isBear) return;
   int dir = isBull ? DIR_BULL : DIR_BEAR;

   // Engulfing candle window + price range (covers C1 manipulation + C2 engulf).
   datetime engTime = iTime(_Symbol, InpMainTF, s + 1);          // start at C1
   datetime engEnd  = iTime(_Symbol, InpMainTF, s) + PeriodSeconds(InpMainTF);
   double   pHi     = MathMax(c1h, c2h);
   double   pLo     = MathMin(c1l, c2l);

   // Dedup: one MEF per engulfing candle (C2 time).
   datetime c2Time = iTime(_Symbol, InpMainTF, s);
   for(int _k = 0; _k < mefTotal; _k++)
      if(!mefs[_k].dead && mefs[_k].engTime == engTime) return;

   // 1 TF lower: Gap SNR inside the candle.
   double gapLevel = FindGapSnr(dir, engTime, engEnd, pLo, pHi);
   if(gapLevel == 0.0) return;

   // 2 TF lower: RBR/DBD inside the candle.
   double baseHi = 0.0, baseLo = 0.0;
   if(!FindRbrDbd(dir, engTime, engEnd, pLo, pHi, baseHi, baseLo)) return;

   int idx = -1;
   for(int _k = 0; _k < mefTotal; _k++)
      if(mefs[_k].dead) { idx = _k; break; }
   if(idx < 0 && mefTotal < MAX_MEF) idx = mefTotal++;
   if(idx < 0) return;

   mefs[idx].id         = nextId++;
   mefs[idx].dir        = dir;
   mefs[idx].engHi      = c2h;
   mefs[idx].engLo      = c2l;
   mefs[idx].engTime    = engTime;
   mefs[idx].engEnd     = engEnd;
   mefs[idx].gapLevel   = gapLevel;
   mefs[idx].baseHi     = baseHi;
   mefs[idx].baseLo     = baseLo;
   mefs[idx].dead       = false;
   mefs[idx].ageCounter = 0;

   DrawMef(idx);
   if(InpShowLog)
      PrintFormat("MEF_CREATED | %s | main=%s gap=%s base=%s | eng=[%.5f,%.5f] gap=%.5f base=[%.5f,%.5f] | %s",
                  dir == DIR_BULL ? "BULL" : "BEAR",
                  EnumToString(InpMainTF), EnumToString(InpGapTF), EnumToString(InpBaseTF),
                  c2h, c2l, gapLevel, baseHi, baseLo,
                  TimeToString(c2Time, TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
void Maintain(int s)
{
   datetime t = iTime(_Symbol, InpMainTF, s);
   for(int i = 0; i < mefTotal; i++) {
      if(mefs[i].dead) continue;
      if(mefs[i].engEnd >= t) continue;
      mefs[i].ageCounter++;
      if(mefs[i].ageCounter >= InpExpiryBars) {
         if(InpShowLog) PrintFormat("MEF_EXPIRED | eng=[%.5f,%.5f]", mefs[i].engHi, mefs[i].engLo);
         KillMef(i);
      }
   }
}

//+------------------------------------------------------------------+
void Rebuild()
{
   ObjectsDeleteAll(0, OBJ_PREFIX);
   mefTotal = 0; nextId = 0;
   int scan = MathMin(InpLookback, iBars(_Symbol, InpMainTF) - 2);
   if(scan < 2) return;
   for(int s = scan; s >= 1; s--) {
      DetectMef(s);
      Maintain(s);
   }
}

//+------------------------------------------------------------------+
int OnInit()
{
   lastMainBar = 0;
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
   datetime curMain = iTime(_Symbol, InpMainTF, 0);
   if(curMain != lastMainBar) {
      lastMainBar = curMain;
      DetectMef(1);
      Maintain(1);
   }
   return rates_total;
}
`;
}
