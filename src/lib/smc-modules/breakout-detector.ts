/**
 * SNR Module Library — Phase 1: Breakout Detector
 *
 * Breakout_Detector v1.0.0
 * ────────────────────────────────────────────────
 * Detects breakouts of Classic SNR levels (candle CLOSE confirmation only).
 *
 * DEPENDENCY: Embeds Classic SNR detection internally.
 *   Classic SNR is detected from candle-pair direction reversals.
 *   Only Classic SNR levels generate breakouts. Gap SNR is ignored.
 *
 * BREAKOUT RULES:
 *   Bullish BO: candle CLOSE > Classic Resistance level
 *   Bearish BO: candle CLOSE < Classic Support level
 *   Wick breaks do NOT count (close_only default).
 *
 * LIFECYCLE STATES:
 *   ACTIVE     → breakout bar detected
 *   CONFIRMED  → first bar after breakout that does not close back through
 *   RETESTED   → price returns to touch the level from the correct side (wick)
 *   INVALIDATED→ price closes back through the broken level
 *   EXPIRED    → InpExpiryBars bars elapsed without invalidation
 *
 * DRAWN ELEMENTS:
 *   OBJ_TREND  line  at level — from SNR origin to breakout bar, extending right
 *   OBJ_TEXT   label at breakout bar ("Bull BO" / "Bear BO")
 *   OBJ_ARROW  marker at breakout bar (▲ bull / ▼ bear)
 *
 * JOURNAL:
 *   BREAKOUT_CREATED     | id | snr_id | dir | level | time
 *   BREAKOUT_CONFIRMED   | id | snr_id | dir | level | time
 *   BREAKOUT_RETESTED    | id | snr_id | dir | level | time
 *   BREAKOUT_INVALIDATED | id | snr_id | dir | level | time
 *   BREAKOUT_EXPIRED     | id | snr_id | dir | level | time
 *
 * FILTERS (optional):
 *   Body size   — breaking candle body ≥ N points
 *   Min distance— close ≥ N points beyond level
 *   ATR filter  — close ≥ InpAtrMult × ATR(14) beyond level
 *
 * NO trading logic. Detection and visualisation only.
 */

export const BREAKOUT_DETECTOR_VERSION = "1.0.0";
export const BREAKOUT_DETECTOR_MODULE  = "Breakout_Detector";

