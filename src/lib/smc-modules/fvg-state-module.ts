/**
 * Phase 2 State Modules — FVG State Module
 *
 * FVG_State_Module v1.1.0
 * ─────────────────────────────────────────────
 * Embeds FVG detection and manages a full state machine per zone.
 *
 * FVG DETECTION (embedded):
 *   Bullish: C3.Low > C1.High  → UL = C3.Low,  LL = C1.High
 *   Bearish: C3.High < C1.Low  → UL = C1.Low,  LL = C3.High
 *
 * STATE MACHINE:
 *   ACTIVE     → zone detected
 *   RETESTED   → wick enters zone (Bull: Low ≤ UL; Bear: High ≥ LL)
 *   CONFIRMED  → from RETESTED, close returns outside near edge
 *                  Bull: Close > UL  |  Bear: Close < LL
 *   MITIGATED  → close trades inside zone  (LL ≤ Close ≤ UL)  [terminal]
 *   INVALIDATED→ close beyond far edge     (Bull: Close < LL; Bear: Close > UL)  [terminal]
 *   EXPIRED    → barsAlive ≥ InpExpiryBars  [terminal]
 *
 * State cycle:
 *   ACTIVE → RETESTED → CONFIRMED → (re-RETESTED → CONFIRMED ...)*
 *   Any live state → MITIGATED / INVALIDATED / EXPIRED
 *
 * RECORDS — per zone:
 *   id · direction · UL · LL · state
 *   leftTime (candle 1 — zone visual left edge)
 *   detectedTime (candle 3 — lifecycle birth)
 *   retestTime · retestHigh · retestLow
 *   confirmTime · barsAlive · endTime
 *
 * DRAWN ELEMENTS:
 *   OBJ_RECTANGLE: left = candle 1, right = FAR_FUTURE (live) or endTime (terminal)
 *   OBJ_TEXT label at zone midpoint, updated on every state change:
 *     FVG↑ / FVG↓  (ACTIVE)
 *     FVG-T         (RETESTED)
 *     FVG-C         (CONFIRMED)
 *     FVG-M         (MITIGATED)
 *     FVG-X         (INVALIDATED)
 *     FVG-E         (EXPIRED)
 *
 * PHASE 3 INTEGRATION:
 *   Buffer 0  BullConfirmBuf[sh] = 1.0 when a bull FVG enters CONFIRMED at bar sh
 *   Buffer 1  BearConfirmBuf[sh] = 1.0 when a bear FVG enters CONFIRMED at bar sh
 *   Buffer 2  BullSLBuf[sh]      = retestLow  at that bar  (SL price for bull trades)
 *   Buffer 3  BearSLBuf[sh]      = retestHigh at that bar  (SL price for bear trades)
 *   Access:   iCustom(NULL, InpTF, "FVG_State_Module", <inputs...>, 0/1/2/3, bar_shift)
 *
 * JOURNAL:
 *   FVG_ACTIVE | FVG_RETESTED | FVG_CONFIRMED | FVG_MITIGATED | FVG_INVALIDATED | FVG_EXPIRED
 *
 * NO trading logic. State tracking and visualisation only.
 */

export const FVG_STATE_MODULE_VERSION = "1.1.0";
export const FVG_STATE_MODULE = "FVG_State_Module";

