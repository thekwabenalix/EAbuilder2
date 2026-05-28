/**
 * SMC Module Library — Phase 1: BOS Detector v2.0.0
 *
 * Break of Structure — clean, filtered, self-cleaning.
 *
 * BULLISH BOS: close > valid swing high → solid line from swing → break bar
 * BEARISH BOS: close < valid swing low  → solid line from swing → break bar
 *
 * SELF-CLEANING:
 *   Active BOS lines are removed when price closes back through them.
 *   Bullish BOS at X is removed when close < X.
 *   Bearish BOS at X is removed when close > X.
 *
 * PIVOT FILTERS (reduce noise):
 *   InpPivotLen    — bars required on each side (default 5)
 *   InpMinSwingPts — new swing must be at least N points from previous
 *                    swing of same type (0 = off)
 *   InpUseAtrFilt  — replace point distance with ATR × multiplier
 *   InpMaxBosLines — oldest active BOS removed when count exceeds limit
 *
 * RULES:
 *   • A swing can only generate one BOS (consumed flag).
 *   • Multiple unbroken swings can be tested each bar — filters control quantity.
 *   • No CHoCH. No trend state. No trade logic.
 *
 * JOURNAL:
 *   BULLISH_BOS | id | price | time
 *   BEARISH_BOS | id | price | time
 *   BOS_INVALIDATED | id | dir | price | time
 *
 * Detection and visualisation only.
 */

export const BOS_DETECTOR_VERSION = "2.0.0";
export const BOS_DETECTOR_MODULE  = "BOS_Detector";

