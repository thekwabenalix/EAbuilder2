/**
 * SMC Module Library — Phase 1: Detection + Lifecycle Management
 *
 * FVG (Fair Value Gap) Detector v3
 * ─────────────────────────────────
 * Generates a standalone MQL5 indicator that detects Fair Value Gaps,
 * draws zones, and manages their complete lifecycle via configurable rules.
 *
 * DETECTION (closed candles only):
 *   Bullish FVG  →  C3.Low  > C1.High    UL = C3.Low,  LL = C1.High
 *   Bearish FVG  →  C3.High < C1.Low     UL = C1.Low,  LL = C3.High
 *   C1 = shift 3  C2 = shift 2  C3 = shift 1
 *
 * LIFECYCLE STATES:
 *   ACTIVE      → zone untouched
 *   MITIGATED   → price entered the zone
 *   INVALIDATED → price closed / wicked through the zone
 *   EXPIRED     → zone exceeded InpExpiryBars
 *
 * MITIGATION MODES:
 *   touch_edge      → Bullish: Low ≤ UL     | Bearish: High ≥ LL
 *   touch_midpoint  → Bullish: Low ≤ mid    | Bearish: High ≥ mid
 *
 * INVALIDATION MODES:
 *   candle_close → Bullish: Close < LL  | Bearish: Close > UL  (default)
 *   wick_break   → Bullish: Low   < LL  | Bearish: High  > UL  (aggressive)
 *
 * VISUALIZATION:
 *   Opacity blended with the actual chart background colour (theme-aware).
 *   ACTIVE      → InpActiveOpacity (default 70%)
 *   MITIGATED   → InpMitigatedOpacity (default 25%)
 *   INVALIDATED → removed OR frozen + dotted border at ~8%
 *   EXPIRED     → same treatment as INVALIDATED
 *
 * PROCESSING ORDER per new bar:
 *   1. Expiry check
 *   2. Mitigation check  (ACTIVE → MITIGATED)
 *   3. Invalidation check (ACTIVE | MITIGATED → INVALIDATED)
 *   4. Draw / update rectangles
 *   5. Detect new FVGs on just-closed bar
 *
 * JOURNAL EVENTS (FVG_CREATED | FVG_MITIGATED | FVG_INVALIDATED | FVG_EXPIRED):
 *   event | id | dir | UL | LL | time / bars
 *
 * NO trading logic. Detection and visualisation only.
 */

export const FVG_DETECTOR_VERSION = "3.0.0";
export const FVG_DETECTOR_MODULE  = "FVG_Detector";

/**
 * Returns the complete MQL5 source code for the FVG Detector indicator (v3).
 * Drop the output into MetaEditor, compile, and attach to any chart.
 */
