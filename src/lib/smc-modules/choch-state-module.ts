// ─── CHoCH State Module ───────────────────────────────────────────────────────
// Phase 2 Structural Reversal Module — EAbuilder2
//
// Change of Character — fires when price breaks structure AGAINST the current
// trend, signalling a potential reversal.  Structurally mirrors BOS State Module
// but with an inverted fire condition:
//
//   BOS State:   close breaks WITH the trend → trend continues (trend unchanged)
//   CHoCH State: close breaks AGAINST the trend → trend MAY reverse (gTrend flips)
//
// Detection logic:
//   In BEAR trend (last CHoCH was bearish, or unknown):
//     → close > unconsumed swing HIGH  = Bull CHoCH  (gTrend flips to BULL)
//   In BULL trend (last CHoCH was bullish):
//     → close < unconsumed swing LOW   = Bear CHoCH  (gTrend flips to BEAR)
//   In UNKNOWN trend:
//     → ANY break treated as CHoCH (establishes initial trend direction)
//
// Note: When trend is UNKNOWN, the first structure break in either direction
// creates a CHoCH and sets gTrend.  This matches Phase 1 CHoCH Detector behavior
// where BOS events internally update the trend state.
//
// Visuals: dashed OBJ_TREND lines (not solid — distinguishes from BOS lines).
// Object prefix: SMCCHOCHS_ (distinct from Phase 1's SMCCHOCH_).
//
// Buffer layout (matches BOS State Module pattern — trend module, not zone module):
//   [0] BullTrendBuf  — 1.0 on every bar while CHoCH-based trend is BULL
//   [1] BearTrendBuf  — 1.0 on every bar while CHoCH-based trend is BEAR
//   [2] ChochUpBuf    — 1.0 at the bar where bull CHoCH fired (event)
//   [3] ChochDnBuf    — 1.0 at the bar where bear CHoCH fired (event)

export const CHOCH_STATE_MODULE_VERSION = "1.00";
export const CHOCH_STATE_MODULE = "CHoCH_State_Module";

