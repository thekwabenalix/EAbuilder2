/**
 * SMC Module Library — Phase 1: Breaker Block (BB) Detector
 *
 * Breaker Block Detector v1.0.0
 * ──────────────────────────────
 * A Breaker Block forms when a valid Order Block FAILS — price closes
 * through the OB zone, invalidating it and flipping its polarity.
 * The zone that was support becomes resistance and vice versa.
 *
 *   Bearish OB (last bullish candle before bearish displacement)
 *     → becomes BULLISH BREAKER when price closes ABOVE the OB high
 *
 *   Bullish OB (last bearish candle before bullish displacement)
 *     → becomes BEARISH BREAKER when price closes BELOW the OB low
 *
 * Breaker zone occupies the EXACT same price range (hi / lo) as the
 * failed OB.  Left edge = original OB candle time.
 * The Breaker itself can then be mitigated or invalidated.
 *
 * OB STATES:
 *   OB_ACTIVE      (0) → zone untouched
 *   OB_MITIGATED   (1) → price entered zone, not yet broken
 *   OB_INVALIDATED (2) → price closed through zone → Breaker created
 *   OB_EXPIRED     (3) → aged out before breaking (no Breaker)
 *
 * BREAKER STATES:
 *   BREAKER_ACTIVE      (0) → live, awaiting retest
 *   BREAKER_MITIGATED   (1) → price returned into zone
 *   BREAKER_INVALIDATED (2) → price closed back through zone
 *   BREAKER_EXPIRED     (3) → aged out
 *
 * JOURNAL:
 *   OB_CREATED       | id | dir | H | L | ob_bar | disp_bar
 *   OB_MITIGATED     | id | dir | H | L | bar
 *   BREAKER_CREATED  | bb_id | orig_ob_id | new_dir | H | L | bar
 *   OB_EXPIRED       | id | dir | H | L | age_bars
 *   BREAKER_MITIGATED   | bb_id | orig_ob_id | dir | H | L | bar
 *   BREAKER_INVALIDATED | bb_id | orig_ob_id | dir | H | L | bar
 *   BREAKER_EXPIRED     | bb_id | orig_ob_id | dir | H | L | age_bars
 *
 * NO trading logic. Detection and visualisation only.
 */

export const BB_DETECTOR_VERSION = "1.0.0";
export const BB_DETECTOR_MODULE  = "BB_Detector";

/**
 * Returns the complete MQL5 source code for the Breaker Block Detector (v1.0).
 * Drop the output into MetaEditor, compile, and attach to any chart.
 */
