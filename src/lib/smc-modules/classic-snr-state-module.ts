// ─── Classic SNR State Module ─────────────────────────────────────────────────
// Phase 2 State Module — EAbuilder2
//
// Embeds Classic SNR detection (candle-pair direction REVERSAL) and tracks each
// level through the full Phase 2 lifecycle.
//
// Classic S/R detection:
//   RESISTANCE: Bullish A → Bearish B  →  A.close = resistance level
//   SUPPORT:    Bearish A → Bullish B  →  A.close = support level
//
// Level lifecycle (single price line — no zone thickness):
//   ACTIVE    → level created, extending right
//   RETESTED  → wick reaches level from correct side
//   CONFIRMED → from RETESTED, close holds on correct side (Phase 3 signal)
//   BROKEN    → close on wrong side [terminal]
//   EXPIRED   → barsAlive ≥ InpExpiryBars [terminal]
//
// Post-CONFIRMED the level cycles back through RETESTED → CONFIRMED on every
// subsequent touch, until BROKEN or EXPIRED (same cycle-until-terminal pattern
// as all other Phase 2 modules).
//
// Standard 4-buffer Phase 3 contract:
//   [0] BullConfirmBuf  [1] BearConfirmBuf  [2] BullSLBuf  [3] BearSLBuf
//
// SL semantics for SNR:
//   BullSLBuf = retestLow  (wick low of the support retest bar — buyer's SL)
//   BearSLBuf = retestHigh (wick high of the resistance retest bar — seller's SL)

export const CLASSIC_SNR_STATE_MODULE_VERSION = "1.0.0";
export const CLASSIC_SNR_STATE_MODULE = "Classic_SNR_State_Module";

