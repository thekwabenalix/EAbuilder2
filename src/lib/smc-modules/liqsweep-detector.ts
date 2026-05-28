/**
 * SMC Module Library — Phase 1: Liquidity Sweep Detector
 *
 * Liquidity Sweep Detector v1.0.0
 * ────────────────────────────────
 * A liquidity sweep occurs when price breaks through a confirmed swing
 * high or swing low (taking the stop-loss orders resting there) and
 * then closes back inside the previous range.
 *
 *   Bullish Sweep: price wicks BELOW a swing low, then closes ABOVE it.
 *   Bearish Sweep: price wicks ABOVE a swing high, then closes BELOW it.
 *
 * SWING DETECTION:
 *   Swing High: candle high > all N candles left AND all N candles right.
 *   Swing Low:  candle low  < all N candles left AND all N candles right.
 *   Default N = InpSwingStr = 3.  A swing is confirmed when N right-side
 *   bars have closed, so there is a built-in N-bar lag.
 *
 * SWEEP LIFECYCLE:
 *   SWING_AVAILABLE → (wick breaks level)           → SWEEP created [PENDING]
 *   SWEEP_PENDING   → (close-back on same/later bar) → SWEEP_CONFIRMED
 *   SWEEP_PENDING   → (no close-back in N bars)       → SWEEP_EXPIRED
 *
 *   On EXPIRED: the originating swing is reset to AVAILABLE so the same
 *   level can generate a new sweep on a future bar.
 *   On CONFIRMED: swing is permanently retired (level consumed).
 *
 *   InpMaxWaitBars (default 5) drives PENDING → EXPIRED.
 *   InpExpiryBars  (default 100) retires swings that are too old to be
 *   relevant — only swings within the last N bars are watched.
 *
 * JOURNAL:
 *   LIQUIDITY_SWEEP_CREATED   | id | dir | level | wick | bar
 *   LIQUIDITY_SWEEP_CONFIRMED | id | dir | level | bar
 *   LIQUIDITY_SWEEP_EXPIRED   | id | dir | level | sweep_bar
 *
 * DRAWN ELEMENTS (CONFIRMED sweeps only):
 *   • Dashed horizontal line from swing candle to confirmation candle
 *   • Arrow (↑ bullish / ↓ bearish) at the wick tip of the sweep candle
 *   • Label: "Bull Sweep #N  Lvl:price" near the confirmation bar
 *
 * NO trading logic. Detection and visualisation only.
 */

export const LIQSWEEP_DETECTOR_VERSION = "1.0.0";
export const LIQSWEEP_DETECTOR_MODULE  = "LiqSweep_Detector";

/**
 * Returns the complete MQL5 source code for the Liquidity Sweep Detector (v1.0).
 * Drop the output into MetaEditor, compile, and attach to any chart.
 */