export function generateBosDetector(): string {
  return `//+------------------------------------------------------------------+
//| BOS_Detector.mq5                                                |
//| SMC Module Library v${BOS_DETECTOR_VERSION} — Phase 1: Detection Only       |
//|                                                                  |
//| Clean Break of Structure detector.                               |
//|                                                                  |
//| BULLISH BOS: close > valid swing high                           |
//| BEARISH BOS: close < valid swing low                            |
//|                                                                  |
//| BOS lines are REMOVED when price closes back through them.      |
//| Filters: pivot length · min distance · ATR filter · max lines   |
//|                                                                  |
//| NO CHoCH. NO trend state. NO trade logic.                        |
//| Detection and visualisation only.                               |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SMC Module Library"
#property version   "2.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define SWING_HIGH  1
#define SWING_LOW  -1

enum ENUM_CONFIRM_MODE
{
   CONFIRM_CLOSE = 0, // Candle close beyond level
   CONFIRM_WICK  = 1  // Wick breach of level
};

//--- Inputs — Detection
input ENUM_TIMEFRAMES   InpTF          = PERIOD_CURRENT; // Timeframe
input int               InpLookback    = 500;             // Historical bars to scan on load
input int               InpPivotLen    = 5;               // Pivot length: bars required each side
input ENUM_CONFIRM_MODE InpConfirmMode = CONFIRM_CLOSE;  // Break confirmation mode

//--- Inputs — Filters
input int    InpMinSwingPts = 0;    // Min swing size in points from prev same-type swing (0=off)
input bool   InpUseAtrFilt  = false; // Use ATR-based distance filter instead of fixed points
input double InpAtrMult     = 1.0;  // ATR multiplier (active when InpUseAtrFilt=true)
input int    InpAtrPeriod   = 14;   // ATR period for distance filter

//--- Inputs — Display
input int InpMaxBosLines = 20; // Max active BOS lines (oldest removed when exceeded)

//--- Inputs — Colours
input color InpBullColor = clrLimeGreen; // Bullish BOS colour
input color InpBearColor = clrCrimson;   // Bearish BOS colour
input int   InpOpacity   = 85;           // Line and label opacity 0-100

//--- Inputs — Logging
input bool InpShowLog = true; // Print BOS events to journal

#define SWING_MAX 800
#define BOS_MAX   400

struct SwingRecord
{
   int      id;
   int      type;     // SWING_HIGH or SWING_LOW
   double   price;
   datetime time;
   bool     consumed; // true once it has generated one BOS
};

struct BosRecord
{
   int      id;
   int      dir;        // +1 bullish, -1 bearish
   double   level;      // the swing price that was broken
   datetime swingTime;  // left edge of the line
   datetime breakTime;  // right edge of the line (break bar)
   bool     active;     // false = invalidated, objects deleted
   bool     drawn;      // true once chart objects have been created
};

SwingRecord swingList[SWING_MAX];
BosRecord   bosRecord [BOS_MAX];
int      swingTotal  = 0;
int      bosTotal    = 0;
int      nextSwingId = 0;
int      nextBosId   = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
color BlendWithBg(color base, int opacityPct)
{
   color  bg = (color)ChartGetInteger(0, CHART_COLOR_BACKGROUND);
   double t  = MathMax(0.0, MathMin(100.0, (double)opacityPct)) / 100.0;
   int baseR = (int)( base & 0xFF);        int bgR = (int)( bg & 0xFF);
   int baseG = (int)((base >>  8) & 0xFF); int bgG = (int)((bg >>  8) & 0xFF);
   int baseB = (int)((base >> 16) & 0xFF); int bgB = (int)((bg >> 16) & 0xFF);
   int r = (int)(baseR * t + bgR * (1.0 - t));
   int g = (int)(baseG * t + bgG * (1.0 - t));
   int b = (int)(baseB * t + bgB * (1.0 - t));
   return (color)(r | (g << 8) | (b << 16));
}

//+------------------------------------------------------------------+
//| Self-contained ATR: simple mean of True Range over [sh, sh+per) |
//+------------------------------------------------------------------+
double CalcATR(int sh, int period)
{
   int avail = iBars(_Symbol, InpTF);
   if(sh + period + 1 >= avail) return 0.0;
   double sum = 0.0;
   for(int i = sh; i < sh + period; i++)
   {
      double hi = iHigh (_Symbol, InpTF, i);
      double lo = iLow  (_Symbol, InpTF, i);
      double pc = iClose(_Symbol, InpTF, i + 1);
      double tr = MathMax(hi - lo, MathMax(MathAbs(hi - pc), MathAbs(lo - pc)));
      sum += tr;
   }
   return sum / period;
}

//+------------------------------------------------------------------+
//| Minimum swing size threshold.                                    |
//| Returns 0 when both filters are off.                            |
//+------------------------------------------------------------------+
double MinSwingDist(int sh)
{
   if(InpUseAtrFilt)
      return InpAtrMult * CalcATR(sh, InpAtrPeriod);
   if(InpMinSwingPts > 0)
      return InpMinSwingPts * _Point;
   return 0.0;
}

//+------------------------------------------------------------------+
//| Scan bar sh as a candidate swing high / swing low.              |
//|                                                                  |
//| Requires InpPivotLen bars on each side.                         |
//| Distance filter: new swing must differ from the most recent      |
//| swing of the same type by at least MinSwingDist.                |
//+------------------------------------------------------------------+
void SWING_ScanBar(int sh)
{
   int avail = iBars(_Symbol, InpTF);
   if(sh < InpPivotLen + 1 || sh + InpPivotLen >= avail) return;

   double   hi = iHigh(_Symbol, InpTF, sh);
   double   lo = iLow (_Symbol, InpTF, sh);
   datetime t  = iTime(_Symbol, InpTF, sh);

   bool isHigh = true, isLow = true;
   for(int k = 1; k <= InpPivotLen && (isHigh || isLow); k++)
   {
      if(iHigh(_Symbol, InpTF, sh + k) >= hi) isHigh = false;
      if(iHigh(_Symbol, InpTF, sh - k) >= hi) isHigh = false;
      if(iLow (_Symbol, InpTF, sh + k) <= lo) isLow  = false;
      if(iLow (_Symbol, InpTF, sh - k) <= lo) isLow  = false;
   }

   double minDist = MinSwingDist(sh);

   // ── Swing High ────────────────────────────────────────────────────
   if(isHigh && swingTotal < SWING_MAX)
   {
      // Dedup by time
      bool dup = false;
      for(int i = 0; i < swingTotal; i++)
         if(swingList[i].type == SWING_HIGH && swingList[i].time == t) { dup=true; break; }

      if(!dup)
      {
         // Distance filter: check against the most recent swing high
         bool tooClose = false;
         if(minDist > 0.0)
         {
            datetime bestT = 0; double bestP = 0;
            for(int i = 0; i < swingTotal; i++)
               if(swingList[i].type == SWING_HIGH && swingList[i].time > bestT)
               { bestT = swingList[i].time; bestP = swingList[i].price; }
            if(bestT > 0 && MathAbs(hi - bestP) < minDist) tooClose = true;
         }

         if(!tooClose)
         {
            int idx = swingTotal++;
            swingList[idx].id       = nextSwingId++;
            swingList[idx].type     = SWING_HIGH;
            swingList[idx].price    = hi;
            swingList[idx].time     = t;
            swingList[idx].consumed = false;
         }
      }
   }

   // ── Swing Low ─────────────────────────────────────────────────────
   if(isLow && swingTotal < SWING_MAX)
   {
      bool dup = false;
      for(int i = 0; i < swingTotal; i++)
         if(swingList[i].type == SWING_LOW && swingList[i].time == t) { dup=true; break; }

      if(!dup)
      {
         bool tooClose = false;
         if(minDist > 0.0)
         {
            datetime bestT = 0; double bestP = 0;
            for(int i = 0; i < swingTotal; i++)
               if(swingList[i].type == SWING_LOW && swingList[i].time > bestT)
               { bestT = swingList[i].time; bestP = swingList[i].price; }
            if(bestT > 0 && MathAbs(lo - bestP) < minDist) tooClose = true;
         }

         if(!tooClose)
         {
            int idx = swingTotal++;
            swingList[idx].id       = nextSwingId++;
            swingList[idx].type     = SWING_LOW;
            swingList[idx].price    = lo;
            swingList[idx].time     = t;
            swingList[idx].consumed = false;
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Delete chart objects for a BOS record.                          |
//| Safe to call even if objects do not exist.                       |
//+------------------------------------------------------------------+
void BOS_DeleteObjects(int idx)
{
   string pfx = "SMCBOS_" + IntegerToString(bosRecord[idx].id);
   ObjectDelete(0, pfx + "_line");
   ObjectDelete(0, pfx + "_lbl");
}

//+------------------------------------------------------------------+
//| Remove oldest active BOS lines until count <= InpMaxBosLines.  |
//+------------------------------------------------------------------+
void BOS_EnforceLimit()
{
   if(InpMaxBosLines <= 0) return;

   // Count active
   int activeCount = 0;
   for(int i = 0; i < bosTotal; i++)
      if(bosRecord[i].active) activeCount++;

   while(activeCount > InpMaxBosLines)
   {
      datetime oldestT = (datetime)LONG_MAX;
      int oldestIdx = -1;
      for(int i = 0; i < bosTotal; i++)
      {
         if(!bosRecord[i].active) continue;
         if(bosRecord[i].breakTime < oldestT)
         { oldestT = bosRecord[i].breakTime; oldestIdx = i; }
      }
      if(oldestIdx < 0) break;
      BOS_DeleteObjects(oldestIdx);
      bosRecord[oldestIdx].active = false;
      activeCount--;
   }
}

//+------------------------------------------------------------------+
//| Check bar sh for new structure breaks.                          |
//|                                                                  |
//| Tests all unconsumed swings that predate the bar.               |
//| Each unconsumed swing can produce at most one BOS.              |
//+------------------------------------------------------------------+
void BOS_CheckBreaks(int sh)
{
   double   barClose = iClose(_Symbol, InpTF, sh);
   double   barHigh  = iHigh (_Symbol, InpTF, sh);
   double   barLow   = iLow  (_Symbol, InpTF, sh);
   datetime barT     = iTime (_Symbol, InpTF, sh);

   double breakUp = (InpConfirmMode == CONFIRM_WICK) ? barHigh : barClose;
   double breakDn = (InpConfirmMode == CONFIRM_WICK) ? barLow  : barClose;

   for(int i = 0; i < swingTotal; i++)
   {
      if(swingList[i].consumed)            continue;
      if(swingList[i].time >= barT)        continue; // swing must predate this bar
      if(bosTotal >= BOS_MAX)              break;

      // ── Bullish BOS ───────────────────────────────────────────────
      if(swingList[i].type == SWING_HIGH && breakUp > swingList[i].price)
      {
         swingList[i].consumed = true;
         int j = bosTotal++;
         bosRecord[j].id        = nextBosId++;
         bosRecord[j].dir       = +1;
         bosRecord[j].level     = swingList[i].price;
         bosRecord[j].swingTime = swingList[i].time;
         bosRecord[j].breakTime = barT;
         bosRecord[j].active    = true;
         bosRecord[j].drawn     = false;

         if(InpShowLog)
            PrintFormat("BULLISH_BOS | id=%d | price=%.5f | time=%s",
               bosRecord[j].id, bosRecord[j].level,
               TimeToString(barT, TIME_DATE|TIME_MINUTES));
      }
      // ── Bearish BOS ───────────────────────────────────────────────
      else if(swingList[i].type == SWING_LOW && breakDn < swingList[i].price)
      {
         swingList[i].consumed = true;
         int j = bosTotal++;
         bosRecord[j].id        = nextBosId++;
         bosRecord[j].dir       = -1;
         bosRecord[j].level     = swingList[i].price;
         bosRecord[j].swingTime = swingList[i].time;
         bosRecord[j].breakTime = barT;
         bosRecord[j].active    = true;
         bosRecord[j].drawn     = false;

         if(InpShowLog)
            PrintFormat("BEARISH_BOS | id=%d | price=%.5f | time=%s",
               bosRecord[j].id, bosRecord[j].level,
               TimeToString(barT, TIME_DATE|TIME_MINUTES));
      }
   }
}

//+------------------------------------------------------------------+
//| Check every active BOS line for invalidation on bar sh.        |
//|                                                                  |
//| Bullish BOS at X: invalidated when close < X                    |
//| Bearish BOS at X: invalidated when close > X                    |
//+------------------------------------------------------------------+
void BOS_CheckInvalidations(int sh)
{
   double   barClose = iClose(_Symbol, InpTF, sh);
   datetime barT     = iTime (_Symbol, InpTF, sh);

   for(int i = 0; i < bosTotal; i++)
   {
      if(!bosRecord[i].active) continue;

      bool inv = false;
      if(bosRecord[i].dir > 0 && barClose < bosRecord[i].level) inv = true;
      if(bosRecord[i].dir < 0 && barClose > bosRecord[i].level) inv = true;

      if(inv)
      {
         BOS_DeleteObjects(i);   // removes objects if they exist (silent if not)
         bosRecord[i].active = false;

         if(InpShowLog)
            PrintFormat("BOS_INVALIDATED | id=%d | %s | price=%.5f | time=%s",
               bosRecord[i].id,
               bosRecord[i].dir > 0 ? "BULLISH" : "BEARISH",
               bosRecord[i].level,
               TimeToString(barT, TIME_DATE|TIME_MINUTES));
      }
   }
}

//+------------------------------------------------------------------+
//| Draw one active BOS line and label.                             |
//+------------------------------------------------------------------+
void BOS_DrawLine(int idx)
{
   if(!bosRecord[idx].active) return;

   color rawClr = (bosRecord[idx].dir > 0) ? InpBullColor : InpBearColor;
   color clr    = BlendWithBg(rawClr, InpOpacity);

   string pfx     = "SMCBOS_" + IntegerToString(bosRecord[idx].id);
   string objLine = pfx + "_line";
   string objLbl  = pfx + "_lbl";
   string lbl     = bosRecord[idx].dir > 0 ? "Bull BOS" : "Bear BOS";

   if(ObjectCreate(0, objLine, OBJ_TREND, 0,
                   bosRecord[idx].swingTime, bosRecord[idx].level,
                   bosRecord[idx].breakTime, bosRecord[idx].level))
   {
      ObjectSetInteger(0, objLine, OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, objLine, OBJPROP_STYLE,      STYLE_SOLID);
      ObjectSetInteger(0, objLine, OBJPROP_WIDTH,      1);
      ObjectSetInteger(0, objLine, OBJPROP_RAY_RIGHT,  false);
      ObjectSetInteger(0, objLine, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, objLine, OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, objLine, OBJPROP_BACK,       true);
   }

   if(ObjectCreate(0, objLbl, OBJ_TEXT, 0,
                   bosRecord[idx].breakTime, bosRecord[idx].level))
   {
      ObjectSetString( 0, objLbl, OBJPROP_TEXT,     lbl);
      ObjectSetInteger(0, objLbl, OBJPROP_COLOR,    clr);
      ObjectSetInteger(0, objLbl, OBJPROP_FONTSIZE, 7);
      ObjectSetInteger(0, objLbl, OBJPROP_ANCHOR,
         bosRecord[idx].dir > 0 ? ANCHOR_LEFT_LOWER : ANCHOR_LEFT_UPPER);
      ObjectSetInteger(0, objLbl, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, objLbl, OBJPROP_HIDDEN,   true);
      ObjectSetInteger(0, objLbl, OBJPROP_BACK,     false);
   }

   bosRecord[idx].drawn = true;
}

//+------------------------------------------------------------------+
//| Draw all active BOS records that have not been drawn yet.       |
//+------------------------------------------------------------------+
void BOS_DrawNew()
{
   for(int i = 0; i < bosTotal; i++)
   {
      if(!bosRecord[i].active || bosRecord[i].drawn) continue;
      BOS_DrawLine(i);
   }
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
void DeleteAll()
{
   for(int i = ObjectsTotal(0) - 1; i >= 0; i--)
   {
      string nm = ObjectName(0, i);
      if(StringFind(nm, "SMCBOS_") == 0) ObjectDelete(0, nm);
   }
}

//+------------------------------------------------------------------+
int OnInit()
{
   DeleteAll();
   swingTotal=0; bosTotal=0; nextSwingId=0; nextBosId=0;

   int avail = iBars(_Symbol, InpTF);
   if(avail < 2 * InpPivotLen + 2)
   { Print("BOS_Detector: not enough bars."); return INIT_FAILED; }

   int limit = MathMin(InpLookback, avail - InpPivotLen - 2);

   // ── Step 1: Detect all valid swings ──────────────────────────────
   for(int sh = limit; sh >= InpPivotLen + 1; sh--)
      SWING_ScanBar(sh);

   // ── Step 2: Historical BOS + invalidation replay ──────────────────
   // Walk oldest → newest:
   //   • Check if bar breaks any unconsumed swing → create BOS
   //   • Check if bar invalidates any active BOS  → deactivate
   //   • Enforce max line limit
   for(int sh = limit; sh >= 1; sh--)
   {
      BOS_CheckBreaks(sh);
      BOS_CheckInvalidations(sh);
      BOS_EnforceLimit();
   }

   // ── Step 3: Draw surviving active BOS lines ───────────────────────
   BOS_DrawNew();

   // ── Summary ───────────────────────────────────────────────────────
   int nActive=0, nBull=0, nBear=0;
   for(int i=0; i<bosTotal; i++)
      if(bosRecord[i].active) { nActive++; bosRecord[i].dir>0 ? nBull++ : nBear++; }

   PrintFormat("BOS_Detector v2 ready | active: bull=%d bear=%d | "
               "swings=%d | %s %s",
               nBull, nBear, swingTotal, _Symbol, EnumToString(InpTF));
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason) { DeleteAll(); ChartRedraw(0); }

//+------------------------------------------------------------------+
int OnCalculate(const int rates_total, const int prev_calculated,
                const datetime &time[], const double &open[],
                const double &high[], const double &low[],
                const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
{
   datetime currentBar = iTime(_Symbol, InpTF, 0);
   if(currentBar == lastBarTime) return rates_total;
   lastBarTime = currentBar;

   // 1. Confirm new swing (InpPivotLen right-side bars have now closed)
   SWING_ScanBar(InpPivotLen + 1);

   // 2. Check if bar 1 breaks any swing → new BOS
   BOS_CheckBreaks(1);

   // 3. Check if bar 1 invalidates any active BOS → delete objects
   BOS_CheckInvalidations(1);

   // 4. Enforce max visible line limit
   BOS_EnforceLimit();

   // 5. Draw any new BOS lines
   BOS_DrawNew();

   return rates_total;
}
`;
}
