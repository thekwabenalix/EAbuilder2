/**
 * SNR Module Library — Phase 1: Gap SNR Detector
 *
 * Gap_SNR_Detector v1.0.0
 * ────────────────────────────────────────────────
 * Gap Support / Resistance levels from candle-pair direction continuation.
 *
 * SNR PRICE = Candle A close.
 *
 * GAP SUPPORT:    Bullish Candle A → Bullish Candle B
 * GAP RESISTANCE: Bearish Candle A → Bearish Candle B
 *
 * LIFECYCLE STATES:
 *   ACTIVE  → no touch yet
 *   TOUCHED → wick reached the level (not broken)
 *   BROKEN  → candle closed through the level
 *   EXPIRED → level not broken within InpExpiryBars bars
 *
 * DRAWN ELEMENTS:
 *   Solid OBJ_TREND line extending right while ACTIVE / TOUCHED.
 *   Line stops (RAY_RIGHT=false, dashed) or is deleted when BROKEN / EXPIRED.
 *   OBJ_TEXT label "G-Sup" / "G-Res" at the left anchor.
 *
 * JOURNAL:
 *   SNR_CREATED | id | type | level | candleA_time | candleB_time
 *   SNR_TOUCHED | id | type | level | time
 *   SNR_BROKEN  | id | type | level | time
 *   SNR_EXPIRED | id | type | level | time
 *
 * NO trading logic. Detection and visualisation only.
 */

export const GAP_SNR_DETECTOR_VERSION = "1.0.0";
export const GAP_SNR_DETECTOR_MODULE  = "Gap_SNR_Detector";

