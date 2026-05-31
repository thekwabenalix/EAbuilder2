/**
 * SNR Module Library — Phase 1: Rejection Detector
 *
 * Rejection_Detector v1.0.0
 * ────────────────────────────────────────────────
 * Reactive SNR Rule 2: "A rejection is a candle that closes below a resistance
 * or above a support." The wick pierces an S/R level, but the candle CLOSES
 * BACK on the origin side — the level held.
 *
 * LEVEL SOURCE (embedded): Classic SNR (reversal pair) + Gap SNR (continuation
 *   pair). SNR price = Candle A close.
 *
 * REJECTION:
 *   Bullish (off SUPPORT):  Low ≤ level AND Close > level AND lowerWick large.
 *   Bearish (off RESISTANCE): High ≥ level AND Close < level AND upperWick large.
 *
 * DRAWN ELEMENTS:
 *   ▲ / ▼ arrow at the rejection candle.
 *   OBJ_TEXT label "REJ↑" / "REJ↓".
 *
 * JOURNAL:
 *   REJECTION_BULL | id | level | wickLow | time
 *   REJECTION_BEAR | id | level | wickHigh | time
 *
 * NO trading logic. Detection and visualisation only.
 */

export const REJECTION_DETECTOR_VERSION = "1.0.0";
export const REJECTION_DETECTOR_MODULE  = "Rejection_Detector";

