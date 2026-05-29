// ─── Gap SNR State Module ─────────────────────────────────────────────────────
// Phase 2 State Module — EAbuilder2
//
// Identical lifecycle to Classic_SNR_State_Module.  Only the detection differs:
// Gap SNR uses candle-pair direction CONTINUATION instead of reversal.
//
// Gap S/R detection:
//   GAP RESISTANCE: Bearish A → Bearish B  →  A.close = resistance level
//   GAP SUPPORT:    Bullish A → Bullish B  →  A.close = support level
//
// Level lifecycle (identical to Classic SNR State Module):
//   ACTIVE → RETESTED → CONFIRMED (Phase 3 signal) → cycle
//   BROKEN [terminal]  |  EXPIRED [terminal]
//
// Object prefix: SMCSNRGS_ (distinct from Classic: SMCSNRCS_)
//
// Standard 4-buffer Phase 3 contract:
//   [0] BullConfirmBuf  [1] BearConfirmBuf  [2] BullSLBuf  [3] BearSLBuf

export const GAP_SNR_STATE_MODULE_VERSION = "1.00";
export const GAP_SNR_STATE_MODULE = "Gap_SNR_State_Module";

export function generateGapSnrStateModule(): string {
  return `
//+------------------------------------------------------------------+
//| Gap_SNR_State_Module.mq5                                         |
//| Phase 2 Gap SNR State Module — EAbuilder2                        |
//| v${GAP_SNR_STATE_MODULE_VERSION}                                                     |
//|                                                                  |
//| Detection: candle-pair direction CONTINUATION (Bull-Bull = Sup,  |
//|            Bear-Bear = Res, Candle A close = level).             |
//|                                                                  |
//| Buffers (read via iCustom()):                                    |
//|   0 : BullConfirmBuf — 1.0 at gap support CONFIRMED bar         |
//|   1 : BearConfirmBuf — 1.0 at gap resistance CONFIRMED bar      |
//|   2 : BullSLBuf      — retestLow at confirmation bar            |
//|   3 : BearSLBuf      — retestHigh at confirmation bar           |
//+------------------------------------------------------------------+
#property copyright   "EAbuilder2"
#property version     "${GAP_SNR_STATE_MODULE_VERSION}"
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
input bool            InpShowSup     = true;              // Show gap support levels
input bool            InpShowRes     = true;              // Show gap resistance levels
input bool            InpShowTerminal = false;            // Show broken/expired lines
input color           InpSupColor    = clrDodgerBlue;     // Gap support colour
input color           InpResColor    = clrDarkOrange;     // Gap resistance colour
input int             InpLineWidth   = 1;                 // Line width (active)
input int             InpMaxLevels   = 50;                // Max levels on chart

// ─── States ───────────────────────────────────────────────────────
#define STATE_ACTIVE       0
#define STATE_RETESTED     1
#define STATE_CONFIRMED    2
#define STATE_BROKEN       3
#define STATE_EXPIRED      5
#define STATE_UNDRAWN     -1

// ─── Object prefix (distinct from Classic SNR State: SMCSNRCS_) ──
#define OBJ_PREFIX   "SMCSNRGS_"
#define FAR_FUTURE   ((datetime)4102444800)

// ─── SNR Level record ─────────────────────────────────────────────
struct SnrRecord
  {
   int      id;
   int      dir;         // 1 = gap support  -1 = gap resistance
   double   level;
   datetime levelTime;
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
int       snrCount    = 0;
int       gNextId     = 1;
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
                      "Gap_SNR_State v${GAP_SNR_STATE_MODULE_VERSION}");
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
// At scan position sh, check if (sh+1=CandleA, sh=CandleB) form a Gap SNR pair.
// Gap pattern: direction CONTINUATION between A and B.
//   Bull A → Bull B  = Gap Support     (A.close = level)
//   Bear A → Bear B  = Gap Resistance  (A.close = level)
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

   if(aBull && bBull) { dir = 1;  level = Cl(sh + 1); }  // Gap Support
   else if(aBear && bBear) { dir = -1; level = Cl(sh + 1); }  // Gap Resistance
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
// Identical logic to Classic SNR State Module — only the detection above differs.
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

      if(snrList[i].levelTime >= barT) continue;

      bool   isSup = (snrList[i].dir == 1);
      double lv    = snrList[i].level;

      snrList[i].barsAlive++;

      if(snrList[i].barsAlive >= InpExpiryBars)
        {
         snrList[i].state   = STATE_EXPIRED;
         snrList[i].endTime = barT;
         DrawOne(i);
         continue;
        }

      if(isSup)
        {
         if(barClose < lv)
           {
            snrList[i].state   = STATE_BROKEN;
            snrList[i].endTime = barT;
            DrawOne(i);
            continue;
           }
         if(st == STATE_RETESTED && barClose > lv)
           {
            snrList[i].state       = STATE_CONFIRMED;
            snrList[i].confirmTime = barT;
            if(sh < ArraySize(BullConfirmBuf)) BullConfirmBuf[sh] = 1.0;
            if(sh < ArraySize(BullSLBuf))      BullSLBuf[sh]      = snrList[i].retestLow;
            PrintFormat("G_SNR_SUPPORT_CONFIRMED | id=%d | level=%.5f | sl=%.5f | sh=%d",
                        snrList[i].id, lv, snrList[i].retestLow, sh);
            DrawOne(i);
            continue;
           }
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
      else
        {
         if(barClose > lv)
           {
            snrList[i].state   = STATE_BROKEN;
            snrList[i].endTime = barT;
            DrawOne(i);
            continue;
           }
         if(st == STATE_RETESTED && barClose < lv)
           {
            snrList[i].state       = STATE_CONFIRMED;
            snrList[i].confirmTime = barT;
            if(sh < ArraySize(BearConfirmBuf)) BearConfirmBuf[sh] = 1.0;
            if(sh < ArraySize(BearSLBuf))      BearSLBuf[sh]      = snrList[i].retestHigh;
            PrintFormat("G_SNR_RESISTANCE_CONFIRMED | id=%d | level=%.5f | sl=%.5f | sh=%d",
                        snrList[i].id, lv, snrList[i].retestHigh, sh);
            DrawOne(i);
            continue;
           }
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
   int   lWidth;
   color lineCol;

   if(terminal)       { lWidth = 1; lineCol = BlendWithBg(baseColor, 80); }
   else if(st == STATE_RETESTED)  { lWidth = InpLineWidth;     lineCol = clrGold;     }
   else if(st == STATE_CONFIRMED) { lWidth = InpLineWidth + 1; lineCol = baseColor;   }
   else                           { lWidth = InpLineWidth;     lineCol = BlendWithBg(baseColor, 180); }

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

   string ltext;
   if(st == STATE_ACTIVE)         ltext = isSup ? "G-Sup" : "G-Res";
   else if(st == STATE_RETESTED)  ltext = isSup ? "G-Sup-T" : "G-Res-T";
   else if(st == STATE_CONFIRMED) ltext = isSup ? "G-Sup-C" : "G-Res-C";
   else if(st == STATE_BROKEN)    ltext = isSup ? "G-Sup-B" : "G-Res-B";
   else                           ltext = isSup ? "G-Sup-E" : "G-Res-E";

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
