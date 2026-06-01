/**
 * SNR Module Library — Phase 1: Miss Detector
 *
 * Miss_Detector v2.0.0
 * ────────────────────────────────────────────────
 * A miss = price comes close to an S/R level but the candle's wick stops
 * before touching it. The CANDLE WITH THE MINIMUM DISTANCE to the level
 * (across all bars after formation) receives the "Ms" label.
 *
 * Rules:
 *   - Any wick TOUCH kills the level immediately — no miss is possible
 *     for a level price has already contacted.
 *   - Every bar (not just swing pivots) is evaluated.
 *   - The closest-approach candle is shown. The label updates in-place
 *     if a subsequent bar comes even closer.
 *   - Levels expire after InpExpiryBars bars (0 = never).
 *
 * JOURNAL:
 *   MISS_BULL | level | low | dist pts | time
 *   MISS_BEAR | level | high | dist pts | time
 *
 * NO trading logic. Detection and visualisation only.
 */

export const MISS_DETECTOR_VERSION = "2.0.0";
export const MISS_DETECTOR_MODULE = "Miss_Detector";

export function generateMissDetector(): string {
  return `//+------------------------------------------------------------------+
//| Miss_Detector.mq5                                              |
//| SNR Module Library v${MISS_DETECTOR_VERSION} — Phase 1: Detection Only  |
//|                                                                  |
//| Price fails to reach an S/R level. The candle with the minimum  |
//| wick-to-level distance gets the "Ms" label.                     |
//| Any wick touch kills the level — label is removed.             |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SNR Module Library"
#property version   "2.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define TYPE_SUPPORT      1
#define TYPE_RESISTANCE   2
#define LVL_MAX           600
#define OBJ_PREFIX        "SMCMISS_"

//--- Inputs — Detection
input ENUM_TIMEFRAMES InpTF         = PERIOD_CURRENT; // Timeframe
input int             InpLookback   = 500;            // Historical bars to scan
input double          InpNearATR    = 0.20;           // Proximity as ATR fraction (auto-scales to any instrument)
input int             InpATRPeriod  = 14;             // ATR lookback period
input int             InpNearPoints = 0;              // Override: fixed distance in points (0 = use ATR)
input int             InpExpiryBars = 200;            // Bars until a level expires (0 = never)
input bool            InpUseClassic = true;           // Use Classic (reversal-pair) levels
input bool            InpUseGap     = true;           // Use Gap (continuation-pair) levels
//--- Inputs — Drawing
input bool            InpDraw       = true;           // Draw labels
input string          InpLabel      = "Ms";           // Label text
input int             InpFontSize   = 8;              // Label font size
input color           InpBullColor  = clrMediumSeaGreen; // Bullish miss (off support)
input color           InpBearColor  = clrTomato;          // Bearish miss (off resistance)
input bool            InpShowLog    = true;           // Print events to journal

//+------------------------------------------------------------------+
struct LevelRec
{
   int      id;
   int      type;           // TYPE_SUPPORT or TYPE_RESISTANCE
   double   level;          // Candle A close
   datetime levelTime;      // Candle A time
   datetime confirmTime;    // Candle B time — level valid only AFTER this bar
   bool     dead;
   int      ageCounter;
   double   bestMissDist;   // smallest wick distance so far (DBL_MAX = no miss yet)
};

LevelRec levList[LVL_MAX];
int      levTotal    = 0;
int      nextId      = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
// Each level has exactly ONE label object — named by level ID.
// Re-creating it replaces the old one automatically.
string MissLb(int lvId) { return OBJ_PREFIX + IntegerToString(lvId) + "_lb"; }

//+------------------------------------------------------------------+
int CandleDir(int sh)
{
   double c = iClose(_Symbol, InpTF, sh);
   double o = iOpen (_Symbol, InpTF, sh);
   if(c > o) return  1;
   if(c < o) return -1;
   return 0;
}

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
   levList[idx].id           = nextId++;
   levList[idx].type         = type;
   levList[idx].level        = level;
   levList[idx].levelTime    = tA;
   levList[idx].confirmTime  = tB;
   levList[idx].dead         = false;
   levList[idx].ageCounter   = 0;
   levList[idx].bestMissDist = DBL_MAX;
}

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
// Draw (or move) the Ms label to the closest approach candle.
// Predictable object name → re-creating overwrites the old position.
void UpdateMissLabel(int i, int dir, double wickExtreme, datetime pivT)
{
   if(!InpDraw) return;
   string nm = MissLb(levList[i].id);
   ObjectDelete(0, nm);
   color c = (dir > 0) ? InpBullColor : InpBearColor;
   if(ObjectCreate(0, nm, OBJ_TEXT, 0, pivT, wickExtreme))
   {
      ObjectSetString (0, nm, OBJPROP_TEXT,       InpLabel);
      ObjectSetInteger(0, nm, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, nm, OBJPROP_FONTSIZE,   InpFontSize);
      // Bull: label below wick tip (away from the support above)
      // Bear: label above wick tip (away from the resistance below)
      ObjectSetInteger(0, nm, OBJPROP_ANCHOR,     dir > 0 ? ANCHOR_UPPER : ANCHOR_LOWER);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
   }
}

//+------------------------------------------------------------------+
// Simple ATR (mean true range) over InpATRPeriod bars before sh.
// Used to scale the proximity threshold to any instrument / timeframe.
double CalcATR(int sh)
{
   int avail = iBars(_Symbol, InpTF);
   if(avail < sh + InpATRPeriod + 2) return 0.0;
   double sum = 0.0;
   for(int k = sh + 1; k <= sh + InpATRPeriod; k++)
   {
      double h  = iHigh (_Symbol, InpTF, k);
      double l  = iLow  (_Symbol, InpTF, k);
      double pc = iClose(_Symbol, InpTF, k + 1);
      double tr = MathMax(h - l, MathMax(MathAbs(h - pc), MathAbs(l - pc)));
      sum += tr;
   }
   return sum / (double)InpATRPeriod;
}

//+------------------------------------------------------------------+
// Check bar sh against all live levels.
// Touch → level dead + label removed.
// Closer approach → label updated to this bar.
void CheckMiss(int sh)
{
   double   hi   = iHigh (_Symbol, InpTF, sh);
   double   lo   = iLow  (_Symbol, InpTF, sh);
   datetime t    = iTime (_Symbol, InpTF, sh);
   double   atr  = CalcATR(sh);
   double   near = (InpNearPoints > 0) ? InpNearPoints * _Point
                                       : InpNearATR * atr;

   for(int i = 0; i < levTotal; i++)
   {
      if(levList[i].dead) continue;
      // Two-candle guard: level not valid until after Candle B
      if(levList[i].confirmTime >= t) continue;
      double lvl = levList[i].level;

      if(levList[i].type == TYPE_SUPPORT)
      {
         if(lo <= lvl)
         {
            // Wick reached the support — this is a contact, not a miss
            ObjectDelete(0, MissLb(levList[i].id));
            levList[i].dead = true;
            continue;
         }
         double dist = lo - lvl;
         if(dist <= near && dist < levList[i].bestMissDist)
         {
            levList[i].bestMissDist = dist;
            UpdateMissLabel(i, 1, lo, t);
            if(InpShowLog)
               PrintFormat("MISS_BULL | level=%.5f | low=%.5f | dist=%.1f pts | time=%s",
                  lvl, lo, dist / _Point, TimeToString(t, TIME_DATE|TIME_MINUTES));
         }
      }
      else // RESISTANCE
      {
         if(hi >= lvl)
         {
            // Wick reached the resistance — contact, not a miss
            ObjectDelete(0, MissLb(levList[i].id));
            levList[i].dead = true;
            continue;
         }
         double dist = lvl - hi;
         if(dist <= near && dist < levList[i].bestMissDist)
         {
            levList[i].bestMissDist = dist;
            UpdateMissLabel(i, -1, hi, t);
            if(InpShowLog)
               PrintFormat("MISS_BEAR | level=%.5f | high=%.5f | dist=%.1f pts | time=%s",
                  lvl, hi, dist / _Point, TimeToString(t, TIME_DATE|TIME_MINUTES));
         }
      }
   }
}

//+------------------------------------------------------------------+
void AgeLevels()
{
   if(InpExpiryBars <= 0) return;
   for(int i = 0; i < levTotal; i++)
   {
      if(levList[i].dead) continue;
      levList[i].ageCounter++;
      if(levList[i].ageCounter >= InpExpiryBars)
      {
         ObjectDelete(0, MissLb(levList[i].id));
         levList[i].dead = true;
      }
   }
}

//+------------------------------------------------------------------+
void Rebuild()
{
   ObjectsDeleteAll(0, OBJ_PREFIX);
   levTotal = 0;
   nextId   = 0;

   int avail = iBars(_Symbol, InpTF);
   int scan  = MathMin(InpLookback, avail - 2);
   if(scan < 2) return;

   for(int sh = scan; sh >= 1; sh--)
   {
      DetectLevels(sh + 1, sh);
      CheckMiss(sh);
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
   ObjectsDeleteAll(0, OBJ_PREFIX);
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
      CheckMiss(1);
      AgeLevels();
   }
   return rates_total;
}
`;
}
