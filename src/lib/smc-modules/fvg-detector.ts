/**
 * SMC Module Library — Phase 1: Detection + Lifecycle Management
 *
 * FVG (Fair Value Gap) Detector v2
 * ─────────────────────────────────
 * Generates a standalone MQL5 indicator that:
 *   1. Scans historical and live candles for Fair Value Gaps
 *   2. Draws every detected zone on the chart
 *   3. Manages zone lifecycle: ACTIVE → MITIGATED → INVALIDATED / EXPIRED
 *   4. Updates zone visuals based on state (fade, remove, freeze right edge)
 *
 * Detection rules (closed candles only):
 *   Bullish FVG  →  C3.Low  > C1.High    UL = C3.Low,  LL = C1.High
 *   Bearish FVG  →  C3.High < C1.Low     UL = C1.Low,  LL = C3.High
 *
 * MQL5 bar indexing (newest closed bar = shift 1):
 *   C3 = shift 1  (newest closed candle in the triplet)
 *   C2 = shift 2  (middle candle — not used in detection)
 *   C1 = shift 3  (oldest closed candle in the triplet)
 *
 * Lifecycle rules:
 *   ACTIVE      → zone untouched by price
 *   MITIGATED   → price entered the zone (Bullish: high ≥ UL | Bearish: low ≤ LL)
 *   INVALIDATED → price closed through the zone (Bullish: close < LL | Bearish: close > UL)
 *   EXPIRED     → zone has exceeded InpExpiryBars bars (0 = never)
 *
 * Rendering by state:
 *   ACTIVE      → full colour, solid border
 *   MITIGATED   → faded colour (when InpFadeMitigated = true)
 *   INVALIDATED → removed (when InpRemoveInvalidated = true)
 *                 OR frozen right edge + heavily faded + dotted border
 *   EXPIRED     → same treatment as INVALIDATED
 *
 * Journal events:
 *   FVG_CREATED    | id | dir | C1 | C3 | UL | LL
 *   FVG_MITIGATED  | id | dir | bar | price
 *   FVG_INVALIDATED| id | dir | bar | close
 *   FVG_EXPIRED    | id | dir | age_bars
 *
 * NO trading logic. Detection and visualisation only.
 */

export const FVG_DETECTOR_VERSION = "2.0.0";
export const FVG_DETECTOR_MODULE  = "FVG_Detector";

