/**
 * SMC Module Library — Phase 1: FVG Inversion (IFVG) Detector
 *
 * FVG Inversion Detector v2.0.0
 * ──────────────────────────────
 * An Inversion FVG (IFVG) is a Fair Value Gap that has been fully traded
 * through.  The zone does NOT disappear — it flips polarity.
 * What was bullish support becomes bearish resistance and vice versa.
 *
 *   Bullish FVG (UL = C3.Low, LL = C1.High)
 *     → becomes BEARISH IFVG when a candle CLOSES BELOW LL
 *
 *   Bearish FVG (UL = C1.Low, LL = C3.High)
 *     → becomes BULLISH IFVG when a candle CLOSES ABOVE UL
 *
 * The IFVG zone:
 *   • Occupies the EXACT same price range (UL / LL) as the original FVG
 *   • Left edge = original FVG's C1 time (the zone was always at this price level)
 *   • Right edge extends to the right until the IFVG itself is broken
 *   • Drawn with a DASHED border and distinct colour to separate from regular FVGs
 *
 * By default the original FVG zones are hidden (InpShowOriginalFvg = false)
 * so the chart shows ONLY IFVG zones — this module is a dedicated IFVG detector,
 * not a duplicate of the FVG Detector module.
 *
 * FVG STATES:
 *   FVG_ACTIVE      (0) → zone untouched
 *   FVG_MITIGATED   (1) → price entered zone
 *   FVG_INVERTED    (2) → price closed through → IFVG zone created
 *   FVG_INVALIDATED (3) → zone expired before inversion (no IFVG created)
 *
 * IFVG STATES:
 *   INV_ACTIVE      (0) → IFVG zone live
 *   INV_INVALIDATED (1) → price closed back through IFVG → zone frozen
 *
 * JOURNAL:
 *   FVG_CREATED           | id | dir | UL | LL | C1 | C3
 *   FVG_MITIGATED         | id | dir | UL | LL | bar
 *   FVG_INVERSION_CREATED | orig_id | new_dir | UL | LL | bar
 *   FVG_EXPIRED           | id | dir | UL | LL | age_bars
 *   INV_INVALIDATED       | inv_id | orig_id | dir | UL | LL | bar
 *
 * NO trading logic. Detection and visualisation only.
 */

export const FVG_INVERSION_DETECTOR_VERSION = "2.0.0";
export const FVG_INVERSION_DETECTOR_MODULE  = "FVG_Inversion_Detector";

/**
 * Returns the complete MQL5 source code for the FVG Inversion Detector (v2).
 * Drop the output into MetaEditor, compile, and attach to any chart.
 */
