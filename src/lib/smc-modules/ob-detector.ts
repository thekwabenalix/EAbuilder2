/**
 * SMC Module Library — Phase 1: Order Block (OB) Detector
 *
 * OB Detector v1.0.0
 * ──────────────────────────────
 * An Order Block is the last candle of the OPPOSITE direction immediately
 * before a strong displacement move.  It marks the point where institutional
 * orders were placed, and the market is likely to return to that zone.
 *
 *   Bullish OB: last BEARISH candle before a bullish displacement
 *     → zone: High = OB candle high, Low = OB candle low
 *
 *   Bearish OB: last BULLISH candle before a bearish displacement
 *     → zone: High = OB candle high, Low = OB candle low
 *
 * DISPLACEMENT FILTER:
 *   Candle body ≥ InpDispMult × ATR(InpAtrPeriod)
 *   Default: body ≥ 1.5 × ATR(14)
 *   ATR computed as SMA of True Range (self-contained, no indicator handle).
 *
 * LIFECYCLE:
 *   ACTIVE      → zone untouched
 *   MITIGATED   → price entered zone (barLow ≤ obHigh / barHigh ≥ obLow)
 *   INVALIDATED → candle closed through the zone (close < obLow / close > obHigh)
 *   EXPIRED     → zone older than InpExpiryBars without being touched
 *
 * JOURNAL:
 *   OB_CREATED    | id | dir | H | L | ob_bar | disp_bar
 *   OB_MITIGATED  | id | dir | H | L | bar
 *   OB_INVALIDATED| id | dir | H | L | bar
 *   OB_EXPIRED    | id | dir | H | L | age_bars
 *
 * NO trading logic. Detection and visualisation only.
 */

export const OB_DETECTOR_VERSION = "1.0.0";
export const OB_DETECTOR_MODULE  = "OB_Detector";

/**
 * Returns the complete MQL5 source code for the Order Block Detector (v1.0).
 * Drop the output into MetaEditor, compile, and attach to any chart.
 */