export function generateChochStateModule(): string {
  return `
//+------------------------------------------------------------------+
//| CHoCH_State_Module.mq5                                           |
//| Phase 2 Change of Character State Module — EAbuilder2            |
//| v${CHOCH_STATE_MODULE_VERSION}                                                       |
//|                                                                  |
//| Buffers (read via iCustom()):                                    |
//|   0 : BullTrendBuf — 1.0 on every bar while trend is BULL       |
//|   1 : BearTrendBuf — 1.0 on every bar while trend is BEAR       |
//|   2 : ChochUpBuf   — 1.0 at bar where bull CHoCH fired (event)  |
//|   3 : ChochDnBuf   — 1.0 at bar where bear CHoCH fired (event)  |
//|                                                                  |
//| Fires ONLY on counter-trend breaks (reversal signal).            |
//| For with-trend breaks (continuation), use BOS_State_Module.      |
//+------------------------------------------------------------------+
#property copyright   "EAbuilder2"
#property version     "${CHOCH_STATE_MODULE_VERSION}"
#property strict
#property indicator_chart_window
#property indicator_buffers 4
#property indicator_plots   0

// ─── Indicator Buffers ────────────────────────────────────────────
double BullTrendBuf[];   // [0] persistent: 1.0 on every bull-trend bar
double BearTrendBuf[];   // [1] persistent: 1.0 on every bear-trend bar
double ChochUpBuf[];     // [2] event: 1.0 at bar where bull CHoCH fired
double ChochDnBuf[];     // [3] event: 1.0 at bar where bear CHoCH fired

// ─── Inputs ───────────────────────────────────────────────────────
input ENUM_TIMEFRAMES InpTimeframe   = PERIOD_CURRENT;   // Timeframe
input int             InpLookback    = 500;              // Bars to scan
input int             InpSwingLeft   = 5;                // Pivot left bars
input int             InpSwingRight  = 5;                // Pivot right bars
input bool            InpShowBull    = true;             // Show bull CHoCH lines
input bool            InpShowBear    = true;             // Show bear CHoCH lines
input color           InpBullColor   = clrDodgerBlue;    // Bull CHoCH colour
input color           InpBearColor   = clrDarkOrange;    // Bear CHoCH colour
input int             InpLineWidth   = 1;                // CHoCH line width
input int             InpMaxLines    = 20;               // Max lines on chart
input bool            InpShowLabels  = true;             // Show CHoCH labels

// ─── Constants ────────────────────────────────────────────────────
#define TREND_UNKNOWN  0
#define TREND_BULL     1
#define TREND_BEAR    -1

#define DIR_HIGH       1
#define DIR_LOW       -1

#define OBJ_PREFIX   "SMCCHOCHS_"
#define FAR_FUTURE   ((datetime)4102444800)

// ─── Structs ──────────────────────────────────────────────────────

struct SwingRecord
  {
   int      id;
   int      dir;
   double   price;
   datetime time;
   bool     consumed;
  };

struct ChochRecord
  {
   int      id;
   int      dir;         // DIR_HIGH = bull CHoCH  DIR_LOW = bear CHoCH
   double   swingLevel;
   datetime swingTime;
   datetime chochTime;
   int      drawn;
   int      invalid;     // 1 = price has closed back through this level
  };

#define MAX_SWINGS 2000
#define MAX_CHOCHS  500

SwingRecord swingList[MAX_SWINGS];
int         swingCount  = 0;
int         gNextSId    = 1;

ChochRecord chochList[MAX_CHOCHS];
int         chochCount  = 0;
int         gNextCId    = 1;

int         gTrend      = TREND_UNKNOWN;
int         gLinesDrawn = 0;

// ─── Inline bar accessors ─────────────────────────────────────────
double   Hi(int sh) { return iHigh (_Symbol, InpTimeframe, sh); }
double   Lo(int sh) { return iLow  (_Symbol, InpTimeframe, sh); }
double   Cl(int sh) { return iClose(_Symbol, InpTimeframe, sh); }
datetime Tm(int sh) { return iTime (_Symbol, InpTimeframe, sh); }

// ─── BlendWithBg ──────────────────────────────────────────────────
color BlendWithBg(color fg, int alpha)
  {
   color bg = (color)ChartGetInteger(0, CHART_COLOR_BACKGROUND);
   int r = (int)(((fg >> 16) & 0xFF) * alpha / 255 + ((bg >> 16) & 0xFF) * (255 - alpha) / 255);
   int g = (int)(((fg >>  8) & 0xFF) * alpha / 255 + ((bg >>  8) & 0xFF) * (255 - alpha) / 255);
   int b = (int)(( fg        & 0xFF) * alpha / 255 + ( bg        & 0xFF) * (255 - alpha) / 255);
   return (color)((r << 16) | (g << 8) | b);
  }

// ─── OnInit ───────────────────────────────────────────────────────
int OnInit()
  {
   SetIndexBuffer(0, BullTrendBuf, INDICATOR_DATA);
   SetIndexBuffer(1, BearTrendBuf, INDICATOR_DATA);
   SetIndexBuffer(2, ChochUpBuf,   INDICATOR_DATA);
   SetIndexBuffer(3, ChochDnBuf,   INDICATOR_DATA);

   ArraySetAsSeries(BullTrendBuf, true);
   ArraySetAsSeries(BearTrendBuf, true);
   ArraySetAsSeries(ChochUpBuf,   true);
   ArraySetAsSeries(ChochDnBuf,   true);

   for(int i = 0; i < 4; i++)
      PlotIndexSetDouble(i, PLOT_EMPTY_VALUE, 0.0);

   IndicatorSetString(INDICATOR_SHORTNAME,
                      "CHoCH_State v${CHOCH_STATE_MODULE_VERSION}");
   return(INIT_SUCCEEDED);
  }

// ─── OnDeinit ─────────────────────────────────────────────────────
void OnDeinit(const int reason)
  {
   ObjectsDeleteAll(0, OBJ_PREFIX);
  }

// ─── ResetState ───────────────────────────────────────────────────
void ResetState()
  {
   swingCount  = 0;  gNextSId = 1;
   chochCount  = 0;  gNextCId = 1;
   gTrend      = TREND_UNKNOWN;
   gLinesDrawn = 0;
   ObjectsDeleteAll(0, OBJ_PREFIX);
  }

// ─── TryAddSwing ──────────────────────────────────────────────────
void TryAddSwing(int sh)
  {
   int pivot     = sh + InpSwingRight;
   int totalBars = Bars(_Symbol, InpTimeframe);
   if(pivot + InpSwingLeft >= totalBars) return;

   datetime pivotT = Tm(pivot);
   // Dedup: skip consumed swings — their slot can be recycled
   for(int k = 0; k < swingCount; k++)
     {
      if(swingList[k].consumed) continue;
      if(swingList[k].time == pivotT) return;
     }

   double pivotH = Hi(pivot);
   double pivotL = Lo(pivot);

   bool isHigh = true;
   for(int j = 1; j <= InpSwingLeft  && isHigh; j++)
      if(Hi(pivot + j) >= pivotH) isHigh = false;
   for(int j = 1; j <= InpSwingRight && isHigh; j++)
      if(Hi(pivot - j) >= pivotH) isHigh = false;

   bool isLow = true;
   for(int j = 1; j <= InpSwingLeft  && isLow; j++)
      if(Lo(pivot + j) <= pivotL) isLow = false;
   for(int j = 1; j <= InpSwingRight && isLow; j++)
      if(Lo(pivot - j) <= pivotL) isLow = false;

   if(isHigh)
     {
      int sHi = -1;
      for(int k = 0; k < swingCount; k++)
         if(swingList[k].consumed) { sHi = k; break; }
      if(sHi < 0 && swingCount < MAX_SWINGS) sHi = swingCount++;
      if(sHi >= 0)
        {
         swingList[sHi].id       = gNextSId++;
         swingList[sHi].dir      = DIR_HIGH;
         swingList[sHi].price    = pivotH;
         swingList[sHi].time     = pivotT;
         swingList[sHi].consumed = false;
        }
     }
   if(isLow)
     {
      int sLo = -1;
      for(int k = 0; k < swingCount; k++)
         if(swingList[k].consumed) { sLo = k; break; }
      if(sLo < 0 && swingCount < MAX_SWINGS) sLo = swingCount++;
      if(sLo >= 0)
        {
         swingList[sLo].id       = gNextSId++;
         swingList[sLo].dir      = DIR_LOW;
         swingList[sLo].price    = pivotL;
         swingList[sLo].time     = pivotT;
         swingList[sLo].consumed = false;
        }
     }
  }

// ─── CheckCHoCH ───────────────────────────────────────────────────
// A CHoCH fires when the close breaks an unconsumed swing that is COUNTER
// to the current trend.  When gTrend == TREND_UNKNOWN the first break in
// either direction fires a CHoCH and establishes the initial trend state.
void CheckCHoCH(int sh)
  {
   double   closeV = Cl(sh);
   datetime barT   = Tm(sh);

   for(int k = 0; k < swingCount; k++)
     {
      if(swingList[k].consumed)      continue;
      if(swingList[k].time >= barT)  continue;

      if(swingList[k].dir == DIR_HIGH && closeV > swingList[k].price)
        {
         swingList[k].consumed = true;
         // Break above swing high.
         // CHoCH if trend was BEAR or UNKNOWN; plain BOS if trend already BULL.
         if(gTrend != TREND_BULL)
           {
            // Allocate slot — recycle oldest drawn slot when pool full
            int cIdx = chochCount < MAX_CHOCHS ? chochCount++ : -1;
            if(cIdx < 0)
              {
               for(int m = 0; m < chochCount; m++)
                  if(chochList[m].drawn == 1) { cIdx = m; break; }
               if(cIdx < 0) cIdx = 0;
               string rn  = OBJ_PREFIX + IntegerToString(chochList[cIdx].id);
               string rln = OBJ_PREFIX + "L" + IntegerToString(chochList[cIdx].id);
               if(ObjectFind(0, rn)  >= 0) ObjectDelete(0, rn);
               if(ObjectFind(0, rln) >= 0) ObjectDelete(0, rln);
               if(chochList[cIdx].drawn == 1) gLinesDrawn--;
              }
            chochList[cIdx].id         = gNextCId++;
            chochList[cIdx].dir        = DIR_HIGH;
            chochList[cIdx].swingLevel = swingList[k].price;
            chochList[cIdx].swingTime  = swingList[k].time;
            chochList[cIdx].chochTime  = barT;
            chochList[cIdx].drawn      = 0;
            chochList[cIdx].invalid    = 0;

            gTrend = TREND_BULL;
            if(sh < ArraySize(ChochUpBuf)) ChochUpBuf[sh] = 1.0;
            PrintFormat("CHOCH_BULL | id=%d | level=%.5f | time=%s",
                        gNextCId - 1, swingList[k].price, TimeToString(barT));
           }
        }
      else if(swingList[k].dir == DIR_LOW && closeV < swingList[k].price)
        {
         swingList[k].consumed = true;
         // Break below swing low.
         // CHoCH if trend was BULL or UNKNOWN.
         if(gTrend != TREND_BEAR)
           {
            int cIdx = chochCount < MAX_CHOCHS ? chochCount++ : -1;
            if(cIdx < 0)
              {
               for(int m = 0; m < chochCount; m++)
                  if(chochList[m].drawn == 1) { cIdx = m; break; }
               if(cIdx < 0) cIdx = 0;
               string rn  = OBJ_PREFIX + IntegerToString(chochList[cIdx].id);
               string rln = OBJ_PREFIX + "L" + IntegerToString(chochList[cIdx].id);
               if(ObjectFind(0, rn)  >= 0) ObjectDelete(0, rn);
               if(ObjectFind(0, rln) >= 0) ObjectDelete(0, rln);
               if(chochList[cIdx].drawn == 1) gLinesDrawn--;
              }
            chochList[cIdx].id         = gNextCId++;
            chochList[cIdx].dir        = DIR_LOW;
            chochList[cIdx].swingLevel = swingList[k].price;
            chochList[cIdx].swingTime  = swingList[k].time;
            chochList[cIdx].chochTime  = barT;
            chochList[cIdx].drawn      = 0;
            chochList[cIdx].invalid    = 0;

            gTrend = TREND_BEAR;
            if(sh < ArraySize(ChochDnBuf)) ChochDnBuf[sh] = 1.0;
            PrintFormat("CHOCH_BEAR | id=%d | level=%.5f | time=%s",
                        gNextCId - 1, swingList[k].price, TimeToString(barT));
           }
        }
     }
  }

// ─── StampTrendBuf ────────────────────────────────────────────────
void StampTrendBuf(int sh)
  {
   if(sh >= ArraySize(BullTrendBuf)) return;
   if(gTrend == TREND_BULL)      BullTrendBuf[sh] = 1.0;
   else if(gTrend == TREND_BEAR) BearTrendBuf[sh] = 1.0;
  }

// ─── InvalidateCHoCHs ─────────────────────────────────────────────
// Called every bar. When price closes back through a CHoCH level the
// line has been "traded through" — remove it from the chart.
//   Bull CHoCH (broke above swing high): invalid when close < swingLevel
//   Bear CHoCH (broke below swing low) : invalid when close > swingLevel
void InvalidateCHoCHs(int sh)
  {
   double closeV = Cl(sh);
   for(int i = 0; i < chochCount; i++)
     {
      if(chochList[i].invalid == 1) continue;

      bool crossed = false;
      if(chochList[i].dir == DIR_HIGH && closeV < chochList[i].swingLevel)
         crossed = true;
      if(chochList[i].dir == DIR_LOW  && closeV > chochList[i].swingLevel)
         crossed = true;

      if(crossed)
        {
         if(chochList[i].drawn == 1) DeleteOne(i);
         chochList[i].invalid = 1;
        }
     }
  }

// ─── DrawOne ──────────────────────────────────────────────────────
void DrawOne(int idx)
  {
   if(idx < 0 || idx >= chochCount) return;
   if(chochList[idx].drawn    == 1) return;
   if(chochList[idx].invalid  == 1) return; // already traded through — do not draw

   bool   isBull = (chochList[idx].dir == DIR_HIGH);
   if( isBull && !InpShowBull) return;
   if(!isBull && !InpShowBear) return;

   color  lc    = isBull ? InpBullColor : InpBearColor;
   string name  = OBJ_PREFIX + IntegerToString(chochList[idx].id);
   string lname = OBJ_PREFIX + "L" + IntegerToString(chochList[idx].id);

   // ── Dashed horizontal ray (CHoCH = dashed, BOS = solid) ───
   if(ObjectFind(0, name) < 0)
     {
      ObjectCreate(0, name, OBJ_TREND, 0,
                   chochList[idx].swingTime,  chochList[idx].swingLevel,
                   FAR_FUTURE,                chochList[idx].swingLevel);
      ObjectSetInteger(0, name, OBJPROP_COLOR,      lc);
      ObjectSetInteger(0, name, OBJPROP_WIDTH,      InpLineWidth);
      ObjectSetInteger(0, name, OBJPROP_STYLE,      STYLE_DASH);
      ObjectSetInteger(0, name, OBJPROP_RAY_RIGHT,  1);
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, 0);
      ObjectSetInteger(0, name, OBJPROP_HIDDEN,     1);
     }

   // ── Label at CHoCH bar ────────────────────────────────────
   if(InpShowLabels && ObjectFind(0, lname) < 0)
     {
      string txt = isBull ? "CHoCH ↑" : "CHoCH ↓";
      ObjectCreate(0, lname, OBJ_TEXT, 0,
                   chochList[idx].chochTime, chochList[idx].swingLevel);
      ObjectSetString (0, lname, OBJPROP_TEXT,       txt);
      ObjectSetInteger(0, lname, OBJPROP_COLOR,      lc);
      ObjectSetInteger(0, lname, OBJPROP_ANCHOR,     ANCHOR_LEFT);
      ObjectSetInteger(0, lname, OBJPROP_FONTSIZE,   8);
      ObjectSetInteger(0, lname, OBJPROP_SELECTABLE, 0);
      ObjectSetInteger(0, lname, OBJPROP_HIDDEN,     1);
     }

   chochList[idx].drawn = 1;
   gLinesDrawn++;
  }

// ─── DeleteOne ────────────────────────────────────────────────────
void DeleteOne(int idx)
  {
   if(idx < 0 || idx >= chochCount) return;
   string name  = OBJ_PREFIX + IntegerToString(chochList[idx].id);
   string lname = OBJ_PREFIX + "L" + IntegerToString(chochList[idx].id);
   if(ObjectFind(0, name)  >= 0) ObjectDelete(0, name);
   if(ObjectFind(0, lname) >= 0) ObjectDelete(0, lname);
   if(chochList[idx].drawn == 1)
     {
      chochList[idx].drawn = 0;
      gLinesDrawn--;
     }
  }

// ─── DrawAll ──────────────────────────────────────────────────────
void DrawAll()
  {
   int drawn = 0;
   for(int i = chochCount - 1; i >= 0 && drawn < InpMaxLines; i--)
     {
      if(chochList[i].invalid == 1) continue; // skip invalidated — don't waste a slot
      DrawOne(i);
      drawn++;
     }
  }

// ─── EnforceMaxLines ──────────────────────────────────────────────
void EnforceMaxLines()
  {
   while(gLinesDrawn >= InpMaxLines)
     {
      bool removed = false;
      for(int k = 0; k < chochCount; k++)
        {
         if(chochList[k].drawn == 1)
           {
            DeleteOne(k);
            removed = true;
            break;
           }
        }
      if(!removed) break;
     }
  }

// ─── OnCalculate ──────────────────────────────────────────────────
int OnCalculate(const int rates_total,
                const int prev_calculated,
                const datetime& time[],
                const double& open[],
                const double& high[],
                const double& low[],
                const double& close[],
                const long& tick_volume[],
                const long& volume[],
                const int& spread[])
  {
   int minBars = InpSwingLeft + InpSwingRight + 2;
   if(rates_total < minBars) return(0);

   // ── Full recalculation ────────────────────────────────────
   if(prev_calculated == 0)
     {
      ResetState();

      int limit = (int)MathMin(
                     (long)(rates_total - InpSwingLeft - InpSwingRight - 1),
                     (long)InpLookback);
      if(limit < 1) return(rates_total);

      for(int sh = limit; sh >= 1; sh--)
        {
         TryAddSwing(sh);
         CheckCHoCH(sh);
         InvalidateCHoCHs(sh);
         StampTrendBuf(sh);
        }

      DrawAll();
      return(rates_total);
     }

   // ── Live: one bar just closed ─────────────────────────────
   TryAddSwing(1);
   CheckCHoCH(1);
   InvalidateCHoCHs(1);
   StampTrendBuf(1);
   EnforceMaxLines();
   if(chochCount > 0 && chochList[chochCount - 1].drawn == 0)
      DrawOne(chochCount - 1);

   return(rates_total);
  }
`.trim();
}