/**
 * Returns the complete MQL5 source code for the FVG Detector indicator (v2).
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
//| LIFECYCLE:                                                       |
//|   ACTIVE      → zone untouched (full colour)                    |
//|   MITIGATED   → price entered zone (faded)                      |
//|   INVALIDATED → price closed through zone (removed or frozen)   |
//|   EXPIRED     → zone exceeded expiry bar limit                  |
//|                                                                  |
//| INVALIDATION:                                                    |
//|   Bullish FVG → candle closes below LL                          |
//|   Bearish FVG → candle closes above UL                          |
//|                                                                  |
//| MITIGATION:                                                      |
//|   Bullish FVG → candle high  >= UL (price entered from below)   |
//|   Bearish FVG → candle low   <= LL (price entered from above)   |
//|                                                                  |
//| JOURNAL OUTPUT:                                                  |
//|   FVG_CREATED    | id | dir | C1 | C3 | UL | LL                 |
//|   FVG_MITIGATED  | id | dir | bar | price                       |
//|   FVG_INVALIDATED| id | dir | bar | close                       |
//|   FVG_EXPIRED    | id | dir | age_bars                          |
//|                                                                  |
//| NO trading logic. Detection and visualisation only.             |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SMC Module Library"
#property version   "2.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

//--- Zone states
#define FVG_ACTIVE      0
#define FVG_MITIGATED   1
#define FVG_INVALIDATED 2
#define FVG_EXPIRED     3

//--- Inputs — Detection
input ENUM_TIMEFRAMES InpTF       = PERIOD_CURRENT; // Timeframe to scan
input int             InpLookback = 500;             // Historical bars to scan on load
input color           InpBullClr  = clrDodgerBlue;  // Bullish FVG colour
input color           InpBearClr  = clrOrangeRed;   // Bearish FVG colour
input bool            InpShowLog  = true;            // Print events to journal

//--- Inputs — Lifecycle
input bool InpRemoveInvalidated = true;  // Remove zone when invalidated / expired
input bool InpFadeMitigated     = true;  // Fade zone colour when mitigated
input int  InpExpiryBars        = 0;     // Expire zone after N bars since C3 (0 = never)

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
   datetime invalidTime;  // bar-open time when zone became invalid/expired (0 = still live)
};

FVGRecord fvgList[FVG_MAX_ZONES];
int       fvgTotal    = 0;
int       fvgDrawn    = 0;
int       nextId      = 0;
datetime  lastBarTime = 0;

//+------------------------------------------------------------------+
//| Blend a colour toward neutral grey                               |
//| strength 1.0 = full original colour, 0.0 = full grey            |
//| MQL5 color layout: 0x00BBGGRR (R=byte0 G=byte1 B=byte2)        |
//+------------------------------------------------------------------+
color FadeColor(color base, double strength)
{
   int r    = (int)( base        & 0xFF);
   int g    = (int)((base >>  8) & 0xFF);
   int b    = (int)((base >> 16) & 0xFF);
   int grey = 140;
   r = (int)(r * strength + grey * (1.0 - strength));
   g = (int)(g * strength + grey * (1.0 - strength));
   b = (int)(b * strength + grey * (1.0 - strength));
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
      PrintFormat("FVG_CREATED | id=%d | dir=%s | C1=%s | C3=%s | UL=%.5f | LL=%.5f",
                  fvgList[idx].id,
                  dir > 0 ? "BULLISH" : "BEARISH",
                  TimeToString(c1T, TIME_DATE|TIME_MINUTES),
                  TimeToString(c3T, TIME_DATE|TIME_MINUTES),
                  ul, ll);
}

//+------------------------------------------------------------------+
//| Scan one 3-candle triplet for an FVG                             |
//+------------------------------------------------------------------+
void FVG_ScanBar(int c3Shift)
{
   if(c3Shift < 1) return; // C3 must be a closed bar

   double c1Hi = iHigh(_Symbol, InpTF, c3Shift + 2);
   double c1Lo = iLow (_Symbol, InpTF, c3Shift + 2);
   double c3Hi = iHigh(_Symbol, InpTF, c3Shift);
   double c3Lo = iLow (_Symbol, InpTF, c3Shift);

   if(c1Hi <= 0 || c3Hi <= 0) return; // data not loaded yet

   datetime c1T = iTime(_Symbol, InpTF, c3Shift + 2);
   datetime c3T = iTime(_Symbol, InpTF, c3Shift);

   // Bullish FVG: gap below the move  (UL = C3.Low, LL = C1.High)
   if(c3Lo > c1Hi) FVG_Add(+1, c1T, c3T, c3Lo, c1Hi);
   // Bearish FVG: gap above the move  (UL = C1.Low, LL = C3.High)
   if(c3Hi < c1Lo) FVG_Add(-1, c1T, c3T, c1Lo, c3Hi);
}

//+------------------------------------------------------------------+
//| Compute the rectangle right-edge time for a zone                 |
//| ACTIVE/MITIGATED → far future. INVALIDATED/EXPIRED → frozen.    |
//+------------------------------------------------------------------+
datetime FVG_RightEdge(int idx)
{
   if(fvgList[idx].invalidTime > 0)
      return fvgList[idx].invalidTime;
   // Extend 5 years from current time for live zones
   return (datetime)(TimeCurrent() + (datetime)(5 * 365 * 86400));
}

//+------------------------------------------------------------------+
//| Compute the display colour for a zone based on its current state |
//+------------------------------------------------------------------+
color FVG_ZoneColor(int idx)
{
   color base  = fvgList[idx].dir > 0 ? InpBullClr : InpBearClr;
   int   state = fvgList[idx].state;

   if(state == FVG_INVALIDATED || state == FVG_EXPIRED)
      return FadeColor(base, 0.12); // heavily faded — barely visible

   if(state == FVG_MITIGATED && InpFadeMitigated)
      return FadeColor(base, 0.30); // moderately faded

   return base; // ACTIVE — full colour
}

//+------------------------------------------------------------------+
//| Draw a zone rectangle and label (called once at creation time)   |
//+------------------------------------------------------------------+
void FVG_DrawZone(int idx)
{
   int state = fvgList[idx].state;

   // Skip terminated zones when auto-removal is enabled
   if(InpRemoveInvalidated && (state == FVG_INVALIDATED || state == FVG_EXPIRED))
      return;

   color    clr  = FVG_ZoneColor(idx);
   string   pfx  = "SMCFVG_" + IntegerToString(fvgList[idx].id);
   string   rect = pfx + "_zone";
   string   lbl  = pfx + "_lbl";
   datetime t2   = FVG_RightEdge(idx);
   bool     dead = (state == FVG_INVALIDATED || state == FVG_EXPIRED);

   // Zone rectangle
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

   // ID label at C3 bar, at UL price
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
//| Update existing chart objects after a live state transition      |
//| Called only from FVG_UpdateStates (objects are guaranteed drawn).|
//+------------------------------------------------------------------+
void FVG_UpdateObjectState(int idx)
{
   string pfx   = "SMCFVG_" + IntegerToString(fvgList[idx].id);
   string rect  = pfx + "_zone";
   string lbl   = pfx + "_lbl";
   int    state = fvgList[idx].state;

   if(state == FVG_INVALIDATED || state == FVG_EXPIRED)
   {
      if(InpRemoveInvalidated)
      {
         ObjectDelete(0, rect);
         ObjectDelete(0, lbl);
      }
      else
      {
         // Freeze the right edge at the invalidating bar and heavily fade
         color faded = FVG_ZoneColor(idx);
         ObjectSetInteger(0, rect, OBJPROP_TIME,  1, (long)fvgList[idx].invalidTime);
         ObjectSetInteger(0, rect, OBJPROP_COLOR,    faded);
         ObjectSetInteger(0, rect, OBJPROP_STYLE,    STYLE_DOT);
         ObjectSetInteger(0, lbl,  OBJPROP_COLOR,    faded);
      }
      return;
   }

   if(state == FVG_MITIGATED && InpFadeMitigated)
   {
      color faded = FVG_ZoneColor(idx);
      ObjectSetInteger(0, rect, OBJPROP_COLOR, faded);
      ObjectSetInteger(0, lbl,  OBJPROP_COLOR, faded);
   }
}

//+------------------------------------------------------------------+
//| Check a single bar against a single zone for a state transition. |
//| freezeAt: datetime used as the right-edge freeze on invalidation.|
//| Returns true when the zone's state changed.                      |
//+------------------------------------------------------------------+
bool FVG_CheckBar(int idx, double barHigh, double barLow, double barClose, datetime freezeAt)
{
   int s = fvgList[idx].state;
   if(s == FVG_INVALIDATED || s == FVG_EXPIRED) return false;

   if(fvgList[idx].dir == +1) // Bullish FVG
   {
      // Invalidated: candle closes below the lower limit
      if(barClose < fvgList[idx].ll)
      {
         fvgList[idx].state       = FVG_INVALIDATED;
         fvgList[idx].invalidTime = freezeAt;
         return true;
      }
      // Mitigated: candle high reached or exceeded the upper limit
      if(s == FVG_ACTIVE && barHigh >= fvgList[idx].ul)
      {
         fvgList[idx].state = FVG_MITIGATED;
         return true;
      }
   }
   else // Bearish FVG
   {
      // Invalidated: candle closes above the upper limit
      if(barClose > fvgList[idx].ul)
      {
         fvgList[idx].state       = FVG_INVALIDATED;
         fvgList[idx].invalidTime = freezeAt;
         return true;
      }
      // Mitigated: candle low reached or went below the lower limit
      if(s == FVG_ACTIVE && barLow <= fvgList[idx].ll)
      {
         fvgList[idx].state = FVG_MITIGATED;
         return true;
      }
   }
   return false;
}

//+------------------------------------------------------------------+
//| Update all zone states on each new bar (live operation only).    |
//| Evaluates the just-closed bar (shift 1) against every live zone. |
//+------------------------------------------------------------------+
void FVG_UpdateStates()
{
   double   hi       = iHigh (_Symbol, InpTF, 1);
   double   lo       = iLow  (_Symbol, InpTF, 1);
   double   cl       = iClose(_Symbol, InpTF, 1);
   datetime barTime  = iTime (_Symbol, InpTF, 1);
   // Freeze boundary = open of the current bar = close of bar 1
   datetime freezeAt = iTime (_Symbol, InpTF, 0);

   for(int i = 0; i < fvgTotal; i++)
   {
      int s = fvgList[i].state;
      if(s == FVG_INVALIDATED || s == FVG_EXPIRED) continue;

      // Expiry: how many bars have passed since the zone's C3 bar?
      if(InpExpiryBars > 0)
      {
         int age = iBarShift(_Symbol, InpTF, fvgList[i].c3Time, false);
         if(age >= InpExpiryBars)
         {
            fvgList[i].state       = FVG_EXPIRED;
            fvgList[i].invalidTime = freezeAt;
            FVG_UpdateObjectState(i);
            if(InpShowLog)
               PrintFormat("FVG_EXPIRED | id=%d | %s | age=%d bars",
                           fvgList[i].id,
                           fvgList[i].dir > 0 ? "BULLISH" : "BEARISH", age);
            continue;
         }
      }

      bool changed = FVG_CheckBar(i, hi, lo, cl, freezeAt);
      if(!changed) continue;

      FVG_UpdateObjectState(i);

      if(InpShowLog)
      {
         if(fvgList[i].state == FVG_INVALIDATED)
            PrintFormat("FVG_INVALIDATED | id=%d | %s | bar=%s | close=%.5f",
                        fvgList[i].id,
                        fvgList[i].dir > 0 ? "BULLISH" : "BEARISH",
                        TimeToString(barTime, TIME_DATE|TIME_MINUTES), cl);
         else if(fvgList[i].state == FVG_MITIGATED)
            PrintFormat("FVG_MITIGATED | id=%d | %s | bar=%s | price=%.5f",
                        fvgList[i].id,
                        fvgList[i].dir > 0 ? "BULLISH" : "BEARISH",
                        TimeToString(barTime, TIME_DATE|TIME_MINUTES),
                        fvgList[i].dir > 0 ? hi : lo);
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

   // ── Step 1: Detect all FVGs in the lookback window ───────────────
   // Oldest → newest so zone IDs are in chronological order.
   for(int sh = limit; sh >= 1; sh--)
      FVG_ScanBar(sh);

   // ── Step 2: Historical lifecycle replay ───────────────────────────
   // For each bar in the window, check all zones that were created
   // before that bar and update their state accordingly.
   // This ensures zones that were already invalidated/mitigated in
   // history start with the correct state before the first draw.
   for(int sh = limit; sh >= 1; sh--)
   {
      double   hi       = iHigh (_Symbol, InpTF, sh);
      double   lo       = iLow  (_Symbol, InpTF, sh);
      double   cl       = iClose(_Symbol, InpTF, sh);
      datetime barTime  = iTime (_Symbol, InpTF, sh);
      // freeze boundary = open of the immediately following bar
      datetime freezeAt = iTime (_Symbol, InpTF, sh - 1);

      for(int i = 0; i < fvgTotal; i++)
      {
         // Skip: bar is not newer than zone's C3 (zone didn't exist yet)
         if(barTime <= fvgList[i].c3Time) continue;
         FVG_CheckBar(i, hi, lo, cl, freezeAt);
      }
   }

   // ── Step 3: Expiry pass on all still-live zones ───────────────────
   if(InpExpiryBars > 0)
   {
      for(int i = 0; i < fvgTotal; i++)
      {
         int s = fvgList[i].state;
         if(s == FVG_INVALIDATED || s == FVG_EXPIRED) continue;
         int age = iBarShift(_Symbol, InpTF, fvgList[i].c3Time, false);
         if(age >= InpExpiryBars)
         {
            fvgList[i].state       = FVG_EXPIRED;
            fvgList[i].invalidTime = fvgList[i].c3Time
                                     + (datetime)(InpExpiryBars * PeriodSeconds(InpTF));
         }
      }
   }

   // ── Step 4: Draw all zones with correct state-aware visuals ──────
   FVG_DrawNew();

   // ── Step 5: Log summary ───────────────────────────────────────────
   int cntActive=0, cntMitigated=0, cntInvalid=0, cntExpired=0;
   for(int i = 0; i < fvgTotal; i++)
   {
      switch(fvgList[i].state)
      {
         case FVG_ACTIVE:      cntActive++;    break;
         case FVG_MITIGATED:   cntMitigated++; break;
         case FVG_INVALIDATED: cntInvalid++;   break;
         default:              cntExpired++;   break;
      }
   }
   PrintFormat("FVG Detector v2 ready | total=%d  active=%d  mitigated=%d  invalidated=%d  expired=%d | %s %s",
               fvgTotal, cntActive, cntMitigated, cntInvalid, cntExpired,
               _Symbol, EnumToString(InpTF));
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
//| OnCalculate: lifecycle → detect new → draw  (bar-open pattern)  |
//+------------------------------------------------------------------+
int OnCalculate(const int rates_total, const int prev_calculated,
                const datetime &time[], const double &open[],
                const double &high[], const double &low[],
                const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
{
   // Run only on the first tick of each new bar
   datetime currentBar = iTime(_Symbol, InpTF, 0);
   if(currentBar == lastBarTime) return rates_total;
   lastBarTime = currentBar;

   // 1. Update existing zone states from the just-closed bar (shift 1)
   FVG_UpdateStates();

   // 2. Scan the just-closed bar for new FVGs
   FVG_ScanBar(1);

   // 3. Draw any newly detected zones
   FVG_DrawNew();

   return rates_total;
}
`;
}
