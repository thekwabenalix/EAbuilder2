/**
 * SNR Module Library — Phase 1: Miss Detector
 *
 * Miss_Detector v1.0.0
 * ────────────────────────────────────────────────
 * Reactive SNR (Slide 27): "A miss is when price fails to touch a support/
 * resistance — it comes close but doesn't touch it. The miss strengthens/
 * validates the level and serves as liquidity."
 *
 * LEVEL SOURCE (embedded): Classic (reversal pair) + Gap (continuation pair).
 *   SNR price = Candle A close. Two-candle pattern — valid only AFTER Candle B.
 *
 * MISS:
 *   Bullish (off SUPPORT):  a swing LOW forms within InpNearPoints ABOVE a
 *     support without its low reaching the level.
 *   Bearish (off RESISTANCE): a swing HIGH forms within InpNearPoints BELOW a
 *     resistance without its high reaching the level.
 *
 * DRAWN ELEMENTS:
 *   The SNR level line (origin → miss pivot) + "Miss" label on the pivot.
 *
 * JOURNAL:
 *   MISS_BULL | level | pivotLow | time
 *   MISS_BEAR | level | pivotHigh | time
 *
 * NO trading logic. Detection and visualisation only.
 */

export const MISS_DETECTOR_VERSION = "1.0.0";
export const MISS_DETECTOR_MODULE  = "Miss_Detector";