export function generateGapSnrDetector(): string {
  return `//+------------------------------------------------------------------+
//| Gap_SNR_Detector.mq5                                           |
//| SNR Module Library v${GAP_SNR_DETECTOR_VERSION} — Phase 1: Detection Only     |
//|                                                                  |
//| Gap S/R from candle-pair direction continuation.               |
//|   GAP SUPPORT:    Bullish candle A → Bullish candle B          |
//|   GAP RESISTANCE: Bearish candle A → Bearish candle B          |
//| SNR price level = Candle A close.                              |
//|                                                                  |
//| States: ACTIVE → TOUCHED → BROKEN / EXPIRED                    |
//| NO trading logic. Detection and visualisation only.            |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SNR Module Library"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define TYPE_SUPPORT      1
#define TYPE_RESISTANCE   2
#define STATE_ACTIVE      0
#define STATE_TOUCHED     1
#define STATE_BROKEN      2
#define STATE_EXPIRED     3
#define STATE_UNDRAWN    -1

#define SNR_MAX 600

//--- Inputs — Detection
input ENUM_TIMEFRAMES InpTF             = PERIOD_CURRENT; // Timeframe
input int             InpLookback       = 500;            // Historical bars to scan
input bool            InpShowSupport    = true;           // Show gap support levels
input bool            InpShowResistance = true;           // Show gap resistance levels
input int             InpExpiryBars     = 100;            // Bars until expiry (0 = never)
input bool            InpRemoveBroken   = true;           // Remove broken/expired levels
input int             InpMaxLevels      = 100;            // Max active + touched levels
input bool            InpIgnoreDoji     = true;           // Skip neutral candles
input int             InpDojiPoints     = 0;              // Doji body size in points (0 = exact)

//--- Inputs — Colours
input color InpSupportColor  = clrDodgerBlue;  // Gap support colour
input color InpResistColor   = clrDarkOrange;  // Gap resistance colour
input color InpBrokenColor   = clrSlateGray;   // Broken / expired colour
input int   InpOpacity       = 85;             // Active level opacity 0-100
input int   InpBrokenOpacity = 35;             // Broken level opacity 0-100

//--- Inputs — Logging
input bool InpShowLog = true; // Print lifecycle events to journal

//+------------------------------------------------------------------+
struct SnrRecord
{
   int      id;
   int      type;          // TYPE_SUPPORT or TYPE_RESISTANCE
   int      state;         // current lifecycle state
   int      drawnState;    // STATE_UNDRAWN or last drawn state
   int      ageCounter;    // bars elapsed since candleBTime
   double   level;         // Candle A close — the S/R price
   datetime candleATime;
   datetime candleBTime;   // level confirmed when Candle B closes
   datetime endTime;       // time of break / expiry (0 = still live)
};

SnrRecord snrList[SNR_MAX];
int      snrTotal    = 0;
int      nextId      = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
string TypeName(int t)
{ return t == TYPE_SUPPORT ? "GAP_SUPPORT" : "GAP_RESISTANCE"; }

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

string ObjLine(int id) { return "SMCGSNR_" + IntegerToString(id) + "_ln"; }
string ObjLbl (int id) { return "SMCGSNR_" + IntegerToString(id) + "_lb"; }

//+------------------------------------------------------------------+
//| Returns candle direction: +1 bullish, -1 bearish, 0 doji        |
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
//| Remove oldest active/touched levels until count <= InpMaxLevels |
//+------------------------------------------------------------------+
void EnforceMaxLevels()
{
   if(InpMaxLevels <= 0) return;
   int cnt = 0;
   for(int i = 0; i < snrTotal; i++)
      if(snrList[i].state == STATE_ACTIVE || snrList[i].state == STATE_TOUCHED) cnt++;

   while(cnt > InpMaxLevels)
   {
      int oldest = -1; datetime oldestT = (datetime)LONG_MAX;
      for(int i = 0; i < snrTotal; i++)
      {
         if(snrList[i].state != STATE_ACTIVE && snrList[i].state != STATE_TOUCHED) continue;
         if(snrList[i].candleBTime < oldestT) { oldestT = snrList[i].candleBTime; oldest = i; }
      }
      if(oldest < 0) break;
      ObjectDelete(0, ObjLine(snrList[oldest].id));
      ObjectDelete(0, ObjLbl (snrList[oldest].id));
      snrList[oldest].state      = STATE_EXPIRED;
      snrList[oldest].endTime    = snrList[oldest].candleBTime;
      snrList[oldest].drawnState = STATE_EXPIRED;
      cnt--;
   }
}

//+------------------------------------------------------------------+
//| Check candle pair (shA = older, shB = newer, shB = shA - 1).   |
//| Creates a Gap SNR level when both candles go the same direction. |
//+------------------------------------------------------------------+
void CheckSnrPair(int shA, int shB)
{
   int avail = iBars(_Symbol, InpTF);
   if(shA >= avail || shB < 0) return;

   int dirA = CandleDir(shA);
   int dirB = CandleDir(shB);
   if(dirA == 0 || dirB == 0) return; // doji / neutral — skip

   int snrType = 0;
   if(dirA > 0 && dirB > 0) snrType = TYPE_SUPPORT;    // Bull A → Bull B = Gap Support
   if(dirA < 0 && dirB < 0) snrType = TYPE_RESISTANCE; // Bear A → Bear B = Gap Resistance
   if(snrType == 0)          return;                    // opposite direction = Classic SNR

   if(snrType == TYPE_SUPPORT    && !InpShowSupport)    return;
   if(snrType == TYPE_RESISTANCE && !InpShowResistance) return;

   double   lvl   = iClose(_Symbol, InpTF, shA);
   datetime timeA = iTime (_Symbol, InpTF, shA);
   datetime timeB = iTime (_Symbol, InpTF, shB);

   // Dedup: same Candle A time + same type
   for(int i = 0; i < snrTotal; i++)
      if(snrList[i].candleATime == timeA && snrList[i].type == snrType) return;

   if(snrTotal >= SNR_MAX) return;

   int idx = snrTotal++;
   snrList[idx].id          = nextId++;
   snrList[idx].type        = snrType;
   snrList[idx].state       = STATE_ACTIVE;
   snrList[idx].drawnState  = STATE_UNDRAWN;
   snrList[idx].ageCounter  = 0;
   snrList[idx].level       = lvl;
   snrList[idx].candleATime = timeA;
   snrList[idx].candleBTime = timeB;
   snrList[idx].endTime     = 0;

   if(InpShowLog)
      PrintFormat("SNR_CREATED | id=%d | type=%s | level=%.5f | candleA=%s | candleB=%s",
         snrList[idx].id, TypeName(snrType), lvl,
         TimeToString(timeA, TIME_DATE|TIME_MINUTES),
         TimeToString(timeB, TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
//| Update lifecycle for all active/touched levels at bar sh.       |
//| Called chronologically oldest→newest (sh high→low).            |
//+------------------------------------------------------------------+
void UpdateLifecycleAtBar(int sh)
{
   double   barHigh  = iHigh (_Symbol, InpTF, sh);
   double   barLow   = iLow  (_Symbol, InpTF, sh);
   double   barClose = iClose(_Symbol, InpTF, sh);
   datetime barT     = iTime (_Symbol, InpTF, sh);

   for(int i = 0; i < snrTotal; i++)
   {
      if(snrList[i].state == STATE_BROKEN || snrList[i].state == STATE_EXPIRED) continue;
      // Only check levels confirmed before this bar
      if(snrList[i].candleBTime >= barT) continue;

      snrList[i].ageCounter++; // one more bar has elapsed

      // ── Expiry ────────────────────────────────────────────────────
      if(InpExpiryBars > 0 && snrList[i].ageCounter >= InpExpiryBars)
      {
         snrList[i].state   = STATE_EXPIRED;
         snrList[i].endTime = barT;
         if(InpShowLog)
            PrintFormat("SNR_EXPIRED | id=%d | type=%s | level=%.5f | time=%s",
               snrList[i].id, TypeName(snrList[i].type), snrList[i].level,
               TimeToString(barT, TIME_DATE|TIME_MINUTES));
         continue;
      }

      double lvl       = snrList[i].level;
      bool   isSupport = (snrList[i].type == TYPE_SUPPORT);

      // ── Broken first (close-based), then touched (wick-based) ────
      if(isSupport)
      {
         if(barClose < lvl)
         {
            snrList[i].state   = STATE_BROKEN;
            snrList[i].endTime = barT;
            if(InpShowLog)
               PrintFormat("SNR_BROKEN | id=%d | type=%s | level=%.5f | time=%s",
                  snrList[i].id, TypeName(snrList[i].type), lvl,
                  TimeToString(barT, TIME_DATE|TIME_MINUTES));
         }
         else if(barLow <= lvl && snrList[i].state == STATE_ACTIVE)
         {
            snrList[i].state = STATE_TOUCHED;
            if(InpShowLog)
               PrintFormat("SNR_TOUCHED | id=%d | type=%s | level=%.5f | time=%s",
                  snrList[i].id, TypeName(snrList[i].type), lvl,
                  TimeToString(barT, TIME_DATE|TIME_MINUTES));
         }
      }
      else // resistance
      {
         if(barClose > lvl)
         {
            snrList[i].state   = STATE_BROKEN;
            snrList[i].endTime = barT;
            if(InpShowLog)
               PrintFormat("SNR_BROKEN | id=%d | type=%s | level=%.5f | time=%s",
                  snrList[i].id, TypeName(snrList[i].type), lvl,
                  TimeToString(barT, TIME_DATE|TIME_MINUTES));
         }
         else if(barHigh >= lvl && snrList[i].state == STATE_ACTIVE)
         {
            snrList[i].state = STATE_TOUCHED;
            if(InpShowLog)
               PrintFormat("SNR_TOUCHED | id=%d | type=%s | level=%.5f | time=%s",
                  snrList[i].id, TypeName(snrList[i].type), lvl,
                  TimeToString(barT, TIME_DATE|TIME_MINUTES));
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Draw or redraw one SNR level (delete + recreate on state change)|
//+------------------------------------------------------------------+
void SNR_DrawOne(int idx)
{
   int  tp = snrList[idx].type;
   int  st = snrList[idx].state;

   if(tp == TYPE_SUPPORT    && !InpShowSupport)    { snrList[idx].drawnState = st; return; }
   if(tp == TYPE_RESISTANCE && !InpShowResistance) { snrList[idx].drawnState = st; return; }

   bool active = (st == STATE_ACTIVE || st == STATE_TOUCHED);

   ObjectDelete(0, ObjLine(snrList[idx].id));
   ObjectDelete(0, ObjLbl (snrList[idx].id));

   if(!active && InpRemoveBroken) { snrList[idx].drawnState = st; return; }

   color rawClr  = active ? ((tp == TYPE_SUPPORT) ? InpSupportColor : InpResistColor)
                          : InpBrokenColor;
   int   opacity = active ? InpOpacity : InpBrokenOpacity;
   color clr     = BlendWithBg(rawClr, opacity);
   int   lstyle  = active ? STYLE_SOLID : STYLE_DASH;

   datetime t1  = snrList[idx].candleATime;
   datetime t2  = active ? snrList[idx].candleBTime
                          : (snrList[idx].endTime > 0 ? snrList[idx].endTime
                                                      : snrList[idx].candleBTime);
   bool ray = active;
   double lvl = snrList[idx].level;

   if(ObjectCreate(0, ObjLine(snrList[idx].id), OBJ_TREND, 0, t1, lvl, t2, lvl))
   {
      ObjectSetInteger(0, ObjLine(snrList[idx].id), OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, ObjLine(snrList[idx].id), OBJPROP_STYLE,      lstyle);
      ObjectSetInteger(0, ObjLine(snrList[idx].id), OBJPROP_WIDTH,      1);
      ObjectSetInteger(0, ObjLine(snrList[idx].id), OBJPROP_RAY_RIGHT,  ray ? 1 : 0);
      ObjectSetInteger(0, ObjLine(snrList[idx].id), OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, ObjLine(snrList[idx].id), OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, ObjLine(snrList[idx].id), OBJPROP_BACK,       true);
   }

   if(ObjectCreate(0, ObjLbl(snrList[idx].id), OBJ_TEXT, 0, t1, lvl))
   {
      ObjectSetString( 0, ObjLbl(snrList[idx].id), OBJPROP_TEXT,
         tp == TYPE_SUPPORT ? "G-Sup" : "G-Res");
      ObjectSetInteger(0, ObjLbl(snrList[idx].id), OBJPROP_COLOR,    clr);
      ObjectSetInteger(0, ObjLbl(snrList[idx].id), OBJPROP_FONTSIZE, 7);
      ObjectSetInteger(0, ObjLbl(snrList[idx].id), OBJPROP_ANCHOR,
         tp == TYPE_SUPPORT ? ANCHOR_LEFT_LOWER : ANCHOR_LEFT_UPPER);
      ObjectSetInteger(0, ObjLbl(snrList[idx].id), OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, ObjLbl(snrList[idx].id), OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, ObjLbl(snrList[idx].id), OBJPROP_BACK,       false);
   }

   snrList[idx].drawnState = st;
}

//+------------------------------------------------------------------+
void SNR_DrawAll()
{
   for(int i = 0; i < snrTotal; i++)
      if(snrList[i].drawnState != snrList[i].state)
         SNR_DrawOne(i);
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
void DeleteAllObjects()
{
   for(int i = ObjectsTotal(0) - 1; i >= 0; i--)
   {
      string nm = ObjectName(0, i);
      if(StringFind(nm, "SMCGSNR_") == 0) ObjectDelete(0, nm);
   }
}

//+------------------------------------------------------------------+
int OnInit()
{
   DeleteAllObjects();
   snrTotal = 0; nextId = 0;

   int avail = iBars(_Symbol, InpTF);
   if(avail < 3) { Print("Gap_SNR_Detector: not enough bars."); return INIT_FAILED; }

   int limit = MathMin(InpLookback, avail - 2);

   // ── Pass 1: Create levels from candle pairs (oldest → newest) ────
   for(int sh = limit; sh >= 2; sh--)
      CheckSnrPair(sh, sh - 1);

   // ── Pass 2: Replay lifecycle bar-by-bar (oldest → newest) ────────
   for(int sh = limit - 1; sh >= 1; sh--)
      UpdateLifecycleAtBar(sh);

   EnforceMaxLevels();
   SNR_DrawAll();

   int nA=0, nT=0, nBr=0, nEx=0;
   for(int i=0; i<snrTotal; i++)
   {
      switch(snrList[i].state)
      {
         case STATE_ACTIVE:  nA++;  break;
         case STATE_TOUCHED: nT++;  break;
         case STATE_BROKEN:  nBr++; break;
         case STATE_EXPIRED: nEx++; break;
      }
   }
   PrintFormat("Gap_SNR_Detector v1 ready | active=%d touched=%d broken=%d expired=%d | %s %s",
      nA, nT, nBr, nEx, _Symbol, EnumToString(InpTF));
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

   // Candle A = bar 2 (closed before last), Candle B = bar 1 (just closed)
   CheckSnrPair(2, 1);
   UpdateLifecycleAtBar(1);
   EnforceMaxLevels();
   SNR_DrawAll();

   return rates_total;
}
`;
}
