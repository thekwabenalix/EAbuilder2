/**
 * Phase 2 State Modules — Order Block (OB) State Module
 *
 * OB_State_Module v1.0.0
 * ─────────────────────────────────────────────────────
 * Embeds OB detection and manages a full state machine per zone.
 * Direct adaptation of FVG_State_Module — same 4-buffer contract,
 * same state lifecycle, OB-specific detection and zone boundaries.
 *
 * OB DETECTION (embedded):
 *   Bullish OB: last BEARISH candle before a bullish displacement
 *     Zone: hi = OB candle high, lo = OB candle low
 *   Bearish OB: last BULLISH candle before a bearish displacement
 *     Zone: hi = OB candle high, lo = OB candle low
 *   Displacement: candle body ≥ InpDispMult × ATR(InpAtrPeriod)
 *
 * STATE MACHINE:
 *   ACTIVE     → OB detected, displacement confirmed, zone untouched
 *   RETESTED   → wick enters zone from correct side
 *                  Bull: barLow  ≤ hi  |  Bear: barHigh ≥ lo
 *   CONFIRMED  → from RETESTED, close exits zone from correct side
 *                  Bull: close > hi   |  Bear: close < lo
 *   MITIGATED  → close inside zone  (lo ≤ close ≤ hi)  [terminal]
 *   INVALIDATED→ close beyond far edge
 *                  Bull: close < lo   |  Bear: close > hi  [terminal]
 *   EXPIRED    → barsAlive ≥ InpExpiryBars  [terminal]
 *
 * State cycle:
 *   ACTIVE → RETESTED → CONFIRMED → (re-RETESTED → CONFIRMED ...)*
 *   Any live state → MITIGATED / INVALIDATED / EXPIRED
 *
 * PHASE 3 BUFFERS (same contract as FVG_State_Module):
 *   Buffer 0  BullConfirmBuf[sh] = 1.0 when bull OB enters CONFIRMED
 *   Buffer 1  BearConfirmBuf[sh] = 1.0 when bear OB enters CONFIRMED
 *   Buffer 2  BullSLBuf[sh]      = retestLow  at confirm bar
 *   Buffer 3  BearSLBuf[sh]      = retestHigh at confirm bar
 *
 * JOURNAL:
 *   OB_ACTIVE | OB_RETESTED | OB_CONFIRMED | OB_MITIGATED | OB_INVALIDATED | OB_EXPIRED
 *
 * NO trading logic. State tracking and visualisation only.
 */

export const OB_STATE_MODULE_VERSION = "1.00";
export const OB_STATE_MODULE         = "OB_State_Module";