export function generateMissDetector(): string {
  return `//+------------------------------------------------------------------+
//| Miss_Detector.mq5                                              |
//| SNR Module Library v${MISS_DETECTOR_VERSION} — Phase 1: Detection Only  |
//|                                                                  |
//| A swing turning point lands NEAR an S/R level without touching   |
//| it — the level is respected (liquidity). Levels = Classic + Gap. |
//| NO trading logic. Detection and visualisation only.            |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SNR Module Library"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define TYPE_SUPPORT      1
#define TYPE_RESISTANCE   2
#define LVL_MAX           600

//--- Inputs — Detection
input ENUM_TIMEFRAMES InpTF         = PERIOD_CURRENT; // Timeframe
input int             InpLookback   = 500;            // Historical bars to scan
input int             InpSwingLen   = 3;              // Pivot strength (bars each side)
input int             InpNearPoints = 50;             // Max distance to level (points)
input int             InpExpiryBars = 200;            // Bars until a level expires (0 = never)
input bool            InpUseClassic = true;           // Use Classic (reversal-pair) levels
input bool            InpUseGap     = true;           // Use Gap (continuation-pair) levels
//--- Inputs — Drawing
input int             InpLineBars   = 6;              // Level line right extension (bars)
input int             InpLineWidth  = 2;              // Level line width
input string          InpLabel      = "Ms";           // Label text
input int             InpFontSize   = 8;              // Label font size
input color           InpBullColor  = clrMediumSeaGreen; // Bullish miss (off support)
input color           InpBearColor  = clrTomato;          // Bearish miss (off resistance)
input bool            InpShowLog    = true;            // Print events to journal

//+------------------------------------------------------------------+
struct LevelRec
{
   int      id;
   int      type;        // TYPE_SUPPORT or TYPE_RESISTANCE
   double   level;       // Candle A close
   datetime levelTime;   // Candle A time (price origin)
   datetime confirmTime; // Candle B time — valid only AFTER this
   bool     dead;
   int      ageCounter;
};

LevelRec levList[LVL_MAX];
int      levTotal    = 0;
int      nextId      = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
string ObjLine(int id) { return "SMCMISS_" + IntegerToString(id) + "_ln"; }
string ObjLbl (int id) { return "SMCMISS_" + IntegerToString(id) + "_lb"; }

int CandleDir(int sh)
{
   double c = iClose(_Symbol, InpTF, sh);
   double o = iOpen (_Symbol, InpTF, sh);
   if(c > o) return  1;
   if(c < o) return -1;
   return 0;
}

//+------------------------------------------------------------------+
//| Register a level (dedup by Candle A time + type).               |
//+------------------------------------------------------------------+
void AddLevel(int type, double level, datetime tA, datetime tB)
{
   for(int i = 0; i < levTotal; i++)
      if(levList[i].levelTime == tA && levList[i].type == type) return;

   int idx = -1;
   for(int i = 0; i < levTotal; i++)
      if(levList[i].dead) { idx = i; break; }
   if(idx < 0)
   {
      if(levTotal >= LVL_MAX) return;
      idx = levTotal++;
   }
   levList[idx].id          = nextId++;
   levList[idx].type        = type;
   levList[idx].level       = level;
   levList[idx].levelTime   = tA;
   levList[idx].confirmTime = tB;
   levList[idx].dead        = false;
   levList[idx].ageCounter  = 0;
}

//+------------------------------------------------------------------+
//| Detect Classic + Gap levels from candle pair (shA older, shB).  |
//+------------------------------------------------------------------+
void DetectLevels(int shA, int shB)
{
   int avail = iBars(_Symbol, InpTF);
   if(shA >= avail || shB < 0) return;
   int dirA = CandleDir(shA);
   int dirB = CandleDir(shB);
   if(dirA == 0 || dirB == 0) return;

   double   lvl = iClose(_Symbol, InpTF, shA);
   datetime tA  = iTime (_Symbol, InpTF, shA);
   datetime tB  = iTime (_Symbol, InpTF, shB);

   if(InpUseClassic)
   {
      if(dirA > 0 && dirB < 0) AddLevel(TYPE_RESISTANCE, lvl, tA, tB);
      if(dirA < 0 && dirB > 0) AddLevel(TYPE_SUPPORT,    lvl, tA, tB);
   }
   if(InpUseGap)
   {
      if(dirA > 0 && dirB > 0) AddLevel(TYPE_SUPPORT,    lvl, tA, tB);
      if(dirA < 0 && dirB < 0) AddLevel(TYPE_RESISTANCE, lvl, tA, tB);
   }
}

//+------------------------------------------------------------------+
//| Mark any level broken if a candle closes through it.            |
//+------------------------------------------------------------------+
void CheckBreakouts(int sh)
{
   double   c = iClose(_Symbol, InpTF, sh);
   datetime t = iTime (_Symbol, InpTF, sh);
   for(int i = 0; i < levTotal; i++)
   {
      if(levList[i].dead) continue;
      if(levList[i].confirmTime >= t) continue;
      double lvl = levList[i].level;
      if(levList[i].type == TYPE_SUPPORT    && c < lvl) levList[i].dead = true;
      if(levList[i].type == TYPE_RESISTANCE && c > lvl) levList[i].dead = true;
   }
}

//+------------------------------------------------------------------+
//| Is bar sh a confirmed swing pivot? +1 high, -1 low, 0 none.     |
//+------------------------------------------------------------------+
int PivotDir(int sh)
{
   int total = iBars(_Symbol, InpTF);
   if(sh + InpSwingLen >= total || sh - InpSwingLen < 0) return 0;
   double hi = iHigh(_Symbol, InpTF, sh);
   double lo = iLow (_Symbol, InpTF, sh);
   bool isHigh = true, isLow = true;
   for(int j = sh - InpSwingLen; j <= sh + InpSwingLen; j++)
   {
      if(j == sh) continue;
      if(iHigh(_Symbol, InpTF, j) >= hi) isHigh = false;
      if(iLow (_Symbol, InpTF, j) <= lo) isLow  = false;
   }
   if(isHigh) return 1;
   if(isLow)  return -1;
   return 0;
}

//+------------------------------------------------------------------+
//| Draw the level line (origin → miss pivot) + "Miss" label.       |
//+------------------------------------------------------------------+
void DrawMiss(int dir, double pivExtreme, datetime levelTime, datetime pivT, double lvl)
{
   int id = nextId++;
   string ln  = ObjLine(id);
   string lbl = ObjLbl(id);
   color c = (dir > 0) ? InpBullColor : InpBearColor;

   datetime tLeft  = (levelTime > 0 && levelTime < pivT) ? levelTime : pivT;
   datetime tRight = pivT + (datetime)(PeriodSeconds(InpTF) * InpLineBars);
   if(ObjectCreate(0, ln, OBJ_TREND, 0, tLeft, lvl, tRight, lvl))
   {
      ObjectSetInteger(0, ln, OBJPROP_COLOR, c);
      ObjectSetInteger(0, ln, OBJPROP_WIDTH, InpLineWidth);
      ObjectSetInteger(0, ln, OBJPROP_STYLE, STYLE_DOT);
      ObjectSetInteger(0, ln, OBJPROP_RAY_RIGHT, false);
      ObjectSetInteger(0, ln, OBJPROP_RAY_LEFT,  false);
      ObjectSetInteger(0, ln, OBJPROP_BACK, false);
      ObjectSetInteger(0, ln, OBJPROP_SELECTABLE, false);
   }
   // Label on the miss pivot (bull → below the swing low, bear → above the swing high)
   if(ObjectCreate(0, lbl, OBJ_TEXT, 0, pivT, pivExtreme))
   {
      ObjectSetString (0, lbl, OBJPROP_TEXT, InpLabel);
      ObjectSetInteger(0, lbl, OBJPROP_COLOR, c);
      ObjectSetInteger(0, lbl, OBJPROP_FONTSIZE, InpFontSize);
      // Bull miss: label below swing low (away from level above), Bear miss: label above swing high
      ObjectSetInteger(0, lbl, OBJPROP_ANCHOR, dir > 0 ? ANCHOR_UPPER : ANCHOR_LOWER);
      ObjectSetInteger(0, lbl, OBJPROP_SELECTABLE, false);
   }
   if(InpShowLog)
      PrintFormat("MISS_%s | level=%.5f | pivot=%.5f | time=%s",
         dir > 0 ? "BULL" : "BEAR", lvl, pivExtreme,
         TimeToString(pivT, TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
//| Check the pivot at bar sh for a miss against any live level.    |
//+------------------------------------------------------------------+
void CheckMiss(int sh)
{
   int pd = PivotDir(sh);
   if(pd == 0) return;

   double pivLo = iLow (_Symbol, InpTF, sh);
   double pivHi = iHigh(_Symbol, InpTF, sh);
   datetime pivT = iTime(_Symbol, InpTF, sh);
   double near = InpNearPoints * _Point;

   for(int i = 0; i < levTotal; i++)
   {
      if(levList[i].dead) continue;
      // Pivot must be after Candle B (SNR not valid until its second candle).
      if(levList[i].confirmTime >= pivT) continue;
      double lvl = levList[i].level;

      if(pd == -1 && levList[i].type == TYPE_SUPPORT)
      {
         if(pivLo > lvl && (pivLo - lvl) <= near)
            DrawMiss(1, pivLo, levList[i].levelTime, pivT, lvl);
      }
      else if(pd == 1 && levList[i].type == TYPE_RESISTANCE)
      {
         if(pivHi < lvl && (lvl - pivHi) <= near)
            DrawMiss(-1, pivHi, levList[i].levelTime, pivT, lvl);
      }
   }
}

//+------------------------------------------------------------------+
//| Age + expire levels.                                            |
//+------------------------------------------------------------------+
void AgeLevels()
{
   if(InpExpiryBars <= 0) return;
   for(int i = 0; i < levTotal; i++)
   {
      if(levList[i].dead) continue;
      levList[i].ageCounter++;
      if(levList[i].ageCounter >= InpExpiryBars) levList[i].dead = true;
   }
}

//+------------------------------------------------------------------+
//| Full historical rebuild.                                        |
//+------------------------------------------------------------------+
void Rebuild()
{
   ObjectsDeleteAll(0, "SMCMISS_");
   levTotal = 0;
   nextId   = 0;

   int avail = iBars(_Symbol, InpTF);
   int scan  = MathMin(InpLookback, avail - 2);
   if(scan < InpSwingLen + 2) return;

   for(int sh = scan; sh >= 1; sh--)
   {
      DetectLevels(sh + 1, sh);
      CheckBreakouts(sh);   // invalidate levels price has already closed through
      if(sh >= InpSwingLen + 1) CheckMiss(sh);
      AgeLevels();
   }
}

//+------------------------------------------------------------------+
int OnInit()
{
   lastBarTime = 0;
   Rebuild();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   ObjectsDeleteAll(0, "SMCMISS_");
}

int OnCalculate(const int rates_total,
                const int prev_calculated,
                const datetime &time[],
                const double &open[],
                const double &high[],
                const double &low[],
                const double &close[],
                const long &tick_volume[],
                const long &volume[],
                const int &spread[])
{
   datetime curBar = iTime(_Symbol, InpTF, 0);
   if(curBar != lastBarTime)
   {
      lastBarTime = curBar;
      DetectLevels(2, 1);
      CheckBreakouts(1);
      CheckMiss(InpSwingLen + 1);
      AgeLevels();
   }
   return rates_total;
}
`;
}
