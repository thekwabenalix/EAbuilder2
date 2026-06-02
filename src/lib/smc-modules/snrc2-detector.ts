/**
 * SNRC2 Detector — Support & Resistance Continuation 2
 *
 * A continuation pattern after a Classic SNR break, with a manipulation pullback
 * back across the broken level before continuation.
 *
 * BEARISH SNRC2 (5 swing points: L1 H1 L2 H2 L3):
 *   1. First Low (L1)            — the Classic SNR level
 *   2. Pullback high (H1)        — price rallies away from L1
 *   3. Second Low (L2 < L1)      — price breaks/closes below L1 (lower low)
 *   4. Manipulation high (H2)    — rally back ABOVE L1 (liquidity grab); SL ref
 *   5. Continuation low (L3 < L2)— price breaks below L2 → pattern confirmed
 *   Entry = L1 level · SL = manipulation high (H2) · Target = continuation lower
 *   Invalidation: close beyond the manipulation high (H2) → structure broken.
 *
 * BULLISH SNRC2 (mirror, R1 L1 R2 L2 R3):
 *   First High (R1) → pullback low → Second High (R2 > R1) → manipulation low
 *   (below R1) → continuation higher high (R3 > R2).
 *   Entry = R1 level · SL = manipulation low · invalid on close beyond it.
 *
 * Detection only — no trade execution.
 */

export const SNRC2_DETECTOR_VERSION = "1.0.0";
export const SNRC2_DETECTOR_MODULE = "SNRC2_Detector";

