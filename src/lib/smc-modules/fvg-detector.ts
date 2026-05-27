/**
 * SMC Module Library — Phase 1: Detection Only
 *
 * FVG (Fair Value Gap) Detector
 * ─────────────────────────────
 * Generates a standalone MQL5 indicator that scans historical candles for
 * Fair Value Gaps, draws every detected zone on the chart, and logs each
 * detection to the journal.
 *
 * Detection rules (closed candles only):
 *   Bullish FVG  →  C3.Low  > C1.High    UL = C3.Low,  LL = C1.High
 *   Bearish FVG  →  C3.High < C1.Low     UL = C1.Low,  LL = C3.High
 *
 * MQL5 bar indexing (newest closed bar = shift 1):
 *   C3 = shift 1  (newest closed candle in the triplet)
 *   C2 = shift 2  (middle candle — not used in detection, part of the move)
 *   C1 = shift 3  (oldest closed candle in the triplet)
 *
 * Journal log per detection:
 *   FVG_CREATED | id | BULLISH/BEARISH | C1_time | C3_time | UL | LL
 *
 * NO trading logic. No entries, no SL, no TP, no breakeven.
 * Detection and visualisation only.
 */

export const FVG_DETECTOR_VERSION = "1.0.0";
export const FVG_DETECTOR_MODULE  = "FVG_Detector";

/**
 * Returns the complete MQL5 source code for the FVG Detector indicator.
 * Drop the output into MetaEditor, compile, and attach to any chart.
 */