export function generateFvgStateModule(): string {
  return `//+------------------------------------------------------------------+
//| FVG_State_Module.mq5                                          |
//| Phase 2: FVG State Module v${FVG_STATE_MODULE_VERSION}                     |
//|                                                                  |
//| Embeds FVG detection. Manages full lifecycle per zone.         |
//|                                                                  |
//| States:  ACTIVE → RETESTED → CONFIRMED                         |
//|          Any live → MITIGATED / INVALIDATED / EXPIRED          |
//|                                                                  |
//| Phase 3 buffers 0/1: BullConfirm / BearConfirm signal bars.   |
//| NO trading logic. State tracking and visualisation only.       |
//+------------------------------------------------------------------+
#property copyright "EA Builder — Phase 2 State Module"
#property version   "1.10"
#property strict
#property indicator_chart_window
#property indicator_buffers 4
#property indicator_plots   0

// ── FVG direction ─────────────────────────────────────────────────
#define FVG_BULL  1
#define FVG_BEAR -1

// ── Lifecycle states ──────────────────────────────────────────────
#define STATE_ACTIVE       0
#define STATE_RETESTED     1
#define STATE_CONFIRMED    2
#define STATE_MITIGATED    3   // terminal
#define STATE_INVALIDATED  4   // terminal
#define STATE_EXPIRED      5   // terminal
#define STATE_UNDRAWN     -1

#define FVG_MAX    500          // Slot pool — recycled; actual live cap = InpMaxZones
#define FAR_FUTURE ((datetime)4102444800)   // 2100-01-01 00:00 UTC

//+------------------------------------------------------------------+
//| Per-zone state record                                          |
//+------------------------------------------------------------------+
struct FvgRecord
{
   int      id;
   int      dir;           // FVG_BULL or FVG_BEAR
   double   ul;            // upper level
   double   ll;            // lower level
   int      state;
   int      drawnState;    // last rendered state (STATE_UNDRAWN = never drawn)
   int      barsAlive;     // incremented every bar after detection
   datetime leftTime;      // candle 1 time — visual left edge of zone
   datetime detectedTime;  // candle 3 time — lifecycle birth (skip guard)
   datetime retestTime;    // time of most recent retest candle
   double   retestHigh;    // retest candle high
   double   retestLow;     // retest candle low
   datetime confirmTime;   // bar where CONFIRMED state was last reached
   datetime endTime;       // terminal state time (0 = still live)
};

//+------------------------------------------------------------------+
//| Phase 3 indicator buffers (readable via iCustom)               |
//| Buf 0  BullConfirmBuf[sh] = 1.0 when bull FVG confirmed        |
//| Buf 1  BearConfirmBuf[sh] = 1.0 when bear FVG confirmed        |
//| Buf 2  BullSLBuf[sh]      = retestLow  (SL for bull trades)    |
//| Buf 3  BearSLBuf[sh]      = retestHigh (SL for bear trades)    |
//+------------------------------------------------------------------+
double BullConfirmBuf[];
double BearConfirmBuf[];
double BullSLBuf[];
double BearSLBuf[];

//--- Inputs — Detection
input ENUM_TIMEFRAMES InpTF        = PERIOD_CURRENT; // Timeframe
input int             InpLookback  = 500;            // Historical bars to scan

//--- Inputs — Filter
input bool InpShowBull = true; // Track bullish FVG zones
input bool InpShowBear = true; // Track bearish FVG zones

//--- Inputs — Lifecycle
input int  InpExpiryBars     = 100;  // Bars until zone expires (0 = never)
input bool InpRemoveTerminal = true; // Delete objects on MITIGATED / INVALIDATED / EXPIRED
input int  InpMaxZones       = 50;   // Max live zones (oldest ACTIVE pruned when exceeded)

//--- Inputs — Colours
input color InpBullColor    = clrForestGreen;  // ACTIVE bullish zone
input color InpBearColor    = clrCrimson;       // ACTIVE bearish zone
input color InpRetestColor  = clrGold;          // RETESTED zone (both directions)
input color InpConfirmBull  = clrLimeGreen;     // CONFIRMED bullish zone
input color InpConfirmBear  = clrOrangeRed;     // CONFIRMED bearish zone
input color InpMitColor     = clrSilver;        // MITIGATED zone
input color InpInvalidColor = clrDimGray;       // INVALIDATED / EXPIRED zone
input int   InpActiveOpacity = 70;              // Live zone opacity  0-100
input int   InpFadeOpacity   = 25;              // Terminal zone opacity 0-100

//--- Inputs — Logging
input bool InpShowLog = true; // Print state transitions to journal

FvgRecord fvgList[FVG_MAX];
int      fvgTotal    = 0;
int      nextFvgId   = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
string DirStr(int d)     { return d > 0 ? "BULL" : "BEAR"; }
string ObjRect(int id)   { return "SMCFVGS_" + IntegerToString(id) + "_rect"; }
string ObjLbl (int id)   { return "SMCFVGS_" + IntegerToString(id) + "_lbl"; }

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
//| FVG Detection                                                  |
//|                                                                  |
//| sh = candle 3 (newest, just closed).                           |
//| sh+1 = candle 2 (middle).  sh+2 = candle 1 (oldest).          |
//|                                                                  |
//| Bullish: C3.Low  > C1.High  → UL=C3.Low,   LL=C1.High         |
//| Bearish: C3.High < C1.Low   → UL=C1.Low,   LL=C3.High         |
//+------------------------------------------------------------------+
void DetectFvg(int sh)
{
   int avail = iBars(_Symbol, InpTF);
   if(sh + 2 >= avail) return;

   double c1High = iHigh(_Symbol, InpTF, sh + 2);
   double c1Low  = iLow (_Symbol, InpTF, sh + 2);
   double c3High = iHigh(_Symbol, InpTF, sh);
   double c3Low  = iLow (_Symbol, InpTF, sh);

   bool bullFvg = (c3Low  > c1High);
   bool bearFvg = (c3High < c1Low);

   if(!bullFvg && !bearFvg) return;
   if( bullFvg && !InpShowBull) return;
   if( bearFvg && !InpShowBear) return;

   int      dir     = bullFvg ? FVG_BULL : FVG_BEAR;
   double   ul      = bullFvg ? c3Low  : c1Low;    // Bull UL=C3.Low  | Bear UL=C1.Low
   double   ll      = bullFvg ? c1High : c3High;   // Bull LL=C1.High | Bear LL=C3.High
   datetime leftT   = iTime(_Symbol, InpTF, sh + 2); // candle 1 — left edge
   datetime detectT = iTime(_Symbol, InpTF, sh);      // candle 3 — birth

   // Dedup: same candle-1 time + direction (live zones only)
   for(int i = 0; i < fvgTotal; i++)
   {
      int st = fvgList[i].state;
      if(st == STATE_MITIGATED || st == STATE_INVALIDATED || st == STATE_EXPIRED) continue;
      if(fvgList[i].leftTime == leftT && fvgList[i].dir == dir) return;
   }

   // ── Slot allocation: recycle a terminal zone before appending ─────
   // Critical for long backtests — without recycling, fvgTotal hits
   // FVG_MAX after ~month of H1 data and DetectFvg returns early
   // for every subsequent bar, silently killing all future signals.
   int idx = -1;
   for(int i = 0; i < fvgTotal; i++)
   {
      int st = fvgList[i].state;
      if(st == STATE_MITIGATED || st == STATE_INVALIDATED || st == STATE_EXPIRED)
      {
         ObjectDelete(0, ObjRect(fvgList[i].id));
         ObjectDelete(0, ObjLbl (fvgList[i].id));
         idx = i;
         break;
      }
   }
   if(idx < 0)
   {
      if(fvgTotal >= FVG_MAX) return;   // All slots live — hard pool cap reached
      idx = fvgTotal++;
   }

   fvgList[idx].id           = nextFvgId++;
   fvgList[idx].dir          = dir;
   fvgList[idx].ul           = ul;
   fvgList[idx].ll           = ll;
   fvgList[idx].state        = STATE_ACTIVE;
   fvgList[idx].drawnState   = STATE_UNDRAWN;
   fvgList[idx].barsAlive    = 0;
   fvgList[idx].leftTime     = leftT;
   fvgList[idx].detectedTime = detectT;
   fvgList[idx].retestTime   = 0;
   fvgList[idx].retestHigh   = 0.0;
   fvgList[idx].retestLow    = 0.0;
   fvgList[idx].confirmTime  = 0;
   fvgList[idx].endTime      = 0;

   if(InpShowLog)
      PrintFormat("FVG_ACTIVE | id=%d | dir=%s | ul=%.5f | ll=%.5f | time=%s",
         fvgList[idx].id, DirStr(dir), ul, ll,
         TimeToString(detectT, TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
//| Lifecycle update for all live zones at bar sh.                 |
//|                                                                  |
//| Check order (priority high → low):                             |
//|   1. EXPIRED    — age-based cutoff                             |
//|   2. INVALIDATED — close beyond far edge                       |
//|   3. MITIGATED  — close inside zone                            |
//|   4. CONFIRMED  — (state==RETESTED) close back outside         |
//|   5. RETESTED   — wick enters zone                             |
//+------------------------------------------------------------------+
void UpdateFvgStates(int sh)
{
   double   barHigh  = iHigh (_Symbol, InpTF, sh);
   double   barLow   = iLow  (_Symbol, InpTF, sh);
   double   barClose = iClose(_Symbol, InpTF, sh);
   datetime barT     = iTime (_Symbol, InpTF, sh);

   for(int i = 0; i < fvgTotal; i++)
   {
      int st = fvgList[i].state;

      // Skip terminal states
      if(st == STATE_MITIGATED || st == STATE_INVALIDATED || st == STATE_EXPIRED) continue;

      // Zone must have been detected before this bar
      if(fvgList[i].detectedTime >= barT) continue;

      fvgList[i].barsAlive++;

      bool   isBull = (fvgList[i].dir == FVG_BULL);
      double ul     = fvgList[i].ul;
      double ll     = fvgList[i].ll;

      // ── 1. EXPIRED ───────────────────────────────────────────────
      if(InpExpiryBars > 0 && fvgList[i].barsAlive >= InpExpiryBars)
      {
         fvgList[i].state   = STATE_EXPIRED;
         fvgList[i].endTime = barT;
         if(InpShowLog)
            PrintFormat("FVG_EXPIRED | id=%d | dir=%s | ul=%.5f | ll=%.5f | bars=%d | time=%s",
               fvgList[i].id, DirStr(fvgList[i].dir), ul, ll,
               fvgList[i].barsAlive, TimeToString(barT, TIME_DATE|TIME_MINUTES));
         continue;
      }

      // ── 2. INVALIDATED: close beyond far edge ────────────────────
      //    Bull: close < LL (below entire zone)
      //    Bear: close > UL (above entire zone)
      bool invalidated = isBull ? (barClose < ll) : (barClose > ul);
      if(invalidated)
      {
         fvgList[i].state   = STATE_INVALIDATED;
         fvgList[i].endTime = barT;
         if(InpShowLog)
            PrintFormat("FVG_INVALIDATED | id=%d | dir=%s | ul=%.5f | ll=%.5f | close=%.5f | time=%s",
               fvgList[i].id, DirStr(fvgList[i].dir), ul, ll,
               barClose, TimeToString(barT, TIME_DATE|TIME_MINUTES));
         continue;
      }

      // ── 3. MITIGATED: close inside zone (LL ≤ close ≤ UL) ────────
      bool mitigated = (barClose >= ll && barClose <= ul);
      if(mitigated)
      {
         fvgList[i].state   = STATE_MITIGATED;
         fvgList[i].endTime = barT;
         if(InpShowLog)
            PrintFormat("FVG_MITIGATED | id=%d | dir=%s | ul=%.5f | ll=%.5f | close=%.5f | time=%s",
               fvgList[i].id, DirStr(fvgList[i].dir), ul, ll,
               barClose, TimeToString(barT, TIME_DATE|TIME_MINUTES));
         continue;
      }

      // ── 4. CONFIRMED: RETESTED → close back outside near edge ────
      //    Bull: close > UL (price left zone upward — zone held)
      //    Bear: close < LL (price left zone downward — zone held)
      if(fvgList[i].state == STATE_RETESTED)
      {
         bool confirmed = isBull ? (barClose > ul) : (barClose < ll);
         if(confirmed)
         {
            fvgList[i].state       = STATE_CONFIRMED;
            fvgList[i].confirmTime = barT;

            // Phase 3 signal buffers — live write during OnCalculate
            // Historical backfill happens in OnCalculate when prev_calculated==0
            if(sh >= 0)
            {
               if(isBull)
               {
                  if(sh < ArraySize(BullConfirmBuf)) BullConfirmBuf[sh] = 1.0;
                  if(sh < ArraySize(BullSLBuf))     BullSLBuf[sh]     = fvgList[i].retestLow;
               }
               else
               {
                  if(sh < ArraySize(BearConfirmBuf)) BearConfirmBuf[sh] = 1.0;
                  if(sh < ArraySize(BearSLBuf))     BearSLBuf[sh]     = fvgList[i].retestHigh;
               }
            }

            if(InpShowLog)
               PrintFormat("FVG_CONFIRMED | id=%d | dir=%s | ul=%.5f | ll=%.5f | retest=%s | confirm=%s",
                  fvgList[i].id, DirStr(fvgList[i].dir), ul, ll,
                  TimeToString(fvgList[i].retestTime, TIME_DATE|TIME_MINUTES),
                  TimeToString(barT, TIME_DATE|TIME_MINUTES));
            continue;
         }
      }

      // ── 5. RETESTED: wick enters zone ────────────────────────────
      //    Only transitions from ACTIVE or CONFIRMED (cycle allowed).
      //    Bull: barLow  <= UL (wick dips into zone from above)
      //    Bear: barHigh >= LL (wick rises into zone from below)
      if(fvgList[i].state != STATE_RETESTED)
      {
         bool retested = isBull ? (barLow <= ul) : (barHigh >= ll);
         if(retested)
         {
            fvgList[i].state      = STATE_RETESTED;
            fvgList[i].retestTime = barT;
            fvgList[i].retestHigh = barHigh;
            fvgList[i].retestLow  = barLow;
            if(InpShowLog)
               PrintFormat("FVG_RETESTED | id=%d | dir=%s | ul=%.5f | ll=%.5f | low=%.5f | high=%.5f | time=%s",
                  fvgList[i].id, DirStr(fvgList[i].dir), ul, ll,
                  barLow, barHigh, TimeToString(barT, TIME_DATE|TIME_MINUTES));
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Prune oldest ACTIVE zone when live count > InpMaxZones         |
//+------------------------------------------------------------------+
void EnforceMaxZones()
{
   if(InpMaxZones <= 0) return;
   int cnt = 0;
   for(int i = 0; i < fvgTotal; i++)
      if(fvgList[i].state <= STATE_CONFIRMED) cnt++; // live states only

   while(cnt > InpMaxZones)
   {
      int oldest = -1; datetime oldT = (datetime)LONG_MAX;
      for(int i = 0; i < fvgTotal; i++)
      {
         if(fvgList[i].state > STATE_CONFIRMED) continue;
         if(fvgList[i].detectedTime < oldT) { oldT = fvgList[i].detectedTime; oldest = i; }
      }
      if(oldest < 0) break;
      ObjectDelete(0, ObjRect(fvgList[oldest].id));
      ObjectDelete(0, ObjLbl (fvgList[oldest].id));
      fvgList[oldest].state      = STATE_EXPIRED;
      fvgList[oldest].endTime    = fvgList[oldest].detectedTime;
      fvgList[oldest].drawnState = STATE_EXPIRED;
      cnt--;
   }
}

//+------------------------------------------------------------------+
//| Draw (or redraw) one zone — delete + recreate on state change  |
//+------------------------------------------------------------------+
void FVG_DrawOne(int idx)
{
   int      st     = fvgList[idx].state;
   int      dir    = fvgList[idx].dir;
   bool     isBull = (dir == FVG_BULL);
   double   ul     = fvgList[idx].ul;
   double   ll     = fvgList[idx].ll;
   datetime tLeft  = fvgList[idx].leftTime;

   // Right edge: live zones extend to far future; terminal zones stop at endTime
   bool     isLive = (st <= STATE_CONFIRMED); // ACTIVE / RETESTED / CONFIRMED
   datetime tRight = isLive ? FAR_FUTURE
                             : (fvgList[idx].endTime > 0 ? fvgList[idx].endTime : tLeft);

   ObjectDelete(0, ObjRect(fvgList[idx].id));
   ObjectDelete(0, ObjLbl (fvgList[idx].id));

   if(!isLive && InpRemoveTerminal) { fvgList[idx].drawnState = st; return; }

   // ── Resolve visual properties per state ──────────────────────
   color rawClr;
   int   opacity;
   int   bwidth  = 1;
   bool  dashed  = false;

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

   // ── Rectangle ────────────────────────────────────────────────
   if(ObjectCreate(0, ObjRect(fvgList[idx].id), OBJ_RECTANGLE, 0,
                   tLeft, ul, tRight, ll))
   {
      ObjectSetInteger(0, ObjRect(fvgList[idx].id), OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, ObjRect(fvgList[idx].id), OBJPROP_FILL,       true);
      ObjectSetInteger(0, ObjRect(fvgList[idx].id), OBJPROP_STYLE,      dashed ? STYLE_DASH : STYLE_SOLID);
      ObjectSetInteger(0, ObjRect(fvgList[idx].id), OBJPROP_WIDTH,      bwidth);
      ObjectSetInteger(0, ObjRect(fvgList[idx].id), OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, ObjRect(fvgList[idx].id), OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, ObjRect(fvgList[idx].id), OBJPROP_BACK,       true);
   }

   // ── Label at zone midpoint ────────────────────────────────────
   string lbl;
   switch(st)
   {
      case STATE_ACTIVE:      lbl = isBull ? "FVG↑" : "FVG↓"; break;
      case STATE_RETESTED:    lbl = "FVG-T"; break;
      case STATE_CONFIRMED:   lbl = "FVG-C"; break;
      case STATE_MITIGATED:   lbl = "FVG-M"; break;
      case STATE_INVALIDATED: lbl = "FVG-X"; break;
      default:                lbl = "FVG-E"; break;
   }
   double midP = (ul + ll) * 0.5;
   if(ObjectCreate(0, ObjLbl(fvgList[idx].id), OBJ_TEXT, 0, tLeft, midP))
   {
      ObjectSetString( 0, ObjLbl(fvgList[idx].id), OBJPROP_TEXT,       lbl);
      ObjectSetInteger(0, ObjLbl(fvgList[idx].id), OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, ObjLbl(fvgList[idx].id), OBJPROP_FONTSIZE,   7);
      ObjectSetInteger(0, ObjLbl(fvgList[idx].id), OBJPROP_ANCHOR,     ANCHOR_LEFT);
      ObjectSetInteger(0, ObjLbl(fvgList[idx].id), OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, ObjLbl(fvgList[idx].id), OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, ObjLbl(fvgList[idx].id), OBJPROP_BACK,       false);
   }

   fvgList[idx].drawnState = st;
}

//+------------------------------------------------------------------+
void FVG_DrawAll()
{
   for(int i = 0; i < fvgTotal; i++)
      if(fvgList[i].drawnState != fvgList[i].state)
         FVG_DrawOne(i);
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
void DeleteAllObjects()
{
   for(int i = ObjectsTotal(0) - 1; i >= 0; i--)
   {
      string nm = ObjectName(0, i);
      if(StringFind(nm, "SMCFVGS_") == 0) ObjectDelete(0, nm);
   }
}

//+------------------------------------------------------------------+
int OnInit()
{
   // ── Phase 3 buffer registration ───────────────────────────────
   // Buffers are populated on first OnCalculate call (prev_calculated==0).
   // Live events write directly during bar-close processing.
   SetIndexBuffer(0, BullConfirmBuf, INDICATOR_DATA);
   SetIndexBuffer(1, BearConfirmBuf, INDICATOR_DATA);
   SetIndexBuffer(2, BullSLBuf,     INDICATOR_DATA);
   SetIndexBuffer(3, BearSLBuf,     INDICATOR_DATA);
   PlotIndexSetString(0, PLOT_LABEL, "Bull FVG Confirmed");
   PlotIndexSetString(1, PLOT_LABEL, "Bear FVG Confirmed");
   PlotIndexSetString(2, PLOT_LABEL, "Bull FVG SL");
   PlotIndexSetString(3, PLOT_LABEL, "Bear FVG SL");
   ArrayInitialize(BullSLBuf, 0.0);
   ArrayInitialize(BearSLBuf, 0.0);

   DeleteAllObjects();
   fvgTotal = 0; nextFvgId = 0;

   int avail = iBars(_Symbol, InpTF);
   if(avail < 3) { Print("FVG_State_Module: not enough bars."); return INIT_FAILED; }

   int limit = MathMin(InpLookback, avail - 3);

   // ── Chronological scan ─────────────────────────────────────────
   //
   // sh = candle 3 bar shift.  Oldest → newest (high shift → low shift).
   //
   // DetectFvg(sh)       — creates FVG record when candles sh+2,sh+1,sh qualify.
   //                        detectedTime = iTime(sh); lifecycle skip guard ensures
   //                        the new zone is not processed on the same bar.
   // UpdateFvgStates(sh) — advances states for all zones with detectedTime < barTime.
   for(int sh = limit; sh >= 1; sh--)
   {
      DetectFvg(sh);
      UpdateFvgStates(sh);
   }

   EnforceMaxZones();
   FVG_DrawAll();

   int nA=0,nR=0,nC=0,nM=0,nI=0,nE=0;
   for(int i=0;i<fvgTotal;i++)
   {
      switch(fvgList[i].state)
      {
         case STATE_ACTIVE:      nA++; break;
         case STATE_RETESTED:    nR++; break;
         case STATE_CONFIRMED:   nC++; break;
         case STATE_MITIGATED:   nM++; break;
         case STATE_INVALIDATED: nI++; break;
         case STATE_EXPIRED:     nE++; break;
      }
   }
   PrintFormat("FVG_State_Module v1 ready | active=%d retested=%d confirmed=%d mitigated=%d invalidated=%d expired=%d | %s %s",
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
   // ── First call: backfill Phase 3 signal buffers ────────────────
   // fvgList was already built in OnInit; buffers are now allocated
   // and sized to rates_total. Walk the list and stamp CONFIRMED bars.
   if(prev_calculated == 0)
   {
      ArrayInitialize(BullConfirmBuf, 0.0);
      ArrayInitialize(BearConfirmBuf, 0.0);
      ArrayInitialize(BullSLBuf,     0.0);
      ArrayInitialize(BearSLBuf,     0.0);
      for(int i = 0; i < fvgTotal; i++)
      {
         if(fvgList[i].confirmTime == 0) continue;
         int si = iBarShift(_Symbol, InpTF, fvgList[i].confirmTime, false);
         if(si < 0 || si >= rates_total) continue;
         if(fvgList[i].dir == FVG_BULL)
         {
            BullConfirmBuf[si] = 1.0;
            BullSLBuf[si]      = fvgList[i].retestLow;
         }
         else
         {
            BearConfirmBuf[si] = 1.0;
            BearSLBuf[si]      = fvgList[i].retestHigh;
         }
      }
      lastBarTime = iTime(_Symbol, InpTF, 0);
      return rates_total;
   }

   // ── Bar-open guard ─────────────────────────────────────────────
   datetime currentBar = iTime(_Symbol, InpTF, 0);
   if(currentBar == lastBarTime) return rates_total;
   lastBarTime = currentBar;

   // Bar 1 just closed (sh=1):
   //   Candle 3 = bar 1 · Candle 2 = bar 2 · Candle 1 = bar 3
   DetectFvg(1);
   UpdateFvgStates(1);

   EnforceMaxZones();
   FVG_DrawAll();

   return rates_total;
}
`;
}