export function generateObStateModule(): string {
  return `//+------------------------------------------------------------------+
//| OB_State_Module.mq5                                              |
//| Phase 2: Order Block State Module v${OB_STATE_MODULE_VERSION}                 |
//|                                                                  |
//| Embeds OB detection (ATR-displacement). Manages full lifecycle. |
//|                                                                  |
//| States:  ACTIVE → RETESTED → CONFIRMED                          |
//|          Any live → MITIGATED / INVALIDATED / EXPIRED           |
//|                                                                  |
//| Phase 3 buffers 0/1: BullConfirm / BearConfirm signal bars.    |
//| Phase 3 buffers 2/3: BullSL / BearSL price at confirm bar.     |
//| NO trading logic. State tracking and visualisation only.        |
//+------------------------------------------------------------------+
#property copyright "EA Builder — Phase 2 State Module"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_buffers 4
#property indicator_plots   0

// ── Direction ─────────────────────────────────────────────────────
#define OB_BULL   1
#define OB_BEAR  -1

// ── Lifecycle states ──────────────────────────────────────────────
#define STATE_ACTIVE       0
#define STATE_RETESTED     1
#define STATE_CONFIRMED    2
#define STATE_MITIGATED    3   // terminal
#define STATE_INVALIDATED  4   // terminal
#define STATE_EXPIRED      5   // terminal
#define STATE_UNDRAWN     -1

#define OB_MAX     500          // Slot pool — recycled; actual live cap = InpMaxZones
#define FAR_FUTURE ((datetime)4102444800)   // 2100-01-01 00:00 UTC

//+------------------------------------------------------------------+
//| Per-zone state record                                            |
//+------------------------------------------------------------------+
struct ObRecord
{
   int      id;
   int      dir;           // OB_BULL or OB_BEAR
   double   hi;            // OB candle high  (upper zone boundary)
   double   lo;            // OB candle low   (lower zone boundary)
   int      state;
   int      drawnState;    // last rendered state (STATE_UNDRAWN = never drawn)
   int      barsAlive;     // increments every bar after detectedTime
   datetime obTime;        // OB candle open time  → visual left edge
   datetime dispTime;      // displacement candle time = detectedTime
   datetime retestTime;    // time of most recent retest candle
   double   retestHigh;    // highest price reached during retest
   double   retestLow;     // lowest  price reached during retest
   datetime confirmTime;   // bar where CONFIRMED state was last entered
   datetime endTime;       // terminal state time (0 = still live)
};

//+------------------------------------------------------------------+
//| Phase 3 indicator buffers (readable via iCustom)                 |
//| Same 4-buffer contract as FVG_State_Module.                     |
//| Buf 0  BullConfirmBuf[sh] = 1.0 when bull OB confirmed          |
//| Buf 1  BearConfirmBuf[sh] = 1.0 when bear OB confirmed          |
//| Buf 2  BullSLBuf[sh]      = retestLow  (SL for bull entries)    |
//| Buf 3  BearSLBuf[sh]      = retestHigh (SL for bear entries)    |
//+------------------------------------------------------------------+
double BullConfirmBuf[];
double BearConfirmBuf[];
double BullSLBuf[];
double BearSLBuf[];

//--- Inputs — Timeframe & history
input ENUM_TIMEFRAMES InpTF        = PERIOD_CURRENT; // Timeframe
input int             InpLookback  = 500;            // Historical bars to scan

//--- Inputs — OB Detection
input int    InpAtrPeriod  = 14;   // ATR period for displacement filter
input double InpDispMult   = 1.5;  // Displacement body ≥ N × ATR
input int    InpObScanBack = 5;    // Bars before displacement to search for OB candle

//--- Inputs — Lifecycle
input bool InpShowBull      = true;  // Track bullish OB zones
input bool InpShowBear      = true;  // Track bearish OB zones
input int  InpExpiryBars    = 100;   // Bars until zone expires (0 = never)
input bool InpRemoveTerminal = true; // Delete objects when zone reaches terminal state
input int  InpMaxZones      = 50;   // Max live zones (oldest ACTIVE pruned when exceeded)

//--- Inputs — Colours
input color InpBullColor    = clrRoyalBlue;   // ACTIVE bullish zone
input color InpBearColor    = clrCrimson;      // ACTIVE bearish zone
input color InpRetestColor  = clrGold;         // RETESTED zone
input color InpConfirmBull  = clrLimeGreen;    // CONFIRMED bullish zone
input color InpConfirmBear  = clrOrangeRed;    // CONFIRMED bearish zone
input color InpMitColor     = clrSilver;       // MITIGATED zone
input color InpInvalidColor = clrDimGray;      // INVALIDATED / EXPIRED zone
input int   InpActiveOpacity = 70;             // Live zone opacity  0-100
input int   InpFadeOpacity   = 25;             // Terminal zone opacity 0-100

//--- Inputs — Logging
input bool InpShowLog = true; // Print state transitions to journal

ObRecord obList[OB_MAX];
int      obTotal     = 0;
int      nextObId    = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
string DirStr(int d)    { return d > 0 ? "BULL" : "BEAR"; }
string ObjRect(int id)  { return "SMCOBS_" + IntegerToString(id) + "_rect"; }
string ObjLbl (int id)  { return "SMCOBS_" + IntegerToString(id) + "_lbl";  }

//+------------------------------------------------------------------+
//| Theme-aware opacity blending (identical across all Phase 2 mods) |
//+------------------------------------------------------------------+
color BlendWithBg(color base, int opacityPct)
{
   color  bg = (color)ChartGetInteger(0, CHART_COLOR_BACKGROUND);
   double t  = MathMax(0.0, MathMin(100.0, (double)opacityPct)) / 100.0;
   int r = (int)(((int)( base        & 0xFF)) * t + ((int)( bg        & 0xFF)) * (1.0 - t));
   int g = (int)(((int)((base >>  8) & 0xFF)) * t + ((int)((bg >>  8) & 0xFF)) * (1.0 - t));
   int b = (int)(((int)((base >> 16) & 0xFF)) * t + ((int)((bg >> 16) & 0xFF)) * (1.0 - t));
   return (color)(r | (g << 8) | (b << 16));
}

//+------------------------------------------------------------------+
//| ATR = SMA of True Range over InpAtrPeriod bars at shift.        |
//| Self-contained — no indicator handle.                            |
//+------------------------------------------------------------------+
double CalcATR(int shift, int period)
{
   int avail = iBars(_Symbol, InpTF);
   if(shift + period + 1 >= avail) return 0.0;
   double sum = 0.0;
   for(int k = 0; k < period; k++)
   {
      double h  = iHigh (_Symbol, InpTF, shift + k);
      double l  = iLow  (_Symbol, InpTF, shift + k);
      double pc = iClose(_Symbol, InpTF, shift + k + 1);
      sum += MathMax(h - l, MathMax(MathAbs(h - pc), MathAbs(l - pc)));
   }
   return sum / period;
}

//+------------------------------------------------------------------+
//| Duplicate guard: same direction + same OB candle time            |
//| Skip terminal zones — their slot may be recycled.               |
//+------------------------------------------------------------------+
bool OB_IsDuplicate(int dir, datetime obT)
{
   for(int i = 0; i < obTotal; i++)
   {
      int st = obList[i].state;
      if(st == STATE_MITIGATED || st == STATE_INVALIDATED || st == STATE_EXPIRED) continue;
      if(obList[i].dir == dir && obList[i].obTime == obT) return true;
   }
   return false;
}

//+------------------------------------------------------------------+
//| Register a new OB zone                                           |
//+------------------------------------------------------------------+
void OB_Add(int dir, datetime obT, datetime dispT, double hi, double lo)
{
   if(OB_IsDuplicate(dir, obT)) return;

   // Slot allocation: recycle a terminal zone before appending.
   // Critical for long backtests — without recycling, obTotal hits
   // OB_MAX after heavy history and OB_Add silently returns, killing
   // all future zone detection.
   int idx = -1;
   for(int i = 0; i < obTotal; i++)
   {
      int st = obList[i].state;
      if(st == STATE_MITIGATED || st == STATE_INVALIDATED || st == STATE_EXPIRED)
      {
         ObjectDelete(0, ObjRect(obList[i].id));
         ObjectDelete(0, ObjLbl (obList[i].id));
         idx = i;
         break;
      }
   }
   if(idx < 0)
   {
      if(obTotal >= OB_MAX) return;   // All slots live — hard pool cap reached
      idx = obTotal++;
   }
   obList[idx].id          = nextObId++;
   obList[idx].dir         = dir;
   obList[idx].hi          = hi;
   obList[idx].lo          = lo;
   obList[idx].state       = STATE_ACTIVE;
   obList[idx].drawnState  = STATE_UNDRAWN;
   obList[idx].barsAlive   = 0;
   obList[idx].obTime      = obT;
   obList[idx].dispTime    = dispT;    // lifecycle birth — used as detectedTime
   obList[idx].retestTime  = 0;
   obList[idx].retestHigh  = 0.0;
   obList[idx].retestLow   = 0.0;
   obList[idx].confirmTime = 0;
   obList[idx].endTime     = 0;

   if(InpShowLog)
      PrintFormat("OB_ACTIVE | id=%d | dir=%s | hi=%.5f | lo=%.5f | ob_bar=%s | disp_bar=%s",
         obList[idx].id, DirStr(dir), hi, lo,
         TimeToString(obT,   TIME_DATE|TIME_MINUTES),
         TimeToString(dispT, TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
//| Scan bar dispShift as a potential displacement candle.           |
//| If displacement confirmed (body >= InpDispMult × ATR), look     |
//| back up to InpObScanBack bars for the last opposing candle.     |
//| That opposing candle becomes the Order Block zone.               |
//+------------------------------------------------------------------+
void OB_ScanBar(int dispShift)
{
   if(dispShift < 1) return;

   double atr = CalcATR(dispShift, InpAtrPeriod);
   if(atr <= 0.0) return;

   double dispO = iOpen (_Symbol, InpTF, dispShift);
   double dispC = iClose(_Symbol, InpTF, dispShift);
   if(MathAbs(dispC - dispO) < InpDispMult * atr) return;

   int dispDir = (dispC > dispO) ? OB_BULL : OB_BEAR;
   if(dispDir == OB_BULL && !InpShowBull) return;
   if(dispDir == OB_BEAR && !InpShowBear) return;

   int avail   = iBars(_Symbol, InpTF);
   int scanEnd = MathMin(dispShift + InpObScanBack, avail - 2);

   for(int j = dispShift + 1; j <= scanEnd; j++)
   {
      double jO = iOpen (_Symbol, InpTF, j);
      double jC = iClose(_Symbol, InpTF, j);

      // Bullish displacement → last bearish candle (close < open)
      if(dispDir == OB_BULL && jC < jO)
      {
         OB_Add(OB_BULL,
                iTime (_Symbol, InpTF, j),
                iTime (_Symbol, InpTF, dispShift),
                iHigh (_Symbol, InpTF, j),
                iLow  (_Symbol, InpTF, j));
         break;
      }
      // Bearish displacement → last bullish candle (close > open)
      if(dispDir == OB_BEAR && jC > jO)
      {
         OB_Add(OB_BEAR,
                iTime (_Symbol, InpTF, j),
                iTime (_Symbol, InpTF, dispShift),
                iHigh (_Symbol, InpTF, j),
                iLow  (_Symbol, InpTF, j));
         break;
      }
   }
}

//+------------------------------------------------------------------+
//| Lifecycle update for all live zones at bar sh.                   |
//|                                                                  |
//| Check priority (high → low):                                     |
//|   1. EXPIRED     — barsAlive ≥ InpExpiryBars                    |
//|   2. INVALIDATED — close beyond far edge                         |
//|      Bull: close < lo   Bear: close > hi                         |
//|   3. MITIGATED   — close inside zone  (lo ≤ close ≤ hi)         |
//|   4. CONFIRMED   — (state==RETESTED) close exits from near edge  |
//|      Bull: close > hi   Bear: close < lo                         |
//|   5. RETESTED    — wick enters zone from correct side            |
//|      Bull: barLow ≤ hi  Bear: barHigh ≥ lo                      |
//+------------------------------------------------------------------+
void UpdateObStates(int sh)
{
   double   barHigh  = iHigh (_Symbol, InpTF, sh);
   double   barLow   = iLow  (_Symbol, InpTF, sh);
   double   barClose = iClose(_Symbol, InpTF, sh);
   datetime barT     = iTime (_Symbol, InpTF, sh);

   for(int i = 0; i < obTotal; i++)
   {
      int st = obList[i].state;

      // Skip terminal states
      if(st == STATE_MITIGATED || st == STATE_INVALIDATED || st == STATE_EXPIRED) continue;

      // Skip: zone must have been detected before this bar
      // detectedTime for OBs is dispTime (when displacement confirmed the zone)
      if(obList[i].dispTime >= barT) continue;

      obList[i].barsAlive++;

      bool   isBull = (obList[i].dir == OB_BULL);
      double hi     = obList[i].hi;
      double lo     = obList[i].lo;

      // ── 1. EXPIRED ────────────────────────────────────────────────
      if(InpExpiryBars > 0 && obList[i].barsAlive >= InpExpiryBars)
      {
         obList[i].state   = STATE_EXPIRED;
         obList[i].endTime = barT;
         if(InpShowLog)
            PrintFormat("OB_EXPIRED | id=%d | dir=%s | hi=%.5f | lo=%.5f | bars=%d | time=%s",
               obList[i].id, DirStr(obList[i].dir), hi, lo,
               obList[i].barsAlive, TimeToString(barT, TIME_DATE|TIME_MINUTES));
         continue;
      }

      // ── 2. INVALIDATED: close beyond far edge ─────────────────────
      //    Bull: close < lo (below entire zone)
      //    Bear: close > hi (above entire zone)
      bool invalidated = isBull ? (barClose < lo) : (barClose > hi);
      if(invalidated)
      {
         obList[i].state   = STATE_INVALIDATED;
         obList[i].endTime = barT;
         if(InpShowLog)
            PrintFormat("OB_INVALIDATED | id=%d | dir=%s | hi=%.5f | lo=%.5f | close=%.5f | time=%s",
               obList[i].id, DirStr(obList[i].dir), hi, lo,
               barClose, TimeToString(barT, TIME_DATE|TIME_MINUTES));
         continue;
      }

      // ── 3. MITIGATED: close inside zone (lo ≤ close ≤ hi) ──────────
      bool mitigated = (barClose >= lo && barClose <= hi);
      if(mitigated)
      {
         obList[i].state   = STATE_MITIGATED;
         obList[i].endTime = barT;
         if(InpShowLog)
            PrintFormat("OB_MITIGATED | id=%d | dir=%s | hi=%.5f | lo=%.5f | close=%.5f | time=%s",
               obList[i].id, DirStr(obList[i].dir), hi, lo,
               barClose, TimeToString(barT, TIME_DATE|TIME_MINUTES));
         continue;
      }

      // ── 4. CONFIRMED: from RETESTED, close exits from near edge ───
      //    Bull: close > hi (rejected up — zone held)
      //    Bear: close < lo (rejected down — zone held)
      if(obList[i].state == STATE_RETESTED)
      {
         bool confirmed = isBull ? (barClose > hi) : (barClose < lo);
         if(confirmed)
         {
            obList[i].state       = STATE_CONFIRMED;
            obList[i].confirmTime = barT;

            // Phase 3 signal buffers — live write during OnCalculate
            // Historical backfill happens in OnCalculate(prev_calculated==0)
            if(sh >= 0)
            {
               if(isBull)
               {
                  if(sh < ArraySize(BullConfirmBuf)) BullConfirmBuf[sh] = 1.0;
                  if(sh < ArraySize(BullSLBuf))     BullSLBuf[sh]     = obList[i].retestLow;
               }
               else
               {
                  if(sh < ArraySize(BearConfirmBuf)) BearConfirmBuf[sh] = 1.0;
                  if(sh < ArraySize(BearSLBuf))     BearSLBuf[sh]     = obList[i].retestHigh;
               }
            }

            if(InpShowLog)
               PrintFormat("OB_CONFIRMED | id=%d | dir=%s | hi=%.5f | lo=%.5f | retest=%s | confirm=%s | sl=%.5f",
                  obList[i].id, DirStr(obList[i].dir), hi, lo,
                  TimeToString(obList[i].retestTime, TIME_DATE|TIME_MINUTES),
                  TimeToString(barT, TIME_DATE|TIME_MINUTES),
                  isBull ? obList[i].retestLow : obList[i].retestHigh);
            continue;
         }
      }

      // ── 5. RETESTED: wick enters zone from correct side ───────────
      //    Only from ACTIVE or CONFIRMED (cycle: CONFIRMED → RETESTED → CONFIRMED).
      //    Bull: barLow  ≤ hi (wick dips into zone from above)
      //    Bear: barHigh ≥ lo (wick rises into zone from below)
      if(obList[i].state != STATE_RETESTED)
      {
         bool retested = isBull ? (barLow <= hi) : (barHigh >= lo);
         if(retested)
         {
            obList[i].state      = STATE_RETESTED;
            obList[i].retestTime = barT;
            obList[i].retestHigh = barHigh;
            obList[i].retestLow  = barLow;
            if(InpShowLog)
               PrintFormat("OB_RETESTED | id=%d | dir=%s | hi=%.5f | lo=%.5f | low=%.5f | high=%.5f | time=%s",
                  obList[i].id, DirStr(obList[i].dir), hi, lo,
                  barLow, barHigh, TimeToString(barT, TIME_DATE|TIME_MINUTES));
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Prune oldest ACTIVE zone when live count > InpMaxZones           |
//+------------------------------------------------------------------+
void EnforceMaxZones()
{
   if(InpMaxZones <= 0) return;
   int cnt = 0;
   for(int i = 0; i < obTotal; i++)
      if(obList[i].state <= STATE_CONFIRMED) cnt++;

   while(cnt > InpMaxZones)
   {
      int oldest = -1; datetime oldT = (datetime)LONG_MAX;
      for(int i = 0; i < obTotal; i++)
      {
         if(obList[i].state > STATE_CONFIRMED) continue;
         if(obList[i].dispTime < oldT) { oldT = obList[i].dispTime; oldest = i; }
      }
      if(oldest < 0) break;
      ObjectDelete(0, ObjRect(obList[oldest].id));
      ObjectDelete(0, ObjLbl (obList[oldest].id));
      obList[oldest].state      = STATE_EXPIRED;
      obList[oldest].endTime    = obList[oldest].dispTime;
      obList[oldest].drawnState = STATE_EXPIRED;
      cnt--;
   }
}

//+------------------------------------------------------------------+
//| Draw (or redraw) one OB zone — delete + recreate on state change |
//+------------------------------------------------------------------+
void OB_DrawOne(int idx)
{
   int      st     = obList[idx].state;
   bool     isBull = (obList[idx].dir == OB_BULL);
   datetime tLeft  = obList[idx].obTime;

   bool     isLive = (st <= STATE_CONFIRMED);
   datetime tRight = isLive ? FAR_FUTURE
                             : (obList[idx].endTime > 0 ? obList[idx].endTime : tLeft);

   ObjectDelete(0, ObjRect(obList[idx].id));
   ObjectDelete(0, ObjLbl (obList[idx].id));

   if(!isLive && InpRemoveTerminal) { obList[idx].drawnState = st; return; }

   // ── Visual properties per state ───────────────────────────────
   color rawClr;
   int   opacity;
   int   bwidth = 1;
   bool  dashed = false;

   switch(st)
   {
      case STATE_ACTIVE:
         rawClr  = isBull ? InpBullColor : InpBearColor;
         opacity = InpActiveOpacity;
         break;
      case STATE_RETESTED:
         rawClr  = InpRetestColor;
         opacity = InpActiveOpacity;
         break;
      case STATE_CONFIRMED:
         rawClr  = isBull ? InpConfirmBull : InpConfirmBear;
         opacity = InpActiveOpacity;
         bwidth  = 2;
         break;
      case STATE_MITIGATED:
         rawClr  = InpMitColor;
         opacity = InpFadeOpacity;
         dashed  = true;
         break;
      default: // INVALIDATED / EXPIRED
         rawClr  = InpInvalidColor;
         opacity = InpFadeOpacity;
         dashed  = true;
         break;
   }

   color clr = BlendWithBg(rawClr, opacity);

   // ── Rectangle ─────────────────────────────────────────────────
   if(ObjectCreate(0, ObjRect(obList[idx].id), OBJ_RECTANGLE, 0,
                   tLeft, obList[idx].hi, tRight, obList[idx].lo))
   {
      ObjectSetInteger(0, ObjRect(obList[idx].id), OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, ObjRect(obList[idx].id), OBJPROP_FILL,       true);
      ObjectSetInteger(0, ObjRect(obList[idx].id), OBJPROP_STYLE,      dashed ? STYLE_DASH : STYLE_SOLID);
      ObjectSetInteger(0, ObjRect(obList[idx].id), OBJPROP_WIDTH,      bwidth);
      ObjectSetInteger(0, ObjRect(obList[idx].id), OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, ObjRect(obList[idx].id), OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, ObjRect(obList[idx].id), OBJPROP_BACK,       true);
   }

   // ── Label at zone midpoint ────────────────────────────────────
   string lbl;
   switch(st)
   {
      case STATE_ACTIVE:      lbl = isBull ? "OB↑" : "OB↓"; break;
      case STATE_RETESTED:    lbl = "OB-T"; break;
      case STATE_CONFIRMED:   lbl = "OB-C"; break;
      case STATE_MITIGATED:   lbl = "OB-M"; break;
      case STATE_INVALIDATED: lbl = "OB-X"; break;
      default:                lbl = "OB-E"; break;
   }
   double midP = (obList[idx].hi + obList[idx].lo) * 0.5;
   if(ObjectCreate(0, ObjLbl(obList[idx].id), OBJ_TEXT, 0, tLeft, midP))
   {
      ObjectSetString( 0, ObjLbl(obList[idx].id), OBJPROP_TEXT,       lbl);
      ObjectSetInteger(0, ObjLbl(obList[idx].id), OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, ObjLbl(obList[idx].id), OBJPROP_FONTSIZE,   7);
      ObjectSetInteger(0, ObjLbl(obList[idx].id), OBJPROP_ANCHOR,     ANCHOR_LEFT);
      ObjectSetInteger(0, ObjLbl(obList[idx].id), OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, ObjLbl(obList[idx].id), OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, ObjLbl(obList[idx].id), OBJPROP_BACK,       false);
   }

   obList[idx].drawnState = st;
}

//+------------------------------------------------------------------+
void OB_DrawAll()
{
   for(int i = 0; i < obTotal; i++)
      if(obList[i].drawnState != obList[i].state)
         OB_DrawOne(i);
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
void DeleteAllObjects()
{
   for(int i = ObjectsTotal(0) - 1; i >= 0; i--)
   {
      string nm = ObjectName(0, i);
      if(StringFind(nm, "SMCOBS_") == 0) ObjectDelete(0, nm);
   }
}

//+------------------------------------------------------------------+
int OnInit()
{
   // ── Phase 3 buffer registration ──────────────────────────────
   SetIndexBuffer(0, BullConfirmBuf, INDICATOR_DATA);
   SetIndexBuffer(1, BearConfirmBuf, INDICATOR_DATA);
   SetIndexBuffer(2, BullSLBuf,     INDICATOR_DATA);
   SetIndexBuffer(3, BearSLBuf,     INDICATOR_DATA);
   PlotIndexSetString(0, PLOT_LABEL, "Bull OB Confirmed");
   PlotIndexSetString(1, PLOT_LABEL, "Bear OB Confirmed");
   PlotIndexSetString(2, PLOT_LABEL, "Bull OB SL");
   PlotIndexSetString(3, PLOT_LABEL, "Bear OB SL");
   ArrayInitialize(BullConfirmBuf, 0.0);
   ArrayInitialize(BearConfirmBuf, 0.0);
   ArrayInitialize(BullSLBuf,     0.0);
   ArrayInitialize(BearSLBuf,     0.0);

   DeleteAllObjects();
   obTotal = 0; nextObId = 0;

   int avail = iBars(_Symbol, InpTF);
   if(avail < InpAtrPeriod + 4)
   { Print("OB_State_Module: not enough bars."); return INIT_FAILED; }

   int limit = MathMin(InpLookback, avail - InpAtrPeriod - 3);

   // ── Chronological scan: oldest bar → newest ───────────────────
   //
   // OB_ScanBar(sh): if bar sh is a displacement candle, search
   //   backwards for the OB candle and register it with
   //   detectedTime = iTime(sh) (= dispTime).
   //
   // UpdateObStates(sh): advance lifecycle for all OBs whose
   //   dispTime < iTime(sh)  (skip guard prevents same-bar processing).
   for(int sh = limit; sh >= 1; sh--)
   {
      OB_ScanBar(sh);
      UpdateObStates(sh);
   }

   EnforceMaxZones();
   OB_DrawAll();

   int nA=0,nR=0,nC=0,nM=0,nI=0,nE=0;
   for(int i = 0; i < obTotal; i++)
   {
      switch(obList[i].state)
      {
         case STATE_ACTIVE:      nA++; break;
         case STATE_RETESTED:    nR++; break;
         case STATE_CONFIRMED:   nC++; break;
         case STATE_MITIGATED:   nM++; break;
         case STATE_INVALIDATED: nI++; break;
         default:                nE++; break;
      }
   }
   PrintFormat("OB_State_Module v1 ready | active=%d retested=%d confirmed=%d mitigated=%d invalidated=%d expired=%d | %s %s",
      nA, nR, nC, nM, nI, nE, _Symbol, EnumToString(InpTF));
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason) { DeleteAllObjects(); ChartRedraw(0); }

//+------------------------------------------------------------------+
int OnCalculate(const int rates_total, const int prev_calculated,
                const datetime &time[], const double &open[],
                const double &high[], const double &low[],
                const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
{
   // ── First call: backfill Phase 3 signal buffers ───────────────
   // obList was built in OnInit; buffers are now allocated and sized
   // to rates_total. Stamp all CONFIRMED bars from history.
   if(prev_calculated == 0)
   {
      ArrayInitialize(BullConfirmBuf, 0.0);
      ArrayInitialize(BearConfirmBuf, 0.0);
      ArrayInitialize(BullSLBuf,     0.0);
      ArrayInitialize(BearSLBuf,     0.0);
      for(int i = 0; i < obTotal; i++)
      {
         if(obList[i].confirmTime == 0) continue;
         int si = iBarShift(_Symbol, InpTF, obList[i].confirmTime, false);
         if(si < 0 || si >= rates_total) continue;
         if(obList[i].dir == OB_BULL)
         {
            BullConfirmBuf[si] = 1.0;
            BullSLBuf[si]      = obList[i].retestLow;
         }
         else
         {
            BearConfirmBuf[si] = 1.0;
            BearSLBuf[si]      = obList[i].retestHigh;
         }
      }
      lastBarTime = iTime(_Symbol, InpTF, 0);
      return rates_total;
   }

   // ── Bar-open guard ────────────────────────────────────────────
   datetime currentBar = iTime(_Symbol, InpTF, 0);
   if(currentBar == lastBarTime) return rates_total;
   lastBarTime = currentBar;

   // Bar 1 just closed — scan for new OBs, then update states
   OB_ScanBar(1);
   UpdateObStates(1);

   EnforceMaxZones();
   OB_DrawAll();

   return rates_total;
}
`;
}