export function generateFvgDetector(): string {
  return `//+------------------------------------------------------------------+
//| FVG_Detector.mq5                                                 |
//| SMC Module Library v${FVG_DETECTOR_VERSION} — Phase 1: Detection Only         |
//|                                                                  |
//| Detects Fair Value Gaps on closed candles and draws every zone.  |
//|                                                                  |
//| DETECTION RULES:                                                 |
//|   Bullish FVG : C3.Low  > C1.High                               |
//|                 UL = C3.Low   LL = C1.High                      |
//|   Bearish FVG : C3.High < C1.Low                                |
//|                 UL = C1.Low   LL = C3.High                      |
//|                                                                  |
//|   C1 = oldest closed bar (shift 3)                              |
//|   C2 = middle closed bar (shift 2, not used in detection)       |
//|   C3 = newest closed bar (shift 1)                              |
//|                                                                  |
//| JOURNAL OUTPUT:                                                  |
//|   FVG_CREATED | id | dir | C1_time | C3_time | UL | LL          |
//|                                                                  |
//| NO trading logic. Detection and visualisation only.             |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SMC Module Library"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

//--- Inputs
input ENUM_TIMEFRAMES InpTF       = PERIOD_CURRENT; // Timeframe to scan
input int             InpLookback = 500;             // Historical bars to scan on load
input color           InpBullClr  = clrDodgerBlue;  // Bullish FVG colour
input color           InpBearClr  = clrOrangeRed;   // Bearish FVG colour
input bool            InpShowLog  = true;            // Print detections to journal

//--- Zone storage
#define FVG_MAX_ZONES 500

struct FVGRecord
{
   int      id;
   int      dir;      // +1 = bullish, -1 = bearish
   datetime c1Time;   // open time of C1 (oldest bar in the triplet)
   datetime c3Time;   // open time of C3 (newest bar in the triplet)
   double   ul;       // upper limit of gap
   double   ll;       // lower limit of gap
};

FVGRecord fvgList[FVG_MAX_ZONES];
int       fvgTotal    = 0;   // zones registered
int       fvgDrawn    = 0;   // zones already drawn (only new ones drawn per bar)
int       nextId      = 0;
datetime  lastBarTime = 0;

//+------------------------------------------------------------------+
//| Prevent double-registration of the same zone across bars         |
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
//| Register a new FVG zone and log it                               |
//+------------------------------------------------------------------+
void FVG_Add(int dir, datetime c1T, datetime c3T, double ul, double ll)
{
   if(fvgTotal >= FVG_MAX_ZONES)
   {
      if(InpShowLog) Print("FVG_Detector: zone limit reached (", FVG_MAX_ZONES, ")");
      return;
   }
   if(FVG_IsDuplicate(dir, ul, ll)) return;

   int idx = fvgTotal++;
   fvgList[idx].id     = nextId++;
   fvgList[idx].dir    = dir;
   fvgList[idx].c1Time = c1T;
   fvgList[idx].c3Time = c3T;
   fvgList[idx].ul     = ul;
   fvgList[idx].ll     = ll;

   if(InpShowLog)
      PrintFormat("FVG_CREATED | id=%d | dir=%s | C1=%s | C3=%s | UL=%.5f | LL=%.5f",
                  fvgList[idx].id,
                  dir > 0 ? "BULLISH" : "BEARISH",
                  TimeToString(c1T, TIME_DATE|TIME_MINUTES),
                  TimeToString(c3T, TIME_DATE|TIME_MINUTES),
                  ul, ll);
}

//+------------------------------------------------------------------+
//| Scan one 3-candle triplet for an FVG.                            |
//| c3Shift = shift of C3 (newest candle of the triplet, must be >=1)|
//| C2 = c3Shift+1  C1 = c3Shift+2                                  |
//+------------------------------------------------------------------+
void FVG_ScanBar(int c3Shift)
{
   if(c3Shift < 1) return; // C3 must be a closed candle (shift >= 1)

   double c1Hi = iHigh(_Symbol, InpTF, c3Shift + 2);
   double c1Lo = iLow (_Symbol, InpTF, c3Shift + 2);
   double c3Hi = iHigh(_Symbol, InpTF, c3Shift);
   double c3Lo = iLow (_Symbol, InpTF, c3Shift);

   if(c1Hi <= 0 || c3Hi <= 0) return; // data not loaded yet

   datetime c1T = iTime(_Symbol, InpTF, c3Shift + 2);
   datetime c3T = iTime(_Symbol, InpTF, c3Shift);

   // Bullish FVG: C3.Low > C1.High — upward move left a gap below
   if(c3Lo > c1Hi)
      FVG_Add(+1, c1T, c3T, c3Lo, c1Hi);  // UL = C3.Low,  LL = C1.High

   // Bearish FVG: C3.High < C1.Low — downward move left a gap above
   if(c3Hi < c1Lo)
      FVG_Add(-1, c1T, c3T, c1Lo, c3Hi);  // UL = C1.Low,  LL = C3.High
}

//+------------------------------------------------------------------+
//| Draw a single FVG zone rectangle and ID label                    |
//+------------------------------------------------------------------+
void FVG_DrawZone(int idx)
{
   color    clr  = fvgList[idx].dir > 0 ? InpBullClr : InpBearClr;
   string   pfx  = "SMCFVG_" + IntegerToString(fvgList[idx].id);
   string   rect = pfx + "_zone";
   string   lbl  = pfx + "_lbl";

   // Right edge: 200 bars after C3 (static — no update needed after creation)
   datetime t2 = fvgList[idx].c3Time + (datetime)(PeriodSeconds(InpTF) * 200);

   // Zone rectangle
   if(ObjectCreate(0, rect, OBJ_RECTANGLE, 0,
                   fvgList[idx].c1Time, fvgList[idx].ul,
                   t2,                  fvgList[idx].ll))
   {
      ObjectSetInteger(0, rect, OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, rect, OBJPROP_STYLE,      STYLE_SOLID);
      ObjectSetInteger(0, rect, OBJPROP_WIDTH,      1);
      ObjectSetInteger(0, rect, OBJPROP_BACK,       true);
      ObjectSetInteger(0, rect, OBJPROP_FILL,       true);
      ObjectSetInteger(0, rect, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, rect, OBJPROP_HIDDEN,     true);
   }
   // (If object already exists, ObjectCreate returns false — zone was drawn before, skip.)

   // ID label at C3 position, upper limit price
   string txt = StringFormat("%s FVG #%d  UL:%.5f  LL:%.5f",
                             fvgList[idx].dir > 0 ? "Bull" : "Bear",
                             fvgList[idx].id,
                             fvgList[idx].ul, fvgList[idx].ll);
   if(ObjectCreate(0, lbl, OBJ_TEXT, 0, fvgList[idx].c3Time, fvgList[idx].ul))
   {
      ObjectSetString( 0, lbl, OBJPROP_TEXT,      txt);
      ObjectSetInteger(0, lbl, OBJPROP_COLOR,     clr);
      ObjectSetInteger(0, lbl, OBJPROP_FONTSIZE,  7);
      ObjectSetInteger(0, lbl, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, lbl, OBJPROP_HIDDEN,    true);
      ObjectSetInteger(0, lbl, OBJPROP_BACK,      false);
   }
}

//+------------------------------------------------------------------+
//| Draw all zones registered since the last draw call               |
//| On init: all zones. On each new bar: only newly added ones.      |
//+------------------------------------------------------------------+
void FVG_DrawNew()
{
   for(int i = fvgDrawn; i < fvgTotal; i++)
      FVG_DrawZone(i);
   fvgDrawn = fvgTotal;
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
//| Remove every object created by this indicator                    |
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
//| OnInit: historical scan                                          |
//+------------------------------------------------------------------+
int OnInit()
{
   int available = iBars(_Symbol, InpTF);
   if(available < 4)
   {
      Print("FVG Detector: not enough bars available. Load more history.");
      return INIT_FAILED;
   }

   // Scan from oldest to newest so IDs are in chronological order.
   // A valid triplet needs shift c3Shift+2 to exist, so scan stops at shift 1.
   int limit = MathMin(InpLookback, available - 3);
   for(int sh = limit; sh >= 1; sh--)
      FVG_ScanBar(sh);

   FVG_DrawNew();

   PrintFormat("FVG Detector ready — %d zones detected across %d bars on %s %s.",
               fvgTotal, limit,
               _Symbol,
               EnumToString(InpTF));
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| OnDeinit: clean up all chart objects                             |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   FVG_DeleteAll();
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
//| OnCalculate: detect new FVGs on each new bar (bar-open pattern)  |
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

   // Scan the triplet whose C3 is the just-closed bar (shift 1)
   FVG_ScanBar(1);

   // Draw only any newly registered zones (efficient: O(new zones) not O(all zones))
   FVG_DrawNew();

   return rates_total;
}
`;
}