export function generateObDetector(): string {
  return `//+------------------------------------------------------------------+
//| OB_Detector.mq5                                                  |
//| SMC Module Library v${OB_DETECTOR_VERSION} — Phase 1: Detection Only         |
//|                                                                  |
//| Detects Order Block (OB) zones.                                  |
//|                                                                  |
//| DEFINITION:                                                      |
//|   Bullish OB: last BEARISH candle before a bullish displacement  |
//|   Bearish OB: last BULLISH candle before a bearish displacement  |
//|   Displacement: candle body >= InpDispMult x ATR(InpAtrPeriod)  |
//|                                                                  |
//| OB ZONE:                                                         |
//|   High = order block candle high                                 |
//|   Low  = order block candle low                                  |
//|                                                                  |
//| LIFECYCLE:                                                       |
//|   ACTIVE -> MITIGATED -> INVALIDATED / EXPIRED                   |
//|   Bullish OB mitigation:   barLow  <= OB high (price in zone)   |
//|   Bullish OB invalidation: close   <  OB low                    |
//|   Bearish OB mitigation:   barHigh >= OB low  (price in zone)   |
//|   Bearish OB invalidation: close   >  OB high                   |
//|                                                                  |
//| JOURNAL OUTPUT:                                                  |
//|   OB_CREATED     | id | dir | H | L | ob_bar | disp_bar         |
//|   OB_MITIGATED   | id | dir | H | L | bar                       |
//|   OB_INVALIDATED | id | dir | H | L | bar                       |
//|   OB_EXPIRED     | id | dir | H | L | age_bars                  |
//|                                                                  |
//| NO trading logic. Detection and visualisation only.             |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SMC Module Library"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

//--- OB lifecycle states
#define OB_ACTIVE      0
#define OB_MITIGATED   1
#define OB_INVALIDATED 2
#define OB_EXPIRED     3

//--- Inputs — Detection
input ENUM_TIMEFRAMES InpTF         = PERIOD_CURRENT; // Timeframe to scan
input int             InpLookback   = 500;             // Historical bars to scan on load
input int             InpAtrPeriod  = 14;              // ATR period for displacement filter
input double          InpDispMult   = 1.5;             // Displacement: body >= N x ATR
input int             InpObScanBack = 5;               // Bars to look back from displacement for OB candle

//--- Inputs — Lifecycle
input int  InpExpiryBars        = 100;  // Expire OB after N bars (0 = never)
input bool InpShowMitigated     = true; // Show mitigated zones (faded)
input bool InpRemoveInvalidated = true; // Remove invalidated/expired zones (false = dotted relic)

//--- Inputs — Colours
input color InpBullObClr = clrRoyalBlue; // Bullish OB zone colour
input color InpBearObClr = clrCrimson;   // Bearish OB zone colour

//--- Inputs — Opacity
input int InpActiveOpacity = 70; // Active zone opacity 0-100
input int InpMitOpacity    = 25; // Mitigated zone opacity 0-100

//--- Inputs — Logging
input bool InpShowLog = true; // Print lifecycle events to journal

#define OB_MAX 300

//--- Order Block record
struct OBRecord
{
   int      id;
   int      dir;         // +1 bullish  -1 bearish
   int      state;       // OB_ACTIVE / OB_MITIGATED / OB_INVALIDATED / OB_EXPIRED
   datetime obTime;      // opening time of the OB candle (zone left edge)
   datetime dispTime;    // opening time of the displacement candle
   double   hi;          // OB candle high
   double   lo;          // OB candle low
   datetime invalidTime; // right-edge freeze when zone ends (0 = still live)
};

OBRecord obList[OB_MAX];
int      obTotal     = 0;
int      obDrawn     = 0;
int      nextObId    = 0;
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
//| Display colour for an OB zone based on its current state         |
//+------------------------------------------------------------------+
color OB_ZoneColor(int idx)
{
   color base = obList[idx].dir > 0 ? InpBullObClr : InpBearObClr;
   int   s    = obList[idx].state;
   if(s == OB_INVALIDATED || s == OB_EXPIRED) return BlendWithBg(base, 10);
   if(s == OB_MITIGATED)                      return BlendWithBg(base, InpMitOpacity);
   return BlendWithBg(base, InpActiveOpacity);
}

//+------------------------------------------------------------------+
//| Right edge for an OB zone rectangle                              |
//| Active / mitigated zones extend far right; ended zones freeze.  |
//+------------------------------------------------------------------+
datetime OB_RightEdge(int idx)
{
   if(obList[idx].invalidTime > 0) return obList[idx].invalidTime;
   return (datetime)(TimeCurrent() + (datetime)(5 * 365 * 86400));
}

//+------------------------------------------------------------------+
//| Duplicate check: same direction + same OB candle time            |
//+------------------------------------------------------------------+
bool OB_IsDuplicate(int dir, datetime obT)
{
   for(int i = 0; i < obTotal; i++)
      if(obList[i].dir == dir && obList[i].obTime == obT) return true;
   return false;
}

//+------------------------------------------------------------------+
//| Register a new Order Block                                       |
//+------------------------------------------------------------------+
void OB_Add(int dir, datetime obT, datetime dispT, double hi, double lo)
{
   if(obTotal >= OB_MAX) { if(InpShowLog) Print("OB_Detector: OB limit reached"); return; }
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
//| ATR (SMA of True Range) at bar shift over InpAtrPeriod bars.    |
//| Self-contained — no indicator handle needed.                    |
//| Returns 0 if not enough history is available.                   |
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
//|                                                                  |
//| If displacement confirmed (body >= InpDispMult x ATR), look     |
//| back up to InpObScanBack bars for the last opposing candle.      |
//| That opposing candle is the Order Block.                         |
//|                                                                  |
//| Bullish displacement → last BEARISH candle before it = Bull OB  |
//| Bearish displacement → last BULLISH candle before it = Bear OB  |
//+------------------------------------------------------------------+
void OB_ScanBar(int dispShift)
{
   if(dispShift < 1) return;

   double atr = CalcATR(dispShift, InpAtrPeriod);
   if(atr <= 0.0) return;

   double dispOpn  = iOpen (_Symbol, InpTF, dispShift);
   double dispCls  = iClose(_Symbol, InpTF, dispShift);
   double dispBody = MathAbs(dispCls - dispOpn);

   if(dispBody < InpDispMult * atr) return; // not a displacement candle

   int dispDir = (dispCls > dispOpn) ? +1 : -1;

   // Scan backwards from the bar immediately before the displacement
   int available = iBars(_Symbol, InpTF);
   int scanEnd   = dispShift + InpObScanBack;
   if(scanEnd >= available - 1) scanEnd = available - 2;

   for(int j = dispShift + 1; j <= scanEnd; j++)
   {
      double jOpn = iOpen (_Symbol, InpTF, j);
      double jCls = iClose(_Symbol, InpTF, j);

      // Bullish displacement → look for last bearish candle (close < open)
      if(dispDir == +1 && jCls < jOpn)
      {
         OB_Add(+1,
                iTime(_Symbol, InpTF, j),         // OB candle time
                iTime(_Symbol, InpTF, dispShift),  // displacement candle time
                iHigh(_Symbol, InpTF, j),
                iLow (_Symbol, InpTF, j));
         break; // last bearish candle found — stop
      }
      // Bearish displacement → look for last bullish candle (close > open)
      if(dispDir == -1 && jCls > jOpn)
      {
         OB_Add(-1,
                iTime(_Symbol, InpTF, j),
                iTime(_Symbol, InpTF, dispShift),
                iHigh(_Symbol, InpTF, j),
                iLow (_Symbol, InpTF, j));
         break; // last bullish candle found — stop
      }
   }
}

//+------------------------------------------------------------------+
//| Mitigation: price re-enters the OB zone                          |
//| Bullish OB: barLow  <= obHigh (retracement down into zone)      |
//| Bearish OB: barHigh >= obLow  (retracement up   into zone)      |
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
//| Invalidation: candle closes through the OB zone                  |
//| Bullish OB: close < OB low   (zone fully violated from below)   |
//| Bearish OB: close > OB high  (zone fully violated from above)   |
//+------------------------------------------------------------------+
bool OB_CheckInvalidation(int idx, double barClose, datetime freezeAt)
{
   int s = obList[idx].state;
   if(s == OB_INVALIDATED || s == OB_EXPIRED) return false;
   bool hit = (obList[idx].dir == +1)
              ? (barClose < obList[idx].lo)
              : (barClose > obList[idx].hi);
   if(hit)
   {
      obList[idx].state       = OB_INVALIDATED;
      obList[idx].invalidTime = freezeAt;
   }
   return hit;
}

//+------------------------------------------------------------------+
//| Draw one OB zone rectangle + label                               |
//+------------------------------------------------------------------+
void OB_DrawZone(int idx)
{
   int s = obList[idx].state;
   if(s == OB_MITIGATED   && !InpShowMitigated)    return;
   if((s == OB_INVALIDATED || s == OB_EXPIRED)
      && InpRemoveInvalidated)                       return;

   color    clr  = OB_ZoneColor(idx);
   string   pfx  = "SMCOB_" + IntegerToString(obList[idx].id);
   string   rect = pfx + "_zone";
   string   lbl  = pfx + "_lbl";
   datetime t2   = OB_RightEdge(idx);
   bool     dead = (s == OB_INVALIDATED || s == OB_EXPIRED);

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
//| Update an OB zone's chart objects after a state change (live)    |
//+------------------------------------------------------------------+
void OB_UpdateObjectState(int idx)
{
   string pfx  = "SMCOB_" + IntegerToString(obList[idx].id);
   string rect = pfx + "_zone";
   string lbl  = pfx + "_lbl";
   int    s    = obList[idx].state;

   if(s == OB_INVALIDATED || s == OB_EXPIRED)
   {
      if(InpRemoveInvalidated)
      {
         ObjectDelete(0, rect);
         ObjectDelete(0, lbl);
      }
      else
      {
         // Freeze right edge + fade to dotted relic
         color faded = OB_ZoneColor(idx); // 10% opacity
         ObjectSetInteger(0, rect, OBJPROP_TIME,  1, (long)obList[idx].invalidTime);
         ObjectSetInteger(0, rect, OBJPROP_COLOR,    faded);
         ObjectSetInteger(0, rect, OBJPROP_STYLE,    STYLE_DOT);
         ObjectSetInteger(0, lbl,  OBJPROP_COLOR,    faded);
      }
      return;
   }

   if(s == OB_MITIGATED)
   {
      if(!InpShowMitigated)
      {
         ObjectDelete(0, rect);
         ObjectDelete(0, lbl);
      }
      else
      {
         color faded = OB_ZoneColor(idx); // InpMitOpacity
         ObjectSetInteger(0, rect, OBJPROP_COLOR, faded);
         ObjectSetInteger(0, lbl,  OBJPROP_COLOR, faded);
      }
   }
}

//+------------------------------------------------------------------+
//| Per-bar state machine: expiry → mitigation → invalidation        |
//+------------------------------------------------------------------+
void OB_UpdateAllStates()
{
   double   hi       = iHigh (_Symbol, InpTF, 1);
   double   lo       = iLow  (_Symbol, InpTF, 1);
   double   cl       = iClose(_Symbol, InpTF, 1);
   datetime barTime  = iTime (_Symbol, InpTF, 1);
   datetime freezeAt = iTime (_Symbol, InpTF, 0); // current bar open = right-edge freeze

   for(int i = 0; i < obTotal; i++)
   {
      int s = obList[i].state;
      if(s == OB_INVALIDATED || s == OB_EXPIRED) continue;

      // ── Expiry ────────────────────────────────────────────────────
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

      // ── Mitigation ────────────────────────────────────────────────
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

      // ── Invalidation ──────────────────────────────────────────────
      if(OB_CheckInvalidation(i, cl, freezeAt))
      {
         OB_UpdateObjectState(i);
         if(InpShowLog)
            PrintFormat("OB_INVALIDATED | id=%d | %s | H=%.5f | L=%.5f | bar=%s",
                        obList[i].id,
                        obList[i].dir > 0 ? "BULLISH" : "BEARISH",
                        obList[i].hi, obList[i].lo,
                        TimeToString(barTime, TIME_DATE|TIME_MINUTES));
      }
   }
}

//+------------------------------------------------------------------+
//| Draw OB zones not yet drawn                                      |
//+------------------------------------------------------------------+
void OB_DrawNew()
{
   for(int i = obDrawn; i < obTotal; i++)
      OB_DrawZone(i);
   obDrawn = obTotal;
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
      if(StringFind(nm, "SMCOB_") == 0) ObjectDelete(0, nm);
   }
}

//+------------------------------------------------------------------+
//| OnInit: detect → historical lifecycle replay → draw              |
//+------------------------------------------------------------------+
int OnInit()
{
   int available = iBars(_Symbol, InpTF);
   if(available < InpAtrPeriod + 4)
   { Print("OB_Detector: not enough bars."); return INIT_FAILED; }

   // Oldest bar we can scan (ATR needs InpAtrPeriod bars of look-ahead beyond the candle)
   int limit = MathMin(InpLookback, available - InpAtrPeriod - 3);

   // ── Step 1: Detect all OBs from oldest bar to newest ─────────────
   for(int sh = limit; sh >= 1; sh--)
      OB_ScanBar(sh);

   // ── Step 2: Historical lifecycle replay ──────────────────────────
   // Walk every bar oldest→newest and advance each OB through its
   // state machine so zones are already MITIGATED / INVALIDATED /
   // EXPIRED when the indicator first draws on the chart.
   for(int sh = limit; sh >= 1; sh--)
   {
      double   hi       = iHigh (_Symbol, InpTF, sh);
      double   lo       = iLow  (_Symbol, InpTF, sh);
      double   cl       = iClose(_Symbol, InpTF, sh);
      datetime barTime  = iTime (_Symbol, InpTF, sh);
      datetime freezeAt = iTime (_Symbol, InpTF, sh - 1);

      for(int i = 0; i < obTotal; i++)
      {
         // Skip bars at or before the OB candle itself (zone didn't exist yet)
         if(barTime <= obList[i].obTime) continue;

         int s = obList[i].state;
         if(s == OB_INVALIDATED || s == OB_EXPIRED) continue;

         // Expiry (time-division approximation avoids O(n²) iBarShift calls)
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
         OB_CheckInvalidation(i, cl, freezeAt);
      }
   }

   // ── Step 3: Draw all zones with correct state-aware visuals ─────
   OB_DrawNew();

   // ── Step 4: Summary ───────────────────────────────────────────────
   int nActive=0, nMit=0, nInv=0, nExp=0;
   for(int i = 0; i < obTotal; i++)
   {
      switch(obList[i].state)
      {
         case OB_ACTIVE:      nActive++; break;
         case OB_MITIGATED:   nMit++;    break;
         case OB_INVALIDATED: nInv++;    break;
         default:             nExp++;    break;
      }
   }
   PrintFormat("OB_Detector v1 ready | total=%d active=%d mitigated=%d invalidated=%d expired=%d | %s %s",
               obTotal, nActive, nMit, nInv, nExp,
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
//| Order: update states → scan for new OB → draw                   |
//+------------------------------------------------------------------+
int OnCalculate(const int rates_total, const int prev_calculated,
                const datetime &time[], const double &open[],
                const double &high[], const double &low[],
                const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
{
   // Process only on first tick of a new bar
   datetime currentBar = iTime(_Symbol, InpTF, 0);
   if(currentBar == lastBarTime) return rates_total;
   lastBarTime = currentBar;

   // 1. Advance lifecycle for all existing OBs using bar 1 (just closed)
   OB_UpdateAllStates();

   // 2. Check bar 1 as a potential displacement → may create a new OB
   OB_ScanBar(1);

   // 3. Draw any newly detected OBs
   OB_DrawNew();

   return rates_total;
}
`;
}