export function generateSnrc2Detector(): string {
  return `//+------------------------------------------------------------------+
//| SNRC2_Detector.mq5 — Support & Resistance Continuation 2        |
//| SNRC2 Detector v${SNRC2_DETECTOR_VERSION}                                |
//|                                                                  |
//| Continuation after a Classic SNR break with a manipulation       |
//| pullback across the broken level.                               |
//|   Bearish: L1 → H1 → L2(<L1) → H2(>L1) → L3(<L2)               |
//|   Bullish: R1 → L1 → R2(>R1) → ML(<R1) → R3(>R2)              |
//|   Entry = first level · SL = manipulation extreme.             |
//| Detection only — no trade logic.                                |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SNRC2"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define DIR_BULL    1
#define DIR_BEAR   -1
#define PV_HIGH     1
#define PV_LOW     -1
#define MAX_PIV     400
#define MAX_REC     200
#define OBJ_PREFIX  "SMSNRC2_"

input ENUM_TIMEFRAMES InpTF          = PERIOD_CURRENT;
input ENUM_TIMEFRAMES InpHtfTF       = PERIOD_H4;   // higher TF that must show an engulfing
input int             InpHtfLookback = 4;     // HTF bars before the pattern to find the engulfing
input int             InpLookback    = 400;   // bars to scan
input int             InpSwingStrength = 2;   // fractal strength (bars each side)
input int             InpExpiryBars  = 250;   // bars until an unfilled pattern is removed
input bool            InpDraw        = true;
input int             InpFontSize    = 8;
input color           InpBullColor   = clrLimeGreen;
input color           InpBearColor   = clrOrangeRed;
input color           InpEntryColor  = clrGold;
input color           InpSLColor     = clrCrimson;
input bool            InpShowLog     = true;

//--- Pivot list (alternating highs/lows, close confirmed) ---------------------
int      pvType[MAX_PIV];
double   pvPrice[MAX_PIV];   // high for PV_HIGH, low for PV_LOW
datetime pvTime[MAX_PIV];
int      pvCount = 0;

struct Rec
{
   int      id;
   int      dir;          // 1 bull, -1 bear
   double   entry;        // first level (L1 bear / R1 bull)
   double   sl;           // manipulation extreme (H2 high bear / ML low bull)
   double   secondExt;    // second low (bear) / second high (bull)
   double   contExt;      // continuation extreme (L3 / R3)
   double   resLevel;     // resistance/support that created the 1st level (H0 / L0)
   datetime t1;           // first pivot time
   datetime tRes;         // resistance/support pivot time
   datetime tManip;       // manipulation pivot time
   datetime tConf;        // confirmation (continuation) time
   bool     touched;      // entry tapped
   datetime endT;         // current right edge of entry line
   bool     dead;
   int      ageCounter;
};

Rec      recs[MAX_REC];
int      recTotal    = 0;
int      nextId      = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
bool IsPivotHigh(int sh, int k)
{
   double h = iHigh(_Symbol, InpTF, sh);
   for(int j = 1; j <= k; j++) {
      if(iHigh(_Symbol, InpTF, sh + j) >= h) return false;
      if(iHigh(_Symbol, InpTF, sh - j) >= h) return false;
   }
   return true;
}
bool IsPivotLow(int sh, int k)
{
   double l = iLow(_Symbol, InpTF, sh);
   for(int j = 1; j <= k; j++) {
      if(iLow(_Symbol, InpTF, sh + j) <= l) return false;
      if(iLow(_Symbol, InpTF, sh - j) <= l) return false;
   }
   return true;
}

//+------------------------------------------------------------------+
// Build an alternating pivot list (oldest → newest) over the lookback.
void BuildPivots()
{
   pvCount = 0;
   int k = MathMax(1, InpSwingStrength);
   int avail = iBars(_Symbol, InpTF);
   int hi = MathMin(InpLookback, avail - 1 - k);

   for(int sh = hi; sh >= k + 1; sh--)
   {
      bool ph = IsPivotHigh(sh, k);
      bool pl = IsPivotLow(sh, k);
      if(!ph && !pl) continue;

      int    typ = ph ? PV_HIGH : PV_LOW;
      double prc = ph ? iHigh(_Symbol, InpTF, sh) : iLow(_Symbol, InpTF, sh);
      datetime tm = iTime(_Symbol, InpTF, sh);

      if(pvCount == 0) {
         pvType[0] = typ; pvPrice[0] = prc; pvTime[0] = tm; pvCount = 1;
         continue;
      }
      int last = pvCount - 1;
      if(pvType[last] == typ) {
         // same type in a row → keep the more extreme one
         bool replace = (typ == PV_HIGH) ? (prc > pvPrice[last]) : (prc < pvPrice[last]);
         if(replace) { pvPrice[last] = prc; pvTime[last] = tm; }
      } else if(pvCount < MAX_PIV) {
         pvType[pvCount] = typ; pvPrice[pvCount] = prc; pvTime[pvCount] = tm; pvCount++;
      }
   }
}

//+------------------------------------------------------------------+
string ObjEntry(int id) { return OBJ_PREFIX + IntegerToString(id) + "_e"; }
string ObjEntryL(int id){ return OBJ_PREFIX + IntegerToString(id) + "_el"; }
string ObjSL(int id)    { return OBJ_PREFIX + IntegerToString(id) + "_sl"; }
string ObjSLL(int id)   { return OBJ_PREFIX + IntegerToString(id) + "_sll"; }
string ObjTag(int id, string s) { return OBJ_PREFIX + IntegerToString(id) + "_" + s; }

void Tag(int id, string key, datetime t, double price, string text, color clr, int anchor)
{
   if(!InpDraw) return;
   string nm = ObjTag(id, key);
   if(ObjectCreate(0, nm, OBJ_TEXT, 0, t, price)) {
      ObjectSetString (0, nm, OBJPROP_TEXT,       text);
      ObjectSetInteger(0, nm, OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, nm, OBJPROP_FONTSIZE,   InpFontSize);
      ObjectSetInteger(0, nm, OBJPROP_ANCHOR,     anchor);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
   }
}

void DrawRec(int i)
{
   if(!InpDraw) return;
   color c = (recs[i].dir == DIR_BULL) ? InpBullColor : InpBearColor;

   // Entry level — SHORT line, grows until tapped then freezes.
   string e = ObjEntry(recs[i].id);
   if(ObjectCreate(0, e, OBJ_TREND, 0, recs[i].t1, recs[i].entry, recs[i].endT, recs[i].entry)) {
      ObjectSetInteger(0, e, OBJPROP_COLOR,      InpEntryColor);
      ObjectSetInteger(0, e, OBJPROP_STYLE,      STYLE_SOLID);
      ObjectSetInteger(0, e, OBJPROP_WIDTH,      2);
      ObjectSetInteger(0, e, OBJPROP_RAY_RIGHT,  false);
      ObjectSetInteger(0, e, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, e, OBJPROP_BACK,       true);
   }
   Tag(recs[i].id, "el", recs[i].t1, recs[i].entry,
       recs[i].dir == DIR_BULL ? "SNRC2 Bull entry" : "SNRC2 Bear entry", InpEntryColor,
       recs[i].dir == DIR_BULL ? ANCHOR_LEFT_UPPER : ANCHOR_LEFT_LOWER);

   // SL zone — red box around the manipulation extreme.
   string sl = ObjSL(recs[i].id);
   double slHi = (recs[i].dir == DIR_BEAR) ? recs[i].sl    : recs[i].entry;
   double slLo = (recs[i].dir == DIR_BEAR) ? recs[i].entry : recs[i].sl;
   if(ObjectCreate(0, sl, OBJ_RECTANGLE, 0, recs[i].tManip, slHi, recs[i].endT, slLo)) {
      ObjectSetInteger(0, sl, OBJPROP_COLOR,      InpSLColor);
      ObjectSetInteger(0, sl, OBJPROP_FILL,       true);
      ObjectSetInteger(0, sl, OBJPROP_BACK,       true);
      ObjectSetInteger(0, sl, OBJPROP_SELECTABLE, false);
   }
   Tag(recs[i].id, "sll", recs[i].tManip, recs[i].sl, "SL", InpSLColor,
       recs[i].dir == DIR_BEAR ? ANCHOR_LEFT_LOWER : ANCHOR_LEFT_UPPER);

   // Resistance/support that created the 1st level — manipulation must stay inside it.
   string rl = ObjTag(recs[i].id, "resln");
   if(ObjectCreate(0, rl, OBJ_TREND, 0, recs[i].tRes, recs[i].resLevel,
                   recs[i].tManip, recs[i].resLevel)) {
      ObjectSetInteger(0, rl, OBJPROP_COLOR,      clrSlateGray);
      ObjectSetInteger(0, rl, OBJPROP_STYLE,      STYLE_DOT);
      ObjectSetInteger(0, rl, OBJPROP_RAY_RIGHT,  false);
      ObjectSetInteger(0, rl, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, rl, OBJPROP_BACK,       true);
   }
   Tag(recs[i].id, "res", recs[i].tRes, recs[i].resLevel,
       recs[i].dir == DIR_BEAR ? "Classic Res (no higher high)" : "Classic Sup (no lower low)",
       clrSlateGray,
       recs[i].dir == DIR_BEAR ? ANCHOR_LEFT_LOWER : ANCHOR_LEFT_UPPER);

   // Structure markers.
   if(recs[i].dir == DIR_BEAR) {
      Tag(recs[i].id, "m1", recs[i].t1,     recs[i].entry,     "1st Low",  c, ANCHOR_UPPER);
      Tag(recs[i].id, "m2", recs[i].tManip, recs[i].secondExt, "2nd Low",  c, ANCHOR_UPPER);
      Tag(recs[i].id, "m3", recs[i].tConf,  recs[i].contExt,   "Cont LL",  c, ANCHOR_UPPER);
   } else {
      Tag(recs[i].id, "m1", recs[i].t1,     recs[i].entry,     "1st High", c, ANCHOR_LOWER);
      Tag(recs[i].id, "m2", recs[i].tManip, recs[i].secondExt, "2nd High", c, ANCHOR_LOWER);
      Tag(recs[i].id, "m3", recs[i].tConf,  recs[i].contExt,   "Cont HH",  c, ANCHOR_LOWER);
   }
}

void KillRec(int i)
{
   ObjectDelete(0, ObjEntry(recs[i].id));
   ObjectDelete(0, ObjTag(recs[i].id, "el"));
   ObjectDelete(0, ObjSL(recs[i].id));
   ObjectDelete(0, ObjTag(recs[i].id, "sll"));
   ObjectDelete(0, ObjTag(recs[i].id, "m1"));
   ObjectDelete(0, ObjTag(recs[i].id, "m2"));
   ObjectDelete(0, ObjTag(recs[i].id, "m3"));
   ObjectDelete(0, ObjTag(recs[i].id, "resln"));
   ObjectDelete(0, ObjTag(recs[i].id, "res"));
   recs[i].dead = true;
}

//+------------------------------------------------------------------+
// Register a pattern (dedup by first-pivot time + direction).
void AddRec(int dir, double entry, double sl, double secondExt, double contExt, double resLevel,
            datetime t1, datetime tRes, datetime tManip, datetime tConf)
{
   for(int _k = 0; _k < recTotal; _k++)
      if(!recs[_k].dead && recs[_k].t1 == t1 && recs[_k].dir == dir) return;

   int idx = -1;
   for(int _k = 0; _k < recTotal; _k++)
      if(recs[_k].dead) { idx = _k; break; }
   if(idx < 0 && recTotal < MAX_REC) idx = recTotal++;
   if(idx < 0) return;

   recs[idx].id        = nextId++;
   recs[idx].dir       = dir;
   recs[idx].entry     = entry;
   recs[idx].sl        = sl;
   recs[idx].secondExt = secondExt;
   recs[idx].contExt   = contExt;
   recs[idx].resLevel  = resLevel;
   recs[idx].t1        = t1;
   recs[idx].tRes      = tRes;
   recs[idx].tManip    = tManip;
   recs[idx].tConf     = tConf;
   recs[idx].touched   = false;
   recs[idx].endT      = iTime(_Symbol, InpTF, 0);
   recs[idx].dead      = false;
   recs[idx].ageCounter = 0;

   DrawRec(idx);
   if(InpShowLog)
      PrintFormat("SNRC2_CREATED | %s | entry=%.5f | SL=%.5f | 2nd=%.5f | cont=%.5f | %s",
                  dir == DIR_BULL ? "BULL" : "BEAR", entry, sl, secondExt, contExt,
                  TimeToString(tConf, TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
// Strong (2-candle) engulfing of a given direction on a timeframe.
bool StrongEngulf(ENUM_TIMEFRAMES tf, int e, int dir)
{
   int avail = iBars(_Symbol, tf);
   if(e + 1 >= avail) return false;
   double c2o = iOpen (_Symbol, tf, e);
   double c2c = iClose(_Symbol, tf, e);
   double c1o = iOpen (_Symbol, tf, e + 1);
   double c1c = iClose(_Symbol, tf, e + 1);
   double c1h = iHigh (_Symbol, tf, e + 1);
   double c1l = iLow  (_Symbol, tf, e + 1);
   if(dir == DIR_BULL) return (c1c < c1o) && (c2c > c2o) && (c2c > c1h);
   return (c1c > c1o) && (c2c < c2o) && (c2c < c1l);
}

//+------------------------------------------------------------------+
// Classic SNR level at/around a pivot bar (the resistance/support that created
// the 1st level). Classic SNR = candle-pair reversal, level = candle A close:
//   Resistance: bullish A → bearish B    Support: bearish A → bullish B
// Returns the level, or 0.0 if no classic reversal is found near the pivot.
double ClassicLevel(datetime pivT, int dir)
{
   int p = iBarShift(_Symbol, InpTF, pivT);
   if(p < 1) return 0.0;
   int hiS = p + 3;
   int loS = MathMax(1, p - 1);
   for(int s = hiS; s >= loS; s--)              // A = s (older), B = s-1 (newer)
   {
      if(s - 1 < 0) continue;
      bool aBull = iClose(_Symbol, InpTF, s)   > iOpen(_Symbol, InpTF, s);
      bool aBear = iClose(_Symbol, InpTF, s)   < iOpen(_Symbol, InpTF, s);
      bool bBull = iClose(_Symbol, InpTF, s-1) > iOpen(_Symbol, InpTF, s-1);
      bool bBear = iClose(_Symbol, InpTF, s-1) < iOpen(_Symbol, InpTF, s-1);
      // bear SNRC2 needs the Classic RESISTANCE that created the 1st low
      if(dir == DIR_BEAR && aBull && bBear) return iClose(_Symbol, InpTF, s);
      // bull SNRC2 needs the Classic SUPPORT that created the 1st high
      if(dir == DIR_BULL && aBear && bBull) return iClose(_Symbol, InpTF, s);
   }
   return 0.0;
}

//+------------------------------------------------------------------+
// The setup is, like MEF, an HTF engulfing FIRST, then the pattern. So the HTF
// engulfing must occur at or BEFORE the pattern start (the candle that contains
// the first pivot, or up to InpHtfLookback HTF candles before it).
// No qualifying HTF engulfing → ignore the pattern.
bool HtfEngulfingPresent(int dir, datetime tPatternStart)
{
   int e0 = iBarShift(_Symbol, InpHtfTF, tPatternStart);
   if(e0 < 0) return false;
   for(int e = e0; e <= e0 + InpHtfLookback; e++)   // e0 = at start, higher e = older
      if(StrongEngulf(InpHtfTF, e, dir)) return true;
   return false;
}

//+------------------------------------------------------------------+
// Scan the pivot list for SNRC2 sequences and register them.
void Detect()
{
   // 6-pivot windows so we also have the resistance/support that created the 1st level.
   for(int i = 0; i + 5 < pvCount; i++)
   {
      // Bearish: H0 L1 H1 L2 H2 L3
      if(pvType[i]   == PV_HIGH && pvType[i+1] == PV_LOW  &&
         pvType[i+2] == PV_HIGH && pvType[i+3] == PV_LOW  &&
         pvType[i+4] == PV_HIGH && pvType[i+5] == PV_LOW)
      {
         double L1 = pvPrice[i+1], L2 = pvPrice[i+3],
                H2 = pvPrice[i+4], L3 = pvPrice[i+5];
         double res   = ClassicLevel(pvTime[i],   DIR_BEAR); // resistance that created the 1st low
         double entry = ClassicLevel(pvTime[i+1], DIR_BULL); // 1st low = Classic SUPPORT (entry on SNR)
         // break first low, manipulation above the SNR entry, continuation lower low,
         // manipulation must NOT exceed the Classic SNR resistance (no higher high),
         // and an HTF engulfing must precede the pattern.
         if(res > 0.0 && entry > 0.0 && L2 < L1 && L3 < L2 && H2 > entry && H2 < res
            && HtfEngulfingPresent(DIR_BEAR, pvTime[i+1]))
            AddRec(DIR_BEAR, entry, H2, L2, L3, res,
                   pvTime[i+1], pvTime[i], pvTime[i+4], pvTime[i+5]);
      }
      // Bullish: L0 R1 L1 R2 ML R3
      if(pvType[i]   == PV_LOW  && pvType[i+1] == PV_HIGH &&
         pvType[i+2] == PV_LOW  && pvType[i+3] == PV_HIGH &&
         pvType[i+4] == PV_LOW  && pvType[i+5] == PV_HIGH)
      {
         double R1 = pvPrice[i+1], R2 = pvPrice[i+3],
                ML = pvPrice[i+4], R3 = pvPrice[i+5];
         double sup   = ClassicLevel(pvTime[i],   DIR_BULL); // support that created the 1st high
         double entry = ClassicLevel(pvTime[i+1], DIR_BEAR); // 1st high = Classic RESISTANCE (entry on SNR)
         // break first high, manipulation below the SNR entry, continuation higher high,
         // manipulation must NOT exceed the Classic SNR support (no lower low),
         // and an HTF engulfing must precede the pattern.
         if(sup > 0.0 && entry > 0.0 && R2 > R1 && R3 > R2 && ML < entry && ML > sup
            && HtfEngulfingPresent(DIR_BULL, pvTime[i+1]))
            AddRec(DIR_BULL, entry, ML, R2, R3, sup,
                   pvTime[i+1], pvTime[i], pvTime[i+4], pvTime[i+5]);
      }
   }
}

//+------------------------------------------------------------------+
// Per-bar: extend entry line until tapped, invalidate on SL break, expire.
void Maintain(int sh)
{
   datetime t  = iTime (_Symbol, InpTF, sh);
   double   cl = iClose(_Symbol, InpTF, sh);
   double   bl = iLow  (_Symbol, InpTF, sh);
   double   bh = iHigh (_Symbol, InpTF, sh);
   for(int i = 0; i < recTotal; i++) {
      if(recs[i].dead) continue;
      if(recs[i].tConf >= t) continue;

      // Entry line grows until price taps the level, then freezes.
      if(!recs[i].touched) {
         bool touched = (recs[i].dir == DIR_BEAR) ? (bh >= recs[i].entry)
                                                  : (bl <= recs[i].entry);
         recs[i].endT = t;
         ObjectSetInteger(0, ObjEntry(recs[i].id), OBJPROP_TIME, 1, t);
         ObjectSetInteger(0, ObjSL(recs[i].id),    OBJPROP_TIME, 1, t);
         if(touched) {
            recs[i].touched = true;
            if(InpShowLog) PrintFormat("SNRC2_ENTRY_TAPPED | %.5f | %s",
                                       recs[i].entry, TimeToString(t, TIME_DATE|TIME_MINUTES));
         }
      }

      // Invalidation: price CLOSES beyond the setup (the SNR entry level).
      // Bearish setup dies on a close above the entry; bullish on a close below.
      if(recs[i].dir == DIR_BEAR && cl > recs[i].entry) {
         if(InpShowLog) PrintFormat("SNRC2_INVALIDATED (closed above setup) | entry=%.5f", recs[i].entry);
         KillRec(i);
         continue;
      }
      if(recs[i].dir == DIR_BULL && cl < recs[i].entry) {
         if(InpShowLog) PrintFormat("SNRC2_INVALIDATED (closed below setup) | entry=%.5f", recs[i].entry);
         KillRec(i);
         continue;
      }

      recs[i].ageCounter++;
      if(recs[i].ageCounter >= InpExpiryBars) {
         if(InpShowLog) PrintFormat("SNRC2_EXPIRED | entry=%.5f", recs[i].entry);
         KillRec(i);
      }
   }
}

//+------------------------------------------------------------------+
void Rebuild()
{
   ObjectsDeleteAll(0, OBJ_PREFIX);
   recTotal = 0; nextId = 0;
   BuildPivots();
   Detect();
   // replay maintenance bar-by-bar (oldest → newest)
   int scan = MathMin(InpLookback, iBars(_Symbol, InpTF) - 2);
   for(int sh = scan; sh >= 1; sh--) Maintain(sh);
}

//+------------------------------------------------------------------+
int OnInit()
{
   lastBarTime = 0;
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
   datetime curBar = iTime(_Symbol, InpTF, 0);
   if(curBar != lastBarTime) {
      lastBarTime = curBar;
      BuildPivots();
      Detect();
      Maintain(1);
   }
   return rates_total;
}
`;
}