export function generateFvgInversionDetector(): string {
  return `//+------------------------------------------------------------------+
//| FVG_Inversion_Detector.mq5                                      |
//| SMC Module Library v${FVG_INVERSION_DETECTOR_VERSION} — Phase 1: Detection Only        |
//|                                                                  |
//| Detects Inversion FVGs (IFVGs).                                 |
//|                                                                  |
//| An IFVG is an FVG that was fully traded through.                |
//| The zone flips polarity — same UL/LL, opposite direction.       |
//|                                                                  |
//| INVERSION RULES:                                                 |
//|   Bullish FVG → BEARISH IFVG when:  Close < LL                  |
//|   Bearish FVG → BULLISH IFVG when:  Close > UL                  |
//|                                                                  |
//| IFVG zone:                                                       |
//|   Left edge  = original FVG C1 time (same zone, flipped)        |
//|   Right edge = extends until IFVG is itself broken              |
//|   Price      = same UL / LL as original FVG                     |
//|   Style      = dashed border, distinct colour                   |
//|                                                                  |
//| JOURNAL OUTPUT:                                                  |
//|   FVG_CREATED           | id | dir | UL | LL | C1 | C3          |
//|   FVG_MITIGATED         | id | dir | UL | LL | bar              |
//|   FVG_INVERSION_CREATED | orig_id | new_dir | UL | LL | bar     |
//|   FVG_EXPIRED           | id | dir | UL | LL | age_bars         |
//|   INV_INVALIDATED       | inv_id | orig_id | dir | UL | LL | bar|
//|                                                                  |
//| NO trading logic. Detection and visualisation only.             |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SMC Module Library"
#property version   "2.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

//--- Original FVG states
#define FVG_ACTIVE      0   // zone untouched
#define FVG_MITIGATED   1   // price entered zone
#define FVG_INVERTED    2   // price closed through → IFVG created
#define FVG_INVALIDATED 3   // zone expired, no IFVG created

//--- IFVG states
#define INV_ACTIVE      0
#define INV_INVALIDATED 1

//--- FVG mitigation mode
enum ENUM_MIT_MODE
{
   MIT_TOUCH_EDGE     = 0, // Price touches near edge of zone (default)
   MIT_TOUCH_MIDPOINT = 1, // Price reaches zone midpoint
};

//--- Inputs — Detection
input ENUM_TIMEFRAMES InpTF       = PERIOD_CURRENT; // Timeframe to scan
input int             InpLookback = 500;             // Historical bars to scan on load

//--- Inputs — IFVG colours
input color InpBullIfvgClr = clrMediumSeaGreen; // Bullish IFVG colour (was bearish FVG)
input color InpBearIfvgClr = clrCrimson;         // Bearish IFVG colour (was bullish FVG)

//--- Inputs — Original FVG colours (used only when InpShowOriginalFvg = true)
input color InpBullFvgClr = clrDodgerBlue; // Bullish FVG colour
input color InpBearFvgClr = clrOrangeRed;  // Bearish FVG colour

//--- Inputs — Lifecycle
input ENUM_MIT_MODE InpMitMode    = MIT_TOUCH_EDGE; // FVG mitigation trigger
input int           InpExpiryBars = 50;              // Expire FVG after N bars (0 = off)

//--- Inputs — Visualization
input int  InpIfvgOpacity      = 70;    // IFVG zone opacity 0-100
input int  InpFvgOpacity       = 50;    // Original FVG opacity (when visible)
input int  InpMitOpacity       = 20;    // Mitigated FVG opacity (when visible)
input bool InpShowOriginalFvg  = false; // Show original FVG zones (false = IFVG-only view)

//--- Inputs — Logging
input bool InpShowLog = true; // Print lifecycle events to journal

//--- Storage limits
#define FVG_MAX 500
#define INV_MAX 500

//--- Original FVG record
struct FVGRecord
{
   int      id;
   int      dir;          // +1 bullish  -1 bearish
   int      state;        // FVG_ACTIVE / MITIGATED / INVERTED / INVALIDATED
   datetime c1Time;       // left edge of original zone
   datetime c3Time;
   double   ul;
   double   ll;
   datetime invalidTime;  // right-edge freeze (0 = still live)
};

//--- IFVG (Inversion FVG) record
struct InvRecord
{
   int      id;
   int      origFvgId;    // ID of the original FVG (for logging)
   int      dir;          // FLIPPED: orig bullish → dir=-1, orig bearish → dir=+1
   int      state;        // INV_ACTIVE / INV_INVALIDATED
   datetime zoneStart;    // left edge = original FVG c1Time (same zone, flipped)
   double   ul;           // same price boundaries as original FVG
   double   ll;
   datetime invalidTime;  // right-edge freeze (0 = still live)
};

FVGRecord fvgList[FVG_MAX];
InvRecord invList[INV_MAX];
int       fvgTotal    = 0;
int       invTotal    = 0;
int       fvgDrawn    = 0;
int       invDrawn    = 0;
int       nextFvgId   = 0;
int       nextInvId   = 0;
datetime  lastBarTime = 0;

//+------------------------------------------------------------------+
//| Blend colour toward chart background (theme-aware opacity)       |
//| opacityPct 100 = full colour,  0 = invisible                    |
//| MQL5 color layout: 0x00BBGGRR  (R=byte0 G=byte1 B=byte2)       |
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
//| Display colour for an original FVG zone                          |
//+------------------------------------------------------------------+
color FVG_ZoneColor(int idx)
{
   color base = fvgList[idx].dir > 0 ? InpBullFvgClr : InpBearFvgClr;
   int   s    = fvgList[idx].state;
   if(s == FVG_INVERTED || s == FVG_INVALIDATED) return BlendWithBg(base, 8);
   if(s == FVG_MITIGATED)                        return BlendWithBg(base, InpMitOpacity);
   return BlendWithBg(base, InpFvgOpacity);
}

//+------------------------------------------------------------------+
//| Display colour for an IFVG zone                                  |
//+------------------------------------------------------------------+
color INV_ZoneColor(int idx)
{
   color base = invList[idx].dir > 0 ? InpBullIfvgClr : InpBearIfvgClr;
   if(invList[idx].state == INV_INVALIDATED) return BlendWithBg(base, 10);
   return BlendWithBg(base, InpIfvgOpacity);
}

//+------------------------------------------------------------------+
//| Right-edge time for an original FVG zone                         |
//+------------------------------------------------------------------+
datetime FVG_RightEdge(int idx)
{
   if(fvgList[idx].invalidTime > 0) return fvgList[idx].invalidTime;
   return (datetime)(TimeCurrent() + (datetime)(5 * 365 * 86400));
}

//+------------------------------------------------------------------+
//| Right-edge time for an IFVG zone                                 |
//+------------------------------------------------------------------+
datetime INV_RightEdge(int idx)
{
   if(invList[idx].invalidTime > 0) return invList[idx].invalidTime;
   return (datetime)(TimeCurrent() + (datetime)(5 * 365 * 86400));
}

//+------------------------------------------------------------------+
//| Prevent duplicate FVG registration                               |
//+------------------------------------------------------------------+
bool FVG_IsDuplicate(int dir, double ul, double ll)
{
   double pt = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   for(int i = 0; i < fvgTotal; i++)
   {
      if(fvgList[i].dir != dir) continue;
      if(MathAbs(fvgList[i].ul - ul) < 5.0 * pt &&
         MathAbs(fvgList[i].ll - ll) < 5.0 * pt) return true;
   }
   return false;
}

//+------------------------------------------------------------------+
//| Register a new FVG zone                                          |
//+------------------------------------------------------------------+
void FVG_Add(int dir, datetime c1T, datetime c3T, double ul, double ll)
{
   if(fvgTotal >= FVG_MAX) { if(InpShowLog) Print("IFVG_Detector: FVG limit reached"); return; }
   if(FVG_IsDuplicate(dir, ul, ll)) return;

   int idx              = fvgTotal++;
   fvgList[idx].id          = nextFvgId++;
   fvgList[idx].dir         = dir;
   fvgList[idx].state       = FVG_ACTIVE;
   fvgList[idx].c1Time      = c1T;
   fvgList[idx].c3Time      = c3T;
   fvgList[idx].ul          = ul;
   fvgList[idx].ll          = ll;
   fvgList[idx].invalidTime = 0;

   if(InpShowLog)
      PrintFormat("FVG_CREATED | id=%d | %s | UL=%.5f | LL=%.5f | C1=%s | C3=%s",
                  fvgList[idx].id, dir > 0 ? "BULLISH" : "BEARISH", ul, ll,
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
   if(c3Lo > c1Hi) FVG_Add(+1, c1T, c3T, c3Lo, c1Hi); // Bullish FVG
   if(c3Hi < c1Lo) FVG_Add(-1, c1T, c3T, c1Lo, c3Hi); // Bearish FVG
}

//+------------------------------------------------------------------+
//| Check price entry into zone: FVG_ACTIVE → FVG_MITIGATED          |
//+------------------------------------------------------------------+
bool FVG_CheckMitigation(int idx, double barHigh, double barLow)
{
   if(fvgList[idx].state != FVG_ACTIVE) return false;
   double ul = fvgList[idx].ul, ll = fvgList[idx].ll;
   double mid = (ul + ll) * 0.5;
   bool hit;
   if(fvgList[idx].dir == +1) // Bullish FVG: price retraces DOWN into gap
   {
      double t = (InpMitMode == MIT_TOUCH_EDGE) ? ul : mid;
      hit = (barLow <= t);
   }
   else // Bearish FVG: price retraces UP into gap
   {
      double t = (InpMitMode == MIT_TOUCH_EDGE) ? ll : mid;
      hit = (barHigh >= t);
   }
   if(hit) fvgList[idx].state = FVG_MITIGATED;
   return hit;
}

//+------------------------------------------------------------------+
//| Create an IFVG zone from an inverted FVG.                        |
//|                                                                  |
//| KEY: zoneStart = original FVG c1Time                            |
//| The IFVG occupies the SAME zone the original FVG occupied,       |
//| just with flipped polarity.  Same UL/LL, same left edge.        |
//+------------------------------------------------------------------+
void INV_Create(int fvgIdx, datetime inversionBar)
{
   if(invTotal >= INV_MAX) { if(InpShowLog) Print("IFVG_Detector: IFVG limit reached"); return; }

   int newDir = -fvgList[fvgIdx].dir; // flip: bullish → bearish, bearish → bullish

   int i               = invTotal++;
   invList[i].id           = nextInvId++;
   invList[i].origFvgId    = fvgList[fvgIdx].id;
   invList[i].dir          = newDir;
   invList[i].state        = INV_ACTIVE;
   invList[i].zoneStart    = fvgList[fvgIdx].c1Time; // ← same left edge as original FVG
   invList[i].ul           = fvgList[fvgIdx].ul;     // ← same price boundaries
   invList[i].ll           = fvgList[fvgIdx].ll;
   invList[i].invalidTime  = 0;

   if(InpShowLog)
      PrintFormat("FVG_INVERSION_CREATED | orig_id=%d | new_dir=%s | UL=%.5f | LL=%.5f | bar=%s",
                  fvgList[fvgIdx].id,
                  newDir > 0 ? "BULLISH" : "BEARISH",
                  invList[i].ul, invList[i].ll,
                  TimeToString(inversionBar, TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
//| Check close through zone: triggers inversion.                    |
//| Valid for ACTIVE and MITIGATED zones.                            |
//+------------------------------------------------------------------+
bool FVG_CheckInversion(int idx, double barClose, datetime inversionBar)
{
   int s = fvgList[idx].state;
   if(s == FVG_INVERTED || s == FVG_INVALIDATED) return false;

   bool hit;
   if(fvgList[idx].dir == +1) // Bullish FVG: inverted when Close < LL
      hit = (barClose < fvgList[idx].ll);
   else                        // Bearish FVG: inverted when Close > UL
      hit = (barClose > fvgList[idx].ul);

   if(hit)
   {
      fvgList[idx].state       = FVG_INVERTED;
      fvgList[idx].invalidTime = inversionBar; // freeze original zone at inversion bar
      INV_Create(idx, inversionBar);
   }
   return hit;
}

//+------------------------------------------------------------------+
//| Check whether an IFVG zone has been broken (closed back through).|
//+------------------------------------------------------------------+
bool INV_CheckInvalidation(int idx, double barClose, datetime freezeAt)
{
   if(invList[idx].state == INV_INVALIDATED) return false;

   bool hit;
   if(invList[idx].dir == +1) // Bullish IFVG: invalidated when Close < LL
      hit = (barClose < invList[idx].ll);
   else                        // Bearish IFVG: invalidated when Close > UL
      hit = (barClose > invList[idx].ul);

   if(hit)
   {
      invList[idx].state       = INV_INVALIDATED;
      invList[idx].invalidTime = freezeAt;
   }
   return hit;
}

//+------------------------------------------------------------------+
//| Draw an original FVG zone (only when InpShowOriginalFvg = true)  |
//+------------------------------------------------------------------+
void FVG_DrawZone(int idx)
{
   if(!InpShowOriginalFvg) return; // hidden in default IFVG-only mode

   int state = fvgList[idx].state;
   // When inverted, the IFVG zone covers the same area — skip original
   if(state == FVG_INVERTED || state == FVG_INVALIDATED) return;

   color    clr  = FVG_ZoneColor(idx);
   string   pfx  = "SMCFVG_" + IntegerToString(fvgList[idx].id);
   string   rect = pfx + "_zone";
   string   lbl  = pfx + "_lbl";
   datetime t2   = FVG_RightEdge(idx);

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

   string txt = StringFormat("%s FVG #%d  UL:%.5f  LL:%.5f",
                             fvgList[idx].dir > 0 ? "Bull" : "Bear",
                             fvgList[idx].id, fvgList[idx].ul, fvgList[idx].ll);
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
//| Draw an IFVG zone rectangle + label                              |
//|                                                                  |
//| The IFVG zone starts at the original FVG's C1 time and extends  |
//| to the right — it IS the original zone, now with opposite        |
//| polarity.  Dashed border distinguishes it from regular FVGs.    |
//+------------------------------------------------------------------+
void INV_DrawZone(int idx)
{
   color    clr  = INV_ZoneColor(idx);
   string   pfx  = "SMCIFVG_" + IntegerToString(invList[idx].id);
   string   rect = pfx + "_zone";
   string   lbl  = pfx + "_lbl";
   datetime t1   = invList[idx].zoneStart; // = original FVG c1Time
   datetime t2   = INV_RightEdge(idx);
   bool     dead = (invList[idx].state == INV_INVALIDATED);

   if(ObjectCreate(0, rect, OBJ_RECTANGLE, 0,
                   t1, invList[idx].ul,
                   t2, invList[idx].ll))
   {
      ObjectSetInteger(0, rect, OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, rect, OBJPROP_STYLE,      dead ? STYLE_DOT : STYLE_DASH);
      ObjectSetInteger(0, rect, OBJPROP_WIDTH,      1);
      ObjectSetInteger(0, rect, OBJPROP_BACK,       true);
      ObjectSetInteger(0, rect, OBJPROP_FILL,       true);
      ObjectSetInteger(0, rect, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, rect, OBJPROP_HIDDEN,     true);
   }

   string dirStr = invList[idx].dir > 0 ? "Bull" : "Bear";
   string txt = StringFormat("%s IFVG #%d (was FVG #%d)  UL:%.5f  LL:%.5f",
                             dirStr, invList[idx].id, invList[idx].origFvgId,
                             invList[idx].ul, invList[idx].ll);
   if(ObjectCreate(0, lbl, OBJ_TEXT, 0, t1, invList[idx].ul))
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
//| Update an original FVG's chart objects on state change (live)    |
//+------------------------------------------------------------------+
void FVG_UpdateObjectState(int idx)
{
   if(!InpShowOriginalFvg) return; // nothing to update — zone was never drawn
   string pfx  = "SMCFVG_" + IntegerToString(fvgList[idx].id);
   string rect = pfx + "_zone";
   string lbl  = pfx + "_lbl";
   int    s    = fvgList[idx].state;

   if(s == FVG_INVERTED || s == FVG_INVALIDATED)
   {
      // Remove original zone — the IFVG zone now covers the same area
      ObjectDelete(0, rect);
      ObjectDelete(0, lbl);
      return;
   }
   if(s == FVG_MITIGATED)
   {
      color faded = FVG_ZoneColor(idx);
      ObjectSetInteger(0, rect, OBJPROP_COLOR, faded);
      ObjectSetInteger(0, lbl,  OBJPROP_COLOR, faded);
   }
}

//+------------------------------------------------------------------+
//| Update an IFVG zone's chart objects on state change (live)       |
//+------------------------------------------------------------------+
void INV_UpdateObjectState(int idx)
{
   string pfx  = "SMCIFVG_" + IntegerToString(invList[idx].id);
   string rect = pfx + "_zone";
   string lbl  = pfx + "_lbl";

   if(invList[idx].state == INV_INVALIDATED)
   {
      color faded = INV_ZoneColor(idx); // 10% — barely visible relic
      ObjectSetInteger(0, rect, OBJPROP_TIME,  1, (long)invList[idx].invalidTime);
      ObjectSetInteger(0, rect, OBJPROP_COLOR,    faded);
      ObjectSetInteger(0, rect, OBJPROP_STYLE,    STYLE_DOT);
      ObjectSetInteger(0, lbl,  OBJPROP_COLOR,    faded);
   }
}

//+------------------------------------------------------------------+
//| Update all zone states on each new bar                           |
//| Order: expiry → mitigation → inversion → IFVG invalidation       |
//+------------------------------------------------------------------+
void UpdateAllStates()
{
   double   hi       = iHigh (_Symbol, InpTF, 1);
   double   lo       = iLow  (_Symbol, InpTF, 1);
   double   cl       = iClose(_Symbol, InpTF, 1);
   datetime barTime  = iTime (_Symbol, InpTF, 1);
   datetime freezeAt = iTime (_Symbol, InpTF, 0);

   // ── Pass 1: Original FVG zones ──────────────────────────────────
   for(int i = 0; i < fvgTotal; i++)
   {
      int s = fvgList[i].state;
      if(s == FVG_INVERTED || s == FVG_INVALIDATED) continue;

      // Step 1: Expiry (no IFVG created for expired zones)
      if(InpExpiryBars > 0)
      {
         int age = iBarShift(_Symbol, InpTF, fvgList[i].c3Time, false);
         if(age >= InpExpiryBars)
         {
            fvgList[i].state       = FVG_INVALIDATED;
            fvgList[i].invalidTime = freezeAt;
            FVG_UpdateObjectState(i);
            if(InpShowLog)
               PrintFormat("FVG_EXPIRED | id=%d | %s | UL=%.5f | LL=%.5f | age=%d bars",
                           fvgList[i].id, fvgList[i].dir > 0 ? "BULLISH" : "BEARISH",
                           fvgList[i].ul, fvgList[i].ll, age);
            continue;
         }
      }

      // Step 2: Mitigation
      if(FVG_CheckMitigation(i, hi, lo))
      {
         FVG_UpdateObjectState(i);
         if(InpShowLog)
            PrintFormat("FVG_MITIGATED | id=%d | %s | UL=%.5f | LL=%.5f | bar=%s",
                        fvgList[i].id, fvgList[i].dir > 0 ? "BULLISH" : "BEARISH",
                        fvgList[i].ul, fvgList[i].ll,
                        TimeToString(barTime, TIME_DATE|TIME_MINUTES));
      }

      // Step 3: Inversion check (fires on same bar as mitigation if price blows through)
      if(FVG_CheckInversion(i, cl, freezeAt))
         FVG_UpdateObjectState(i); // removes original zone; IFVG queued for INV_DrawNew
   }

   // ── Pass 2: IFVG zone invalidation ──────────────────────────────
   for(int i = 0; i < invTotal; i++)
   {
      if(invList[i].state == INV_INVALIDATED) continue;
      if(INV_CheckInvalidation(i, cl, freezeAt))
      {
         INV_UpdateObjectState(i);
         if(InpShowLog)
            PrintFormat("INV_INVALIDATED | inv_id=%d | orig_id=%d | %s | UL=%.5f | LL=%.5f | bar=%s",
                        invList[i].id, invList[i].origFvgId,
                        invList[i].dir > 0 ? "BULLISH" : "BEARISH",
                        invList[i].ul, invList[i].ll,
                        TimeToString(barTime, TIME_DATE|TIME_MINUTES));
      }
   }
}

//+------------------------------------------------------------------+
//| Draw FVG zones not yet drawn                                     |
//+------------------------------------------------------------------+
void FVG_DrawNew()
{
   for(int i = fvgDrawn; i < fvgTotal; i++)
      FVG_DrawZone(i);
   fvgDrawn = fvgTotal;
}

//+------------------------------------------------------------------+
//| Draw IFVG zones not yet drawn                                    |
//+------------------------------------------------------------------+
void INV_DrawNew()
{
   for(int i = invDrawn; i < invTotal; i++)
      INV_DrawZone(i);
   invDrawn = invTotal;
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
      if(StringFind(nm, "SMCFVG_")  == 0 ||
         StringFind(nm, "SMCIFVG_") == 0) ObjectDelete(0, nm);
   }
}

//+------------------------------------------------------------------+
//| OnInit: detect → historical lifecycle replay → draw              |
//+------------------------------------------------------------------+
int OnInit()
{
   int available = iBars(_Symbol, InpTF);
   if(available < 4) { Print("IFVG_Detector: not enough bars."); return INIT_FAILED; }

   int limit = MathMin(InpLookback, available - 3);

   // ── Step 1: Detect all FVGs (oldest → newest) ────────────────────
   for(int sh = limit; sh >= 1; sh--)
      FVG_ScanBar(sh);

   // ── Step 2: Historical lifecycle replay ──────────────────────────
   // Replay every bar so zones start with correct state on attach.
   // Inversion zones created during replay are immediately available
   // for invalidation checking in subsequent bar iterations.
   for(int sh = limit; sh >= 1; sh--)
   {
      double   hi       = iHigh (_Symbol, InpTF, sh);
      double   lo       = iLow  (_Symbol, InpTF, sh);
      double   cl       = iClose(_Symbol, InpTF, sh);
      datetime barTime  = iTime (_Symbol, InpTF, sh);
      datetime freezeAt = iTime (_Symbol, InpTF, sh - 1);

      // FVG pass
      for(int i = 0; i < fvgTotal; i++)
      {
         if(barTime <= fvgList[i].c3Time) continue;
         int s = fvgList[i].state;
         if(s == FVG_INVERTED || s == FVG_INVALIDATED) continue;

         // Expiry
         if(InpExpiryBars > 0)
         {
            int age = (int)((barTime - fvgList[i].c3Time) / PeriodSeconds(InpTF));
            if(age >= InpExpiryBars)
            {
               fvgList[i].state       = FVG_INVALIDATED;
               fvgList[i].invalidTime = freezeAt;
               continue;
            }
         }

         FVG_CheckMitigation(i, hi, lo);
         FVG_CheckInversion(i, cl, freezeAt); // may create IFVG record
      }

      // IFVG pass: check any inversion zones created so far
      for(int i = 0; i < invTotal; i++)
      {
         if(invList[i].state == INV_INVALIDATED) continue;
         if(barTime <= invList[i].zoneStart) continue; // zone didn't exist yet
         INV_CheckInvalidation(i, cl, freezeAt);
      }
   }

   // ── Step 3: Draw all zones with correct state-aware visuals ─────
   FVG_DrawNew();  // original FVG zones (if InpShowOriginalFvg = true)
   INV_DrawNew();  // IFVG zones

   // ── Step 4: Summary ───────────────────────────────────────────────
   int fActive=0, fMit=0, fInv=0, fExpired=0;
   for(int i = 0; i < fvgTotal; i++)
   {
      switch(fvgList[i].state)
      {
         case FVG_ACTIVE:      fActive++;  break;
         case FVG_MITIGATED:   fMit++;     break;
         case FVG_INVERTED:    fInv++;     break;
         default:              fExpired++; break;
      }
   }
   int iActive=0, iInvalid=0;
   for(int i = 0; i < invTotal; i++)
      invList[i].state == INV_ACTIVE ? iActive++ : iInvalid++;

   PrintFormat("IFVG Detector v2 ready | FVG: total=%d active=%d mitigated=%d inverted=%d expired=%d | IFVG zones: active=%d broken=%d | %s %s",
               fvgTotal, fActive, fMit, fInv, fExpired, iActive, iInvalid,
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
//| OnCalculate: state updates → draw new IFVGs → detect new FVGs   |
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

   // 1. Update all states: expiry → mitigation → inversion → IFVG break
   UpdateAllStates();

   // 2. Draw any IFVG zones created in step 1
   INV_DrawNew();

   // 3. Detect new FVGs from the just-closed bar
   FVG_ScanBar(1);

   // 4. Draw any new FVG zones (visible only when InpShowOriginalFvg = true)
   FVG_DrawNew();

   return rates_total;
}
`;
}
