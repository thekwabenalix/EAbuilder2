/**
 * SNR Module Library — Phase 2: Miss State Module
 *
 * Miss_State_Module v2.0.0
 * ────────────────────────────────────────────────
 * Embeds Classic + Gap S/R level detection and fires a CONFIRMED signal when
 * any candle comes within InpNearPoints of a level without its wick touching
 * it. The candle with the MINIMUM wick distance gets the signal (buffers update
 * if a closer candle appears before any touch). Two-candle SNR guard — never
 * reacts before Candle B closes.
 *
 * Phase 3 buffer contract (read via iCustom):
 *   0 : BullConfirmBuf — 1.0 at the closest bullish miss bar (off support)
 *   1 : BearConfirmBuf — 1.0 at the closest bearish miss bar (off resistance)
 *   2 : BullSLBuf      — the wick low of the closest miss (SL for bull entries)
 *   3 : BearSLBuf      — the wick high of the closest miss (SL for bear entries)
 *
 * Any wick touch of the level clears all buffers for that level and retires it.
 *
 * NO trading logic — state tracking, signal buffers, and visualisation only.
 */

export const MISS_STATE_MODULE_VERSION = "2.0.0";
export const MISS_STATE_MODULE = "Miss_State_Module";

export function generateMissStateModule(): string {
  return `//+------------------------------------------------------------------+
//| Miss_State_Module.mq5                                          |
//| SNR Module Library v${MISS_STATE_MODULE_VERSION} — Phase 2: State + Buffers |
//|                                                                  |
//| Any candle within InpNearPoints of an S/R level without touching |
//| fires a signal. The CLOSEST approach updates the buffers.       |
//| Wick contact retires the level and clears its buffers.          |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SNR Module Library"
#property version   "2.00"
#property strict
#property indicator_chart_window
#property indicator_buffers 4
#property indicator_plots   0

//--- Buffers (Phase 3 iCustom contract)
double BullConfirmBuf[];
double BearConfirmBuf[];
double BullSLBuf[];
double BearSLBuf[];

#define TYPE_SUPPORT      1
#define TYPE_RESISTANCE   2
#define LVL_MAX           600
#define OBJ_PREFIX        "SMCMISS_"

//--- Inputs — Detection
input ENUM_TIMEFRAMES InpTF          = PERIOD_CURRENT; // Timeframe
input int             InpLookback    = 500;            // Historical bars to scan
input double          InpNearATR     = 0.20;           // Proximity as ATR fraction (auto-scales to any instrument)
input int             InpATRPeriod   = 14;             // ATR lookback period
input int             InpNearPoints  = 0;              // Override: fixed distance in points (0 = use ATR)
input int             InpExpiryBars  = 200;            // Bars until a level expires (0 = never)
input bool            InpUseClassic  = true;           // Use Classic (reversal-pair) levels
input bool            InpUseGap      = true;           // Use Gap (continuation-pair) levels
//--- Inputs — Drawing
input bool            InpDraw        = true;           // Draw labels
input string          InpLabel       = "Ms";           // Label text
input int             InpFontSize    = 8;              // Label font size
input color           InpBullColor   = clrMediumSeaGreen; // Bullish miss (off support)
input color           InpBearColor   = clrTomato;          // Bearish miss (off resistance)
input bool            InpShowLog     = true;           // Print events to journal

//+------------------------------------------------------------------+
struct LevelRec
{
   int      id;
   int      type;           // TYPE_SUPPORT or TYPE_RESISTANCE
   double   level;          // Candle A close
   datetime levelTime;      // Candle A time
   datetime confirmTime;    // Candle B time — valid only AFTER this bar
   bool     broken;
   int      ageCounter;
   double   bestMissDist;   // smallest wick distance so far (DBL_MAX = none)
   int      bestMissSh;     // shift of current best-miss bar (-1 = none)
};

LevelRec levList[LVL_MAX];
int      levTotal = 0;
int      nextId   = 0;

//+------------------------------------------------------------------+
string MissLb(int lvId) { return OBJ_PREFIX + IntegerToString(lvId) + "_lb"; }

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
      if(levList[i].broken) { idx = i; break; }
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
   levList[idx].broken       = false;
   levList[idx].ageCounter   = 0;
   levList[idx].bestMissDist = DBL_MAX;
   levList[idx].bestMissSh   = -1;
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
      ObjectSetInteger(0, nm, OBJPROP_ANCHOR,     dir > 0 ? ANCHOR_UPPER : ANCHOR_LOWER);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
   }
}

//+------------------------------------------------------------------+
// Clear buffer entries written for the current best miss of level i.
void ClearMissBuffers(int i)
{
   int sh = levList[i].bestMissSh;
   if(sh < 0) return;
   int bufN = ArraySize(BullConfirmBuf);
   if(sh < bufN)
   {
      if(levList[i].type == TYPE_SUPPORT)
         { BullConfirmBuf[sh] = 0.0; BullSLBuf[sh] = 0.0; }
      else
         { BearConfirmBuf[sh] = 0.0; BearSLBuf[sh] = 0.0; }
   }
}

//+------------------------------------------------------------------+
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
// Check bar sh: touch kills level, closer approach updates buffers + label.
void CheckMiss(int sh)
{
   double   hi   = iHigh (_Symbol, InpTF, sh);
   double   lo   = iLow  (_Symbol, InpTF, sh);
   datetime t    = iTime (_Symbol, InpTF, sh);
   double   atr  = CalcATR(sh);
   double   near = (InpNearPoints > 0) ? InpNearPoints * _Point
                                       : InpNearATR * atr;
   int      bufN = ArraySize(BullConfirmBuf);

   for(int i = 0; i < levTotal; i++)
   {
      if(levList[i].broken) continue;
      if(levList[i].confirmTime >= t) continue;
      double lvl = levList[i].level;

      if(levList[i].type == TYPE_SUPPORT)
      {
         if(lo <= lvl)
         {
            // Wick touched support — not a miss zone anymore
            ClearMissBuffers(i);
            ObjectDelete(0, MissLb(levList[i].id));
            levList[i].broken = true;
            continue;
         }
         double dist = lo - lvl;
         if(dist <= near && dist < levList[i].bestMissDist)
         {
            ClearMissBuffers(i);
            levList[i].bestMissDist = dist;
            levList[i].bestMissSh   = sh;
            if(sh < bufN) { BullConfirmBuf[sh] = 1.0; BullSLBuf[sh] = lo; }
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
            // Wick touched resistance — not a miss zone anymore
            ClearMissBuffers(i);
            ObjectDelete(0, MissLb(levList[i].id));
            levList[i].broken = true;
            continue;
         }
         double dist = lvl - hi;
         if(dist <= near && dist < levList[i].bestMissDist)
         {
            ClearMissBuffers(i);
            levList[i].bestMissDist = dist;
            levList[i].bestMissSh   = sh;
            if(sh < bufN) { BearConfirmBuf[sh] = 1.0; BearSLBuf[sh] = hi; }
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
      if(levList[i].broken) continue;
      levList[i].ageCounter++;
      if(levList[i].ageCounter >= InpExpiryBars)
      {
         ClearMissBuffers(i);
         ObjectDelete(0, MissLb(levList[i].id));
         levList[i].broken = true;
      }
   }
}

//+------------------------------------------------------------------+
void ResetState()
{
   levTotal = 0;
   nextId   = 0;
   ObjectsDeleteAll(0, OBJ_PREFIX);
   ArrayInitialize(BullConfirmBuf, 0.0);
   ArrayInitialize(BearConfirmBuf, 0.0);
   ArrayInitialize(BullSLBuf,      0.0);
   ArrayInitialize(BearSLBuf,      0.0);
}

//+------------------------------------------------------------------+
int OnInit()
{
   SetIndexBuffer(0, BullConfirmBuf, INDICATOR_DATA);
   SetIndexBuffer(1, BearConfirmBuf, INDICATOR_DATA);
   SetIndexBuffer(2, BullSLBuf,      INDICATOR_DATA);
   SetIndexBuffer(3, BearSLBuf,      INDICATOR_DATA);
   ArraySetAsSeries(BullConfirmBuf, true);
   ArraySetAsSeries(BearConfirmBuf, true);
   ArraySetAsSeries(BullSLBuf,      true);
   ArraySetAsSeries(BearSLBuf,      true);
   IndicatorSetString(INDICATOR_SHORTNAME, "Miss_State v${MISS_STATE_MODULE_VERSION}");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   ObjectsDeleteAll(0, OBJ_PREFIX);
}

//+------------------------------------------------------------------+
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
   if(rates_total < 3) return 0;

   // ── Full recalculation ──────────────────────────────────────────
   if(prev_calculated == 0)
   {
      ResetState();
      int limit = (int)MathMin((long)(rates_total - 2), (long)InpLookback);
      if(limit < 1) return rates_total;
      for(int sh = limit; sh >= 1; sh--)
      {
         DetectLevels(sh + 1, sh);
         CheckMiss(sh);
         AgeLevels();
      }
      return rates_total;
   }

   // ── Live: one bar just closed ───────────────────────────────────
   if(sh1IsNewBar())
   {
      DetectLevels(2, 1);
      CheckMiss(1);
      AgeLevels();
   }
   return rates_total;
}

//+------------------------------------------------------------------+
bool sh1IsNewBar()
{
   static datetime last = 0;
   datetime t = iTime(_Symbol, InpTF, 0);
   if(t == last) return false;
   last = t;
   return true;
}
`;
}
