// ─── BOS State Module ────────────────────────────────────────────────────────
// Phase 2 Structural Bias Module — EAbuilder2
// Embeds Phase 1 swing + BOS detection and exposes 4 indicator buffers:
//   [0] BullTrendBuf — 1.0 on every bar while trend is BULL
//   [1] BearTrendBuf — 1.0 on every bar while trend is BEAR
//   [2] BosUpBuf     — 1.0 at the bar where a bull BOS fired
//   [3] BosDnBuf     — 1.0 at the bar where a bear BOS fired
//
// Unlike FVG / OB / Breakout state modules (zone + retest pattern), BOS tracks
// structural TREND STATE.  The persistent buffers [0] and [1] let an MTF
// orchestrator step confirm "currently in bull/bear trend" by reading bar[1].
// The event buffers [2] and [3] fire once per BOS bar for fine-grained timing.

export const BOS_STATE_MODULE_VERSION = "1.0.0";
export const BOS_STATE_MODULE = "BOS_State_Module";

export function generateBosStateModule(): string {
  return `
//+------------------------------------------------------------------+
//| BOS_State_Module.mq5                                             |
//| Phase 2 Structural Bias Module — EAbuilder2                      |
//| v${BOS_STATE_MODULE_VERSION}                                                         |
//|                                                                  |
//| Buffers (read via iCustom()):                                    |
//|   0 : BullTrendBuf — 1.0 on every bar while trend is BULL       |
//|   1 : BearTrendBuf — 1.0 on every bar while trend is BEAR       |
//|   2 : BosUpBuf     — 1.0 at bull BOS event bar                  |
//|   3 : BosDnBuf     — 1.0 at bear BOS event bar                  |
//+------------------------------------------------------------------+
#property copyright   "EAbuilder2"
#property version     "${BOS_STATE_MODULE_VERSION}"
#property strict
#property indicator_chart_window
#property indicator_buffers 4
#property indicator_plots   0

// ─── Indicator Buffers ────────────────────────────────────────────
double BullTrendBuf[];  // [0] persistent: 1.0 on every bull-trend bar
double BearTrendBuf[];  // [1] persistent: 1.0 on every bear-trend bar
double BosUpBuf[];      // [2] event: 1.0 at bar where bull BOS fired
double BosDnBuf[];      // [3] event: 1.0 at bar where bear BOS fired

// ─── Inputs ───────────────────────────────────────────────────────
input ENUM_TIMEFRAMES InpTimeframe   = PERIOD_CURRENT;    // Timeframe
input int             InpLookback    = 500;               // Bars to scan
input int             InpSwingLeft   = 5;                 // Pivot left bars
input int             InpSwingRight  = 5;                 // Pivot right bars
input bool            InpShowBull    = true;              // Show bull BOS lines
input bool            InpShowBear    = true;              // Show bear BOS lines
input color           InpBullColor   = clrMediumSeaGreen; // Bull BOS colour
input color           InpBearColor   = clrTomato;         // Bear BOS colour
input int             InpLineWidth   = 1;                 // BOS line width
input int             InpMaxLines    = 20;                // Max lines on chart
input bool            InpShowLabels  = true;              // Show BOS labels

// ─── Constants ────────────────────────────────────────────────────
#define TREND_UNKNOWN  0
#define TREND_BULL     1
#define TREND_BEAR    -1

#define DIR_HIGH       1
#define DIR_LOW       -1

#define OBJ_PREFIX     "SMCBOSS_"
#define FAR_FUTURE     ((datetime)4102444800)

// ─── Structs ──────────────────────────────────────────────────────

struct SwingRecord
  {
   int      id;
   int      dir;        // DIR_HIGH or DIR_LOW
   double   price;
   datetime time;
   bool     consumed;   // true once a BOS has consumed this swing
  };

struct BosRecord
  {
   int      id;
   int      dir;        // DIR_HIGH = bull BOS,  DIR_LOW = bear BOS
   double   swingLevel;
   datetime swingTime;
   datetime bosTime;
   int      drawn;      // 0 = not drawn, 1 = drawn
  };

#define MAX_SWINGS 2000
#define MAX_BOS     500

SwingRecord swingList[MAX_SWINGS];
int         swingCount  = 0;
int         gNextSId    = 1;

BosRecord   bosList[MAX_BOS];
int         bosCount    = 0;
int         gNextBId    = 1;

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
   SetIndexBuffer(2, BosUpBuf,    INDICATOR_DATA);
   SetIndexBuffer(3, BosDnBuf,    INDICATOR_DATA);

   ArraySetAsSeries(BullTrendBuf, true);
   ArraySetAsSeries(BearTrendBuf, true);
   ArraySetAsSeries(BosUpBuf,    true);
   ArraySetAsSeries(BosDnBuf,    true);

   for(int i = 0; i < 4; i++)
      PlotIndexSetDouble(i, PLOT_EMPTY_VALUE, 0.0);

   IndicatorSetString(INDICATOR_SHORTNAME,
                      "BOS_State v${BOS_STATE_MODULE_VERSION}");
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
   swingCount  = 0;
   gNextSId    = 1;
   bosCount    = 0;
   gNextBId    = 1;
   gTrend      = TREND_UNKNOWN;
   gLinesDrawn = 0;
   ObjectsDeleteAll(0, OBJ_PREFIX);
  }

// ─── TryAddSwing ──────────────────────────────────────────────────
// At chronological scan position sh, the pivot at (sh + InpSwingRight)
// has just had its full right-side confirmed.  Test it as swing H / L.
void TryAddSwing(int sh)
  {
   int pivot    = sh + InpSwingRight;
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

   // ── Swing HIGH ────────────────────────────────────────────
   bool isHigh = true;
   for(int j = 1; j <= InpSwingLeft  && isHigh; j++)
      if(Hi(pivot + j) >= pivotH) isHigh = false;
   for(int j = 1; j <= InpSwingRight && isHigh; j++)
      if(Hi(pivot - j) >= pivotH) isHigh = false;

   // ── Swing LOW ─────────────────────────────────────────────
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

// ─── CheckBOS ─────────────────────────────────────────────────────
// Check bar sh for a BOS against every unconsumed swing.
// A bull BOS fires when close > swing high; bear when close < swing low.
// Each swing can only generate one BOS (consumed flag prevents repeats).
void CheckBOS(int sh)
  {
   double   closeV = Cl(sh);
   datetime barT   = Tm(sh);

   for(int k = 0; k < swingCount; k++)
     {
      if(swingList[k].consumed)      continue;
      if(swingList[k].time >= barT)  continue;  // swing must pre-date this bar

      bool isBullBos = (swingList[k].dir == DIR_HIGH && closeV > swingList[k].price);
      bool isBearBos = (swingList[k].dir == DIR_LOW  && closeV < swingList[k].price);
      if(!isBullBos && !isBearBos) continue;

      // Allocate slot — recycle oldest (drawn=1) when pool full.
      // gTrend and buffer writes happen regardless of whether slot is available.
      int bIdx = bosCount < MAX_BOS ? bosCount++ : -1;
      if(bIdx < 0)
        {
         // Find first drawn slot (oldest) to recycle
         for(int m = 0; m < bosCount; m++)
            if(bosList[m].drawn == 1) { bIdx = m; break; }
         if(bIdx < 0) bIdx = 0;  // fallback: overwrite slot 0
         // Clean up visual of the recycled slot
         string rname  = OBJ_PREFIX + IntegerToString(bosList[bIdx].id);
         string rlname = OBJ_PREFIX + "L" + IntegerToString(bosList[bIdx].id);
         if(ObjectFind(0, rname)  >= 0) ObjectDelete(0, rname);
         if(ObjectFind(0, rlname) >= 0) ObjectDelete(0, rlname);
         if(bosList[bIdx].drawn == 1) gLinesDrawn--;
        }

      bosList[bIdx].id         = gNextBId++;
      bosList[bIdx].dir        = isBullBos ? DIR_HIGH : DIR_LOW;
      bosList[bIdx].swingLevel = swingList[k].price;
      bosList[bIdx].swingTime  = swingList[k].time;
      bosList[bIdx].bosTime    = barT;
      bosList[bIdx].drawn      = 0;

      swingList[k].consumed = true;
      gTrend = isBullBos ? TREND_BULL : TREND_BEAR;

      if(isBullBos)
        {
         if(sh < ArraySize(BosUpBuf)) BosUpBuf[sh] = 1.0;
         PrintFormat("BOS_BULL | id=%d | level=%.5f | bosTime=%s",
                     gNextBId - 1, swingList[k].price, TimeToString(barT));
        }
      else
        {
         if(sh < ArraySize(BosDnBuf)) BosDnBuf[sh] = 1.0;
         PrintFormat("BOS_BEAR | id=%d | level=%.5f | bosTime=%s",
                     gNextBId - 1, swingList[k].price, TimeToString(barT));
        }
     }
  }

// ─── StampTrendBuf ────────────────────────────────────────────────
// Called every bar, AFTER CheckBOS so gTrend is already updated.
void StampTrendBuf(int sh)
  {
   if(sh >= ArraySize(BullTrendBuf)) return;
   if(gTrend == TREND_BULL)      BullTrendBuf[sh] = 1.0;
   else if(gTrend == TREND_BEAR) BearTrendBuf[sh]  = 1.0;
  }

// ─── DrawOne ──────────────────────────────────────────────────────
void DrawOne(int idx)
  {
   if(idx < 0 || idx >= bosCount) return;
   if(bosList[idx].drawn == 1)   return;  // already drawn

   bool   isBull = (bosList[idx].dir == DIR_HIGH);
   if( isBull && !InpShowBull) return;
   if(!isBull && !InpShowBear) return;

   color  lc    = isBull ? InpBullColor : InpBearColor;
   string name  = OBJ_PREFIX + IntegerToString(bosList[idx].id);
   string lname = OBJ_PREFIX + "L" + IntegerToString(bosList[idx].id);

   // ── Horizontal ray from swing candle → FAR_FUTURE ─────────
   if(ObjectFind(0, name) < 0)
     {
      ObjectCreate(0, name, OBJ_TREND, 0,
                   bosList[idx].swingTime, bosList[idx].swingLevel,
                   FAR_FUTURE,             bosList[idx].swingLevel);
      ObjectSetInteger(0, name, OBJPROP_COLOR,      lc);
      ObjectSetInteger(0, name, OBJPROP_WIDTH,      InpLineWidth);
      ObjectSetInteger(0, name, OBJPROP_STYLE,      STYLE_SOLID);
      ObjectSetInteger(0, name, OBJPROP_RAY_RIGHT,  1);
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, 0);
      ObjectSetInteger(0, name, OBJPROP_HIDDEN,     1);
     }

   // ── Label at BOS bar ──────────────────────────────────────
   if(InpShowLabels && ObjectFind(0, lname) < 0)
     {
      string txt = isBull ? "Bull BOS" : "Bear BOS";
      ObjectCreate(0, lname, OBJ_TEXT, 0,
                   bosList[idx].bosTime, bosList[idx].swingLevel);
      ObjectSetString (0, lname, OBJPROP_TEXT,       txt);
      ObjectSetInteger(0, lname, OBJPROP_COLOR,      lc);
      ObjectSetInteger(0, lname, OBJPROP_ANCHOR,     ANCHOR_LEFT);
      ObjectSetInteger(0, lname, OBJPROP_FONTSIZE,   8);
      ObjectSetInteger(0, lname, OBJPROP_SELECTABLE, 0);
      ObjectSetInteger(0, lname, OBJPROP_HIDDEN,     1);
     }

   bosList[idx].drawn = 1;
   gLinesDrawn++;
  }

// ─── DeleteOne ────────────────────────────────────────────────────
void DeleteOne(int idx)
  {
   if(idx < 0 || idx >= bosCount) return;
   string name  = OBJ_PREFIX + IntegerToString(bosList[idx].id);
   string lname = OBJ_PREFIX + "L" + IntegerToString(bosList[idx].id);
   if(ObjectFind(0, name)  >= 0) ObjectDelete(0, name);
   if(ObjectFind(0, lname) >= 0) ObjectDelete(0, lname);
   if(bosList[idx].drawn == 1)
     {
      bosList[idx].drawn = 0;
      gLinesDrawn--;
     }
  }

// ─── DrawAll (full recalculation) ─────────────────────────────────
// Draw the InpMaxLines most recent BOS records.
void DrawAll()
  {
   int drawn = 0;
   for(int i = bosCount - 1; i >= 0 && drawn < InpMaxLines; i--)
     {
      DrawOne(i);
      drawn++;
     }
  }

// ─── EnforceMaxLines (live path) ──────────────────────────────────
void EnforceMaxLines()
  {
   while(gLinesDrawn >= InpMaxLines)
     {
      bool removed = false;
      for(int k = 0; k < bosCount; k++)
        {
         if(bosList[k].drawn == 1)
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

      // Single chronological loop — oldest (limit) → newest (1).
      // TryAddSwing at sh confirms a pivot at sh + InpSwingRight (older bar).
      // CheckBOS then tests all unconsumed swings against bar sh.
      // StampTrendBuf writes the current gTrend for this bar.
      for(int sh = limit; sh >= 1; sh--)
        {
         TryAddSwing(sh);
         CheckBOS(sh);
         StampTrendBuf(sh);
        }

      DrawAll();
      return(rates_total);
     }

   // ── Live: one bar just closed ─────────────────────────────
   TryAddSwing(1);
   CheckBOS(1);
   StampTrendBuf(1);
   EnforceMaxLines();
   // Draw any BOS record that just got added (will have drawn==0)
   if(bosCount > 0 && bosList[bosCount - 1].drawn == 0)
      DrawOne(bosCount - 1);

   return(rates_total);
  }
`.trim();
}