export function generateRejectionDetector(): string {
  return `//+------------------------------------------------------------------+
//| Rejection_Detector.mq5                                         |
//| SNR Module Library v${REJECTION_DETECTOR_VERSION} — Phase 1: Detection Only  |
//|                                                                  |
//| Reactive SNR Rule 2: wick pierces an S/R level, close holds on  |
//| the origin side. Levels = Classic (reversal) + Gap (continuation)|
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
input ENUM_TIMEFRAMES InpTF           = PERIOD_CURRENT; // Timeframe
input int             InpLookback     = 500;            // Historical bars to scan
input double          InpMinWickRatio = 0.5;            // Rejection wick >= this fraction of range
input int             InpExpiryBars   = 150;            // Bars until a level expires (0 = never)
input bool            InpUseClassic   = true;           // Use Classic (reversal-pair) levels
input bool            InpUseGap       = true;           // Use Gap (continuation-pair) levels
input int             InpLineBars     = 4;               // Rejection line length (bars)
//--- Inputs — Colours
input color           InpBullColor    = clrMediumSeaGreen; // Bullish rejection
input color           InpBearColor    = clrTomato;          // Bearish rejection
input int             InpLineWidth    = 2;               // Rejection line width
input bool            InpShowLog      = true;            // Print events to journal

//+------------------------------------------------------------------+
struct LevelRec
{
   int      id;
   int      type;        // TYPE_SUPPORT or TYPE_RESISTANCE
   double   level;
   datetime levelTime;
   bool     broken;
   int      ageCounter;
};

LevelRec levList[LVL_MAX];
int      levTotal    = 0;
int      nextId      = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
string ObjLine(int id) { return "SMCREJ_" + IntegerToString(id) + "_ln"; }

int CandleDir(int sh)
{
   double c = iClose(_Symbol, InpTF, sh);
   double o = iOpen (_Symbol, InpTF, sh);
   if(c > o) return  1;
   if(c < o) return -1;
   return 0;
}

//+------------------------------------------------------------------+
//| Register a level (dedup by time+type). Recycle broken slots.    |
//+------------------------------------------------------------------+
void AddLevel(int type, double level, datetime lvlT)
{
   for(int i = 0; i < levTotal; i++)
      if(levList[i].levelTime == lvlT && levList[i].type == type) return;

   int idx = -1;
   for(int i = 0; i < levTotal; i++)
      if(levList[i].broken) { idx = i; break; }
   if(idx < 0)
   {
      if(levTotal >= LVL_MAX) return;
      idx = levTotal++;
   }
   levList[idx].id         = nextId++;
   levList[idx].type       = type;
   levList[idx].level      = level;
   levList[idx].levelTime  = lvlT;
   levList[idx].broken     = false;
   levList[idx].ageCounter = 0;
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

   double   lvl  = iClose(_Symbol, InpTF, shA);
   datetime tA   = iTime (_Symbol, InpTF, shA);

   if(InpUseClassic)
   {
      if(dirA > 0 && dirB < 0) AddLevel(TYPE_RESISTANCE, lvl, tA);
      if(dirA < 0 && dirB > 0) AddLevel(TYPE_SUPPORT,    lvl, tA);
   }
   if(InpUseGap)
   {
      if(dirA > 0 && dirB > 0) AddLevel(TYPE_SUPPORT,    lvl, tA);
      if(dirA < 0 && dirB < 0) AddLevel(TYPE_RESISTANCE, lvl, tA);
   }
}

//+------------------------------------------------------------------+
//| Draw a short slanted rejection line: from the wick extreme back  |
//| toward the level. Bull slants up-right, bear slants down-right.  |
//| Not a horizontal level line — it marks the rejection itself.     |
//+------------------------------------------------------------------+
void DrawRejection(int dir, double wickExtreme, datetime t, double lvl)
{
   int id = nextId++;
   string ln = ObjLine(id);
   // Right end projected InpLineBars into the future, anchored at the level price
   datetime tRight = t + (datetime)(PeriodSeconds(InpTF) * InpLineBars);
   color c = (dir > 0) ? InpBullColor : InpBearColor;

   if(ObjectCreate(0, ln, OBJ_TREND, 0, t, wickExtreme, tRight, lvl))
   {
      ObjectSetInteger(0, ln, OBJPROP_COLOR, c);
      ObjectSetInteger(0, ln, OBJPROP_WIDTH, InpLineWidth);
      ObjectSetInteger(0, ln, OBJPROP_RAY_RIGHT, false);
      ObjectSetInteger(0, ln, OBJPROP_RAY_LEFT,  false);
      ObjectSetInteger(0, ln, OBJPROP_BACK, false);
      ObjectSetInteger(0, ln, OBJPROP_SELECTABLE, false);
   }
   if(InpShowLog)
      PrintFormat("REJECTION_%s | level=%.5f | wick=%.5f | time=%s",
         dir > 0 ? "BULL" : "BEAR", lvl, wickExtreme,
         TimeToString(t, TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
//| Check bar sh for a rejection off any live level.                |
//+------------------------------------------------------------------+
void CheckRejection(int sh)
{
   double o = iOpen (_Symbol, InpTF, sh);
   double c = iClose(_Symbol, InpTF, sh);
   double h = iHigh (_Symbol, InpTF, sh);
   double l = iLow  (_Symbol, InpTF, sh);
   datetime t = iTime(_Symbol, InpTF, sh);
   double range = h - l;
   if(range <= 0) return;
   double lowerWick = MathMin(o, c) - l;
   double upperWick = h - MathMax(o, c);

   for(int i = 0; i < levTotal; i++)
   {
      if(levList[i].broken) continue;
      if(levList[i].levelTime >= t) continue;
      double lvl = levList[i].level;

      if(levList[i].type == TYPE_SUPPORT)
      {
         if(l <= lvl && c > lvl && lowerWick >= range * InpMinWickRatio)
            DrawRejection(1, l, t, lvl);
         if(c < lvl) levList[i].broken = true;
      }
      else // RESISTANCE
      {
         if(h >= lvl && c < lvl && upperWick >= range * InpMinWickRatio)
            DrawRejection(-1, h, t, lvl);
         if(c > lvl) levList[i].broken = true;
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
      if(levList[i].broken) continue;
      levList[i].ageCounter++;
      if(levList[i].ageCounter >= InpExpiryBars) levList[i].broken = true;
   }
}

//+------------------------------------------------------------------+
//| Full historical rebuild.                                        |
//+------------------------------------------------------------------+
void Rebuild()
{
   ObjectsDeleteAll(0, "SMCREJ_");
   levTotal = 0;
   nextId   = 0;

   int avail = iBars(_Symbol, InpTF);
   int scan  = MathMin(InpLookback, avail - 2);
   if(scan < 3) return;

   // Walk chronologically oldest → newest
   for(int sh = scan; sh >= 1; sh--)
   {
      DetectLevels(sh + 1, sh);  // candle pair forming a level
      CheckRejection(sh);        // is this bar a rejection?
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
   ObjectsDeleteAll(0, "SMCREJ_");
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
      // On each new bar: detect the newest level pair and check the just-closed bar
      DetectLevels(2, 1);
      CheckRejection(1);
      AgeLevels();
   }
   return rates_total;
}
`;
}
