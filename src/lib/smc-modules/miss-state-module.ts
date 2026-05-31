/**
 * SNR Module Library — Phase 2: Miss State Module
 *
 * Miss_State_Module v1.0.0
 * ────────────────────────────────────────────────
 * Embeds Classic + Gap S/R level detection and fires a CONFIRMED signal when a
 * swing pivot lands NEAR a level without touching it (miss = liquidity / level
 * validation). Two-candle SNR guard — never reacts before Candle B closes.
 *
 * Phase 3 buffer contract (read via iCustom):
 *   0 : BullConfirmBuf — 1.0 at a bullish miss bar (swing low near support)
 *   1 : BearConfirmBuf — 1.0 at a bearish miss bar (swing high near resistance)
 *   2 : BullSLBuf      — the swing low itself (SL for bull entries)
 *   3 : BearSLBuf      — the swing high itself (SL for bear entries)
 *
 * Visual: the SNR level line (origin → miss pivot, dotted) + "Miss" label on
 *   the pivot.
 *
 * NO trading logic — state tracking, signal buffers, and visualisation only.
 */

export const MISS_STATE_MODULE_VERSION = "1.0.0";
export const MISS_STATE_MODULE  = "Miss_State_Module";

export function generateMissStateModule(): string {
  return `//+------------------------------------------------------------------+
//| Miss_State_Module.mq5                                          |
//| SNR Module Library v${MISS_STATE_MODULE_VERSION} — Phase 2: State + Buffers |
//|                                                                  |
//| Swing pivot lands NEAR an S/R level without touching → miss     |
//| CONFIRMED. Buffers 0/1 = bull/bear confirm, 2/3 = bull/bear SL. |
//| Levels = Classic (reversal) + Gap (continuation). Two-candle    |
//| guard — Candle B is never a miss.                               |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SNR Module Library"
#property version   "1.00"
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
input int             InpSwingLen    = 3;              // Pivot strength (bars each side)
input int             InpNearPoints  = 50;             // Max distance to level (points)
input int             InpExpiryBars  = 200;            // Bars until a level expires (0 = never)
input bool            InpUseClassic  = true;           // Use Classic (reversal-pair) levels
input bool            InpUseGap      = true;           // Use Gap (continuation-pair) levels
//--- Inputs — Drawing
input bool            InpDraw        = true;           // Draw level lines + labels
input int             InpLineBars    = 6;              // Level line right extension (bars)
input int             InpLineWidth   = 2;              // Level line width
input string          InpLabelText   = "Miss";         // Label text
input int             InpFontSize    = 8;              // Label font size
input color           InpBullColor   = clrMediumSeaGreen; // Bullish miss (off support)
input color           InpBearColor   = clrTomato;          // Bearish miss (off resistance)
input bool            InpShowLog     = true;           // Print events to journal

//+------------------------------------------------------------------+
struct LevelRec
{
   int      id;
   int      type;        // TYPE_SUPPORT or TYPE_RESISTANCE
   double   level;       // Candle A close
   datetime levelTime;   // Candle A time (price origin)
   datetime confirmTime; // Candle B time — valid only AFTER this
   bool     broken;
   int      ageCounter;
};

LevelRec levList[LVL_MAX];
int      levTotal = 0;
int      nextId   = 0;

//+------------------------------------------------------------------+
string ObjLine(int id) { return OBJ_PREFIX + IntegerToString(id) + "_ln"; }
string ObjLbl (int id) { return OBJ_PREFIX + IntegerToString(id) + "_lb"; }

int CandleDir(int sh)
{
   double c = iClose(_Symbol, InpTF, sh);
   double o = iOpen (_Symbol, InpTF, sh);
   if(c > o) return  1;
   if(c < o) return -1;
   return 0;
}

//+------------------------------------------------------------------+
//| Mark a level dead the moment any wick touches it.               |
//| Once touched (even a rejection wick) it is no longer a fresh    |
//| miss zone — price already reached it.                           |
//+------------------------------------------------------------------+
void CheckActivity(int sh)
{
   double   hi = iHigh(_Symbol, InpTF, sh);
   double   lo = iLow (_Symbol, InpTF, sh);
   datetime t  = iTime(_Symbol, InpTF, sh);
   for(int i = 0; i < levTotal; i++)
   {
      if(levList[i].broken) continue;
      if(levList[i].confirmTime >= t) continue;
      double lvl = levList[i].level;
      if(levList[i].type == TYPE_SUPPORT    && lo <= lvl) levList[i].broken = true;
      if(levList[i].type == TYPE_RESISTANCE && hi >= lvl) levList[i].broken = true;
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
   levList[idx].id          = nextId++;
   levList[idx].type        = type;
   levList[idx].level       = level;
   levList[idx].levelTime   = tA;
   levList[idx].confirmTime = tB;
   levList[idx].broken      = false;
   levList[idx].ageCounter  = 0;
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
void DrawMiss(int dir, double pivExtreme, datetime levelTime, datetime pivT, double lvl)
{
   if(!InpDraw) return;
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
   if(ObjectCreate(0, lbl, OBJ_TEXT, 0, pivT, pivExtreme))
   {
      ObjectSetString (0, lbl, OBJPROP_TEXT, InpLabelText);
      ObjectSetInteger(0, lbl, OBJPROP_COLOR, c);
      ObjectSetInteger(0, lbl, OBJPROP_FONTSIZE, InpFontSize);
      ObjectSetInteger(0, lbl, OBJPROP_ANCHOR, dir > 0 ? ANCHOR_UPPER : ANCHOR_LOWER);
      ObjectSetInteger(0, lbl, OBJPROP_SELECTABLE, false);
   }
}

//+------------------------------------------------------------------+
//| Check pivot at bar sh for a miss; write buffers + draw.         |
//+------------------------------------------------------------------+
void CheckMiss(int sh)
{
   int pd = PivotDir(sh);
   if(pd == 0) return;

   double pivLo = iLow (_Symbol, InpTF, sh);
   double pivHi = iHigh(_Symbol, InpTF, sh);
   datetime pivT = iTime(_Symbol, InpTF, sh);
   double near   = InpNearPoints * _Point;
   int    bufN   = ArraySize(BullConfirmBuf);

   for(int i = 0; i < levTotal; i++)
   {
      if(levList[i].broken) continue;
      // Two-candle guard — pivot must be after Candle B.
      if(levList[i].confirmTime >= pivT) continue;
      double lvl = levList[i].level;

      if(pd == -1 && levList[i].type == TYPE_SUPPORT)
      {
         if(pivLo > lvl && (pivLo - lvl) <= near)
         {
            if(sh < bufN) { BullConfirmBuf[sh] = 1.0; BullSLBuf[sh] = pivLo; }
            DrawMiss(1, pivLo, levList[i].levelTime, pivT, lvl);
            if(InpShowLog)
               PrintFormat("MISS_BULL | level=%.5f | pivot=%.5f | time=%s",
                  lvl, pivLo, TimeToString(pivT, TIME_DATE|TIME_MINUTES));
            levList[i].broken = true;  // one miss per level
         }
      }
      else if(pd == 1 && levList[i].type == TYPE_RESISTANCE)
      {
         if(pivHi < lvl && (lvl - pivHi) <= near)
         {
            if(sh < bufN) { BearConfirmBuf[sh] = 1.0; BearSLBuf[sh] = pivHi; }
            DrawMiss(-1, pivHi, levList[i].levelTime, pivT, lvl);
            if(InpShowLog)
               PrintFormat("MISS_BEAR | level=%.5f | pivot=%.5f | time=%s",
                  lvl, pivHi, TimeToString(pivT, TIME_DATE|TIME_MINUTES));
            levList[i].broken = true;  // one miss per level
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
      if(levList[i].ageCounter >= InpExpiryBars) levList[i].broken = true;
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
   if(rates_total < InpSwingLen * 2 + 2) return 0;

   // ── Full recalculation ──────────────────────────────────────────
   if(prev_calculated == 0)
   {
      ResetState();
      int limit = (int)MathMin((long)(rates_total - 2), (long)InpLookback);
      if(limit < InpSwingLen + 1) return rates_total;
      for(int sh = limit; sh >= InpSwingLen + 1; sh--)
      {
         DetectLevels(sh + 1, sh);
         CheckActivity(sh);
         CheckMiss(sh);
         AgeLevels();
      }
      return rates_total;
   }

   // ── Live: one bar just closed ───────────────────────────────────
   if(sh1IsNewBar())
   {
      DetectLevels(2, 1);
      CheckActivity(1);
      CheckMiss(InpSwingLen + 1);
      AgeLevels();
   }
   return rates_total;
}

//+------------------------------------------------------------------+
//| True once per newly-closed bar.                                 |
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
