// ─── Liquidity Sweep State Module ────────────────────────────────────────────
// Phase 2 State Module — EAbuilder2
//
// Simplest Phase 2 lifecycle — no RETESTED step.
//
// The sweep itself IS the confirmation event.  Two-stage detection:
//   Stage 1 (PENDING): wick pierces a confirmed swing level but bar has NOT
//                      yet closed back on the correct side.
//   Stage 2 (CONFIRMED): close-back confirmed → Phase 3 signal fired.
//   Terminal (EXPIRED): InpMaxWaitBars elapsed without close-back.
//
// Same-bar confirmation is supported: if the wick and close-back happen on
// the same candle, the sweep goes directly PENDING → CONFIRMED immediately.
//
// Bullish sweep: barLow < swingLow AND eventually barClose > swingLow
//   SL = sweepLow (wick low of the sweep bar)
//
// Bearish sweep: barHigh > swingHigh AND eventually barClose < swingHigh
//   SL = sweepHigh (wick high of the sweep bar)
//
// Standard 4-buffer Phase 3 contract:
//   [0] BullConfirmBuf  [1] BearConfirmBuf  [2] BullSLBuf  [3] BearSLBuf

export const LIQSWEEP_STATE_MODULE_VERSION = "1.0.0";
export const LIQSWEEP_STATE_MODULE = "LiqSweep_State_Module";

