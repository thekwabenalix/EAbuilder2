/**
 * SMC Module Library — Phase 1: FVG Inversion Detector
 *
 * FVG Inversion Detector v1.0.0
 * ──────────────────────────────
 * A Fair Value Gap becomes an Inversion FVG when price fully trades
 * through it — closing beyond its far limit — flipping its polarity.
 *
 * INVERSION RULES (closed candles only):
 *   Bullish FVG  →  BEARISH inversion when:  Close < LL
 *   Bearish FVG  →  BULLISH inversion when:  Close > UL
 *
 * The original FVG zone is frozen at the inversion bar. A new zone
 * of opposite polarity is drawn from the inversion bar forward,
 * using distinct colours and a dashed border.
 *
 * FVG STATES:
 *   ACTIVE_FVG  (0) → zone untouched
 *   MITIGATED   (1) → price entered the zone (Bullish: Low≤UL | Bearish: High≥LL)
 *   INVERTED    (2) → price closed through → inversion zone created
 *   INVALIDATED (3) → zone expired (no inversion created)
 *
 * INVERSION ZONE STATES:
 *   INV_ACTIVE      (0) → inversion zone live
 *   INV_INVALIDATED (1) → inversion zone broken (price closed back through)
 *
 * JOURNAL EVENTS:
 *   FVG_CREATED           | id | dir | UL | LL | C1 | C3
 *   FVG_MITIGATED         | id | dir | UL | LL | bar
 *   FVG_INVERSION_CREATED | orig_id | new_dir | UL | LL | bar
 *   FVG_EXPIRED           | id | dir | UL | LL | age_bars
 *   INV_INVALIDATED       | inv_id | orig_id | dir | UL | LL | bar
 *
 * PROCESSING ORDER per new bar:
 *   1. Expiry check on original FVG zones
 *   2. Mitigation check   (ACTIVE → MITIGATED)
 *   3. Inversion check    (ACTIVE | MITIGATED → INVERTED + create INV zone)
 *   4. INV zone checks    (INV_ACTIVE → INV_INVALIDATED)
 *   5. Draw new FVG zones and new INV zones
 *   6. Detect new FVG zones on just-closed bar
 *
 * NO trading logic. Detection and visualisation only.
 */

export const FVG_INVERSION_DETECTOR_VERSION = "1.0.0";
export const FVG_INVERSION_DETECTOR_MODULE  = "FVG_Inversion_Detector";

/**
 * Returns the complete MQL5 source code for the FVG Inversion Detector.
 * Drop the output into MetaEditor, compile, and attach to any chart.
 */
