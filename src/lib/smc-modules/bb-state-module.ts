// ─── Breaker Block State Module ──────────────────────────────────────────────
// Phase 2 State Module — EAbuilder2
//
// Two-layer embedded detection:
//   Layer 1 — OB detection: ATR displacement → find last opposing candle (= OB)
//   Layer 2 — BB creation:  OB broken in opposite direction → Breaker Block born
//
// BB lifecycle mirrors OB State exactly:
//   ACTIVE → RETESTED → CONFIRMED (Phase 3 signal)
//   ACTIVE → MITIGATED | INVALIDATED | EXPIRED (terminal)
//
// Bullish BB (buy zone): from BEARISH OB broken upward — price should return
//                        to zone and close above OB high.
// Bearish BB (sell zone): from BULLISH OB broken downward — price should return
//                         to zone and close below OB low.
//
// Standard 4-buffer Phase 3 contract:
//   [0] BullConfirmBuf  [1] BearConfirmBuf  [2] BullSLBuf  [3] BearSLBuf

export const BB_STATE_MODULE_VERSION = "1.0.0";
export const BB_STATE_MODULE = "BB_State_Module";

export function generateBbStateModule(): string {
  return `
//+------------------------------------------------------------------+
//| BB_State_Module.mq5                                              |
//| Phase 2 Breaker Block State Module — EAbuilder2                  |
//| v${BB_STATE_MODULE_VERSION}                                                          |
//|                                                                  |
//| Buffers (read via iCustom()):                                    |
//|   0 : BullConfirmBuf — 1.0 at bull BB CONFIRMED bar             |
//|   1 : BearConfirmBuf — 1.0 at bear BB CONFIRMED bar             |
//|   2 : BullSLBuf      — retestLow at bull confirmation bar       |
//|   3 : BearSLBuf      — retestHigh at bear confirmation bar      |
//+------------------------------------------------------------------+
#property copyright   "EAbuilder2"
#property version     "${BB_STATE_MODULE_VERSION}"
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
input int             InpAtrPeriod   = 14;                // ATR period (displacement filter)
input double          InpDispMult    = 1.5;               // ATR multiplier for displacement
input int             InpObLookback  = 5;                 // Max bars to search for OB candle
input int             InpExpiryBars  = 100;               // Bars before EXPIRED
input bool            InpShowBull    = true;              // Show bullish BB zones
input bool            InpShowBear    = true;              // Show bearish BB zones
input bool            InpShowTerminal = false;            // Show terminal zones
input color           InpBullColor   = clrMediumSeaGreen; // Bull BB colour
input color           InpBearColor   = clrOrangeRed;      // Bear BB colour
input int             InpActiveFillAlpha  = 70;           // Active fill opacity 0–255
input int             InpTerminalFillAlpha = 25;          // Terminal fill opacity 0–255

// ─── States ───────────────────────────────────────────────────────
#define STATE_ACTIVE       0
#define STATE_RETESTED     1
#define STATE_CONFIRMED    2
#define STATE_MITIGATED    3
#define STATE_INVALIDATED  4
#define STATE_EXPIRED      5
#define STATE_UNDRAWN     -1

// ─── Object prefix ────────────────────────────────────────────────
#define OBJ_PREFIX    "SMCBBS_"
#define FAR_FUTURE    ((datetime)4102444800)

// ─── Internal OB struct (detection layer only) ───────────────────
//  dir: 1 = bullish OB (last bearish candle before bullish displacement)
//       -1 = bearish OB (last bullish candle before bearish displacement)
struct ObInternal
  {
   int      id;
   int      dir;
   double   hi;
   double   lo;
   datetime time;
   bool     broken;
  };

// ─── BB record ────────────────────────────────────────────────────
//  dir: 1 = bullish BB (buy zone), -1 = bearish BB (sell zone)
struct BbRecord
  {
   int      id;
   int      dir;
   double   hi;
   double   lo;
   int      state;
   int      drawnState;
   int      barsAlive;
   datetime obTime;        // original OB candle time (left edge of rectangle)
   datetime breakoutTime;  // bar where OB was broken → BB born (skip guard)
   datetime retestTime;
   double   retestHigh;
   double   retestLow;
   datetime confirmTime;
   datetime endTime;
  };

#define MAX_OBS  500
#define MAX_BBS  500

ObInternal obList[MAX_OBS];
int        obCount  = 0;
int        gNextOId = 1;

BbRecord   bbList[MAX_BBS];
int        bbCount  = 0;
int        gNextBId = 1;

// ─── Inline bar accessors ─────────────────────────────────────────
double   Hi(int sh) { return iHigh (_Symbol, InpTimeframe, sh); }
double   Lo(int sh) { return iLow  (_Symbol, InpTimeframe, sh); }
double   Op(int sh) { return iOpen (_Symbol, InpTimeframe, sh); }
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

// ─── ATR ──────────────────────────────────────────────────────────
double CalcATR(int sh, int period)
  {
   double sum = 0.0;
   int    totalBars = Bars(_Symbol, InpTimeframe);
   for(int j = sh; j < sh + period && j + 1 < totalBars; j++)
     {
      double h = Hi(j), l = Lo(j), pc = Cl(j + 1);
      sum += MathMax(h - l, MathMax(MathAbs(h - pc), MathAbs(l - pc)));
     }
   return (period > 0) ? sum / period : 0.0;
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
                      "BB_State v${BB_STATE_MODULE_VERSION}");
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
   obCount  = 0;  gNextOId = 1;
   bbCount  = 0;  gNextBId = 1;
   ObjectsDeleteAll(0, OBJ_PREFIX);
  }

// ─── OB Detection ─────────────────────────────────────────────────
// At bar sh: test for ATR displacement.  If found, walk backward from
// sh+1 up to InpObLookback bars to find the last opposing candle = OB.
void DetectOb(int sh)
  {
   int totalBars = Bars(_Symbol, InpTimeframe);
   if(sh + InpAtrPeriod + 1 >= totalBars) return;

   double body = MathAbs(Cl(sh) - Op(sh));
   double atr  = CalcATR(sh, InpAtrPeriod);
   if(atr <= 0.0 || body < InpDispMult * atr) return;

   bool isBullDisp = (Cl(sh) > Op(sh));

   // Walk backward from sh+1 looking for the last opposing candle
   for(int j = sh + 1; j <= sh + InpObLookback && j + 1 < totalBars; j++)
     {
      bool isBearCandle = (Cl(j) < Op(j));
      bool isBullCandle = (Cl(j) > Op(j));

      bool found = (isBullDisp && isBearCandle) || (!isBullDisp && isBullCandle);
      if(!found) continue;

      // Dedup: OB at this time already registered? (skip broken — their slot can be recycled)
      datetime obT = Tm(j);
      bool dup = false;
      for(int k = 0; k < obCount; k++)
        {
         if(obList[k].broken) continue;
         if(obList[k].time == obT) { dup = true; break; }
        }
      if(dup) return;

      // Slot allocation: recycle a broken OB slot before appending.
      // Without recycling, obCount hits MAX_OBS during long backtests
      // and DetectOb silently stops registering new OBs — no BBs born.
      int idx = -1;
      for(int k = 0; k < obCount; k++)
        {
         if(obList[k].broken) { idx = k; break; }
        }
      if(idx < 0)
        {
         if(obCount >= MAX_OBS) return;  // All slots live — hard pool cap
         idx = obCount++;
        }

      obList[idx].id     = gNextOId++;
      obList[idx].dir    = isBullDisp ? 1 : -1;
      obList[idx].hi     = Hi(j);
      obList[idx].lo     = Lo(j);
      obList[idx].time   = obT;
      obList[idx].broken = false;
      return;  // one OB per displacement
     }
  }

// ─── OB Breakout → BB Creation ────────────────────────────────────
// Close through the FAR edge of an OB (opposite side from origin) → BB born.
//   Bullish OB (dir=1) broken when close < lo  → Bearish BB (sell zone)
//   Bearish OB (dir=-1) broken when close > hi → Bullish BB (buy zone)
void CheckObBreakout(int sh)
  {
   double   closeV = Cl(sh);
   datetime barT   = Tm(sh);

   for(int k = 0; k < obCount; k++)
     {
      if(obList[k].broken)         continue;
      if(obList[k].time >= barT)   continue;  // skip guard: OB must pre-date bar

      if(obList[k].dir == 1 && closeV < obList[k].lo)
        {
         // Bullish OB broken → Bearish BB
         // Recycle a terminal BB slot before appending
         int bIdx = -1;
         for(int m = 0; m < bbCount; m++)
           {
            int bst = bbList[m].state;
            if(bst == STATE_MITIGATED || bst == STATE_INVALIDATED || bst == STATE_EXPIRED)
              { bIdx = m; break; }
           }
         if(bIdx < 0)
           {
            if(bbCount >= MAX_BBS) { obList[k].broken = true; continue; }
            bIdx = bbCount++;
           }
         bbList[bIdx].id           = gNextBId++;
         bbList[bIdx].dir          = -1;
         bbList[bIdx].hi           = obList[k].hi;
         bbList[bIdx].lo           = obList[k].lo;
         bbList[bIdx].state        = STATE_ACTIVE;
         bbList[bIdx].drawnState   = STATE_UNDRAWN;
         bbList[bIdx].barsAlive    = 0;
         bbList[bIdx].obTime       = obList[k].time;
         bbList[bIdx].breakoutTime = barT;
         bbList[bIdx].retestTime   = 0;
         bbList[bIdx].retestHigh   = 0.0;
         bbList[bIdx].retestLow    = 0.0;
         bbList[bIdx].confirmTime  = 0;
         bbList[bIdx].endTime      = FAR_FUTURE;

         obList[k].broken = true;
         PrintFormat("BB_BEAR_ACTIVE | id=%d | hi=%.5f | lo=%.5f | breakout=%s",
                     gNextBId - 1, obList[k].hi, obList[k].lo, TimeToString(barT));
        }
      else if(obList[k].dir == -1 && closeV > obList[k].hi)
        {
         // Bearish OB broken → Bullish BB
         int bIdx = -1;
         for(int m = 0; m < bbCount; m++)
           {
            int bst = bbList[m].state;
            if(bst == STATE_MITIGATED || bst == STATE_INVALIDATED || bst == STATE_EXPIRED)
              { bIdx = m; break; }
           }
         if(bIdx < 0)
           {
            if(bbCount >= MAX_BBS) { obList[k].broken = true; continue; }
            bIdx = bbCount++;
           }
         bbList[bIdx].id           = gNextBId++;
         bbList[bIdx].dir          = 1;
         bbList[bIdx].hi           = obList[k].hi;
         bbList[bIdx].lo           = obList[k].lo;
         bbList[bIdx].state        = STATE_ACTIVE;
         bbList[bIdx].drawnState   = STATE_UNDRAWN;
         bbList[bIdx].barsAlive    = 0;
         bbList[bIdx].obTime       = obList[k].time;
         bbList[bIdx].breakoutTime = barT;
         bbList[bIdx].retestTime   = 0;
         bbList[bIdx].retestHigh   = 0.0;
         bbList[bIdx].retestLow    = 0.0;
         bbList[bIdx].confirmTime  = 0;
         bbList[bIdx].endTime      = FAR_FUTURE;

         obList[k].broken = true;
         PrintFormat("BB_BULL_ACTIVE | id=%d | hi=%.5f | lo=%.5f | breakout=%s",
                     gNextBId - 1, obList[k].hi, obList[k].lo, TimeToString(barT));
        }
     }
  }

// ─── UpdateBbStates ───────────────────────────────────────────────
void UpdateBbStates(int sh)
  {
   double   barHigh  = Hi(sh);
   double   barLow   = Lo(sh);
   double   barClose = Cl(sh);
   datetime barT     = Tm(sh);

   for(int i = 0; i < bbCount; i++)
     {
      int st = bbList[i].state;
      if(st == STATE_MITIGATED  || st == STATE_INVALIDATED || st == STATE_EXPIRED)
         continue;

      // Skip guard: don't process BB on the same bar it was created
      if(bbList[i].breakoutTime >= barT) continue;

      bool isBull = (bbList[i].dir == 1);
      double bbHi = bbList[i].hi;
      double bbLo = bbList[i].lo;

      bbList[i].barsAlive++;

      // ── Expiry check ─────────────────────────────────────
      if(bbList[i].barsAlive >= InpExpiryBars)
        {
         bbList[i].state   = STATE_EXPIRED;
         bbList[i].endTime = barT;
         PrintFormat(isBull ? "BB_BULL_EXPIRED | id=%d | bars=%d"
                            : "BB_BEAR_EXPIRED | id=%d | bars=%d",
                     bbList[i].id, bbList[i].barsAlive);
         DrawOne(i);
         continue;
        }

      // ── State-specific transitions ────────────────────────
      if(st == STATE_ACTIVE || st == STATE_RETESTED || st == STATE_CONFIRMED)
        {
         if(isBull)
           {
            // Invalidation: close below lo (failed zone)
            if(barClose < bbLo)
              {
               bbList[i].state   = STATE_INVALIDATED;
               bbList[i].endTime = barT;
               PrintFormat("BB_BULL_INVALIDATED | id=%d | close=%.5f | lo=%.5f",
                           bbList[i].id, barClose, bbLo);
               DrawOne(i);
               continue;
              }
            // Mitigation: close trades inside zone
            if(barClose >= bbLo && barClose <= bbHi)
              {
               bbList[i].state   = STATE_MITIGATED;
               bbList[i].endTime = barT;
               PrintFormat("BB_BULL_MITIGATED | id=%d | close=%.5f",
                           bbList[i].id, barClose);
               DrawOne(i);
               continue;
              }
            // CONFIRMED transition (from RETESTED): close above hi
            if(st == STATE_RETESTED && barClose > bbHi)
              {
               bbList[i].state       = STATE_CONFIRMED;
               bbList[i].confirmTime = barT;
               // Write Phase 3 buffers
               if(sh < ArraySize(BullConfirmBuf)) BullConfirmBuf[sh] = 1.0;
               if(sh < ArraySize(BullSLBuf))
                  BullSLBuf[sh] = bbList[i].retestLow;
               PrintFormat("BB_BULL_CONFIRMED | id=%d | retestLow=%.5f | sh=%d",
                           bbList[i].id, bbList[i].retestLow, sh);
               DrawOne(i);
               continue;
              }
            // RETESTED: wick enters zone from above
            if(st != STATE_RETESTED && barLow <= bbHi)
              {
               bbList[i].state      = STATE_RETESTED;
               bbList[i].retestTime = barT;
               if(barLow  < bbList[i].retestLow  || bbList[i].retestLow  == 0.0) bbList[i].retestLow  = barLow;
               if(barHigh > bbList[i].retestHigh || bbList[i].retestHigh == 0.0) bbList[i].retestHigh = barHigh;
               PrintFormat("BB_BULL_RETESTED | id=%d | retestLow=%.5f",
                           bbList[i].id, bbList[i].retestLow);
               DrawOne(i);
              }
            // Already RETESTED: accumulate wick extremes
            else if(st == STATE_RETESTED)
              {
               if(barLow  < bbList[i].retestLow)  bbList[i].retestLow  = barLow;
               if(barHigh > bbList[i].retestHigh) bbList[i].retestHigh = barHigh;
              }
           }
         else // isBear
           {
            // Invalidation: close above hi
            if(barClose > bbHi)
              {
               bbList[i].state   = STATE_INVALIDATED;
               bbList[i].endTime = barT;
               PrintFormat("BB_BEAR_INVALIDATED | id=%d | close=%.5f | hi=%.5f",
                           bbList[i].id, barClose, bbHi);
               DrawOne(i);
               continue;
              }
            // Mitigation: close inside zone
            if(barClose >= bbLo && barClose <= bbHi)
              {
               bbList[i].state   = STATE_MITIGATED;
               bbList[i].endTime = barT;
               PrintFormat("BB_BEAR_MITIGATED | id=%d | close=%.5f",
                           bbList[i].id, barClose);
               DrawOne(i);
               continue;
              }
            // CONFIRMED transition (from RETESTED): close below lo
            if(st == STATE_RETESTED && barClose < bbLo)
              {
               bbList[i].state       = STATE_CONFIRMED;
               bbList[i].confirmTime = barT;
               if(sh < ArraySize(BearConfirmBuf)) BearConfirmBuf[sh] = 1.0;
               if(sh < ArraySize(BearSLBuf))
                  BearSLBuf[sh] = bbList[i].retestHigh;
               PrintFormat("BB_BEAR_CONFIRMED | id=%d | retestHigh=%.5f | sh=%d",
                           bbList[i].id, bbList[i].retestHigh, sh);
               DrawOne(i);
               continue;
              }
            // RETESTED: wick enters zone from below
            if(st != STATE_RETESTED && barHigh >= bbLo)
              {
               bbList[i].state      = STATE_RETESTED;
               bbList[i].retestTime = barT;
               if(barLow  < bbList[i].retestLow  || bbList[i].retestLow  == 0.0) bbList[i].retestLow  = barLow;
               if(barHigh > bbList[i].retestHigh || bbList[i].retestHigh == 0.0) bbList[i].retestHigh = barHigh;
               PrintFormat("BB_BEAR_RETESTED | id=%d | retestHigh=%.5f",
                           bbList[i].id, bbList[i].retestHigh);
               DrawOne(i);
              }
            else if(st == STATE_RETESTED)
              {
               if(barLow  < bbList[i].retestLow)  bbList[i].retestLow  = barLow;
               if(barHigh > bbList[i].retestHigh) bbList[i].retestHigh = barHigh;
              }
           }
        }
     }
  }

// ─── DrawOne ──────────────────────────────────────────────────────
void DrawOne(int idx)
  {
   if(idx < 0 || idx >= bbCount) return;

   bool    isBull = (bbList[idx].dir == 1);
   int     st     = bbList[idx].state;
   bool    terminal = (st == STATE_MITIGATED || st == STATE_INVALIDATED || st == STATE_EXPIRED);

   if(terminal && !InpShowTerminal) return;
   if( isBull  && !InpShowBull)     return;
   if(!isBull  && !InpShowBear)     return;
   if(st == bbList[idx].drawnState) return;  // no visual change

   color baseColor = isBull ? InpBullColor : InpBearColor;

   color fillColor;
   ENUM_LINE_STYLE borderStyle = STYLE_SOLID;
   int   borderWidth = 1;

   if(terminal)
     {
      fillColor   = BlendWithBg(baseColor, InpTerminalFillAlpha);
      borderStyle = STYLE_DOT;
     }
   else
     {
      int alpha = InpActiveFillAlpha;
      if(st == STATE_RETESTED)  { fillColor = BlendWithBg(clrGold,  alpha); }
      else if(st == STATE_CONFIRMED) { fillColor = BlendWithBg(baseColor, alpha); borderWidth = 2; }
      else                      { fillColor = BlendWithBg(baseColor, alpha); }
     }

   string   name  = OBJ_PREFIX + IntegerToString(bbList[idx].id);
   string   lname = OBJ_PREFIX + "L" + IntegerToString(bbList[idx].id);
   datetime right = terminal ? bbList[idx].endTime : FAR_FUTURE;

   // ── Rectangle ─────────────────────────────────────────────
   if(ObjectFind(0, name) < 0)
      ObjectCreate(0, name, OBJ_RECTANGLE, 0,
                   bbList[idx].obTime, bbList[idx].hi,
                   right,              bbList[idx].lo);
   else
      ObjectSetInteger(0, name, OBJPROP_TIME,  1, right);

   ObjectSetInteger(0, name, OBJPROP_COLOR,      baseColor);
   ObjectSetInteger(0, name, OBJPROP_BGCOLOR,    fillColor);
   ObjectSetInteger(0, name, OBJPROP_STYLE,      borderStyle);
   ObjectSetInteger(0, name, OBJPROP_WIDTH,      borderWidth);
   ObjectSetInteger(0, name, OBJPROP_BACK,       1);
   ObjectSetInteger(0, name, OBJPROP_FILL,       1);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, 0);
   ObjectSetInteger(0, name, OBJPROP_HIDDEN,     1);

   // ── Label ─────────────────────────────────────────────────
   string ltext;
   if(st == STATE_ACTIVE)       ltext = isBull ? "BB↑" : "BB↓";
   else if(st == STATE_RETESTED)  ltext = isBull ? "BB-T" : "BB-T";
   else if(st == STATE_CONFIRMED) ltext = isBull ? "BB-C" : "BB-C";
   else if(st == STATE_MITIGATED) ltext = "BB-M";
   else if(st == STATE_INVALIDATED) ltext = "BB-X";
   else ltext = "BB-E";

   if(ObjectFind(0, lname) < 0)
      ObjectCreate(0, lname, OBJ_TEXT, 0,
                   bbList[idx].obTime, bbList[idx].hi);
   ObjectSetString (0, lname, OBJPROP_TEXT,       ltext);
   ObjectSetInteger(0, lname, OBJPROP_COLOR,      baseColor);
   ObjectSetInteger(0, lname, OBJPROP_ANCHOR,     ANCHOR_LEFT);
   ObjectSetInteger(0, lname, OBJPROP_FONTSIZE,   8);
   ObjectSetInteger(0, lname, OBJPROP_SELECTABLE, 0);
   ObjectSetInteger(0, lname, OBJPROP_HIDDEN,     1);

   bbList[idx].drawnState = st;
  }

// ─── DrawAll ──────────────────────────────────────────────────────
void DrawAll()
  {
   for(int i = 0; i < bbCount; i++) DrawOne(i);
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
   int minBars = InpAtrPeriod + InpObLookback + 2;
   if(rates_total < minBars) return(0);

   // ── Full recalculation ────────────────────────────────────
   if(prev_calculated == 0)
     {
      ResetState();
      int limit = (int)MathMin((long)(rates_total - minBars), (long)InpLookback);
      if(limit < 1) return(rates_total);

      // Single chronological loop (oldest → newest).
      // DetectOb at sh: detects displacement at sh, creates internal OB at sh+j.
      // CheckObBreakout at sh: closes through OB far edge → creates BB.
      // UpdateBbStates at sh: advances BB state machine.
      for(int sh = limit; sh >= 1; sh--)
        {
         DetectOb(sh);
         CheckObBreakout(sh);
         UpdateBbStates(sh);
        }

      DrawAll();
      return(rates_total);
     }

   // ── Live: one bar just closed ─────────────────────────────
   DetectOb(1);
   CheckObBreakout(1);
   UpdateBbStates(1);
   // Redraw any zones whose state changed on this bar
   for(int i = bbCount - 1; i >= 0; i--)
     {
      if(bbList[i].drawnState != bbList[i].state) DrawOne(i);
     }

   return(rates_total);
  }
`.trim();
}