export function generateFvgDetector(): string {
  return `//+------------------------------------------------------------------+
//| FVG_Detector.mq5                                                 |
//| SMC Module Library v${FVG_DETECTOR_VERSION} — Phase 1: Detection + Lifecycle   |
//|                                                                  |
//| Detects Fair Value Gaps and manages their full lifecycle.        |
//|                                                                  |
//| DETECTION RULES:                                                 |
//|   Bullish FVG : C3.Low  > C1.High                               |
//|                 UL = C3.Low   LL = C1.High                      |
//|   Bearish FVG : C3.High < C1.Low                                |
//|                 UL = C1.Low   LL = C3.High                      |
//|   C1 = shift 3  C2 = shift 2  C3 = shift 1 (newest closed)     |
//|                                                                  |
//| MITIGATION MODES:                                                |
//|   touch_edge     : Bullish Low<=UL   | Bearish High>=LL          |
//|   touch_midpoint : Bullish Low<=mid  | Bearish High>=mid         |
//|                                                                  |
//| INVALIDATION MODES:                                              |
//|   candle_close : Bullish Close<LL  | Bearish Close>UL (default) |
//|   wick_break   : Bullish Low<LL    | Bearish High>UL  (aggress.) |
//|                                                                  |
//| JOURNAL OUTPUT:                                                  |
//|   FVG_CREATED    | id | dir | UL | LL | C1 | C3                 |
//|   FVG_MITIGATED  | id | dir | UL | LL | bar                     |
//|   FVG_INVALIDATED| id | dir | UL | LL | bar                     |
//|   FVG_EXPIRED    | id | dir | UL | LL | age_bars                |
//|                                                                  |
//| NO trading logic. Detection and visualisation only.             |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SMC Module Library"
#property version   "3.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

//--- Zone states
#define FVG_ACTIVE      0
#define FVG_MITIGATED   1
#define FVG_INVALIDATED 2
#define FVG_EXPIRED     3

//--- Mitigation mode
enum ENUM_MITIGATION_MODE
{
   MIT_TOUCH_EDGE      = 0, // Price enters zone near-side edge (default)
   MIT_TOUCH_MIDPOINT  = 1, // Price reaches zone midpoint
};

//--- Invalidation mode
enum ENUM_INVALIDATION_MODE
{
   INV_CANDLE_CLOSE = 0, // Candle close beyond zone (conservative)
   INV_WICK_BREAK   = 1, // Any wick beyond zone (aggressive)
};

//--- Inputs — Detection
input ENUM_TIMEFRAMES InpTF       = PERIOD_CURRENT; // Timeframe to scan
input int             InpLookback = 500;             // Historical bars to scan on load

//--- Inputs — Colour
input color InpBullClr = clrDodgerBlue; // Bullish FVG base colour
input color InpBearClr = clrOrangeRed;  // Bearish FVG base colour

//--- Inputs — Lifecycle
input ENUM_MITIGATION_MODE   InpMitigationMode   = MIT_TOUCH_EDGE;    // Mitigation trigger
input ENUM_INVALIDATION_MODE InpInvalidationMode = INV_CANDLE_CLOSE;  // Invalidation trigger
input int                    InpExpiryBars        = 50;                // Expire after N bars (0 = off)

//--- Inputs — Visualization
input int  InpActiveOpacity     = 70;   // Active zone opacity 0-100
input int  InpMitigatedOpacity  = 25;   // Mitigated zone opacity 0-100
input bool InpShowMitigated     = true; // Show mitigated zones
input bool InpRemoveInvalidated = true; // Remove invalidated / expired zones

//--- Inputs — Logging
input bool InpShowLog = true; // Print lifecycle events to journal

//--- Zone storage
#define FVG_MAX_ZONES 500

struct FVGRecord
{
   int      id;
   int      dir;          // +1 = bullish, -1 = bearish
   int      state;        // FVG_ACTIVE / MITIGATED / INVALIDATED / EXPIRED
   datetime c1Time;
   datetime c3Time;
   double   ul;           // upper limit of the gap
   double   ll;           // lower limit of the gap
   datetime invalidTime;  // right-edge freeze time (0 = still live)
};

FVGRecord fvgList[FVG_MAX_ZONES];
int       fvgTotal    = 0;
int       fvgDrawn    = 0;
int       nextId      = 0;
datetime  lastBarTime = 0;

//+------------------------------------------------------------------+
//| Blend a colour toward the chart background colour                |
//| opacityPct 100 = full base colour,  0 = invisible (background)  |
//| Uses the actual chart background so the result is theme-aware.  |
//| MQL5 color: 0x00BBGGRR  (R=byte0 G=byte1 B=byte2)              |
//+------------------------------------------------------------------+
color BlendWithBg(color base, int opacityPct)
{
   color  bg = (color)ChartGetInteger(0, CHART_COLOR_BACKGROUND);
   double t  = MathMax(0.0, MathMin(100.0, (double)opacityPct)) / 100.0;

   int baseR = (int)( base & 0xFF);        int bgR = (int)( bg & 0xFF);
   int baseG = (int)((base >>  8) & 0xFF); int bgG = (int)((bg >>  8) & 0xFF);
   int baseB = (int)((base >> 16) & 0xFF); int bgB = (int)((bg >> 16) & 0xFF);

   int r = (int)(baseR * t + bgR * (1.0 - t));
   int g = (int)(baseG * t + bgG * (1.0 - t));
   int b = (int)(baseB * t + bgB * (1.0 - t));
   return (color)(r | (g << 8) | (b << 16));
}

//+------------------------------------------------------------------+
//| Prevent double-registration of the same zone                     |
//+------------------------------------------------------------------+
bool FVG_IsDuplicate(int dir, double ul, double ll)
{
   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   for(int i = 0; i < fvgTotal; i++)
   {
      if(fvgList[i].dir != dir) continue;
      if(MathAbs(fvgList[i].ul - ul) < 5.0 * point &&
         MathAbs(fvgList[i].ll - ll) < 5.0 * point) return true;
   }
   return false;
}

//+------------------------------------------------------------------+
//| Register a new FVG zone                                          |
//+------------------------------------------------------------------+
void FVG_Add(int dir, datetime c1T, datetime c3T, double ul, double ll)
{
   if(fvgTotal >= FVG_MAX_ZONES)
   {
      if(InpShowLog) Print("FVG_Detector: zone limit reached (", FVG_MAX_ZONES, ")");
      return;
   }
   if(FVG_IsDuplicate(dir, ul, ll)) return;

   int idx              = fvgTotal++;
   fvgList[idx].id          = nextId++;
   fvgList[idx].dir         = dir;
   fvgList[idx].state       = FVG_ACTIVE;
   fvgList[idx].c1Time      = c1T;
   fvgList[idx].c3Time      = c3T;
   fvgList[idx].ul          = ul;
   fvgList[idx].ll          = ll;
   fvgList[idx].invalidTime = 0;

   if(InpShowLog)
      PrintFormat("FVG_CREATED | id=%d | %s | UL=%.5f | LL=%.5f | C1=%s | C3=%s",
                  fvgList[idx].id,
                  dir > 0 ? "BULLISH" : "BEARISH",
                  ul, ll,
                  TimeToString(c1T, TIME_DATE|TIME_MINUTES),
                  TimeToString(c3T, TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
//| Scan one 3-candle triplet for an FVG                             |
//+------------------------------------------------------------------+
void FVG_ScanBar(int c3Shift)
{
   if(c3Shift < 1) return;

   double c1Hi = iHigh(_Symbol, InpTF, c3Shift + 2);
   double c1Lo = iLow (_Symbol, InpTF, c3Shift + 2);
   double c3Hi = iHigh(_Symbol, InpTF, c3Shift);
   double c3Lo = iLow (_Symbol, InpTF, c3Shift);

   if(c1Hi <= 0 || c3Hi <= 0) return;

   datetime c1T = iTime(_Symbol, InpTF, c3Shift + 2);
   datetime c3T = iTime(_Symbol, InpTF, c3Shift);

   // Bullish FVG: gap left below a bullish impulse
   if(c3Lo > c1Hi) FVG_Add(+1, c1T, c3T, c3Lo, c1Hi);
   // Bearish FVG: gap left above a bearish impulse
   if(c3Hi < c1Lo) FVG_Add(-1, c1T, c3T, c1Lo, c3Hi);
}

//+------------------------------------------------------------------+
//| Right-edge time for a zone rectangle                             |
//| ACTIVE / MITIGATED → 5 years from now. INVALID / EXPIRED → frozen.|
//+------------------------------------------------------------------+
datetime FVG_RightEdge(int idx)
{
   if(fvgList[idx].invalidTime > 0)
      return fvgList[idx].invalidTime;
   return (datetime)(TimeCurrent() + (datetime)(5 * 365 * 86400));
}

//+------------------------------------------------------------------+
//| Display colour for a zone based on its current state             |
//+------------------------------------------------------------------+
color FVG_ZoneColor(int idx)
{
   color base  = fvgList[idx].dir > 0 ? InpBullClr : InpBearClr;
   int   state = fvgList[idx].state;

   if(state == FVG_INVALIDATED || state == FVG_EXPIRED)
      return BlendWithBg(base, 8);                // barely visible relic

   if(state == FVG_MITIGATED)
      return BlendWithBg(base, InpMitigatedOpacity);

   return BlendWithBg(base, InpActiveOpacity);    // ACTIVE
}

//+------------------------------------------------------------------+
//| Draw a zone rectangle + label (called once at zone creation)     |
//+------------------------------------------------------------------+
void FVG_DrawZone(int idx)
{
   int state = fvgList[idx].state;

   // Respect visibility preferences
   if(InpRemoveInvalidated && (state == FVG_INVALIDATED || state == FVG_EXPIRED)) return;
   if(!InpShowMitigated && state == FVG_MITIGATED) return;

   color    clr  = FVG_ZoneColor(idx);
   string   pfx  = "SMCFVG_" + IntegerToString(fvgList[idx].id);
   string   rect = pfx + "_zone";
   string   lbl  = pfx + "_lbl";
   datetime t2   = FVG_RightEdge(idx);
   bool     dead = (state == FVG_INVALIDATED || state == FVG_EXPIRED);

   if(ObjectCreate(0, rect, OBJ_RECTANGLE, 0,
                   fvgList[idx].c1Time, fvgList[idx].ul,
                   t2,                  fvgList[idx].ll))
   {
      ObjectSetInteger(0, rect, OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, rect, OBJPROP_STYLE,      dead ? STYLE_DOT : STYLE_SOLID);
      ObjectSetInteger(0, rect, OBJPROP_WIDTH,      1);
      ObjectSetInteger(0, rect, OBJPROP_BACK,       true);
      ObjectSetInteger(0, rect, OBJPROP_FILL,       true);
      ObjectSetInteger(0, rect, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, rect, OBJPROP_HIDDEN,     true);
   }

   string txt = StringFormat("%s FVG #%d  UL:%.5f  LL:%.5f",
                             fvgList[idx].dir > 0 ? "Bull" : "Bear",
                             fvgList[idx].id,
                             fvgList[idx].ul, fvgList[idx].ll);
   if(ObjectCreate(0, lbl, OBJ_TEXT, 0, fvgList[idx].c3Time, fvgList[idx].ul))
   {
      ObjectSetString( 0, lbl, OBJPROP_TEXT,       txt);
      ObjectSetInteger(0, lbl, OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, lbl, OBJPROP_FONTSIZE,   7);
      ObjectSetInteger(0, lbl, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, lbl, OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, lbl, OBJPROP_BACK,       false);
   }
}

//+------------------------------------------------------------------+
//| Push a state change out to the chart objects (live bars only)    |
//+------------------------------------------------------------------+
void FVG_UpdateObjectState(int idx)
{
   string pfx   = "SMCFVG_" + IntegerToString(fvgList[idx].id);
   string rect  = pfx + "_zone";
   string lbl   = pfx + "_lbl";
   int    state = fvgList[idx].state;

   // ── INVALIDATED / EXPIRED ────────────────────────────────────────
   if(state == FVG_INVALIDATED || state == FVG_EXPIRED)
   {
      if(InpRemoveInvalidated)
      {
         ObjectDelete(0, rect);
         ObjectDelete(0, lbl);
      }
      else
      {
         // Freeze right edge at the invalidating bar; heavy fade + dotted border
         color faded = FVG_ZoneColor(idx);
         ObjectSetInteger(0, rect, OBJPROP_TIME,  1, (long)fvgList[idx].invalidTime);
         ObjectSetInteger(0, rect, OBJPROP_COLOR,    faded);
         ObjectSetInteger(0, rect, OBJPROP_STYLE,    STYLE_DOT);
         ObjectSetInteger(0, lbl,  OBJPROP_COLOR,    faded);
      }
      return;
   }

   // ── MITIGATED ─────────────────────────────────────────────────────
   if(state == FVG_MITIGATED)
   {
      if(!InpShowMitigated)
      {
         ObjectDelete(0, rect);
         ObjectDelete(0, lbl);
      }
      else
      {
         color faded = FVG_ZoneColor(idx);
         ObjectSetInteger(0, rect, OBJPROP_COLOR, faded);
         ObjectSetInteger(0, lbl,  OBJPROP_COLOR, faded);
      }
   }
}

//+------------------------------------------------------------------+
//| Check whether price entered the zone (ACTIVE → MITIGATED).       |
//| Updates fvgList[idx].state if condition is met.                  |
//| Returns true on state change.                                    |
//+------------------------------------------------------------------+
bool FVG_CheckMitigation(int idx, double barHigh, double barLow)
{
   if(fvgList[idx].state != FVG_ACTIVE) return false;

   double ul  = fvgList[idx].ul;
   double ll  = fvgList[idx].ll;
   double mid = (ul + ll) * 0.5;
   bool   hit = false;

   if(fvgList[idx].dir == +1) // Bullish: price retraces DOWN into the gap
   {
      // Edge mode: low enters the gap from above (barLow <= UL)
      // Mid mode:  low reaches the midpoint
      double threshold = (InpMitigationMode == MIT_TOUCH_EDGE) ? ul : mid;
      hit = (barLow <= threshold);
   }
   else // Bearish: price retraces UP into the gap
   {
      // Edge mode: high enters the gap from below (barHigh >= LL)
      // Mid mode:  high reaches the midpoint
      double threshold = (InpMitigationMode == MIT_TOUCH_EDGE) ? ll : mid;
      hit = (barHigh >= threshold);
   }

   if(hit) fvgList[idx].state = FVG_MITIGATED;
   return hit;
}

//+------------------------------------------------------------------+
//| Check whether price closed / wicked through the zone.            |
//| Valid for both ACTIVE and MITIGATED zones.                       |
//| Updates state and freezes invalidTime if condition is met.       |
//| Returns true on state change.                                    |
//+------------------------------------------------------------------+
bool FVG_CheckInvalidation(int idx, double barHigh, double barLow, double barClose, datetime freezeAt)
{
   int s = fvgList[idx].state;
   if(s == FVG_INVALIDATED || s == FVG_EXPIRED) return false;

   bool hit = false;
   if(fvgList[idx].dir == +1) // Bullish FVG: invalidated when price closes / wicks below LL
   {
      hit = (InpInvalidationMode == INV_CANDLE_CLOSE) ? (barClose < fvgList[idx].ll)
                                                       : (barLow   < fvgList[idx].ll);
   }
   else // Bearish FVG: invalidated when price closes / wicks above UL
   {
      hit = (InpInvalidationMode == INV_CANDLE_CLOSE) ? (barClose > fvgList[idx].ul)
                                                       : (barHigh  > fvgList[idx].ul);
   }

   if(hit)
   {
      fvgList[idx].state       = FVG_INVALIDATED;
      fvgList[idx].invalidTime = freezeAt;
   }
   return hit;
}

//+------------------------------------------------------------------+
//| Update all live zones on each new bar.                           |
//| Processing order: expiry → mitigation → invalidation → objects   |
//+------------------------------------------------------------------+
void FVG_UpdateStates()
{
   double   hi       = iHigh (_Symbol, InpTF, 1);
   double   lo       = iLow  (_Symbol, InpTF, 1);
   double   cl       = iClose(_Symbol, InpTF, 1);
   datetime barTime  = iTime (_Symbol, InpTF, 1);
   datetime freezeAt = iTime (_Symbol, InpTF, 0); // open of new bar = end of bar 1

   for(int i = 0; i < fvgTotal; i++)
   {
      int s = fvgList[i].state;
      if(s == FVG_INVALIDATED || s == FVG_EXPIRED) continue;

      // ── Step 1: Expiry ──────────────────────────────────────────
      if(InpExpiryBars > 0)
      {
         int age = iBarShift(_Symbol, InpTF, fvgList[i].c3Time, false);
         if(age >= InpExpiryBars)
         {
            fvgList[i].state       = FVG_EXPIRED;
            fvgList[i].invalidTime = freezeAt;
            FVG_UpdateObjectState(i);
            if(InpShowLog)
               PrintFormat("FVG_EXPIRED | id=%d | %s | UL=%.5f | LL=%.5f | age=%d bars",
                           fvgList[i].id,
                           fvgList[i].dir > 0 ? "BULLISH" : "BEARISH",
                           fvgList[i].ul, fvgList[i].ll, age);
            continue;
         }
      }

      // ── Step 2: Mitigation (ACTIVE → MITIGATED) ─────────────────
      bool wasMitigated = FVG_CheckMitigation(i, hi, lo);
      if(wasMitigated)
      {
         FVG_UpdateObjectState(i);
         if(InpShowLog)
            PrintFormat("FVG_MITIGATED | id=%d | %s | UL=%.5f | LL=%.5f | bar=%s",
                        fvgList[i].id,
                        fvgList[i].dir > 0 ? "BULLISH" : "BEARISH",
                        fvgList[i].ul, fvgList[i].ll,
                        TimeToString(barTime, TIME_DATE|TIME_MINUTES));
      }

      // ── Step 3: Invalidation (ACTIVE | MITIGATED → INVALIDATED) ─
      // Runs even on a bar where mitigation also fired (same-bar break-through)
      bool wasInvalidated = FVG_CheckInvalidation(i, hi, lo, cl, freezeAt);
      if(wasInvalidated)
      {
         FVG_UpdateObjectState(i);
         if(InpShowLog)
            PrintFormat("FVG_INVALIDATED | id=%d | %s | UL=%.5f | LL=%.5f | bar=%s",
                        fvgList[i].id,
                        fvgList[i].dir > 0 ? "BULLISH" : "BEARISH",
                        fvgList[i].ul, fvgList[i].ll,
                        TimeToString(barTime, TIME_DATE|TIME_MINUTES));
      }
   }
}

//+------------------------------------------------------------------+
//| Draw all zones registered since the last draw call               |
//+------------------------------------------------------------------+
void FVG_DrawNew()
{
   for(int i = fvgDrawn; i < fvgTotal; i++)
      FVG_DrawZone(i);
   fvgDrawn = fvgTotal;
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
//| Remove every chart object created by this indicator              |
//+------------------------------------------------------------------+
void FVG_DeleteAll()
{
   for(int i = ObjectsTotal(0) - 1; i >= 0; i--)
   {
      string nm = ObjectName(0, i);
      if(StringFind(nm, "SMCFVG_") == 0) ObjectDelete(0, nm);
   }
}

//+------------------------------------------------------------------+
//| OnInit: detect → historical lifecycle replay → draw              |
//+------------------------------------------------------------------+
int OnInit()
{
   int available = iBars(_Symbol, InpTF);
   if(available < 4)
   {
      Print("FVG Detector: not enough bars available. Load more history.");
      return INIT_FAILED;
   }

   int limit = MathMin(InpLookback, available - 3);

   // ── Step 1: Detect all FVGs (oldest → newest) ────────────────────
   for(int sh = limit; sh >= 1; sh--)
      FVG_ScanBar(sh);

   // ── Step 2: Historical lifecycle replay ──────────────────────────
   // Re-run the same expiry → mitigation → invalidation logic on every
   // historical bar so zones start with the correct state on attach.
   for(int sh = limit; sh >= 1; sh--)
   {
      double   hi       = iHigh (_Symbol, InpTF, sh);
      double   lo       = iLow  (_Symbol, InpTF, sh);
      double   cl       = iClose(_Symbol, InpTF, sh);
      datetime barTime  = iTime (_Symbol, InpTF, sh);
      datetime freezeAt = iTime (_Symbol, InpTF, sh - 1);

      for(int i = 0; i < fvgTotal; i++)
      {
         if(barTime <= fvgList[i].c3Time) continue; // zone didn't exist yet

         int s = fvgList[i].state;
         if(s == FVG_INVALIDATED || s == FVG_EXPIRED) continue;

         // Expiry
         if(InpExpiryBars > 0)
         {
            int age = (int)((barTime - fvgList[i].c3Time) / PeriodSeconds(InpTF));
            if(age >= InpExpiryBars)
            {
               fvgList[i].state       = FVG_EXPIRED;
               fvgList[i].invalidTime = fvgList[i].c3Time
                                        + (datetime)(InpExpiryBars * PeriodSeconds(InpTF));
               continue;
            }
         }

         // Mitigation (ACTIVE → MITIGATED)
         FVG_CheckMitigation(i, hi, lo);

         // Invalidation (ACTIVE | MITIGATED → INVALIDATED)
         FVG_CheckInvalidation(i, hi, lo, cl, freezeAt);
      }
   }

   // ── Step 3: Draw all zones with state-correct visuals ────────────
   FVG_DrawNew();

   // ── Step 4: Summary ───────────────────────────────────────────────
   int cA=0, cM=0, cI=0, cE=0;
   for(int i = 0; i < fvgTotal; i++)
   {
      switch(fvgList[i].state)
      {
         case FVG_ACTIVE:      cA++; break;
         case FVG_MITIGATED:   cM++; break;
         case FVG_INVALIDATED: cI++; break;
         default:              cE++; break;
      }
   }
   PrintFormat("FVG Detector v3 | total=%d  active=%d  mitigated=%d  invalidated=%d  expired=%d | %s %s",
               fvgTotal, cA, cM, cI, cE, _Symbol, EnumToString(InpTF));
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| OnDeinit: remove all indicator chart objects                     |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   FVG_DeleteAll();
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
//| OnCalculate: bar-open event handler                              |
//| Order: states (expiry→mitig→invalid) → draw existing → detect new|
//+------------------------------------------------------------------+
int OnCalculate(const int rates_total, const int prev_calculated,
                const datetime &time[], const double &open[],
                const double &high[], const double &low[],
                const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
{
   datetime currentBar = iTime(_Symbol, InpTF, 0);
   if(currentBar == lastBarTime) return rates_total;
   lastBarTime = currentBar;

   // 1. Expiry → mitigation → invalidation for all existing zones
   FVG_UpdateStates();

   // 2. Detect new FVGs from the just-closed bar (C3 = shift 1)
   FVG_ScanBar(1);

   // 3. Draw any newly created zones
   FVG_DrawNew();

   return rates_total;
}
`;
}