export function generateLiqSweepStateModule(): string {
  return `
//+------------------------------------------------------------------+
//| LiqSweep_State_Module.mq5                                        |
//| Phase 2 Liquidity Sweep State Module — EAbuilder2                |
//| v${LIQSWEEP_STATE_MODULE_VERSION}                                                    |
//|                                                                  |
//| Buffers (read via iCustom()):                                    |
//|   0 : BullConfirmBuf — 1.0 at bull sweep CONFIRMED bar          |
//|   1 : BearConfirmBuf — 1.0 at bear sweep CONFIRMED bar          |
//|   2 : BullSLBuf      — sweepLow at confirmation bar             |
//|   3 : BearSLBuf      — sweepHigh at confirmation bar            |
//+------------------------------------------------------------------+
#property copyright   "EAbuilder2"
#property version     "${LIQSWEEP_STATE_MODULE_VERSION}"
#property strict
#property indicator_chart_window
#property indicator_buffers 4
#property indicator_plots   0

// ─── Indicator Buffers ────────────────────────────────────────────
double BullConfirmBuf[];
double BearConfirmBuf[];
double BullSLBuf[];
double BearSLBuf[];

// ─── Inputs ───────────────────────────────────────────────────────
input ENUM_TIMEFRAMES InpTimeframe   = PERIOD_CURRENT;    // Timeframe
input int             InpLookback    = 500;               // Bars to scan
input int             InpSwingStr    = 3;                 // Swing confirmation bars each side
input int             InpMaxWaitBars = 5;                 // Max bars to wait for close-back
input int             InpExpiryBars  = 100;               // Bars before sweep record EXPIRED
input bool            InpShowBull    = true;              // Show bull sweep lines
input bool            InpShowBear    = true;              // Show bear sweep lines
input color           InpBullColor   = clrDodgerBlue;     // Bull sweep colour
input color           InpBearColor   = clrOrangeRed;      // Bear sweep colour
input int             InpLineWidth   = 1;                 // Line width (active)
input bool            InpShowLabels  = true;              // Show sweep labels

// ─── States ───────────────────────────────────────────────────────
#define STATE_PENDING    0   // wick through level — waiting for close-back
#define STATE_CONFIRMED  2   // close-back confirmed — Phase 3 signal fired
#define STATE_EXPIRED    5   // maxWaitBars or expiryBars elapsed [terminal]
#define STATE_UNDRAWN   -1

// ─── Object prefix ────────────────────────────────────────────────
#define OBJ_PREFIX   "SMCLSS_"
#define FAR_FUTURE   ((datetime)4102444800)

// ─── Structs ──────────────────────────────────────────────────────

// Internal swing record
struct SwingRec
  {
   int      id;
   int      dir;        // 1=swing high, -1=swing low
   double   price;
   datetime time;
   bool     consumed;
  };

// Sweep record
struct SweepRecord
  {
   int      id;
   int      dir;         // 1=bull sweep (swept low), -1=bear sweep (swept high)
   int      state;
   int      drawnState;
   int      barsAlive;   // bars since sweep bar (for expiry)
   int      waitBars;    // bars in PENDING (for close-back timeout)
   double   swingLevel;
   datetime swingTime;
   datetime sweepTime;   // bar where wick first pierced the level
   double   sweepHigh;   // high of sweep bar (SL source for bear sweeps)
   double   sweepLow;    // low of sweep bar  (SL source for bull sweeps)
   datetime confirmTime;
   datetime endTime;
  };

#define MAX_SWINGS 2000
#define MAX_SWEEPS  500

SwingRec    swingList[MAX_SWINGS];
int         swingCount  = 0;
int         gNextSId    = 1;

SweepRecord sweepList[MAX_SWEEPS];
int         sweepCount  = 0;
int         gNextSwId   = 1;

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
   SetIndexBuffer(0, BullConfirmBuf, INDICATOR_DATA);
   SetIndexBuffer(1, BearConfirmBuf, INDICATOR_DATA);
   SetIndexBuffer(2, BullSLBuf,      INDICATOR_DATA);
   SetIndexBuffer(3, BearSLBuf,      INDICATOR_DATA);

   ArraySetAsSeries(BullConfirmBuf, true);
   ArraySetAsSeries(BearConfirmBuf, true);
   ArraySetAsSeries(BullSLBuf,      true);
   ArraySetAsSeries(BearSLBuf,      true);

   for(int i = 0; i < 4; i++)
      PlotIndexSetDouble(i, PLOT_EMPTY_VALUE, 0.0);

   IndicatorSetString(INDICATOR_SHORTNAME,
                      "LiqSweep_State v${LIQSWEEP_STATE_MODULE_VERSION}");
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
   swingCount  = 0;  gNextSId  = 1;
   sweepCount  = 0;  gNextSwId = 1;
   ObjectsDeleteAll(0, OBJ_PREFIX);
  }

// ─── TryAddSwing ──────────────────────────────────────────────────
// At scan position sh, confirm pivot at sh + InpSwingStr (just got right side).
void TryAddSwing(int sh)
  {
   int pivot     = sh + InpSwingStr;
   int totalBars = Bars(_Symbol, InpTimeframe);
   if(pivot + InpSwingStr >= totalBars) return;
   if(swingCount >= MAX_SWINGS - 2)     return;

   datetime pivotT = Tm(pivot);
   for(int k = 0; k < swingCount; k++)
      if(swingList[k].time == pivotT) return;  // dedup

   double pivotH = Hi(pivot);
   double pivotL = Lo(pivot);

   // ── Swing HIGH check ─────────────────────────────────────
   bool isHigh = true;
   for(int j = 1; j <= InpSwingStr && isHigh; j++)
      if(Hi(pivot + j) >= pivotH) isHigh = false;
   for(int j = 1; j <= InpSwingStr && isHigh; j++)
      if(Hi(pivot - j) >= pivotH) isHigh = false;

   // ── Swing LOW check ──────────────────────────────────────
   bool isLow = true;
   for(int j = 1; j <= InpSwingStr && isLow; j++)
      if(Lo(pivot + j) <= pivotL) isLow = false;
   for(int j = 1; j <= InpSwingStr && isLow; j++)
      if(Lo(pivot - j) <= pivotL) isLow = false;

   if(isHigh)
     {
      swingList[swingCount].id       = gNextSId++;
      swingList[swingCount].dir      = 1;
      swingList[swingCount].price    = pivotH;
      swingList[swingCount].time     = pivotT;
      swingList[swingCount].consumed = false;
      swingCount++;
     }
   if(isLow)
     {
      swingList[swingCount].id       = gNextSId++;
      swingList[swingCount].dir      = -1;
      swingList[swingCount].price    = pivotL;
      swingList[swingCount].time     = pivotT;
      swingList[swingCount].consumed = false;
      swingCount++;
     }
  }

// ─── CheckNewSweeps ───────────────────────────────────────────────
// At bar sh: test wick against all unconsumed swings.
// Same-bar confirmation is handled here — if wick + close-back both on sh,
// the sweep is immediately CONFIRMED without going through PENDING.
void CheckNewSweeps(int sh)
  {
   if(sweepCount >= MAX_SWEEPS - 1) return;

   double   barHigh  = Hi(sh);
   double   barLow   = Lo(sh);
   double   barClose = Cl(sh);
   datetime barT     = Tm(sh);

   for(int k = 0; k < swingCount; k++)
     {
      if(swingList[k].consumed)      continue;
      if(swingList[k].time >= barT)  continue;

      // ── Bull sweep — wick below swing low ─────────────────
      if(swingList[k].dir == -1 && barLow < swingList[k].price)
        {
         sweepList[sweepCount].id         = gNextSwId++;
         sweepList[sweepCount].dir        = 1;
         sweepList[sweepCount].barsAlive  = 0;
         sweepList[sweepCount].waitBars   = 0;
         sweepList[sweepCount].swingLevel = swingList[k].price;
         sweepList[sweepCount].swingTime  = swingList[k].time;
         sweepList[sweepCount].sweepTime  = barT;
         sweepList[sweepCount].sweepHigh  = barHigh;
         sweepList[sweepCount].sweepLow   = barLow;
         sweepList[sweepCount].confirmTime = 0;
         sweepList[sweepCount].endTime     = FAR_FUTURE;
         sweepList[sweepCount].drawnState  = STATE_UNDRAWN;

         // Same-bar close-back?
         if(barClose > swingList[k].price)
           {
            sweepList[sweepCount].state = STATE_CONFIRMED;
            sweepList[sweepCount].confirmTime = barT;
            if(sh < ArraySize(BullConfirmBuf)) BullConfirmBuf[sh] = 1.0;
            if(sh < ArraySize(BullSLBuf))      BullSLBuf[sh]      = barLow;
            PrintFormat("LIQSWEEP_BULL_CONFIRMED | id=%d | level=%.5f | sl=%.5f | sh=%d",
                        gNextSwId - 1, swingList[k].price, barLow, sh);
           }
         else
           {
            sweepList[sweepCount].state = STATE_PENDING;
            PrintFormat("LIQSWEEP_BULL_PENDING | id=%d | level=%.5f | wickLow=%.5f",
                        gNextSwId - 1, swingList[k].price, barLow);
           }

         sweepCount++;
         swingList[k].consumed = true;
        }
      // ── Bear sweep — wick above swing high ────────────────
      else if(swingList[k].dir == 1 && barHigh > swingList[k].price)
        {
         sweepList[sweepCount].id         = gNextSwId++;
         sweepList[sweepCount].dir        = -1;
         sweepList[sweepCount].barsAlive  = 0;
         sweepList[sweepCount].waitBars   = 0;
         sweepList[sweepCount].swingLevel = swingList[k].price;
         sweepList[sweepCount].swingTime  = swingList[k].time;
         sweepList[sweepCount].sweepTime  = barT;
         sweepList[sweepCount].sweepHigh  = barHigh;
         sweepList[sweepCount].sweepLow   = barLow;
         sweepList[sweepCount].confirmTime = 0;
         sweepList[sweepCount].endTime     = FAR_FUTURE;
         sweepList[sweepCount].drawnState  = STATE_UNDRAWN;

         if(barClose < swingList[k].price)
           {
            sweepList[sweepCount].state = STATE_CONFIRMED;
            sweepList[sweepCount].confirmTime = barT;
            if(sh < ArraySize(BearConfirmBuf)) BearConfirmBuf[sh] = 1.0;
            if(sh < ArraySize(BearSLBuf))      BearSLBuf[sh]      = barHigh;
            PrintFormat("LIQSWEEP_BEAR_CONFIRMED | id=%d | level=%.5f | sl=%.5f | sh=%d",
                        gNextSwId - 1, swingList[k].price, barHigh, sh);
           }
         else
           {
            sweepList[sweepCount].state = STATE_PENDING;
            PrintFormat("LIQSWEEP_BEAR_PENDING | id=%d | level=%.5f | wickHigh=%.5f",
                        gNextSwId - 1, swingList[k].price, barHigh);
           }

         sweepCount++;
         swingList[k].consumed = true;
        }
     }
  }

// ─── UpdateSweepStates ────────────────────────────────────────────
// Advance PENDING sweeps toward CONFIRMED or EXPIRED.
void UpdateSweepStates(int sh)
  {
   double   barClose = Cl(sh);
   datetime barT     = Tm(sh);

   for(int i = 0; i < sweepCount; i++)
     {
      int st = sweepList[i].state;
      if(st == STATE_CONFIRMED || st == STATE_EXPIRED) continue;

      // Skip guard: don't process sweep on the same bar it was detected
      if(sweepList[i].sweepTime >= barT) continue;

      sweepList[i].barsAlive++;

      // Expiry by total age
      if(sweepList[i].barsAlive >= InpExpiryBars)
        {
         sweepList[i].state   = STATE_EXPIRED;
         sweepList[i].endTime = barT;
         PrintFormat(sweepList[i].dir == 1
                     ? "LIQSWEEP_BULL_EXPIRED | id=%d"
                     : "LIQSWEEP_BEAR_EXPIRED | id=%d",
                     sweepList[i].id);
         DrawOne(i);
         continue;
        }

      if(st == STATE_PENDING)
        {
         sweepList[i].waitBars++;

         // Wait-bar timeout
         if(sweepList[i].waitBars > InpMaxWaitBars)
           {
            sweepList[i].state   = STATE_EXPIRED;
            sweepList[i].endTime = barT;
            PrintFormat(sweepList[i].dir == 1
                        ? "LIQSWEEP_BULL_EXPIRED(timeout) | id=%d"
                        : "LIQSWEEP_BEAR_EXPIRED(timeout) | id=%d",
                        sweepList[i].id);
            DrawOne(i);
            continue;
           }

         bool isBull = (sweepList[i].dir == 1);
         double level = sweepList[i].swingLevel;

         if(isBull && barClose > level)
           {
            sweepList[i].state       = STATE_CONFIRMED;
            sweepList[i].confirmTime = barT;
            if(sh < ArraySize(BullConfirmBuf)) BullConfirmBuf[sh] = 1.0;
            if(sh < ArraySize(BullSLBuf))      BullSLBuf[sh]      = sweepList[i].sweepLow;
            PrintFormat("LIQSWEEP_BULL_CONFIRMED | id=%d | level=%.5f | sl=%.5f | sh=%d",
                        sweepList[i].id, level, sweepList[i].sweepLow, sh);
            DrawOne(i);
           }
         else if(!isBull && barClose < level)
           {
            sweepList[i].state       = STATE_CONFIRMED;
            sweepList[i].confirmTime = barT;
            if(sh < ArraySize(BearConfirmBuf)) BearConfirmBuf[sh] = 1.0;
            if(sh < ArraySize(BearSLBuf))      BearSLBuf[sh]      = sweepList[i].sweepHigh;
            PrintFormat("LIQSWEEP_BEAR_CONFIRMED | id=%d | level=%.5f | sl=%.5f | sh=%d",
                        sweepList[i].id, level, sweepList[i].sweepHigh, sh);
            DrawOne(i);
           }
        }
     }
  }

// ─── DrawOne ──────────────────────────────────────────────────────
void DrawOne(int idx)
  {
   if(idx < 0 || idx >= sweepCount) return;

   bool isBull = (sweepList[idx].dir == 1);
   int  st     = sweepList[idx].state;

   if(st == sweepList[idx].drawnState) return;

   if( isBull && !InpShowBull) return;
   if(!isBull && !InpShowBear) return;

   color  lc   = isBull ? InpBullColor : InpBearColor;
   string name = OBJ_PREFIX + IntegerToString(sweepList[idx].id);
   string lname = OBJ_PREFIX + "L" + IntegerToString(sweepList[idx].id);

   bool terminal = (st == STATE_EXPIRED);
   datetime right = terminal
                    ? sweepList[idx].endTime
                    : (st == STATE_CONFIRMED ? sweepList[idx].confirmTime : FAR_FUTURE);

   ENUM_LINE_STYLE lStyle = terminal ? STYLE_DOT : STYLE_DASH;
   int             lWidth = (st == STATE_CONFIRMED) ? InpLineWidth + 1 : InpLineWidth;
   color           lineCol = (st == STATE_CONFIRMED) ? lc : BlendWithBg(lc, 180);

   // ── OBJ_TREND dashed line from swingTime to right ──────
   if(ObjectFind(0, name) < 0)
      ObjectCreate(0, name, OBJ_TREND, 0,
                   sweepList[idx].swingTime, sweepList[idx].swingLevel,
                   right,                    sweepList[idx].swingLevel);
   else
      ObjectSetInteger(0, name, OBJPROP_TIME, 1, right);

   ObjectSetInteger(0, name, OBJPROP_COLOR,      lineCol);
   ObjectSetInteger(0, name, OBJPROP_WIDTH,      lWidth);
   ObjectSetInteger(0, name, OBJPROP_STYLE,      lStyle);
   ObjectSetInteger(0, name, OBJPROP_RAY_RIGHT,  terminal ? 0 : 1);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, 0);
   ObjectSetInteger(0, name, OBJPROP_HIDDEN,     1);

   // ── Label at sweep bar ────────────────────────────────
   if(InpShowLabels)
     {
      string txt;
      if(st == STATE_PENDING)   txt = isBull ? "Sweep↑" : "Sweep↓";
      else if(st == STATE_CONFIRMED) txt = isBull ? "Sweep↑-C" : "Sweep↓-C";
      else                          txt = isBull ? "Sweep↑-E" : "Sweep↓-E";

      if(ObjectFind(0, lname) < 0)
         ObjectCreate(0, lname, OBJ_TEXT, 0,
                      sweepList[idx].sweepTime, sweepList[idx].swingLevel);
      ObjectSetString (0, lname, OBJPROP_TEXT,       txt);
      ObjectSetInteger(0, lname, OBJPROP_COLOR,      lc);
      ObjectSetInteger(0, lname, OBJPROP_ANCHOR,     ANCHOR_LEFT);
      ObjectSetInteger(0, lname, OBJPROP_FONTSIZE,   8);
      ObjectSetInteger(0, lname, OBJPROP_SELECTABLE, 0);
      ObjectSetInteger(0, lname, OBJPROP_HIDDEN,     1);
     }

   sweepList[idx].drawnState = st;
  }

// ─── DrawAll ──────────────────────────────────────────────────────
void DrawAll()
  {
   for(int i = 0; i < sweepCount; i++) DrawOne(i);
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
   int minBars = InpSwingStr * 2 + 2;
   if(rates_total < minBars) return(0);

   // ── Full recalculation ────────────────────────────────────
   if(prev_calculated == 0)
     {
      ResetState();
      int limit = (int)MathMin(
                     (long)(rates_total - InpSwingStr - 1),
                     (long)InpLookback);
      if(limit < 1) return(rates_total);

      for(int sh = limit; sh >= 1; sh--)
        {
         TryAddSwing(sh);
         CheckNewSweeps(sh);
         UpdateSweepStates(sh);
        }

      DrawAll();
      return(rates_total);
     }

   // ── Live: one bar just closed ─────────────────────────────
   TryAddSwing(1);
   CheckNewSweeps(1);
   UpdateSweepStates(1);
   for(int i = sweepCount - 1; i >= 0; i--)
     {
      if(sweepList[i].drawnState != sweepList[i].state) DrawOne(i);
     }

   return(rates_total);
  }
`.trim();
}