export function generateBbDetector(): string {
  return `//+------------------------------------------------------------------+
//| BB_Detector.mq5                                                  |
//| SMC Module Library v${BB_DETECTOR_VERSION} — Phase 1: Detection Only         |
//|                                                                  |
//| Detects Breaker Block (BB) zones.                                |
//|                                                                  |
//| A Breaker forms when an Order Block fails:                       |
//|   Bearish OB + close above OB high  →  Bullish Breaker          |
//|   Bullish OB + close below OB low   →  Bearish Breaker          |
//|                                                                  |
//| Breaker zone = original OB price range (same Hi / Lo).          |
//| Left edge    = original OB candle time.                          |
//|                                                                  |
//| OB STATES:                                                       |
//|   OB_ACTIVE (0) | OB_MITIGATED (1) | OB_INVALIDATED (2→BB)     |
//|   OB_EXPIRED (3)                                                 |
//|                                                                  |
//| BREAKER STATES:                                                  |
//|   BREAKER_ACTIVE (0) | BREAKER_MITIGATED (1)                    |
//|   BREAKER_INVALIDATED (2) | BREAKER_EXPIRED (3)                 |
//|                                                                  |
//| JOURNAL:                                                         |
//|   OB_CREATED        | id | dir | H | L | ob_bar | disp_bar      |
//|   OB_MITIGATED      | id | dir | H | L | bar                    |
//|   BREAKER_CREATED   | bb_id | orig_ob_id | dir | H | L | bar    |
//|   OB_EXPIRED        | id | dir | H | L | age_bars               |
//|   BREAKER_MITIGATED   | bb_id | orig_ob_id | dir | H | L | bar  |
//|   BREAKER_INVALIDATED | bb_id | orig_ob_id | dir | H | L | bar  |
//|   BREAKER_EXPIRED     | bb_id | orig_ob_id | dir | age_bars      |
//|                                                                  |
//| NO trading logic. Detection and visualisation only.             |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SMC Module Library"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

//--- OB lifecycle states
#define OB_ACTIVE      0  // zone untouched
#define OB_MITIGATED   1  // price entered zone, not yet broken
#define OB_INVALIDATED 2  // price closed through → Breaker created
#define OB_EXPIRED     3  // aged out, no Breaker

//--- Breaker lifecycle states
#define BREAKER_ACTIVE      0
#define BREAKER_MITIGATED   1
#define BREAKER_INVALIDATED 2
#define BREAKER_EXPIRED     3

//--- Inputs — Detection (ATR-displacement filter, same as OB Detector)
input ENUM_TIMEFRAMES InpTF         = PERIOD_CURRENT; // Timeframe to scan
input int             InpLookback   = 500;             // Historical bars to scan on load
input int             InpAtrPeriod  = 14;              // ATR period for displacement filter
input double          InpDispMult   = 1.5;             // Displacement: body >= N x ATR
input int             InpObScanBack = 5;               // Bars before displacement to search for OB

//--- Inputs — Lifecycle
input int  InpExpiryBars        = 100;  // Expire OB / Breaker after N bars (0 = never)
input bool InpShowMitigated     = true; // Show mitigated breaker zones (faded)
input bool InpRemoveInvalidated = true; // Remove invalidated/expired zones (false = dotted relic)

//--- Inputs — Colours
input color InpBullBbClr = clrMediumSeaGreen; // Bullish Breaker zone colour
input color InpBearBbClr = clrOrangeRed;       // Bearish Breaker zone colour
input color InpBullObClr = clrRoyalBlue;       // Bullish OB colour (when InpShowOriginalOb = true)
input color InpBearObClr = clrCrimson;         // Bearish OB colour (when InpShowOriginalOb = true)

//--- Inputs — Opacity
input int  InpBbActiveOpacity = 70;    // Breaker active zone opacity 0-100
input int  InpBbMitOpacity    = 25;    // Breaker mitigated zone opacity 0-100
input int  InpObOpacity       = 40;    // Original OB zone opacity (when shown)

//--- Inputs — Visibility
input bool InpShowOriginalOb = false; // Show underlying OB zones (false = Breakers only)

//--- Inputs — Logging
input bool InpShowLog = true; // Print lifecycle events to journal

#define OB_MAX 300
#define BB_MAX 300

//--- Original Order Block record
struct OBRecord
{
   int      id;
   int      dir;         // +1 bullish OB  -1 bearish OB
   int      state;       // OB_ACTIVE / OB_MITIGATED / OB_INVALIDATED / OB_EXPIRED
   datetime obTime;      // opening time of the OB candle (zone left edge)
   datetime dispTime;    // opening time of the displacement candle
   double   hi;          // OB candle high
   double   lo;          // OB candle low
   datetime invalidTime; // right-edge freeze when zone ends (0 = live)
};

//--- Breaker Block record
struct BreakerRecord
{
   int      id;
   int      origObId;    // id of the original OB that was broken
   int      dir;         // FLIPPED: bearish OB broken → +1 bull breaker; bullish OB → -1 bear breaker
   int      state;       // BREAKER_ACTIVE / BREAKER_MITIGATED / BREAKER_INVALIDATED / BREAKER_EXPIRED
   datetime zoneStart;   // left edge = original OB candle time
   datetime breakerTime; // bar that closed through the OB (when breaker was born)
   double   hi;          // same as original OB high
   double   lo;          // same as original OB low
   datetime invalidTime; // right-edge freeze (0 = live)
};

OBRecord     obList[OB_MAX];
BreakerRecord bbList[BB_MAX];
int      obTotal     = 0;
int      obDrawn     = 0;
int      bbTotal     = 0;
int      bbDrawn     = 0;
int      nextObId    = 0;
int      nextBbId    = 0;
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
//| Display colour for an original OB zone                           |
//+------------------------------------------------------------------+
color OB_ZoneColor(int idx)
{
   color base = obList[idx].dir > 0 ? InpBullObClr : InpBearObClr;
   int   s    = obList[idx].state;
   if(s == OB_INVALIDATED || s == OB_EXPIRED) return BlendWithBg(base, 8);
   if(s == OB_MITIGATED)                      return BlendWithBg(base, (int)(InpObOpacity * 0.5));
   return BlendWithBg(base, InpObOpacity);
}

//+------------------------------------------------------------------+
//| Display colour for a Breaker zone                                |
//+------------------------------------------------------------------+
color BB_ZoneColor(int idx)
{
   color base = bbList[idx].dir > 0 ? InpBullBbClr : InpBearBbClr;
   int   s    = bbList[idx].state;
   if(s == BREAKER_INVALIDATED || s == BREAKER_EXPIRED) return BlendWithBg(base, 10);
   if(s == BREAKER_MITIGATED)                           return BlendWithBg(base, InpBbMitOpacity);
   return BlendWithBg(base, InpBbActiveOpacity);
}

//+------------------------------------------------------------------+
//| Right-edge time for an OB or Breaker zone                        |
//+------------------------------------------------------------------+
datetime OB_RightEdge(int idx)
{
   if(obList[idx].invalidTime > 0) return obList[idx].invalidTime;
   return (datetime)(TimeCurrent() + (datetime)(5 * 365 * 86400));
}

datetime BB_RightEdge(int idx)
{
   if(bbList[idx].invalidTime > 0) return bbList[idx].invalidTime;
   return (datetime)(TimeCurrent() + (datetime)(5 * 365 * 86400));
}

//+------------------------------------------------------------------+
//| Duplicate guards                                                  |
//+------------------------------------------------------------------+
bool OB_IsDuplicate(int dir, datetime obT)
{
   for(int i = 0; i < obTotal; i++)
      if(obList[i].dir == dir && obList[i].obTime == obT) return true;
   return false;
}

bool BB_IsDuplicate(int origObId)
{
   for(int i = 0; i < bbTotal; i++)
      if(bbList[i].origObId == origObId) return true;
   return false;
}

//+------------------------------------------------------------------+
//| Register a new Order Block                                       |
//+------------------------------------------------------------------+
void OB_Add(int dir, datetime obT, datetime dispT, double hi, double lo)
{
   if(obTotal >= OB_MAX) { if(InpShowLog) Print("BB_Detector: OB limit reached"); return; }
   if(OB_IsDuplicate(dir, obT)) return;

   int idx             = obTotal++;
   obList[idx].id          = nextObId++;
   obList[idx].dir         = dir;
   obList[idx].state       = OB_ACTIVE;
   obList[idx].obTime      = obT;
   obList[idx].dispTime    = dispT;
   obList[idx].hi          = hi;
   obList[idx].lo          = lo;
   obList[idx].invalidTime = 0;

   if(InpShowLog)
      PrintFormat("OB_CREATED | id=%d | %s | H=%.5f | L=%.5f | ob_bar=%s | disp_bar=%s",
                  obList[idx].id,
                  dir > 0 ? "BULLISH" : "BEARISH",
                  hi, lo,
                  TimeToString(obT,   TIME_DATE|TIME_MINUTES),
                  TimeToString(dispT, TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
//| Create a Breaker Block from a failed OB.                         |
//|                                                                  |
//| zoneStart  = original OB candle time (same left edge)           |
//| hi / lo    = same price boundaries as the failed OB             |
//| dir        = FLIPPED (bearOB → +1 bullBreaker, bullOB → -1)    |
//+------------------------------------------------------------------+
void BB_Create(int obIdx, datetime breakTime)
{
   if(bbTotal >= BB_MAX) { if(InpShowLog) Print("BB_Detector: BB limit reached"); return; }
   if(BB_IsDuplicate(obList[obIdx].id)) return;

   int newDir = -obList[obIdx].dir; // flip: bearish OB → bullish breaker

   int i = bbTotal++;
   bbList[i].id          = nextBbId++;
   bbList[i].origObId    = obList[obIdx].id;
   bbList[i].dir         = newDir;
   bbList[i].state       = BREAKER_ACTIVE;
   bbList[i].zoneStart   = obList[obIdx].obTime;  // same left edge as original OB
   bbList[i].breakerTime = breakTime;              // bar on which the break closed
   bbList[i].hi          = obList[obIdx].hi;       // same price boundaries
   bbList[i].lo          = obList[obIdx].lo;
   bbList[i].invalidTime = 0;

   if(InpShowLog)
      PrintFormat("BREAKER_CREATED | bb_id=%d | orig_ob_id=%d | %s | H=%.5f | L=%.5f | bar=%s",
                  bbList[i].id, bbList[i].origObId,
                  newDir > 0 ? "BULLISH" : "BEARISH",
                  bbList[i].hi, bbList[i].lo,
                  TimeToString(breakTime, TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
//| ATR (SMA of True Range) at bar shift over InpAtrPeriod bars.    |
//| Self-contained — no indicator handle needed.                    |
//+------------------------------------------------------------------+
double CalcATR(int shift, int period)
{
   int available = iBars(_Symbol, InpTF);
   if(shift + period + 1 >= available) return 0.0;
   double sum = 0.0;
   for(int k = 0; k < period; k++)
   {
      double hi  = iHigh (_Symbol, InpTF, shift + k);
      double lo  = iLow  (_Symbol, InpTF, shift + k);
      double prv = iClose(_Symbol, InpTF, shift + k + 1);
      double tr  = MathMax(hi - lo,
                   MathMax(MathAbs(hi - prv), MathAbs(lo - prv)));
      sum += tr;
   }
   return sum / (double)period;
}

//+------------------------------------------------------------------+
//| Scan bar dispShift as a potential displacement candle.           |
//| If displacement confirmed, look back for the OB candle.         |
//+------------------------------------------------------------------+
void OB_ScanBar(int dispShift)
{
   if(dispShift < 1) return;

   double atr = CalcATR(dispShift, InpAtrPeriod);
   if(atr <= 0.0) return;

   double dispOpn  = iOpen (_Symbol, InpTF, dispShift);
   double dispCls  = iClose(_Symbol, InpTF, dispShift);
   double dispBody = MathAbs(dispCls - dispOpn);

   if(dispBody < InpDispMult * atr) return;

   int dispDir  = (dispCls > dispOpn) ? +1 : -1;
   int available = iBars(_Symbol, InpTF);
   int scanEnd  = dispShift + InpObScanBack;
   if(scanEnd >= available - 1) scanEnd = available - 2;

   for(int j = dispShift + 1; j <= scanEnd; j++)
   {
      double jOpn = iOpen (_Symbol, InpTF, j);
      double jCls = iClose(_Symbol, InpTF, j);
      bool isBearish = (jCls < jOpn);
      bool isBullish = (jCls > jOpn);

      if(dispDir == +1 && isBearish) // bullish disp → last bearish candle = bull OB
      {
         OB_Add(+1,
                iTime(_Symbol, InpTF, j), iTime(_Symbol, InpTF, dispShift),
                iHigh(_Symbol, InpTF, j), iLow (_Symbol, InpTF, j));
         break;
      }
      if(dispDir == -1 && isBullish) // bearish disp → last bullish candle = bear OB
      {
         OB_Add(-1,
                iTime(_Symbol, InpTF, j), iTime(_Symbol, InpTF, dispShift),
                iHigh(_Symbol, InpTF, j), iLow (_Symbol, InpTF, j));
         break;
      }
   }
}

//+------------------------------------------------------------------+
//| OB mitigation: price enters zone without closing through.        |
//| Bullish OB: barLow  <= OB high  (price retraces down into zone) |
//| Bearish OB: barHigh >= OB low   (price retraces up   into zone) |
//+------------------------------------------------------------------+
bool OB_CheckMitigation(int idx, double barHigh, double barLow)
{
   if(obList[idx].state != OB_ACTIVE) return false;
   bool hit = (obList[idx].dir == +1)
              ? (barLow  <= obList[idx].hi)
              : (barHigh >= obList[idx].lo);
   if(hit) obList[idx].state = OB_MITIGATED;
   return hit;
}

//+------------------------------------------------------------------+
//| OB breaker check: price closes THROUGH the OB zone.             |
//|                                                                  |
//| Bearish OB (dir=-1): close > OB high  → Bullish Breaker (+1)   |
//| Bullish OB (dir=+1): close < OB low   → Bearish Breaker (-1)   |
//|                                                                  |
//| Fires for both ACTIVE and MITIGATED OBs — a touched OB can     |
//| still fail and become a breaker on the same or later bar.       |
//+------------------------------------------------------------------+
bool OB_CheckBreaker(int idx, double barClose, datetime breakTime)
{
   int s = obList[idx].state;
   if(s == OB_INVALIDATED || s == OB_EXPIRED) return false;

   bool hit = (obList[idx].dir == -1)
              ? (barClose > obList[idx].hi) // bearish OB broken upward
              : (barClose < obList[idx].lo); // bullish OB broken downward

   if(hit)
   {
      obList[idx].state       = OB_INVALIDATED;
      obList[idx].invalidTime = breakTime;
      BB_Create(idx, breakTime);
   }
   return hit;
}

//+------------------------------------------------------------------+
//| Breaker mitigation: price returns into the breaker zone          |
//| Bullish Breaker: barLow  <= bb high (retracement back down)     |
//| Bearish Breaker: barHigh >= bb low  (retracement back up)       |
//+------------------------------------------------------------------+
bool BB_CheckMitigation(int idx, double barHigh, double barLow)
{
   if(bbList[idx].state != BREAKER_ACTIVE) return false;
   bool hit = (bbList[idx].dir == +1)
              ? (barLow  <= bbList[idx].hi)
              : (barHigh >= bbList[idx].lo);
   if(hit) bbList[idx].state = BREAKER_MITIGATED;
   return hit;
}

//+------------------------------------------------------------------+
//| Breaker invalidation: price closes back through the breaker zone |
//| Bullish Breaker: close < bb low                                  |
//| Bearish Breaker: close > bb high                                 |
//+------------------------------------------------------------------+
bool BB_CheckInvalidation(int idx, double barClose, datetime freezeAt)
{
   int s = bbList[idx].state;
   if(s == BREAKER_INVALIDATED || s == BREAKER_EXPIRED) return false;
   bool hit = (bbList[idx].dir == +1)
              ? (barClose < bbList[idx].lo)
              : (barClose > bbList[idx].hi);
   if(hit)
   {
      bbList[idx].state       = BREAKER_INVALIDATED;
      bbList[idx].invalidTime = freezeAt;
   }
   return hit;
}

//+------------------------------------------------------------------+
//| Draw an original OB zone (only when InpShowOriginalOb = true)   |
//+------------------------------------------------------------------+
void OB_DrawZone(int idx)
{
   if(!InpShowOriginalOb) return;
   int s = obList[idx].state;
   // OBs that became breakers: the BB zone takes over visually
   if(s == OB_INVALIDATED) return;
   if(s == OB_EXPIRED && InpRemoveInvalidated) return;

   color    clr  = OB_ZoneColor(idx);
   string   pfx  = "SMCBB_ob_" + IntegerToString(obList[idx].id);
   string   rect = pfx + "_zone";
   string   lbl  = pfx + "_lbl";
   datetime t2   = OB_RightEdge(idx);
   bool     dead = (s == OB_EXPIRED);

   if(ObjectCreate(0, rect, OBJ_RECTANGLE, 0,
                   obList[idx].obTime, obList[idx].hi,
                   t2,                 obList[idx].lo))
   {
      ObjectSetInteger(0, rect, OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, rect, OBJPROP_STYLE,      dead ? STYLE_DOT : STYLE_SOLID);
      ObjectSetInteger(0, rect, OBJPROP_WIDTH,      1);
      ObjectSetInteger(0, rect, OBJPROP_BACK,       true);
      ObjectSetInteger(0, rect, OBJPROP_FILL,       true);
      ObjectSetInteger(0, rect, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, rect, OBJPROP_HIDDEN,     true);
   }

   string txt = StringFormat("%s OB #%d  H:%.5f  L:%.5f",
                             obList[idx].dir > 0 ? "Bull" : "Bear",
                             obList[idx].id, obList[idx].hi, obList[idx].lo);
   if(ObjectCreate(0, lbl, OBJ_TEXT, 0, obList[idx].obTime, obList[idx].hi))
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
//| Draw a Breaker zone rectangle + label                            |
//|                                                                  |
//| Zone starts at the original OB candle time, spans the same      |
//| price range as the failed OB.  Dashed border = breaker style.   |
//+------------------------------------------------------------------+
void BB_DrawZone(int idx)
{
   int s = bbList[idx].state;
   if(s == BREAKER_MITIGATED   && !InpShowMitigated)    return;
   if((s == BREAKER_INVALIDATED || s == BREAKER_EXPIRED)
      && InpRemoveInvalidated)                            return;

   color    clr  = BB_ZoneColor(idx);
   string   pfx  = "SMCBB_" + IntegerToString(bbList[idx].id);
   string   rect = pfx + "_zone";
   string   lbl  = pfx + "_lbl";
   datetime t2   = BB_RightEdge(idx);
   bool     dead = (s == BREAKER_INVALIDATED || s == BREAKER_EXPIRED);

   if(ObjectCreate(0, rect, OBJ_RECTANGLE, 0,
                   bbList[idx].zoneStart, bbList[idx].hi,
                   t2,                    bbList[idx].lo))
   {
      ObjectSetInteger(0, rect, OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, rect, OBJPROP_STYLE,      dead ? STYLE_DOT : STYLE_DASH);
      ObjectSetInteger(0, rect, OBJPROP_WIDTH,      1);
      ObjectSetInteger(0, rect, OBJPROP_BACK,       true);
      ObjectSetInteger(0, rect, OBJPROP_FILL,       true);
      ObjectSetInteger(0, rect, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, rect, OBJPROP_HIDDEN,     true);
   }

   string dirStr = bbList[idx].dir > 0 ? "Bull" : "Bear";
   string txt = StringFormat("%s BB #%d (OB #%d)  H:%.5f  L:%.5f",
                             dirStr, bbList[idx].id, bbList[idx].origObId,
                             bbList[idx].hi, bbList[idx].lo);
   if(ObjectCreate(0, lbl, OBJ_TEXT, 0, bbList[idx].zoneStart, bbList[idx].hi))
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
//| Update an original OB zone's chart objects after state change    |
//+------------------------------------------------------------------+
void OB_UpdateObjectState(int idx)
{
   if(!InpShowOriginalOb) return;
   string pfx  = "SMCBB_ob_" + IntegerToString(obList[idx].id);
   string rect = pfx + "_zone";
   string lbl  = pfx + "_lbl";
   int    s    = obList[idx].state;

   if(s == OB_INVALIDATED)
   {
      // OB became a Breaker — remove OB zone; BB zone draws at same location
      ObjectDelete(0, rect);
      ObjectDelete(0, lbl);
      return;
   }
   if(s == OB_EXPIRED)
   {
      if(InpRemoveInvalidated) { ObjectDelete(0, rect); ObjectDelete(0, lbl); }
      else
      {
         color faded = OB_ZoneColor(idx);
         ObjectSetInteger(0, rect, OBJPROP_TIME,  1, (long)obList[idx].invalidTime);
         ObjectSetInteger(0, rect, OBJPROP_COLOR,    faded);
         ObjectSetInteger(0, rect, OBJPROP_STYLE,    STYLE_DOT);
         ObjectSetInteger(0, lbl,  OBJPROP_COLOR,    faded);
      }
      return;
   }
   if(s == OB_MITIGATED)
   {
      color faded = OB_ZoneColor(idx);
      ObjectSetInteger(0, rect, OBJPROP_COLOR, faded);
      ObjectSetInteger(0, lbl,  OBJPROP_COLOR, faded);
   }
}

//+------------------------------------------------------------------+
//| Update a Breaker zone's chart objects after state change         |
//+------------------------------------------------------------------+
void BB_UpdateObjectState(int idx)
{
   string pfx  = "SMCBB_" + IntegerToString(bbList[idx].id);
   string rect = pfx + "_zone";
   string lbl  = pfx + "_lbl";
   int    s    = bbList[idx].state;

   if(s == BREAKER_INVALIDATED || s == BREAKER_EXPIRED)
   {
      if(InpRemoveInvalidated)
      {
         ObjectDelete(0, rect);
         ObjectDelete(0, lbl);
      }
      else
      {
         color faded = BB_ZoneColor(idx); // 10% opacity relic
         ObjectSetInteger(0, rect, OBJPROP_TIME,  1, (long)bbList[idx].invalidTime);
         ObjectSetInteger(0, rect, OBJPROP_COLOR,    faded);
         ObjectSetInteger(0, rect, OBJPROP_STYLE,    STYLE_DOT);
         ObjectSetInteger(0, lbl,  OBJPROP_COLOR,    faded);
      }
      return;
   }
   if(s == BREAKER_MITIGATED)
   {
      if(!InpShowMitigated)
      {
         ObjectDelete(0, rect);
         ObjectDelete(0, lbl);
      }
      else
      {
         color faded = BB_ZoneColor(idx); // InpBbMitOpacity
         ObjectSetInteger(0, rect, OBJPROP_COLOR, faded);
         ObjectSetInteger(0, lbl,  OBJPROP_COLOR, faded);
      }
   }
}

//+------------------------------------------------------------------+
//| Per-bar state machine for all zones.                             |
//|                                                                  |
//| Pass 1 — OBs:      expiry → mitigation → breaker check          |
//| Pass 2 — Breakers: expiry → mitigation → invalidation           |
//|                                                                  |
//| OB breaker check fires for both ACTIVE and MITIGATED OBs:       |
//| a touched OB that is then fully broken becomes a Breaker.       |
//+------------------------------------------------------------------+
void UpdateAllStates()
{
   double   hi       = iHigh (_Symbol, InpTF, 1);
   double   lo       = iLow  (_Symbol, InpTF, 1);
   double   cl       = iClose(_Symbol, InpTF, 1);
   datetime barTime  = iTime (_Symbol, InpTF, 1);
   datetime freezeAt = iTime (_Symbol, InpTF, 0);

   // ── Pass 1: OB lifecycle ─────────────────────────────────────────
   for(int i = 0; i < obTotal; i++)
   {
      int s = obList[i].state;
      if(s == OB_INVALIDATED || s == OB_EXPIRED) continue;

      // Expiry (no Breaker created for expired OBs)
      if(InpExpiryBars > 0)
      {
         int age = iBarShift(_Symbol, InpTF, obList[i].obTime, false);
         if(age >= InpExpiryBars)
         {
            obList[i].state       = OB_EXPIRED;
            obList[i].invalidTime = freezeAt;
            OB_UpdateObjectState(i);
            if(InpShowLog)
               PrintFormat("OB_EXPIRED | id=%d | %s | H=%.5f | L=%.5f | age=%d bars",
                           obList[i].id,
                           obList[i].dir > 0 ? "BULLISH" : "BEARISH",
                           obList[i].hi, obList[i].lo, age);
            continue;
         }
      }

      // Mitigation (ACTIVE → MITIGATED, does NOT prevent becoming a Breaker)
      if(OB_CheckMitigation(i, hi, lo))
      {
         OB_UpdateObjectState(i);
         if(InpShowLog)
            PrintFormat("OB_MITIGATED | id=%d | %s | H=%.5f | L=%.5f | bar=%s",
                        obList[i].id,
                        obList[i].dir > 0 ? "BULLISH" : "BEARISH",
                        obList[i].hi, obList[i].lo,
                        TimeToString(barTime, TIME_DATE|TIME_MINUTES));
      }

      // Breaker check (ACTIVE or MITIGATED → OB_INVALIDATED + BB_Create)
      if(OB_CheckBreaker(i, cl, freezeAt))
         OB_UpdateObjectState(i); // removes OB zone; BB queued for BB_DrawNew
   }

   // ── Pass 2: Breaker lifecycle ────────────────────────────────────
   for(int i = 0; i < bbTotal; i++)
   {
      int s = bbList[i].state;
      if(s == BREAKER_INVALIDATED || s == BREAKER_EXPIRED) continue;

      // Expiry
      if(InpExpiryBars > 0)
      {
         int age = iBarShift(_Symbol, InpTF, bbList[i].breakerTime, false);
         if(age >= InpExpiryBars)
         {
            bbList[i].state       = BREAKER_EXPIRED;
            bbList[i].invalidTime = freezeAt;
            BB_UpdateObjectState(i);
            if(InpShowLog)
               PrintFormat("BREAKER_EXPIRED | bb_id=%d | orig_ob_id=%d | %s | age=%d bars",
                           bbList[i].id, bbList[i].origObId,
                           bbList[i].dir > 0 ? "BULLISH" : "BEARISH", age);
            continue;
         }
      }

      // Mitigation
      if(BB_CheckMitigation(i, hi, lo))
      {
         BB_UpdateObjectState(i);
         if(InpShowLog)
            PrintFormat("BREAKER_MITIGATED | bb_id=%d | orig_ob_id=%d | %s | H=%.5f | L=%.5f | bar=%s",
                        bbList[i].id, bbList[i].origObId,
                        bbList[i].dir > 0 ? "BULLISH" : "BEARISH",
                        bbList[i].hi, bbList[i].lo,
                        TimeToString(barTime, TIME_DATE|TIME_MINUTES));
      }

      // Invalidation
      if(BB_CheckInvalidation(i, cl, freezeAt))
      {
         BB_UpdateObjectState(i);
         if(InpShowLog)
            PrintFormat("BREAKER_INVALIDATED | bb_id=%d | orig_ob_id=%d | %s | H=%.5f | L=%.5f | bar=%s",
                        bbList[i].id, bbList[i].origObId,
                        bbList[i].dir > 0 ? "BULLISH" : "BEARISH",
                        bbList[i].hi, bbList[i].lo,
                        TimeToString(barTime, TIME_DATE|TIME_MINUTES));
      }
   }
}

//+------------------------------------------------------------------+
//| Draw zones not yet drawn                                         |
//+------------------------------------------------------------------+
void OB_DrawNew()
{
   for(int i = obDrawn; i < obTotal; i++)
      OB_DrawZone(i);
   obDrawn = obTotal;
}

void BB_DrawNew()
{
   for(int i = bbDrawn; i < bbTotal; i++)
      BB_DrawZone(i);
   bbDrawn = bbTotal;
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
//| Remove all chart objects belonging to this indicator             |
//+------------------------------------------------------------------+
void DeleteAll()
{
   for(int i = ObjectsTotal(0) - 1; i >= 0; i--)
   {
      string nm = ObjectName(0, i);
      if(StringFind(nm, "SMCBB_") == 0) ObjectDelete(0, nm);
   }
}

//+------------------------------------------------------------------+
//| OnInit: detect OBs → historical lifecycle replay → draw          |
//+------------------------------------------------------------------+
int OnInit()
{
   int available = iBars(_Symbol, InpTF);
   if(available < InpAtrPeriod + 4)
   { Print("BB_Detector: not enough bars."); return INIT_FAILED; }

   int limit = MathMin(InpLookback, available - InpAtrPeriod - 3);

   // ── Step 1: Detect all OBs (oldest → newest) ─────────────────────
   for(int sh = limit; sh >= 1; sh--)
      OB_ScanBar(sh);

   // ── Step 2: Historical lifecycle replay ──────────────────────────
   // Walk every bar oldest→newest.  OB state transitions may spawn
   // Breaker records which are then immediately eligible for their own
   // lifecycle checks in subsequent iterations.
   for(int sh = limit; sh >= 1; sh--)
   {
      double   hi       = iHigh (_Symbol, InpTF, sh);
      double   lo       = iLow  (_Symbol, InpTF, sh);
      double   cl       = iClose(_Symbol, InpTF, sh);
      datetime barTime  = iTime (_Symbol, InpTF, sh);
      datetime freezeAt = iTime (_Symbol, InpTF, sh - 1);

      // OB pass
      for(int i = 0; i < obTotal; i++)
      {
         if(barTime <= obList[i].obTime) continue; // before OB candle
         int s = obList[i].state;
         if(s == OB_INVALIDATED || s == OB_EXPIRED) continue;

         // Expiry
         if(InpExpiryBars > 0)
         {
            int age = (int)((barTime - obList[i].obTime) / PeriodSeconds(InpTF));
            if(age >= InpExpiryBars)
            {
               obList[i].state       = OB_EXPIRED;
               obList[i].invalidTime = freezeAt;
               continue;
            }
         }

         OB_CheckMitigation(i, hi, lo);
         OB_CheckBreaker(i, cl, freezeAt); // may spawn a BreakerRecord
      }

      // Breaker pass — check breakers created so far (including this bar's new ones)
      for(int i = 0; i < bbTotal; i++)
      {
         if(bbList[i].state == BREAKER_INVALIDATED ||
            bbList[i].state == BREAKER_EXPIRED) continue;
         if(barTime <= bbList[i].breakerTime) continue; // before breaker was born

         // Expiry
         if(InpExpiryBars > 0)
         {
            int age = (int)((barTime - bbList[i].breakerTime) / PeriodSeconds(InpTF));
            if(age >= InpExpiryBars)
            {
               bbList[i].state       = BREAKER_EXPIRED;
               bbList[i].invalidTime = freezeAt;
               continue;
            }
         }

         BB_CheckMitigation(i, hi, lo);
         BB_CheckInvalidation(i, cl, freezeAt);
      }
   }

   // ── Step 3: Draw all zones with correct state-aware visuals ─────
   OB_DrawNew(); // original OB zones (only when InpShowOriginalOb = true)
   BB_DrawNew(); // Breaker zones

   // ── Step 4: Summary ───────────────────────────────────────────────
   int obAct=0, obMit=0, obInv=0, obExp=0;
   for(int i = 0; i < obTotal; i++)
   {
      switch(obList[i].state)
      {
         case OB_ACTIVE:      obAct++; break;
         case OB_MITIGATED:   obMit++; break;
         case OB_INVALIDATED: obInv++; break;
         default:             obExp++; break;
      }
   }
   int bbAct=0, bbMit=0, bbInv=0, bbExp=0;
   for(int i = 0; i < bbTotal; i++)
   {
      switch(bbList[i].state)
      {
         case BREAKER_ACTIVE:      bbAct++; break;
         case BREAKER_MITIGATED:   bbMit++; break;
         case BREAKER_INVALIDATED: bbInv++; break;
         default:                  bbExp++; break;
      }
   }
   PrintFormat("BB_Detector v1 ready | OB: total=%d active=%d mitigated=%d broken=%d expired=%d | BB: total=%d active=%d mitigated=%d invalidated=%d expired=%d | %s %s",
               obTotal, obAct, obMit, obInv, obExp,
               bbTotal, bbAct, bbMit, bbInv, bbExp,
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
//| Order: update states → draw new Breakers → scan new OBs → draw  |
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

   // 1. Advance all OB and Breaker states from the just-closed bar (shift=1)
   UpdateAllStates();

   // 2. Draw any Breakers created in step 1
   BB_DrawNew();

   // 3. Scan just-closed bar as a potential displacement → may detect new OB
   OB_ScanBar(1);

   // 4. Draw any new OB zones (visible only when InpShowOriginalOb = true)
   OB_DrawNew();

   return rates_total;
}
`;
}