export function generateLiqSweepDetector(): string {
  return `//+------------------------------------------------------------------+
//| LiqSweep_Detector.mq5                                           |
//| SMC Module Library v${LIQSWEEP_DETECTOR_VERSION} — Phase 1: Detection Only       |
//|                                                                  |
//| Detects Liquidity Sweeps.                                        |
//|                                                                  |
//| A sweep occurs when price wicks through a confirmed swing        |
//| high or low, then closes back inside the range.                 |
//|                                                                  |
//| SWING DETECTION:                                                 |
//|   Swing High: hi > N left bars AND N right bars                  |
//|   Swing Low:  lo < N left bars AND N right bars  (N=InpSwingStr)|
//|                                                                  |
//| BULLISH SWEEP (wick below swing low, close above):              |
//|   1. Swing low confirmed.                                        |
//|   2. Bar's low < swing low (wick break).                        |
//|   3. Same or later bar closes > swing low  → CONFIRMED          |
//|   4. No close-back within InpMaxWaitBars   → EXPIRED            |
//|                                                                  |
//| BEARISH SWEEP (wick above swing high, close below):             |
//|   Same logic, inverted.                                          |
//|                                                                  |
//| JOURNAL:                                                         |
//|   LIQUIDITY_SWEEP_CREATED   | id | dir | level | wick | bar     |
//|   LIQUIDITY_SWEEP_CONFIRMED | id | dir | level | bar            |
//|   LIQUIDITY_SWEEP_EXPIRED   | id | dir | level | sweep_bar      |
//|                                                                  |
//| NO trading logic. Detection and visualisation only.             |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SMC Module Library"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

//--- Swing tracking states
#define SWING_AVAILABLE 0   // active, can trigger a sweep
#define SWING_PENDING   1   // a PENDING sweep exists for this swing
#define SWING_RETIRED   2   // confirmed-swept or aged-out; no more sweeps

//--- Sweep lifecycle states
#define SWEEP_PENDING   0   // wick broke the level; awaiting close-back
#define SWEEP_CONFIRMED 1   // close-back confirmed
#define SWEEP_EXPIRED   2   // no close-back within InpMaxWaitBars

//--- Inputs — Detection
input ENUM_TIMEFRAMES InpTF          = PERIOD_CURRENT; // Timeframe to scan
input int             InpLookback    = 500;             // Historical bars to scan on load
input int             InpSwingStr    = 3;               // Swing strength: N candles each side
input int             InpMaxWaitBars = 5;               // Max bars to wait for close-back (0 = unlimited)
input int             InpExpiryBars  = 100;             // Retire swings older than N bars  (0 = never)

//--- Inputs — Colours
input color InpBullClr = clrDeepSkyBlue; // Bullish sweep colour
input color InpBearClr = clrOrangeRed;   // Bearish sweep colour
input int   InpOpacity = 80;             // Sweep marker opacity 0-100

//--- Inputs — Visibility
input bool InpShowBull = true; // Show bullish sweeps
input bool InpShowBear = true; // Show bearish sweeps

//--- Inputs — Logging
input bool InpShowLog = true; // Print lifecycle events to journal

#define SWING_MAX 400
#define SWEEP_MAX 400

//--- Swing record: a confirmed price extreme awaiting a sweep
struct SwingRecord
{
   int      id;
   int      dir;       // +1 = swing high, -1 = swing low
   datetime swingTime; // opening time of the swing candle
   double   level;     // the swing high or swing low price
   int      state;     // SWING_AVAILABLE / SWING_PENDING / SWING_RETIRED
};

//--- Sweep record: one wick-break + close-back event
struct SweepRecord
{
   int      id;
   int      swingId;     // id of the swept swing
   int      dir;         // +1 bullish (low swept), -1 bearish (high swept)
   int      state;       // SWEEP_PENDING / SWEEP_CONFIRMED / SWEEP_EXPIRED
   datetime swingTime;   // time of the swing candle (left edge of the level line)
   double   swingLevel;  // the swept price level
   datetime sweepTime;   // bar whose wick broke the level
   double   wickTip;     // extreme of the sweep wick (low for bull, high for bear)
   datetime confirmTime; // bar of the close-back (0 = not yet confirmed)
   bool     drawn;       // has this sweep been rendered to the chart?
};

SwingRecord swingList[SWING_MAX];
SweepRecord sweepList[SWEEP_MAX];
int      swingTotal  = 0;
int      sweepTotal  = 0;
int      nextSwingId = 0;
int      nextSweepId = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
//| Blend colour toward chart background (theme-aware opacity).      |
//| opacityPct 100 = full colour, 0 = invisible.                    |
//| MQL5 color layout: 0x00BBGGRR (R=byte0 G=byte1 B=byte2)        |
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
//| Sweep marker colour                                               |
//+------------------------------------------------------------------+
color SWEEP_Color(int idx)
{
   return BlendWithBg(sweepList[idx].dir > 0 ? InpBullClr : InpBearClr, InpOpacity);
}

//+------------------------------------------------------------------+
//| Scan bar sh as a candidate swing high / swing low.              |
//|                                                                  |
//| A swing HIGH at shift sh requires:                              |
//|   iHigh(sh) > iHigh(sh+k) for k = 1..N  (left  / older)        |
//|   iHigh(sh) > iHigh(sh-k) for k = 1..N  (right / newer)        |
//| Symmetric rule for swing LOW.                                    |
//|                                                                  |
//| A new swing at sh=N+1 is confirmable each time bar 1 closes.   |
//+------------------------------------------------------------------+
void SWING_ScanBar(int sh)
{
   int available = iBars(_Symbol, InpTF);
   if(sh <= InpSwingStr || sh + InpSwingStr >= available) return;

   double hi = iHigh(_Symbol, InpTF, sh);
   double lo = iLow (_Symbol, InpTF, sh);

   bool isHigh = true, isLow = true;
   for(int k = 1; k <= InpSwingStr && (isHigh || isLow); k++)
   {
      if(iHigh(_Symbol, InpTF, sh + k) >= hi) isHigh = false;
      if(iHigh(_Symbol, InpTF, sh - k) >= hi) isHigh = false;
      if(iLow (_Symbol, InpTF, sh + k) <= lo) isLow  = false;
      if(iLow (_Symbol, InpTF, sh - k) <= lo) isLow  = false;
   }

   if(isHigh && swingTotal < SWING_MAX)
   {
      swingList[swingTotal].id        = nextSwingId++;
      swingList[swingTotal].dir       = +1;
      swingList[swingTotal].swingTime = iTime(_Symbol, InpTF, sh);
      swingList[swingTotal].level     = hi;
      swingList[swingTotal].state     = SWING_AVAILABLE;
      swingTotal++;
   }
   if(isLow && swingTotal < SWING_MAX)
   {
      swingList[swingTotal].id        = nextSwingId++;
      swingList[swingTotal].dir       = -1;
      swingList[swingTotal].swingTime = iTime(_Symbol, InpTF, sh);
      swingList[swingTotal].level     = lo;
      swingList[swingTotal].state     = SWING_AVAILABLE;
      swingTotal++;
   }
}

//+------------------------------------------------------------------+
//| Retire swings that are too old to generate relevant sweeps.      |
//| Uses time-division in historical replay, iBarShift in live mode. |
//+------------------------------------------------------------------+
void SWING_RetireOld(datetime barTime, bool historical)
{
   if(InpExpiryBars <= 0) return;
   for(int i = 0; i < swingTotal; i++)
   {
      if(swingList[i].state != SWING_AVAILABLE) continue;
      int age = historical
                ? (int)((barTime - swingList[i].swingTime) / PeriodSeconds(InpTF))
                : iBarShift(_Symbol, InpTF, swingList[i].swingTime, false);
      if(age >= InpExpiryBars) swingList[i].state = SWING_RETIRED;
   }
}

//+------------------------------------------------------------------+
//| Add a new sweep record and log the creation event.               |
//+------------------------------------------------------------------+
void SWEEP_Add(int swingIdx, datetime sweepTime, double wickTip,
               int initialState, datetime confirmTime)
{
   if(sweepTotal >= SWEEP_MAX)
   {
      if(InpShowLog) Print("LiqSweep_Detector: sweep limit reached");
      return;
   }

   // dir: swing low swept → bullish (+1); swing high swept → bearish (-1)
   int dir = -swingList[swingIdx].dir;
   int i   = sweepTotal++;

   sweepList[i].id          = nextSweepId++;
   sweepList[i].swingId     = swingList[swingIdx].id;
   sweepList[i].dir         = dir;
   sweepList[i].state       = initialState;
   sweepList[i].swingTime   = swingList[swingIdx].swingTime;
   sweepList[i].swingLevel  = swingList[swingIdx].level;
   sweepList[i].sweepTime   = sweepTime;
   sweepList[i].wickTip     = wickTip;
   sweepList[i].confirmTime = confirmTime;
   sweepList[i].drawn       = false;

   if(InpShowLog)
      PrintFormat("LIQUIDITY_SWEEP_CREATED | id=%d | %s | level=%.5f | wick=%.5f | bar=%s",
                  sweepList[i].id,
                  dir > 0 ? "BULLISH" : "BEARISH",
                  sweepList[i].swingLevel, wickTip,
                  TimeToString(sweepTime, TIME_DATE|TIME_MINUTES));

   if(initialState == SWEEP_CONFIRMED && InpShowLog)
      PrintFormat("LIQUIDITY_SWEEP_CONFIRMED | id=%d | %s | level=%.5f | bar=%s (same-bar)",
                  sweepList[i].id,
                  dir > 0 ? "BULLISH" : "BEARISH",
                  sweepList[i].swingLevel,
                  TimeToString(confirmTime, TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
//| Check bar sh as a new sweep candle against all AVAILABLE swings. |
//|                                                                  |
//| Bullish sweep: iLow(sh) < swing low AND the swing is older.     |
//| Bearish sweep: iHigh(sh) > swing high AND the swing is older.   |
//|                                                                  |
//| Same-bar confirmation: if close is already back inside on sh,   |
//| create the sweep as CONFIRMED immediately.                       |
//+------------------------------------------------------------------+
void SWEEP_CheckNewSweeps(int sh)
{
   double barHi  = iHigh (_Symbol, InpTF, sh);
   double barLo  = iLow  (_Symbol, InpTF, sh);
   double barCl  = iClose(_Symbol, InpTF, sh);
   datetime barT = iTime (_Symbol, InpTF, sh);

   for(int i = 0; i < swingTotal; i++)
   {
      if(swingList[i].state != SWING_AVAILABLE) continue;
      if(swingList[i].swingTime >= barT) continue; // swing must predate the sweep bar

      // ── Bullish sweep candidate: wick below swing low ──────────────
      if(swingList[i].dir == -1 && barLo < swingList[i].level)
      {
         bool confirmed = (barCl > swingList[i].level);
         SWEEP_Add(i, barT, barLo,
                   confirmed ? SWEEP_CONFIRMED : SWEEP_PENDING,
                   confirmed ? barT : 0);
         swingList[i].state = confirmed ? SWING_RETIRED : SWING_PENDING;
      }
      // ── Bearish sweep candidate: wick above swing high ─────────────
      else if(swingList[i].dir == +1 && barHi > swingList[i].level)
      {
         bool confirmed = (barCl < swingList[i].level);
         SWEEP_Add(i, barT, barHi,
                   confirmed ? SWEEP_CONFIRMED : SWEEP_PENDING,
                   confirmed ? barT : 0);
         swingList[i].state = confirmed ? SWING_RETIRED : SWING_PENDING;
      }
   }
}

//+------------------------------------------------------------------+
//| Check bar sh for close-back confirmation of PENDING sweeps.      |
//+------------------------------------------------------------------+
void SWEEP_CheckConfirmations(int sh)
{
   double   barCl = iClose(_Symbol, InpTF, sh);
   datetime barT  = iTime (_Symbol, InpTF, sh);

   for(int i = 0; i < sweepTotal; i++)
   {
      if(sweepList[i].state != SWEEP_PENDING) continue;
      if(barT <= sweepList[i].sweepTime) continue; // must be a later bar

      bool confirmed = (sweepList[i].dir == +1)
                       ? (barCl > sweepList[i].swingLevel)  // bull: close above swept low
                       : (barCl < sweepList[i].swingLevel); // bear: close below swept high

      if(!confirmed) continue;

      sweepList[i].state       = SWEEP_CONFIRMED;
      sweepList[i].confirmTime = barT;

      // Retire the originating swing permanently
      for(int j = 0; j < swingTotal; j++)
         if(swingList[j].id == sweepList[i].swingId)
         { swingList[j].state = SWING_RETIRED; break; }

      if(InpShowLog)
         PrintFormat("LIQUIDITY_SWEEP_CONFIRMED | id=%d | %s | level=%.5f | bar=%s",
                     sweepList[i].id,
                     sweepList[i].dir > 0 ? "BULLISH" : "BEARISH",
                     sweepList[i].swingLevel,
                     TimeToString(barT, TIME_DATE|TIME_MINUTES));
   }
}

//+------------------------------------------------------------------+
//| Expire PENDING sweeps that have waited too long for close-back.  |
//| Resets the originating swing to AVAILABLE so it can be swept     |
//| again on a future bar.                                           |
//+------------------------------------------------------------------+
void SWEEP_CheckExpiry(datetime barTime, bool historical)
{
   if(InpMaxWaitBars <= 0) return;

   for(int i = 0; i < sweepTotal; i++)
   {
      if(sweepList[i].state != SWEEP_PENDING) continue;

      int age = historical
                ? (int)((barTime - sweepList[i].sweepTime) / PeriodSeconds(InpTF))
                : iBarShift(_Symbol, InpTF, sweepList[i].sweepTime, false);

      if(age < InpMaxWaitBars) continue;

      sweepList[i].state = SWEEP_EXPIRED;

      // Reset swing so it can generate a new sweep later
      for(int j = 0; j < swingTotal; j++)
         if(swingList[j].id == sweepList[i].swingId && swingList[j].state == SWING_PENDING)
         { swingList[j].state = SWING_AVAILABLE; break; }

      if(InpShowLog)
         PrintFormat("LIQUIDITY_SWEEP_EXPIRED | id=%d | %s | level=%.5f | sweep_bar=%s",
                     sweepList[i].id,
                     sweepList[i].dir > 0 ? "BULLISH" : "BEARISH",
                     sweepList[i].swingLevel,
                     TimeToString(sweepList[i].sweepTime, TIME_DATE|TIME_MINUTES));
   }
}

//+------------------------------------------------------------------+
//| Per-bar state update (live mode, processes bar shift=1).         |
//+------------------------------------------------------------------+
void UpdateAllStates()
{
   datetime barTime = iTime(_Symbol, InpTF, 1);
   SWING_RetireOld(barTime, false);
   SWEEP_CheckNewSweeps(1);
   SWEEP_CheckConfirmations(1);
   SWEEP_CheckExpiry(barTime, false);
}

//+------------------------------------------------------------------+
//| Draw a single confirmed sweep.                                   |
//|                                                                  |
//| Three objects:                                                   |
//|   _line  : dashed OBJ_TREND from swing candle to confirm candle  |
//|   _arrow : OBJ_ARROW (↑ or ↓) at the wick extreme               |
//|   _lbl   : OBJ_TEXT label near the confirmation bar              |
//+------------------------------------------------------------------+
void SWEEP_DrawSweep(int idx)
{
   if(sweepList[idx].state != SWEEP_CONFIRMED) return;
   if(sweepList[idx].dir > 0 && !InpShowBull)  return;
   if(sweepList[idx].dir < 0 && !InpShowBear)  return;

   color    clr     = SWEEP_Color(idx);
   bool     bullish = (sweepList[idx].dir > 0);
   string   pfx     = "SMCLS_" + IntegerToString(sweepList[idx].id);
   string   objLine = pfx + "_line";
   string   objArr  = pfx + "_arrow";
   string   objLbl  = pfx + "_lbl";

   datetime t1  = sweepList[idx].swingTime;
   datetime t2  = sweepList[idx].confirmTime;
   double   lvl = sweepList[idx].swingLevel;

   // ── 1. Dashed level line: swing candle → confirmation candle ──────
   if(ObjectCreate(0, objLine, OBJ_TREND, 0, t1, lvl, t2, lvl))
   {
      ObjectSetInteger(0, objLine, OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, objLine, OBJPROP_STYLE,      STYLE_DASH);
      ObjectSetInteger(0, objLine, OBJPROP_WIDTH,      1);
      ObjectSetInteger(0, objLine, OBJPROP_RAY_RIGHT,  false);
      ObjectSetInteger(0, objLine, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, objLine, OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, objLine, OBJPROP_BACK,       true);
   }

   // ── 2. Arrow at the wick extreme of the sweep candle ─────────────
   // Bullish sweep → ↑ arrow (233) at the wick low = rejection sign
   // Bearish sweep → ↓ arrow (234) at the wick high
   if(ObjectCreate(0, objArr, OBJ_ARROW, 0,
                   sweepList[idx].sweepTime, sweepList[idx].wickTip))
   {
      ObjectSetInteger(0, objArr, OBJPROP_ARROWCODE,  bullish ? 233 : 234);
      ObjectSetInteger(0, objArr, OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, objArr, OBJPROP_WIDTH,      2);
      ObjectSetInteger(0, objArr, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, objArr, OBJPROP_HIDDEN,     true);
   }

   // ── 3. Text label at confirmation bar ────────────────────────────
   string txt = StringFormat("%s Sweep #%d  Lvl:%.5f",
                             bullish ? "Bull" : "Bear",
                             sweepList[idx].id,
                             sweepList[idx].swingLevel);
   if(ObjectCreate(0, objLbl, OBJ_TEXT, 0, t2, lvl))
   {
      ObjectSetString( 0, objLbl, OBJPROP_TEXT,       txt);
      ObjectSetInteger(0, objLbl, OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, objLbl, OBJPROP_FONTSIZE,   7);
      ObjectSetInteger(0, objLbl, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, objLbl, OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, objLbl, OBJPROP_BACK,       false);
   }

   sweepList[idx].drawn = true;
}

//+------------------------------------------------------------------+
//| Draw all CONFIRMED sweeps that have not been drawn yet.          |
//| Uses the drawn flag so both initial render (OnInit) and          |
//| delayed confirmations (OnCalculate) work correctly.              |
//+------------------------------------------------------------------+
void SWEEP_DrawNew()
{
   for(int i = 0; i < sweepTotal; i++)
   {
      if(sweepList[i].drawn) continue;
      if(sweepList[i].state != SWEEP_CONFIRMED) continue;
      SWEEP_DrawSweep(i);
   }
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
//| Remove all indicator chart objects                               |
//+------------------------------------------------------------------+
void DeleteAll()
{
   for(int i = ObjectsTotal(0) - 1; i >= 0; i--)
   {
      string nm = ObjectName(0, i);
      if(StringFind(nm, "SMCLS_") == 0) ObjectDelete(0, nm);
   }
}

//+------------------------------------------------------------------+
//| OnInit: detect swings → historical lifecycle replay → draw       |
//+------------------------------------------------------------------+
int OnInit()
{
   int available = iBars(_Symbol, InpTF);
   if(available < 2 * InpSwingStr + 2)
   { Print("LiqSweep_Detector: not enough bars."); return INIT_FAILED; }

   int limit = MathMin(InpLookback, available - InpSwingStr - 2);

   // ── Step 1: Detect all swings (oldest → newest) ──────────────────
   // Scan sh from limit down to InpSwingStr+1: each bar requires N left
   // AND N right bars to be confirmed as a swing.
   for(int sh = limit; sh >= InpSwingStr + 1; sh--)
      SWING_ScanBar(sh);

   // ── Step 2: Historical lifecycle replay (oldest → newest) ─────────
   // Walk every bar in the lookback window.  For each bar:
   //   • Retire swings that have aged past InpExpiryBars
   //   • Check if the bar sweeps any available swing (PENDING or CONFIRMED)
   //   • Check if the bar confirms any existing PENDING sweep
   //   • Check if any PENDING sweep has expired (InpMaxWaitBars elapsed)
   for(int sh = limit; sh >= 1; sh--)
   {
      datetime barTime = iTime(_Symbol, InpTF, sh);
      SWING_RetireOld(barTime, true);
      SWEEP_CheckNewSweeps(sh);
      SWEEP_CheckConfirmations(sh);
      SWEEP_CheckExpiry(barTime, true);
   }

   // ── Step 3: Draw all confirmed sweeps ────────────────────────────
   SWEEP_DrawNew();

   // ── Step 4: Summary ───────────────────────────────────────────────
   int swAvail=0, swRetired=0;
   for(int i = 0; i < swingTotal; i++)
      swingList[i].state == SWING_AVAILABLE ? swAvail++ : swRetired++;

   int spConf=0, spPend=0, spExp=0;
   for(int i = 0; i < sweepTotal; i++)
   {
      if     (sweepList[i].state == SWEEP_CONFIRMED) spConf++;
      else if(sweepList[i].state == SWEEP_PENDING)   spPend++;
      else                                            spExp++;
   }

   PrintFormat("LiqSweep_Detector v1 ready | swings=%d (avail=%d retired=%d) | sweeps=%d (confirmed=%d pending=%d expired=%d) | %s %s",
               swingTotal, swAvail, swRetired,
               sweepTotal, spConf, spPend, spExp,
               _Symbol, EnumToString(InpTF));
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| OnDeinit: remove all indicator chart objects                     |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   DeleteAll();
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
//| OnCalculate: bar-open processing only                            |
//|                                                                  |
//| Order:                                                           |
//|   1. Check bar N+1 as a newly confirmed swing                   |
//|   2. Advance all swing / sweep states using bar 1               |
//|   3. Draw any newly confirmed sweeps                             |
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

   // 1. Detect new swing: the candle at shift N+1 now has N right-side bars
   //    confirmed (bar 1 is the Nth right-side bar for the swing at N+1)
   SWING_ScanBar(InpSwingStr + 1);

   // 2. Advance lifecycle: retire old swings, detect new sweeps, confirm / expire
   UpdateAllStates();

   // 3. Draw any sweeps newly confirmed this bar
   SWEEP_DrawNew();

   return rates_total;
}
`;
}