export function generateClassicSnrStateModule(): string {
  return `
//+------------------------------------------------------------------+
//| Classic_SNR_State_Module.mq5                                     |
//| Phase 2 Classic SNR State Module — EAbuilder2                    |
//| v${CLASSIC_SNR_STATE_MODULE_VERSION}                                                 |
//|                                                                  |
//| Detection: candle-pair direction REVERSAL (Bull-Bear = Res,      |
//|            Bear-Bull = Sup, Candle A close = level).             |
//|                                                                  |
//| Buffers (read via iCustom()):                                    |
//|   0 : BullConfirmBuf — 1.0 at support CONFIRMED bar             |
//|   1 : BearConfirmBuf — 1.0 at resistance CONFIRMED bar          |
//|   2 : BullSLBuf      — retestLow at confirmation bar            |
//|   3 : BearSLBuf      — retestHigh at confirmation bar           |
//+------------------------------------------------------------------+
#property copyright   "EAbuilder2"
#property version     "${CLASSIC_SNR_STATE_MODULE_VERSION}"
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
input int             InpExpiryBars  = 100;               // Bars before EXPIRED
input bool            InpIgnoreDoji  = true;              // Skip doji candles
input double          InpDojiThresh  = 0.1;               // Doji body/range threshold
input bool            InpShowSup     = true;              // Show support levels
input bool            InpShowRes     = true;              // Show resistance levels
input bool            InpShowTerminal = false;            // Show broken/expired lines
input color           InpSupColor    = clrMediumSeaGreen; // Support colour
input color           InpResColor    = clrTomato;         // Resistance colour
input int             InpLineWidth   = 1;                 // Line width (active)
input int             InpMaxLevels   = 50;                // Max levels on chart

// ─── States ───────────────────────────────────────────────────────
#define STATE_ACTIVE       0
#define STATE_RETESTED     1
#define STATE_CONFIRMED    2
#define STATE_BROKEN       3
#define STATE_EXPIRED      5
#define STATE_UNDRAWN     -1

// ─── Object prefix (distinct from Phase 1 Classic_SNR_Detector) ──
#define OBJ_PREFIX   "SMCSNRCS_"
#define FAR_FUTURE   ((datetime)4102444800)

// ─── SNR Level record ─────────────────────────────────────────────
struct SnrRecord
  {
   int      id;
   int      dir;         // 1 = support  -1 = resistance
   double   level;
   datetime levelTime;   // Candle A bar time (left edge of line)
   int      state;
   int      drawnState;
   int      barsAlive;
   datetime retestTime;
   double   retestHigh;
   double   retestLow;
   datetime confirmTime;
   datetime endTime;
  };

#define MAX_LEVELS 1000

SnrRecord snrList[MAX_LEVELS];
int       snrCount   = 0;
int       gNextId    = 1;
int       gLinesDrawn = 0;

// ─── Inline bar accessors ─────────────────────────────────────────
double   Hi(int sh) { return iHigh (_Symbol, InpTimeframe, sh); }
double   Lo(int sh) { return iLow  (_Symbol, InpTimeframe, sh); }
double   Op(int sh) { return iOpen (_Symbol, InpTimeframe, sh); }
double   Cl(int sh) { return iClose(_Symbol, InpTimeframe, sh); }
datetime Tm(int sh) { return iTime (_Symbol, InpTimeframe, sh); }

bool IsDoji(int sh)
  {
   if(!InpIgnoreDoji) return false;
   double range = Hi(sh) - Lo(sh);
   if(range <= 0.0) return true;
   return (MathAbs(Cl(sh) - Op(sh)) / range) <= InpDojiThresh;
  }

bool IsBull(int sh) { return Cl(sh) > Op(sh); }
bool IsBear(int sh) { return Cl(sh) < Op(sh); }

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
                      "Classic_SNR_State v${CLASSIC_SNR_STATE_MODULE_VERSION}");
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
   snrCount    = 0;
   gNextId     = 1;
   gLinesDrawn = 0;
   ObjectsDeleteAll(0, OBJ_PREFIX);
  }

// ─── DetectSnr ────────────────────────────────────────────────────
// At scan position sh, check if (sh+1=CandleA, sh=CandleB) form an SNR pair.
// Classic pattern: direction REVERSAL between A and B.
//   Bull A → Bear B  = Resistance  (A.close = level)
//   Bear A → Bull B  = Support     (A.close = level)
void DetectSnr(int sh)
  {
   int totalBars = Bars(_Symbol, InpTimeframe);
   if(sh + 1 >= totalBars) return;

   if(IsDoji(sh) || IsDoji(sh + 1)) return;

   bool aBull = IsBull(sh + 1);
   bool aBear = IsBear(sh + 1);
   bool bBull = IsBull(sh);
   bool bBear = IsBear(sh);

   int    dir   = 0;
   double level = 0.0;

   if(aBull && bBear) { dir = -1; level = Cl(sh + 1); }  // Resistance
   else if(aBear && bBull) { dir = 1; level = Cl(sh + 1); }  // Support
   else return;

   // Dedup: skip terminal levels — their slot can be recycled
   datetime t = Tm(sh + 1);
   for(int k = 0; k < snrCount; k++)
     {
      if(snrList[k].state == STATE_BROKEN || snrList[k].state == STATE_EXPIRED) continue;
      if(snrList[k].levelTime == t && MathAbs(snrList[k].level - level) < _Point)
         return;
     }

   // Slot allocation: recycle a terminal slot before appending.
   // Without recycling, snrCount hits MAX_LEVELS during long backtests and
   // DetectSnr silently stops detecting — no further signals possible.
   int idx = -1;
   for(int k = 0; k < snrCount; k++)
     {
      if(snrList[k].state == STATE_BROKEN || snrList[k].state == STATE_EXPIRED)
        { idx = k; break; }
     }
   if(idx < 0)
     {
      if(snrCount >= MAX_LEVELS) return;
      idx = snrCount++;
     }

   snrList[idx].id          = gNextId++;
   snrList[idx].dir         = dir;
   snrList[idx].level       = level;
   snrList[idx].levelTime   = t;
   snrList[idx].state       = STATE_ACTIVE;
   snrList[idx].drawnState  = STATE_UNDRAWN;
   snrList[idx].barsAlive   = 0;
   snrList[idx].retestTime  = 0;
   snrList[idx].retestHigh  = 0.0;
   snrList[idx].retestLow   = 0.0;
   snrList[idx].confirmTime = 0;
   snrList[idx].endTime     = FAR_FUTURE;
  }

// ─── UpdateSnrStates ──────────────────────────────────────────────
void UpdateSnrStates(int sh)
  {
   double   barHigh  = Hi(sh);
   double   barLow   = Lo(sh);
   double   barClose = Cl(sh);
   datetime barT     = Tm(sh);

   for(int i = 0; i < snrCount; i++)
     {
      int st = snrList[i].state;
      if(st == STATE_BROKEN || st == STATE_EXPIRED) continue;

      // Skip guard: don't process level on the bar it was detected (CandleB = sh)
      if(snrList[i].levelTime >= barT) continue;

      bool    isSup = (snrList[i].dir == 1);
      double  lv    = snrList[i].level;

      snrList[i].barsAlive++;

      // ── Expiry ───────────────────────────────────────────
      if(snrList[i].barsAlive >= InpExpiryBars)
        {
         snrList[i].state   = STATE_EXPIRED;
         snrList[i].endTime = barT;
         DrawOne(i);
         continue;
        }

      // ── Support transitions ───────────────────────────────
      if(isSup)
        {
         // BROKEN: close below level [terminal]
         if(barClose < lv)
           {
            snrList[i].state   = STATE_BROKEN;
            snrList[i].endTime = barT;
            DrawOne(i);
            continue;
           }
         // CONFIRMED from RETESTED: close above level
         if(st == STATE_RETESTED && barClose > lv)
           {
            snrList[i].state       = STATE_CONFIRMED;
            snrList[i].confirmTime = barT;
            if(sh < ArraySize(BullConfirmBuf)) BullConfirmBuf[sh] = 1.0;
            if(sh < ArraySize(BullSLBuf))      BullSLBuf[sh]      = snrList[i].retestLow;
            PrintFormat("C_SNR_SUPPORT_CONFIRMED | id=%d | level=%.5f | sl=%.5f | sh=%d",
                        snrList[i].id, lv, snrList[i].retestLow, sh);
            DrawOne(i);
            continue;
           }
         // RETESTED: wick reaches level
         if(barLow <= lv)
           {
            if(st != STATE_RETESTED)
              {
               snrList[i].state      = STATE_RETESTED;
               snrList[i].retestTime = barT;
               snrList[i].retestLow  = barLow;
               snrList[i].retestHigh = barHigh;
               DrawOne(i);
              }
            else
              {
               if(barLow  < snrList[i].retestLow)  snrList[i].retestLow  = barLow;
               if(barHigh > snrList[i].retestHigh) snrList[i].retestHigh = barHigh;
              }
           }
        }
      // ── Resistance transitions ────────────────────────────
      else
        {
         // BROKEN: close above level [terminal]
         if(barClose > lv)
           {
            snrList[i].state   = STATE_BROKEN;
            snrList[i].endTime = barT;
            DrawOne(i);
            continue;
           }
         // CONFIRMED from RETESTED: close below level
         if(st == STATE_RETESTED && barClose < lv)
           {
            snrList[i].state       = STATE_CONFIRMED;
            snrList[i].confirmTime = barT;
            if(sh < ArraySize(BearConfirmBuf)) BearConfirmBuf[sh] = 1.0;
            if(sh < ArraySize(BearSLBuf))      BearSLBuf[sh]      = snrList[i].retestHigh;
            PrintFormat("C_SNR_RESISTANCE_CONFIRMED | id=%d | level=%.5f | sl=%.5f | sh=%d",
                        snrList[i].id, lv, snrList[i].retestHigh, sh);
            DrawOne(i);
            continue;
           }
         // RETESTED: wick reaches level
         if(barHigh >= lv)
           {
            if(st != STATE_RETESTED)
              {
               snrList[i].state      = STATE_RETESTED;
               snrList[i].retestTime = barT;
               snrList[i].retestLow  = barLow;
               snrList[i].retestHigh = barHigh;
               DrawOne(i);
              }
            else
              {
               if(barLow  < snrList[i].retestLow)  snrList[i].retestLow  = barLow;
               if(barHigh > snrList[i].retestHigh) snrList[i].retestHigh = barHigh;
              }
           }
        }
     }
  }

// ─── DrawOne ──────────────────────────────────────────────────────
void DrawOne(int idx)
  {
   if(idx < 0 || idx >= snrCount) return;

   bool  isSup    = (snrList[idx].dir == 1);
   int   st       = snrList[idx].state;
   bool  terminal = (st == STATE_BROKEN || st == STATE_EXPIRED);

   if(terminal && !InpShowTerminal) return;
   if( isSup   && !InpShowSup)      return;
   if(!isSup   && !InpShowRes)      return;
   if(st == snrList[idx].drawnState) return;

   color  baseColor = isSup ? InpSupColor : InpResColor;
   string name  = OBJ_PREFIX + IntegerToString(snrList[idx].id);
   string lname = OBJ_PREFIX + "L" + IntegerToString(snrList[idx].id);

   ENUM_LINE_STYLE lStyle = terminal ? STYLE_DOT : STYLE_SOLID;
   int lWidth;
   color lineCol;

   if(terminal)
     {
      lWidth  = 1;
      lineCol = BlendWithBg(baseColor, 80);
     }
   else if(st == STATE_RETESTED)
     {
      lWidth  = InpLineWidth;
      lineCol = clrGold;
     }
   else if(st == STATE_CONFIRMED)
     {
      lWidth  = InpLineWidth + 1;
      lineCol = baseColor;
     }
   else
     {
      lWidth  = InpLineWidth;
      lineCol = BlendWithBg(baseColor, 180);
     }

   datetime right = terminal ? snrList[idx].endTime : FAR_FUTURE;

   if(ObjectFind(0, name) < 0)
      ObjectCreate(0, name, OBJ_TREND, 0,
                   snrList[idx].levelTime, snrList[idx].level,
                   right,                  snrList[idx].level);
   else
      ObjectSetInteger(0, name, OBJPROP_TIME, 1, right);

   ObjectSetInteger(0, name, OBJPROP_COLOR,      lineCol);
   ObjectSetInteger(0, name, OBJPROP_WIDTH,      lWidth);
   ObjectSetInteger(0, name, OBJPROP_STYLE,      lStyle);
   ObjectSetInteger(0, name, OBJPROP_RAY_RIGHT,  terminal ? 0 : 1);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, 0);
   ObjectSetInteger(0, name, OBJPROP_HIDDEN,     1);

   // ── Label ─────────────────────────────────────────────────
   string ltext;
   if(st == STATE_ACTIVE)     ltext = isSup ? "C-Sup" : "C-Res";
   else if(st == STATE_RETESTED)  ltext = isSup ? "C-Sup-T" : "C-Res-T";
   else if(st == STATE_CONFIRMED) ltext = isSup ? "C-Sup-C" : "C-Res-C";
   else if(st == STATE_BROKEN)    ltext = isSup ? "C-Sup-B" : "C-Res-B";
   else                           ltext = isSup ? "C-Sup-E" : "C-Res-E";

   if(ObjectFind(0, lname) < 0)
      ObjectCreate(0, lname, OBJ_TEXT, 0,
                   snrList[idx].levelTime, snrList[idx].level);
   ObjectSetString (0, lname, OBJPROP_TEXT,       ltext);
   ObjectSetInteger(0, lname, OBJPROP_COLOR,      lineCol);
   ObjectSetInteger(0, lname, OBJPROP_ANCHOR,     ANCHOR_LEFT);
   ObjectSetInteger(0, lname, OBJPROP_FONTSIZE,   8);
   ObjectSetInteger(0, lname, OBJPROP_SELECTABLE, 0);
   ObjectSetInteger(0, lname, OBJPROP_HIDDEN,     1);

   snrList[idx].drawnState = st;
  }

// ─── DrawAll ──────────────────────────────────────────────────────
void DrawAll()
  {
   for(int i = 0; i < snrCount; i++) DrawOne(i);
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
   if(rates_total < 3) return(0);

   // ── Full recalculation ────────────────────────────────────
   if(prev_calculated == 0)
     {
      ResetState();
      int limit = (int)MathMin((long)(rates_total - 2), (long)InpLookback);
      if(limit < 1) return(rates_total);

      for(int sh = limit; sh >= 1; sh--)
        {
         DetectSnr(sh);
         UpdateSnrStates(sh);
        }

      DrawAll();
      return(rates_total);
     }

   // ── Live: one bar just closed ─────────────────────────────
   DetectSnr(1);
   UpdateSnrStates(1);
   for(int i = snrCount - 1; i >= 0; i--)
     {
      if(snrList[i].drawnState != snrList[i].state) DrawOne(i);
     }

   return(rates_total);
  }
`.trim();
}