export function generateBreakoutDetector(): string {
  return `//+------------------------------------------------------------------+
//| Breakout_Detector.mq5                                          |
//| SNR Module Library v${BREAKOUT_DETECTOR_VERSION} — Phase 1: Detection Only  |
//|                                                                  |
//| Detects breakouts of Classic SNR levels (close confirmation).  |
//| Classic SNR: candle-pair direction reversal; level = A close.  |
//|                                                                  |
//| Bullish BO: close > Classic Resistance                          |
//| Bearish BO: close < Classic Support                             |
//| Wick breaks do NOT count (InpConfirmMode default = close_only) |
//|                                                                  |
//| States: ACTIVE → CONFIRMED → RETESTED → INVALIDATED / EXPIRED  |
//| NO trading logic. Detection and visualisation only.            |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SNR Module Library"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

// ── Classic SNR types (embedded detection) ───────────────────────
#define SNR_SUPPORT      1
#define SNR_RESISTANCE   2

// ── Breakout lifecycle states ────────────────────────────────────
#define BO_ACTIVE        0
#define BO_CONFIRMED     1
#define BO_RETESTED      2
#define BO_INVALIDATED   3
#define BO_EXPIRED       4
#define BO_UNDRAWN      -1

#define SNR_MAX 600
#define BO_MAX  300

enum ENUM_CONFIRM_MODE
{
   CONFIRM_CLOSE = 0, // Candle close beyond level (default — recommended)
   CONFIRM_WICK  = 1  // Wick breach of level
};

//--- Inputs — Detection
input ENUM_TIMEFRAMES   InpTF          = PERIOD_CURRENT; // Timeframe
input int               InpLookback    = 500;            // Historical bars to scan
input bool              InpShowBull    = true;           // Show bullish breakouts
input bool              InpShowBear    = true;           // Show bearish breakouts
input bool              InpIgnoreDoji  = true;           // Skip neutral candles (Classic SNR)
input int               InpDojiPoints  = 0;              // Doji body threshold in points (0 = exact)

//--- Inputs — Confirmation
input ENUM_CONFIRM_MODE InpConfirmMode = CONFIRM_CLOSE;  // Breakout confirmation method

//--- Inputs — Filters
input int    InpMinBodyPts   = 0;     // Min body size of breakout candle (points, 0 = off)
input int    InpMinBreakDist = 0;     // Min close distance beyond level (points, 0 = off)
input bool   InpUseAtrFilt   = false; // Use ATR-based minimum distance filter
input double InpAtrMult      = 0.5;   // ATR multiplier (used when InpUseAtrFilt = true)
input int    InpAtrPeriod    = 14;    // ATR period

//--- Inputs — Lifecycle
input int  InpExpiryBars    = 100;   // Bars until breakout expires (0 = never)
input bool InpRemoveInvalid = true;  // Remove invalidated / expired objects
input int  InpMaxBreakouts  = 100;   // Max active breakouts visible

//--- Inputs — Colours
input color InpBullColor    = clrDodgerBlue; // Bullish breakout colour
input color InpBearColor    = clrCrimson;    // Bearish breakout colour
input color InpRetestColor  = clrGold;       // Retested breakout colour
input color InpInvalidColor = clrDimGray;    // Invalidated / expired colour
input int   InpOpacity      = 85;            // Active level opacity 0-100
input int   InpFadeOpacity  = 35;            // Invalidated level opacity 0-100

//--- Inputs — Logging
input bool InpShowLog = true; // Print lifecycle events to journal

//+------------------------------------------------------------------+
//| Embedded Classic SNR record                                     |
//+------------------------------------------------------------------+
struct SnrLevel
{
   int      id;
   int      type;         // SNR_SUPPORT or SNR_RESISTANCE
   double   price;        // Candle A close
   datetime candleATime;
   datetime candleBTime;
   bool     broken;       // consumed by a breakout
};

//+------------------------------------------------------------------+
//| Breakout record                                                 |
//+------------------------------------------------------------------+
struct BoRecord
{
   int      id;
   int      snrId;           // linked Classic SNR level id
   int      dir;             // +1 bullish, -1 bearish
   int      state;
   int      drawnState;      // BO_UNDRAWN or last drawn state
   int      ageCounter;      // bars elapsed since breakout bar
   double   level;           // Classic SNR price (the broken level)
   datetime snrCandleATime;  // left anchor of the line (SNR origin)
   datetime breakoutTime;    // bar when breakout occurred
   datetime endTime;         // 0 = still live
};

SnrLevel snrList[SNR_MAX];
BoRecord boList [BO_MAX];
int      snrTotal    = 0;
int      boTotal     = 0;
int      nextSnrId   = 0;
int      nextBoId    = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
string DirName(int d) { return d > 0 ? "BULLISH" : "BEARISH"; }

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

string ObjLine(int id) { return "SMCBO_" + IntegerToString(id) + "_ln"; }
string ObjLbl (int id) { return "SMCBO_" + IntegerToString(id) + "_lb"; }
string ObjArr (int id) { return "SMCBO_" + IntegerToString(id) + "_ar"; }

//+------------------------------------------------------------------+
//| Candle direction: +1 bullish, -1 bearish, 0 doji / neutral     |
//+------------------------------------------------------------------+
int CandleDir(int sh)
{
   double c    = iClose(_Symbol, InpTF, sh);
   double o    = iOpen (_Symbol, InpTF, sh);
   double body = MathAbs(c - o);
   if(InpIgnoreDoji)
   {
      double thr = (InpDojiPoints > 0) ? InpDojiPoints * _Point : 0.0;
      if(body <= thr) return 0;
   }
   if(c > o) return  1;
   if(c < o) return -1;
   return 0;
}

//+------------------------------------------------------------------+
//| Self-contained ATR — SMA of True Range over 'period' bars      |
//+------------------------------------------------------------------+
double CalcATR(int sh, int period)
{
   int avail = iBars(_Symbol, InpTF);
   if(sh + period + 1 >= avail || period <= 0) return _Point;
   double sum = 0.0;
   for(int i = 0; i < period; i++)
   {
      double hi = iHigh (_Symbol, InpTF, sh + i);
      double lo = iLow  (_Symbol, InpTF, sh + i);
      double pc = iClose(_Symbol, InpTF, sh + i + 1);
      sum += MathMax(hi - lo, MathMax(MathAbs(hi - pc), MathAbs(lo - pc)));
   }
   return sum / period;
}

//+------------------------------------------------------------------+
//| Optional breakout quality filters.                              |
//| dir: +1 = bullish break (close > level), -1 = bearish          |
//+------------------------------------------------------------------+
bool BreakoutFilter(int sh, double level, int dir)
{
   double closePrice = iClose(_Symbol, InpTF, sh);
   double dist       = dir > 0 ? (closePrice - level) : (level - closePrice);

   // Body size filter
   if(InpMinBodyPts > 0)
   {
      double body = MathAbs(iClose(_Symbol, InpTF, sh) - iOpen(_Symbol, InpTF, sh));
      if(body < InpMinBodyPts * _Point) return false;
   }

   // Fixed-point minimum distance filter
   if(InpMinBreakDist > 0 && dist < InpMinBreakDist * _Point) return false;

   // ATR-based minimum distance filter
   if(InpUseAtrFilt)
   {
      double atr = CalcATR(sh, InpAtrPeriod);
      if(dist < InpAtrMult * atr) return false;
   }

   return true;
}

//+------------------------------------------------------------------+
//| Add a Classic SNR level from the pair (shA = older, shB = newer)|
//| Called chronologically so shB is the bar just closed.          |
//+------------------------------------------------------------------+
void AddSnrLevel(int shA, int shB)
{
   int avail = iBars(_Symbol, InpTF);
   if(shA >= avail || shB < 0) return;

   int dirA = CandleDir(shA);
   int dirB = CandleDir(shB);
   if(dirA == 0 || dirB == 0) return; // doji — skip

   int snrType = 0;
   if(dirA > 0 && dirB < 0) snrType = SNR_RESISTANCE; // Bull A → Bear B
   if(dirA < 0 && dirB > 0) snrType = SNR_SUPPORT;    // Bear A → Bull B
   if(snrType == 0) return;                            // same direction = Gap SNR; ignore

   double   lvl   = iClose(_Symbol, InpTF, shA);
   datetime timeA = iTime (_Symbol, InpTF, shA);
   datetime timeB = iTime (_Symbol, InpTF, shB);

   // Dedup by candleA time + type
   for(int i = 0; i < snrTotal; i++)
      if(snrList[i].candleATime == timeA && snrList[i].type == snrType) return;

   if(snrTotal >= SNR_MAX) return;

   int idx = snrTotal++;
   snrList[idx].id          = nextSnrId++;
   snrList[idx].type        = snrType;
   snrList[idx].price       = lvl;
   snrList[idx].candleATime = timeA;
   snrList[idx].candleBTime = timeB;
   snrList[idx].broken      = false;
}

//+------------------------------------------------------------------+
//| Check bar sh for a breakout of any active Classic SNR level.   |
//+------------------------------------------------------------------+
void CheckBreakout(int sh)
{
   double   barClose = iClose(_Symbol, InpTF, sh);
   double   barHigh  = iHigh (_Symbol, InpTF, sh);
   double   barLow   = iLow  (_Symbol, InpTF, sh);
   datetime barT     = iTime (_Symbol, InpTF, sh);

   for(int i = 0; i < snrTotal; i++)
   {
      if(snrList[i].broken) continue;
      // Level must have been confirmed (candleBTime) before this bar
      if(snrList[i].candleBTime >= barT) continue;

      double lvl       = snrList[i].price;
      bool   isResist  = (snrList[i].type == SNR_RESISTANCE);

      // Break price depends on confirmation mode
      double breakPrice = (InpConfirmMode == CONFIRM_WICK)
                        ? (isResist ? barHigh : barLow)
                        : barClose;

      bool boBull = isResist  && breakPrice > lvl;
      bool boBear = !isResist && breakPrice < lvl;
      if(!boBull && !boBear) continue;

      int dir = boBull ? +1 : -1;
      if(dir == +1 && !InpShowBull) { snrList[i].broken = true; continue; }
      if(dir == -1 && !InpShowBear) { snrList[i].broken = true; continue; }

      // Apply optional quality filters
      if(!BreakoutFilter(sh, lvl, dir)) continue;

      // Mark SNR consumed
      snrList[i].broken = true;

      if(boTotal >= BO_MAX) continue;

      int idx = boTotal++;
      boList[idx].id             = nextBoId++;
      boList[idx].snrId          = snrList[i].id;
      boList[idx].dir            = dir;
      boList[idx].state          = BO_ACTIVE;
      boList[idx].drawnState     = BO_UNDRAWN;
      boList[idx].ageCounter     = 0;
      boList[idx].level          = lvl;
      boList[idx].snrCandleATime = snrList[i].candleATime;
      boList[idx].breakoutTime   = barT;
      boList[idx].endTime        = 0;

      if(InpShowLog)
         PrintFormat("BREAKOUT_CREATED | id=%d | snr_id=%d | dir=%s | level=%.5f | time=%s",
            boList[idx].id, boList[idx].snrId, DirName(dir), lvl,
            TimeToString(barT, TIME_DATE|TIME_MINUTES));
   }
}

//+------------------------------------------------------------------+
//| Update lifecycle for all live breakouts at bar sh.             |
//+------------------------------------------------------------------+
void UpdateBoLifecycle(int sh)
{
   double   barHigh  = iHigh (_Symbol, InpTF, sh);
   double   barLow   = iLow  (_Symbol, InpTF, sh);
   double   barClose = iClose(_Symbol, InpTF, sh);
   datetime barT     = iTime (_Symbol, InpTF, sh);

   for(int i = 0; i < boTotal; i++)
   {
      if(boList[i].state == BO_INVALIDATED || boList[i].state == BO_EXPIRED) continue;
      // Only process breakouts confirmed before this bar
      if(boList[i].breakoutTime >= barT) continue;

      boList[i].ageCounter++;

      // ── Expiry ────────────────────────────────────────────────────
      if(InpExpiryBars > 0 && boList[i].ageCounter >= InpExpiryBars)
      {
         boList[i].state   = BO_EXPIRED;
         boList[i].endTime = barT;
         if(InpShowLog)
            PrintFormat("BREAKOUT_EXPIRED | id=%d | snr_id=%d | dir=%s | level=%.5f | time=%s",
               boList[i].id, boList[i].snrId, DirName(boList[i].dir), boList[i].level,
               TimeToString(barT, TIME_DATE|TIME_MINUTES));
         continue;
      }

      double lvl    = boList[i].level;
      bool   isBull = (boList[i].dir == +1);

      // ── Invalidation: close back through the broken level ─────────
      bool invalidated = isBull ? (barClose < lvl) : (barClose > lvl);
      if(invalidated)
      {
         boList[i].state   = BO_INVALIDATED;
         boList[i].endTime = barT;
         if(InpShowLog)
            PrintFormat("BREAKOUT_INVALIDATED | id=%d | snr_id=%d | dir=%s | level=%.5f | time=%s",
               boList[i].id, boList[i].snrId, DirName(boList[i].dir), lvl,
               TimeToString(barT, TIME_DATE|TIME_MINUTES));
         continue;
      }

      // ── Confirmation: ACTIVE → CONFIRMED on first non-invalidated bar ─
      if(boList[i].state == BO_ACTIVE)
      {
         boList[i].state = BO_CONFIRMED;
         if(InpShowLog)
            PrintFormat("BREAKOUT_CONFIRMED | id=%d | snr_id=%d | dir=%s | level=%.5f | time=%s",
               boList[i].id, boList[i].snrId, DirName(boList[i].dir), lvl,
               TimeToString(barT, TIME_DATE|TIME_MINUTES));
      }

      // ── Retest: wick returns to level without closing through ─────
      // Only transitions from CONFIRMED → RETESTED (once)
      if(boList[i].state == BO_CONFIRMED)
      {
         bool retested = isBull ? (barLow <= lvl) : (barHigh >= lvl);
         if(retested)
         {
            boList[i].state = BO_RETESTED;
            if(InpShowLog)
               PrintFormat("BREAKOUT_RETESTED | id=%d | snr_id=%d | dir=%s | level=%.5f | time=%s",
                  boList[i].id, boList[i].snrId, DirName(boList[i].dir), lvl,
                  TimeToString(barT, TIME_DATE|TIME_MINUTES));
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Prune oldest active breakouts when count > InpMaxBreakouts      |
//+------------------------------------------------------------------+
void EnforceMaxBreakouts()
{
   if(InpMaxBreakouts <= 0) return;
   int cnt = 0;
   for(int i = 0; i < boTotal; i++)
      if(boList[i].state <= BO_RETESTED) cnt++; // ACTIVE / CONFIRMED / RETESTED

   while(cnt > InpMaxBreakouts)
   {
      int oldest = -1; datetime oldestT = (datetime)LONG_MAX;
      for(int i = 0; i < boTotal; i++)
      {
         if(boList[i].state > BO_RETESTED) continue;
         if(boList[i].breakoutTime < oldestT) { oldestT = boList[i].breakoutTime; oldest = i; }
      }
      if(oldest < 0) break;
      ObjectDelete(0, ObjLine(boList[oldest].id));
      ObjectDelete(0, ObjLbl (boList[oldest].id));
      ObjectDelete(0, ObjArr (boList[oldest].id));
      boList[oldest].state      = BO_EXPIRED;
      boList[oldest].endTime    = boList[oldest].breakoutTime;
      boList[oldest].drawnState = BO_EXPIRED;
      cnt--;
   }
}

//+------------------------------------------------------------------+
//| Resolve colour for the current breakout state.                 |
//+------------------------------------------------------------------+
color GetBoColor(int idx)
{
   int st = boList[idx].state;
   if(st == BO_INVALIDATED || st == BO_EXPIRED) return InpInvalidColor;
   if(st == BO_RETESTED)                        return InpRetestColor;
   return boList[idx].dir > 0 ? InpBullColor : InpBearColor;
}

//+------------------------------------------------------------------+
//| Draw or redraw one breakout (delete + recreate on state change) |
//+------------------------------------------------------------------+
void BO_DrawOne(int idx)
{
   int      st    = boList[idx].state;
   int      dir   = boList[idx].dir;
   double   lvl   = boList[idx].level;
   datetime tLeft = boList[idx].snrCandleATime;
   datetime tBO   = boList[idx].breakoutTime;

   // Delete existing objects
   ObjectDelete(0, ObjLine(boList[idx].id));
   ObjectDelete(0, ObjLbl (boList[idx].id));
   ObjectDelete(0, ObjArr (boList[idx].id));

   bool active = (st <= BO_RETESTED); // ACTIVE / CONFIRMED / RETESTED

   // Remove from chart if inactive and InpRemoveInvalid is set
   if(!active && InpRemoveInvalid) { boList[idx].drawnState = st; return; }

   int   opacity  = active ? InpOpacity : InpFadeOpacity;
   color rawClr   = GetBoColor(idx);
   color clr      = BlendWithBg(rawClr, opacity);
   int   lstyle   = active ? STYLE_SOLID : STYLE_DASH;
   bool  ray      = active; // extend right while active
   datetime tRight = active ? tBO
                             : (boList[idx].endTime > 0 ? boList[idx].endTime : tBO);

   // ── Horizontal level line ────────────────────────────────────────
   if(ObjectCreate(0, ObjLine(boList[idx].id), OBJ_TREND, 0, tLeft, lvl, tRight, lvl))
   {
      ObjectSetInteger(0, ObjLine(boList[idx].id), OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, ObjLine(boList[idx].id), OBJPROP_STYLE,      lstyle);
      ObjectSetInteger(0, ObjLine(boList[idx].id), OBJPROP_WIDTH,      1);
      ObjectSetInteger(0, ObjLine(boList[idx].id), OBJPROP_RAY_RIGHT,  ray ? 1 : 0);
      ObjectSetInteger(0, ObjLine(boList[idx].id), OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, ObjLine(boList[idx].id), OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, ObjLine(boList[idx].id), OBJPROP_BACK,       true);
   }

   // ── Text label at breakout bar ───────────────────────────────────
   if(ObjectCreate(0, ObjLbl(boList[idx].id), OBJ_TEXT, 0, tBO, lvl))
   {
      ObjectSetString( 0, ObjLbl(boList[idx].id), OBJPROP_TEXT,
         dir > 0 ? "Bull BO" : "Bear BO");
      ObjectSetInteger(0, ObjLbl(boList[idx].id), OBJPROP_COLOR,    clr);
      ObjectSetInteger(0, ObjLbl(boList[idx].id), OBJPROP_FONTSIZE, 7);
      ObjectSetInteger(0, ObjLbl(boList[idx].id), OBJPROP_ANCHOR,
         dir > 0 ? ANCHOR_LEFT_LOWER : ANCHOR_LEFT_UPPER);
      ObjectSetInteger(0, ObjLbl(boList[idx].id), OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, ObjLbl(boList[idx].id), OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, ObjLbl(boList[idx].id), OBJPROP_BACK,       false);
   }

   // ── Arrow marker at breakout bar (▲ bull / ▼ bear) ───────────────
   if(ObjectCreate(0, ObjArr(boList[idx].id), OBJ_ARROW, 0, tBO, lvl))
   {
      // code 233 = ▲ (up), code 234 = ▼ (down)
      ObjectSetInteger(0, ObjArr(boList[idx].id), OBJPROP_ARROWCODE,  dir > 0 ? 233 : 234);
      ObjectSetInteger(0, ObjArr(boList[idx].id), OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, ObjArr(boList[idx].id), OBJPROP_WIDTH,      1);
      ObjectSetInteger(0, ObjArr(boList[idx].id), OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, ObjArr(boList[idx].id), OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, ObjArr(boList[idx].id), OBJPROP_BACK,       false);
   }

   boList[idx].drawnState = st;
}

//+------------------------------------------------------------------+
void BO_DrawAll()
{
   for(int i = 0; i < boTotal; i++)
      if(boList[i].drawnState != boList[i].state)
         BO_DrawOne(i);
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
void DeleteAllObjects()
{
   for(int i = ObjectsTotal(0) - 1; i >= 0; i--)
   {
      string nm = ObjectName(0, i);
      if(StringFind(nm, "SMCBO_") == 0) ObjectDelete(0, nm);
   }
}

//+------------------------------------------------------------------+
int OnInit()
{
   DeleteAllObjects();
   snrTotal = 0; boTotal = 0; nextSnrId = 0; nextBoId = 0;

   int avail = iBars(_Symbol, InpTF);
   if(avail < 3) { Print("Breakout_Detector: not enough bars."); return INIT_FAILED; }

   int limit = MathMin(InpLookback, avail - 2);

   // ── Interleaved chronological scan (oldest → newest) ─────────────
   //
   // At shift sh, candle B just closed → confirm the pair (sh+1, sh)
   // as a Classic SNR level, then check if bar sh breaks any prior level,
   // then update lifecycle for all existing breakouts at bar sh.
   for(int sh = limit; sh >= 1; sh--)
   {
      AddSnrLevel(sh + 1, sh);   // Candle A = sh+1, Candle B = sh
      CheckBreakout(sh);          // Does bar sh break any SNR level?
      UpdateBoLifecycle(sh);      // Update live breakouts at bar sh
   }

   EnforceMaxBreakouts();
   BO_DrawAll();

   // Summary
   int nAct=0, nCon=0, nRet=0, nInv=0, nExp=0;
   for(int i=0; i<boTotal; i++)
   {
      switch(boList[i].state)
      {
         case BO_ACTIVE:      nAct++; break;
         case BO_CONFIRMED:   nCon++; break;
         case BO_RETESTED:    nRet++; break;
         case BO_INVALIDATED: nInv++; break;
         case BO_EXPIRED:     nExp++; break;
      }
   }
   PrintFormat("Breakout_Detector v1 ready | active=%d confirmed=%d retested=%d invalidated=%d expired=%d | %s %s",
      nAct, nCon, nRet, nInv, nExp, _Symbol, EnumToString(InpTF));
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
   datetime currentBar = iTime(_Symbol, InpTF, 0);
   if(currentBar == lastBarTime) return rates_total;
   lastBarTime = currentBar;

   // Bar 1 just closed:
   //   Candle A = bar 2 (older), Candle B = bar 1 (just closed)
   AddSnrLevel(2, 1);

   // Did bar 1 break any active Classic SNR level?
   CheckBreakout(1);

   // Update lifecycle for breakouts created before bar 1
   UpdateBoLifecycle(1);

   EnforceMaxBreakouts();
   BO_DrawAll();

   return rates_total;
}
`;
}