export function generateFvgInversionDetector(): string {
  return `//+------------------------------------------------------------------+
//| FVG_Inversion_Detector.mq5                                      |
//| SMC Module Library v${FVG_INVERSION_DETECTOR_VERSION} — Phase 1: Detection Only        |
//|                                                                  |
//| Detects FVG polarity inversions when price closes through a zone.|
//|                                                                  |
//| INVERSION RULES:                                                 |
//|   Bullish FVG → BEARISH inversion when:  Close < LL             |
//|   Bearish FVG → BULLISH inversion when:  Close > UL             |
//|                                                                  |
//| FVG STATES:                                                      |
//|   ACTIVE_FVG  → zone untouched                                  |
//|   MITIGATED   → price entered zone                              |
//|   INVERTED    → price closed through → new inversion zone drawn |
//|   INVALIDATED → zone expired (no inversion)                     |
//|                                                                  |
//| INVERSION ZONE STATES:                                          |
//|   INV_ACTIVE      → inversion zone live, extending right        |
//|   INV_INVALIDATED → price closed back through, zone frozen      |
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
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

//--- Original FVG states
#define FVG_ACTIVE      0   // untouched
#define FVG_MITIGATED   1   // price entered zone
#define FVG_INVERTED    2   // price closed through → inversion zone created
#define FVG_INVALIDATED 3   // zone expired, no inversion

//--- Inversion zone states
#define INV_ACTIVE      0
#define INV_INVALIDATED 1

//--- Mitigation mode
enum ENUM_MIT_MODE
{
   MIT_TOUCH_EDGE     = 0, // Price touches near edge of zone (default)
   MIT_TOUCH_MIDPOINT = 1, // Price reaches midpoint of zone
};

//--- Inputs — Detection
input ENUM_TIMEFRAMES InpTF       = PERIOD_CURRENT; // Timeframe to scan
input int             InpLookback = 500;             // Historical bars to scan on load

//--- Inputs — Original FVG colours
input color InpBullFvgClr = clrDodgerBlue; // Bullish FVG colour
input color InpBearFvgClr = clrOrangeRed;  // Bearish FVG colour

//--- Inputs — Inversion zone colours
input color InpBullInvClr = clrMediumSeaGreen; // Bullish inversion (orig: bearish FVG)
input color InpBearInvClr = clrOrchid;         // Bearish inversion (orig: bullish FVG)

//--- Inputs — Lifecycle
input ENUM_MIT_MODE InpMitMode    = MIT_TOUCH_EDGE; // FVG mitigation trigger
input int           InpExpiryBars = 50;              // Expire FVG after N bars (0 = off)

//--- Inputs — Visualization
input int  InpFvgOpacity     = 70;   // Active FVG opacity 0-100
input int  InpMitOpacity     = 25;   // Mitigated FVG opacity 0-100
input int  InpInvOpacity     = 65;   // Inversion zone opacity 0-100
input bool InpShowMitigated  = true; // Show mitigated FVG zones
input bool InpKeepInverted   = true; // Keep original FVG as frozen relic when inverted

//--- Inputs — Logging
input bool InpShowLog = true; // Print lifecycle events to journal

//--- Zone storage limits
#define FVG_MAX 500
#define INV_MAX 500

//--- Original FVG record
struct FVGRecord
{
   int      id;
   int      dir;          // +1 bullish  -1 bearish
   int      state;        // FVG_ACTIVE / MITIGATED / INVERTED / INVALIDATED
   datetime c1Time;
   datetime c3Time;
   double   ul;
   double   ll;
   datetime invalidTime;  // right-edge freeze when zone ends (0 = still live)
};

//--- Inversion zone record
struct InvRecord
{
   int      id;
   int      origFvgId;    // ID of the original FVG (for logging)
   int      dir;          // FLIPPED polarity: +1 = now bullish, -1 = now bearish
   int      state;        // INV_ACTIVE / INV_INVALIDATED
   datetime startTime;    // left edge of inversion zone (= inversion bar boundary)
   double   ul;           // same price range as original FVG
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
   return BlendWithBg(base, InpFvgOpacity); // ACTIVE
}

//+------------------------------------------------------------------+
//| Display colour for an inversion zone                             |
//+------------------------------------------------------------------+
color INV_ZoneColor(int idx)
{
   color base = invList[idx].dir > 0 ? InpBullInvClr : InpBearInvClr;
   if(invList[idx].state == INV_INVALIDATED) return BlendWithBg(base, 8);
   return BlendWithBg(base, InpInvOpacity);
}

//+------------------------------------------------------------------+
//| Right-edge time for an original FVG rectangle                    |
//+------------------------------------------------------------------+
datetime FVG_RightEdge(int idx)
{
   if(fvgList[idx].invalidTime > 0) return fvgList[idx].invalidTime;
   return (datetime)(TimeCurrent() + (datetime)(5 * 365 * 86400));
}

//+------------------------------------------------------------------+
//| Right-edge time for an inversion zone rectangle                  |
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
   if(fvgTotal >= FVG_MAX) { if(InpShowLog) Print("FVG_Inversion: FVG limit reached"); return; }
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
//| Scan one 3-candle triplet for an FVG (same detection as v3)      |
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
   if(c3Lo > c1Hi) FVG_Add(+1, c1T, c3T, c3Lo, c1Hi); // Bullish
   if(c3Hi < c1Lo) FVG_Add(-1, c1T, c3T, c1Lo, c3Hi); // Bearish
}

//+------------------------------------------------------------------+
//| Check price entry into zone: ACTIVE → MITIGATED                  |
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
//| Create an inversion zone record from an inverted FVG             |
//+------------------------------------------------------------------+
void INV_Create(int fvgIdx, datetime startTime)
{
   if(invTotal >= INV_MAX) { if(InpShowLog) Print("FVG_Inversion: INV limit reached"); return; }

   int newDir = -fvgList[fvgIdx].dir; // flip polarity

   int i               = invTotal++;
   invList[i].id           = nextInvId++;
   invList[i].origFvgId    = fvgList[fvgIdx].id;
   invList[i].dir          = newDir;
   invList[i].state        = INV_ACTIVE;
   invList[i].startTime    = startTime; // left edge of inversion zone
   invList[i].ul           = fvgList[fvgIdx].ul;
   invList[i].ll           = fvgList[fvgIdx].ll;
   invList[i].invalidTime  = 0;

   if(InpShowLog)
      PrintFormat("FVG_INVERSION_CREATED | orig_id=%d | new_dir=%s | UL=%.5f | LL=%.5f | bar=%s",
                  fvgList[fvgIdx].id,
                  newDir > 0 ? "BULLISH" : "BEARISH",
                  invList[i].ul, invList[i].ll,
                  TimeToString(startTime, TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
//| Check close through zone: ACTIVE|MITIGATED → INVERTED            |
//| Creates an inversion zone on positive detection.                 |
//+------------------------------------------------------------------+
bool FVG_CheckInversion(int idx, double barClose, datetime freezeAt)
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
      fvgList[idx].invalidTime = freezeAt;
      INV_Create(idx, freezeAt); // start = boundary between original and inversion zone
   }
   return hit;
}

//+------------------------------------------------------------------+
//| Check whether an inversion zone has been broken                  |
//| Inversion zone broken when price closes back through it.         |
//+------------------------------------------------------------------+
bool INV_CheckInvalidation(int idx, double barClose, datetime freezeAt)
{
   if(invList[idx].state == INV_INVALIDATED) return false;

   bool hit;
   if(invList[idx].dir == +1) // Bullish inversion: invalidated when Close < LL
      hit = (barClose < invList[idx].ll);
   else                        // Bearish inversion: invalidated when Close > UL
      hit = (barClose > invList[idx].ul);

   if(hit)
   {
      invList[idx].state       = INV_INVALIDATED;
      invList[idx].invalidTime = freezeAt;
   }
   return hit;
}

//+------------------------------------------------------------------+
//| Draw an original FVG zone rectangle + label                      |
//+------------------------------------------------------------------+
void FVG_DrawZone(int idx)
{
   int state = fvgList[idx].state;
   // Respect visibility settings
   if(!InpKeepInverted   && (state == FVG_INVERTED || state == FVG_INVALIDATED)) return;
   if(!InpShowMitigated  &&  state == FVG_MITIGATED) return;

   color    clr  = FVG_ZoneColor(idx);
   string   pfx  = "SMCFVG_" + IntegerToString(fvgList[idx].id);
   string   rect = pfx + "_zone";
   string   lbl  = pfx + "_lbl";
   datetime t2   = FVG_RightEdge(idx);
   bool     dead = (state == FVG_INVERTED || state == FVG_INVALIDATED);

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
//| Draw an inversion zone rectangle + label                         |
//+------------------------------------------------------------------+
void INV_DrawZone(int idx)
{
   color    clr  = INV_ZoneColor(idx);
   string   pfx  = "SMCINV_" + IntegerToString(invList[idx].id);
   string   rect = pfx + "_zone";
   string   lbl  = pfx + "_lbl";
   datetime t1   = invList[idx].startTime;
   datetime t2   = INV_RightEdge(idx);
   bool     dead = (invList[idx].state == INV_INVALIDATED);

   // Dashed border to visually distinguish from original FVG zones
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

   // Label: show original id and new direction
   string dirStr = invList[idx].dir > 0 ? "Bull" : "Bear";
   string txt = StringFormat("INV %s FVG #%d (was #%d)  UL:%.5f  LL:%.5f",
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
//| Update an original FVG zone's chart objects on state change      |
//+------------------------------------------------------------------+
void FVG_UpdateObjectState(int idx)
{
   string pfx  = "SMCFVG_" + IntegerToString(fvgList[idx].id);
   string rect = pfx + "_zone";
   string lbl  = pfx + "_lbl";
   int    s    = fvgList[idx].state;

   if(s == FVG_INVERTED || s == FVG_INVALIDATED)
   {
      if(!InpKeepInverted)
      {
         ObjectDelete(0, rect);
         ObjectDelete(0, lbl);
      }
      else
      {
         // Freeze right edge + heavily fade + dotted border
         color faded = FVG_ZoneColor(idx); // returns 8% opacity for terminal states
         ObjectSetInteger(0, rect, OBJPROP_TIME,  1, (long)fvgList[idx].invalidTime);
         ObjectSetInteger(0, rect, OBJPROP_COLOR,    faded);
         ObjectSetInteger(0, rect, OBJPROP_STYLE,    STYLE_DOT);
         ObjectSetInteger(0, lbl,  OBJPROP_COLOR,    faded);
      }
      return;
   }

   if(s == FVG_MITIGATED)
   {
      if(!InpShowMitigated) { ObjectDelete(0, rect); ObjectDelete(0, lbl); }
      else
      {
         color faded = FVG_ZoneColor(idx);
         ObjectSetInteger(0, rect, OBJPROP_COLOR, faded);
         ObjectSetInteger(0, lbl,  OBJPROP_COLOR, faded);
      }
   }
}

//+------------------------------------------------------------------+
//| Update an inversion zone's chart objects on state change         |
//+------------------------------------------------------------------+
void INV_UpdateObjectState(int idx)
{
   string pfx  = "SMCINV_" + IntegerToString(invList[idx].id);
   string rect = pfx + "_zone";
   string lbl  = pfx + "_lbl";

   if(invList[idx].state == INV_INVALIDATED)
   {
      color faded = INV_ZoneColor(idx); // returns 8% for invalidated
      ObjectSetInteger(0, rect, OBJPROP_TIME,  1, (long)invList[idx].invalidTime);
      ObjectSetInteger(0, rect, OBJPROP_COLOR,    faded);
      ObjectSetInteger(0, rect, OBJPROP_STYLE,    STYLE_DOT);
      ObjectSetInteger(0, lbl,  OBJPROP_COLOR,    faded);
   }
}

//+------------------------------------------------------------------+
//| Update all zone states on each new bar (live operation)          |
//| Order: expiry → mitigation → inversion → INV invalidation        |
//+------------------------------------------------------------------+
void UpdateAllStates()
{
   double   hi       = iHigh (_Symbol, InpTF, 1);
   double   lo       = iLow  (_Symbol, InpTF, 1);
   double   cl       = iClose(_Symbol, InpTF, 1);
   datetime barTime  = iTime (_Symbol, InpTF, 1);
   datetime freezeAt = iTime (_Symbol, InpTF, 0); // new bar open = closed bar end

   // ── Pass 1: Update original FVG zones ───────────────────────────
   for(int i = 0; i < fvgTotal; i++)
   {
      int s = fvgList[i].state;
      if(s == FVG_INVERTED || s == FVG_INVALIDATED) continue;

      // Step 1: Expiry
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

      // Step 3: Inversion (can fire on same bar as mitigation if price blew through)
      if(FVG_CheckInversion(i, cl, freezeAt))
         FVG_UpdateObjectState(i); // freeze/remove original zone; INV zone queued for drawing
   }

   // ── Pass 2: Update inversion zones ──────────────────────────────
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
//| Draw all FVG zones added since the last draw call                |
//+------------------------------------------------------------------+
void FVG_DrawNew()
{
   for(int i = fvgDrawn; i < fvgTotal; i++)
      FVG_DrawZone(i);
   fvgDrawn = fvgTotal;
}

//+------------------------------------------------------------------+
//| Draw all inversion zones added since the last draw call          |
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
      if(StringFind(nm, "SMCFVG_") == 0 || StringFind(nm, "SMCINV_") == 0)
         ObjectDelete(0, nm);
   }
}

//+------------------------------------------------------------------+
//| OnInit: detect → historical replay → draw                        |
//+------------------------------------------------------------------+
int OnInit()
{
   int available = iBars(_Symbol, InpTF);
   if(available < 4) { Print("FVG_Inversion: not enough bars."); return INIT_FAILED; }

   int limit = MathMin(InpLookback, available - 3);

   // ── Step 1: Detect all FVGs (oldest → newest) ────────────────────
   for(int sh = limit; sh >= 1; sh--)
      FVG_ScanBar(sh);

   // ── Step 2: Historical lifecycle replay ──────────────────────────
   // Re-run the full state machine bar-by-bar so every zone starts in
   // the correct state when the indicator is first attached.
   for(int sh = limit; sh >= 1; sh--)
   {
      double   hi       = iHigh (_Symbol, InpTF, sh);
      double   lo       = iLow  (_Symbol, InpTF, sh);
      double   cl       = iClose(_Symbol, InpTF, sh);
      datetime barTime  = iTime (_Symbol, InpTF, sh);
      datetime freezeAt = iTime (_Symbol, InpTF, sh - 1);

      // ── FVG pass ──────────────────────────────────────────────────
      for(int i = 0; i < fvgTotal; i++)
      {
         if(barTime <= fvgList[i].c3Time) continue; // zone not yet created
         int s = fvgList[i].state;
         if(s == FVG_INVERTED || s == FVG_INVALIDATED) continue;

         // Expiry (time-based approximation for historical replay)
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

         // Mitigation
         FVG_CheckMitigation(i, hi, lo);

         // Inversion: creates an INV record immediately; will be checked below
         FVG_CheckInversion(i, cl, freezeAt);
      }

      // ── INV pass: check inversion zones created so far ────────────
      for(int i = 0; i < invTotal; i++)
      {
         if(invList[i].state == INV_INVALIDATED) continue;
         if(barTime <= invList[i].startTime) continue; // zone didn't exist yet
         INV_CheckInvalidation(i, cl, freezeAt);
      }
   }

   // ── Step 3: Draw all zones with correct state-aware visuals ─────
   FVG_DrawNew();
   INV_DrawNew();

   // ── Step 4: Summary log ──────────────────────────────────────────
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

   PrintFormat("FVG Inversion Detector ready | FVG: total=%d active=%d mitigated=%d inverted=%d expired=%d | INV zones: active=%d invalidated=%d | %s %s",
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
//| OnCalculate: state updates → draw new inversion zones → new FVGs |
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

   // 1. Expiry → mitigation → inversion → INV invalidation
   UpdateAllStates();

   // 2. Draw any inversion zones created in step 1
   INV_DrawNew();

   // 3. Detect new FVGs from the just-closed bar
   FVG_ScanBar(1);

   // 4. Draw any new FVG zones
   FVG_DrawNew();

   return rates_total;
}
`;
}
