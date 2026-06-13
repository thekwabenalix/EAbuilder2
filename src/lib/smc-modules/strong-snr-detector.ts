/**
 * SNR Module Library — Strong SNR Detector
 *
 * Strong_SNR_Detector v1.0.0
 * ────────────────────────────────────────────────
 * A Classic SNR (candle-pair direction reversal) that is followed by
 * a strong displacement move.  On a line chart the bullish variant
 * forms a sharp V; the bearish variant forms a sharp A.
 *
 * DETECTION:
 *   Step 1 — Classic SNR pair  (same as Classic_SNR_Detector):
 *     STRONG RESISTANCE: Bullish Candle A → Bearish Candle B
 *     STRONG SUPPORT:    Bearish Candle A → Bullish Candle B
 *     Level = Candle A close.
 *
 *   Step 2 — Displacement strength qualifier:
 *     Sum the on-direction bodies across InpDispBars bars starting at
 *     Candle B (capped at bar[1] in live mode to avoid the live bar).
 *     If the cumulative displacement < InpDispMult × ATR → reject.
 *     During live OnCalculate this reduces to checking Candle B alone
 *     (bar[1]) which is sufficient for the sharp-move requirement.
 *
 * LIFECYCLE:
 *   ACTIVE → TOUCHED → BROKEN / EXPIRED  (identical to Classic SNR)
 *
 * DRAWN ELEMENTS:
 *   Solid OBJ_TREND line (width 2, stronger than Classic) extending
 *   right while ACTIVE / TOUCHED; dashed and dimmed after BROKEN /
 *   EXPIRED.  OBJ_TEXT label "S-Sup" / "S-Res" at the left anchor.
 *
 * JOURNAL:
 *   SSNR_CREATED | id | type | level | dispPts | candleA | candleB
 *   SSNR_TOUCHED | id | type | level | time
 *   SSNR_BROKEN  | id | type | level | time
 *   SSNR_EXPIRED | id | type | level | time
 */

export const STRONG_SNR_DETECTOR_VERSION = "1.0.0";
export const STRONG_SNR_DETECTOR_MODULE = "Strong_SNR_Detector";

export function generateStrongSnrDetector(): string {
  return `//+------------------------------------------------------------------+
//| Strong_SNR_Detector.mq5                                        |
//| SNR Module Library v${STRONG_SNR_DETECTOR_VERSION} — Strong Displacement SNR  |
//|                                                                  |
//| Classic S/R with strong displacement qualifier.                 |
//|   STRONG RESISTANCE: Bullish A → strong bearish displacement    |
//|   STRONG SUPPORT:    Bearish A → strong bullish displacement    |
//| On a line chart: bullish = V-shape, bearish = A-shape.         |
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
#define OBJ_PFX "SMCSSNR_"

//--- Detection
input ENUM_TIMEFRAMES InpTF             = PERIOD_CURRENT; // Timeframe
input int             InpLookback       = 500;            // Historical bars to scan
input bool            InpShowSupport    = true;           // Show strong support levels
input bool            InpShowResistance = true;           // Show strong resistance levels
input bool            InpIgnoreDoji     = true;           // Skip neutral candles (A or B)
input int             InpDojiPoints     = 0;              // Doji threshold in points (0=exact)
//--- Displacement qualifier
input double          InpDispMult       = 1.5;            // Displacement >= N x ATR to qualify
input int             InpDispAtrPer     = 14;             // ATR period for displacement check
input int             InpDispBars       = 3;              // Bars (incl. Candle B) to sum displacement
//--- Lifecycle
input int             InpExpiryBars     = 100;            // Bars until expiry (0 = never)
input bool            InpRemoveBroken   = true;           // Remove broken/expired levels
input int             InpMaxLevels      = 100;            // Max active + touched levels
//--- Colours
input color InpSupportColor  = clrLimeGreen;  // Strong support colour
input color InpResistColor   = clrCrimson;    // Strong resistance colour
input color InpBrokenColor   = clrDimGray;    // Broken / expired colour
input int   InpOpacity       = 90;            // Active level opacity 0-100
input int   InpBrokenOpacity = 30;            // Broken level opacity 0-100
input int   InpLineWidth     = 2;             // Line width (thicker than Classic)
//--- Logging
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
   double   dispPts;       // measured displacement in points (log only)
   datetime candleATime;
   datetime candleBTime;
   datetime endTime;
};

SnrRecord snrList[SNR_MAX];
int      snrTotal    = 0;
int      nextId      = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
string TypeName(int t)
{ return t == TYPE_SUPPORT ? "STRONG_SUPPORT" : "STRONG_RESISTANCE"; }

string ObjLine(int id) { return OBJ_PFX + IntegerToString(id) + "_ln"; }
string ObjLbl (int id) { return OBJ_PFX + IntegerToString(id) + "_lb"; }

color BlendWithBg(color base, int opacityPct)
{
   color  bg = (color)ChartGetInteger(0, CHART_COLOR_BACKGROUND);
   double t  = MathMax(0.0, MathMin(100.0, (double)opacityPct)) / 100.0;
   int r = (int)(( base & 0xFF)       * t + ( bg & 0xFF)       * (1.0 - t));
   int g = (int)(((base >>  8) & 0xFF) * t + ((bg >>  8) & 0xFF) * (1.0 - t));
   int b = (int)(((base >> 16) & 0xFF) * t + ((bg >> 16) & 0xFF) * (1.0 - t));
   return (color)(r | (g << 8) | (b << 16));
}

//+------------------------------------------------------------------+
//| Candle direction: +1 bull, -1 bear, 0 doji                      |
//+------------------------------------------------------------------+
int CandleDir(int sh)
{
   double c = iClose(_Symbol, InpTF, sh);
   double o = iOpen (_Symbol, InpTF, sh);
   if(InpIgnoreDoji)
   {
      double thr = (InpDojiPoints > 0) ? InpDojiPoints * _Point : 0.0;
      if(MathAbs(c - o) <= thr) return 0;
   }
   return (c > o) ? 1 : (c < o) ? -1 : 0;
}

//+------------------------------------------------------------------+
//| ATR at bar sh over InpDispAtrPer periods                        |
//+------------------------------------------------------------------+
double CalcATR(int sh)
{
   int avail = iBars(_Symbol, InpTF);
   if(avail < sh + InpDispAtrPer + 2) return 0.0;
   double sum = 0.0;
   for(int k = sh + 1; k <= sh + InpDispAtrPer; k++)
   {
      double h  = iHigh (_Symbol, InpTF, k);
      double l  = iLow  (_Symbol, InpTF, k);
      double pc = iClose(_Symbol, InpTF, k + 1);
      sum += MathMax(h - l, MathMax(MathAbs(h - pc), MathAbs(l - pc)));
   }
   return sum / (double)InpDispAtrPer;
}

//+------------------------------------------------------------------+
//| Sum displacement bodies across bars [shStart .. shEnd]          |
//| Counts only bars moving in the required direction.              |
//| reqDir: +1 = sum bullish bodies, -1 = sum bearish bodies        |
//+------------------------------------------------------------------+
double SumDisplacement(int shStart, int shEnd, int reqDir)
{
   double total = 0.0;
   int lo = MathMin(shStart, shEnd);
   int hi = MathMax(shStart, shEnd);
   for(int b = hi; b >= lo; b--)
   {
      double o = iOpen (_Symbol, InpTF, b);
      double c = iClose(_Symbol, InpTF, b);
      if(reqDir > 0 && c > o) total += (c - o);   // bullish body
      if(reqDir < 0 && c < o) total += (o - c);   // bearish body
   }
   return total;
}

//+------------------------------------------------------------------+
//| Enforce max visible levels (drop oldest active/touched)         |
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
//| Attempt to create a Strong SNR from candle pair (shA, shB).     |
//| shA = older candle (higher shift), shB = shA - 1 (newer).      |
//+------------------------------------------------------------------+
void CheckSnrPair(int shA, int shB)
{
   int avail = iBars(_Symbol, InpTF);
   if(shA >= avail || shB < 0) return;

   // ── Step 1: Classic SNR pair (opposite directions) ─────────────
   int dirA = CandleDir(shA);
   int dirB = CandleDir(shB);
   if(dirA == 0 || dirB == 0) return;
   if(dirA == dirB)           return; // same direction = Gap SNR, not Classic

   int snrType  = (dirA > 0) ? TYPE_RESISTANCE : TYPE_SUPPORT;
   int dispDir  = -dirA;               // displacement direction (opposite of Candle A)

   if(snrType == TYPE_SUPPORT    && !InpShowSupport)    return;
   if(snrType == TYPE_RESISTANCE && !InpShowResistance) return;

   // ── Step 2: Displacement strength qualifier ─────────────────────
   double atr = CalcATR(shA);
   if(atr <= 0.0) return;
   double thresh = InpDispMult * atr;

   // Displacement window: bars [shB .. endShift], clamped so we never
   // use bar[0] (the live forming bar).
   int endShift = shB - (InpDispBars - 1);
   if(endShift < 1) endShift = 1;  // never read bar[0]

   double disp = SumDisplacement(shB, endShift, dispDir);
   if(disp < thresh) return;        // not a strong enough displacement → skip

   // ── Dedup: same Candle A time + same type ──────────────────────
   double   lvl   = iClose(_Symbol, InpTF, shA);
   datetime timeA = iTime (_Symbol, InpTF, shA);
   datetime timeB = iTime (_Symbol, InpTF, shB);
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
   snrList[idx].dispPts     = disp / _Point;
   snrList[idx].candleATime = timeA;
   snrList[idx].candleBTime = timeB;
   snrList[idx].endTime     = 0;

   if(InpShowLog)
      PrintFormat("SSNR_CREATED | id=%d | type=%s | level=%.5f | disp=%.1f pts | A=%s | B=%s",
         snrList[idx].id, TypeName(snrType), lvl, snrList[idx].dispPts,
         TimeToString(timeA, TIME_DATE|TIME_MINUTES),
         TimeToString(timeB, TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
//| Lifecycle update for all active/touched levels at bar sh.       |
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
      if(snrList[i].candleBTime >= barT) continue;

      snrList[i].ageCounter++;

      // ── Expiry ────────────────────────────────────────────────────
      if(InpExpiryBars > 0 && snrList[i].ageCounter >= InpExpiryBars)
      {
         snrList[i].state   = STATE_EXPIRED;
         snrList[i].endTime = barT;
         if(InpShowLog)
            PrintFormat("SSNR_EXPIRED | id=%d | type=%s | level=%.5f | time=%s",
               snrList[i].id, TypeName(snrList[i].type), snrList[i].level,
               TimeToString(barT, TIME_DATE|TIME_MINUTES));
         continue;
      }

      double lvl       = snrList[i].level;
      bool   isSupport = (snrList[i].type == TYPE_SUPPORT);

      if(isSupport)
      {
         if(barClose < lvl)
         {
            snrList[i].state = STATE_BROKEN; snrList[i].endTime = barT;
            if(InpShowLog)
               PrintFormat("SSNR_BROKEN | id=%d | type=%s | level=%.5f | time=%s",
                  snrList[i].id, TypeName(snrList[i].type), lvl,
                  TimeToString(barT, TIME_DATE|TIME_MINUTES));
         }
         else if(barLow <= lvl && snrList[i].state == STATE_ACTIVE)
         {
            snrList[i].state = STATE_TOUCHED;
            if(InpShowLog)
               PrintFormat("SSNR_TOUCHED | id=%d | type=%s | level=%.5f | time=%s",
                  snrList[i].id, TypeName(snrList[i].type), lvl,
                  TimeToString(barT, TIME_DATE|TIME_MINUTES));
         }
      }
      else
      {
         if(barClose > lvl)
         {
            snrList[i].state = STATE_BROKEN; snrList[i].endTime = barT;
            if(InpShowLog)
               PrintFormat("SSNR_BROKEN | id=%d | type=%s | level=%.5f | time=%s",
                  snrList[i].id, TypeName(snrList[i].type), lvl,
                  TimeToString(barT, TIME_DATE|TIME_MINUTES));
         }
         else if(barHigh >= lvl && snrList[i].state == STATE_ACTIVE)
         {
            snrList[i].state = STATE_TOUCHED;
            if(InpShowLog)
               PrintFormat("SSNR_TOUCHED | id=%d | type=%s | level=%.5f | time=%s",
                  snrList[i].id, TypeName(snrList[i].type), lvl,
                  TimeToString(barT, TIME_DATE|TIME_MINUTES));
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Draw / redraw one level                                         |
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
      ObjectSetInteger(0, ObjLine(snrList[idx].id), OBJPROP_WIDTH,      InpLineWidth);
      ObjectSetInteger(0, ObjLine(snrList[idx].id), OBJPROP_RAY_RIGHT,  ray ? 1 : 0);
      ObjectSetInteger(0, ObjLine(snrList[idx].id), OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, ObjLine(snrList[idx].id), OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, ObjLine(snrList[idx].id), OBJPROP_BACK,       true);
   }

   string lbl = (tp == TYPE_SUPPORT) ? "S-Sup" : "S-Res";
   if(ObjectCreate(0, ObjLbl(snrList[idx].id), OBJ_TEXT, 0, t1, lvl))
   {
      ObjectSetString( 0, ObjLbl(snrList[idx].id), OBJPROP_TEXT,      lbl);
      ObjectSetInteger(0, ObjLbl(snrList[idx].id), OBJPROP_COLOR,     clr);
      ObjectSetInteger(0, ObjLbl(snrList[idx].id), OBJPROP_FONTSIZE,  7);
      ObjectSetInteger(0, ObjLbl(snrList[idx].id), OBJPROP_ANCHOR,
         tp == TYPE_SUPPORT ? ANCHOR_LEFT_LOWER : ANCHOR_LEFT_UPPER);
      ObjectSetInteger(0, ObjLbl(snrList[idx].id), OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, ObjLbl(snrList[idx].id), OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, ObjLbl(snrList[idx].id), OBJPROP_BACK,       false);
   }

   snrList[idx].drawnState = st;
}

void SNR_DrawAll()
{
   for(int i = 0; i < snrTotal; i++)
      if(snrList[i].drawnState != snrList[i].state)
         SNR_DrawOne(i);
   ChartRedraw(0);
}

void DeleteAllObjects()
{
   for(int i = ObjectsTotal(0) - 1; i >= 0; i--)
   {
      string nm = ObjectName(0, i);
      if(StringFind(nm, OBJ_PFX) == 0) ObjectDelete(0, nm);
   }
}

//+------------------------------------------------------------------+
int OnInit()
{
   DeleteAllObjects();
   snrTotal = 0; nextId = 0;

   int avail = iBars(_Symbol, InpTF);
   if(avail < InpDispBars + 3)
      { Print("Strong_SNR_Detector: not enough bars."); return INIT_FAILED; }

   int limit = MathMin(InpLookback, avail - InpDispBars - 2);

   // Pass 1 — create levels from candle pairs (oldest → newest)
   // shA ranges from limit down to 2; shB = shA - 1.
   // Displacement window needs InpDispBars bars more recent than shB,
   // so we need shB - InpDispBars + 1 >= 1 → shA >= InpDispBars + 1.
   int startSh = MathMax(2, InpDispBars + 1);
   for(int sh = limit; sh >= startSh; sh--)
      CheckSnrPair(sh, sh - 1);

   // Pass 2 — replay lifecycle bar-by-bar
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
   PrintFormat("Strong_SNR_Detector v${STRONG_SNR_DETECTOR_VERSION} ready | active=%d touched=%d broken=%d expired=%d | disp>=%.1fx ATR(%d) over %d bar(s) | %s %s",
      nA, nT, nBr, nEx, InpDispMult, InpDispAtrPer, InpDispBars,
      _Symbol, EnumToString(InpTF));
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { DeleteAllObjects(); ChartRedraw(0); }

int OnCalculate(const int rates_total, const int prev_calculated,
                const datetime &time[], const double &open[],
                const double &high[], const double &low[],
                const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
{
   datetime currentBar = iTime(_Symbol, InpTF, 0);
   if(currentBar == lastBarTime) return rates_total;
   lastBarTime = currentBar;

   // Candle A = bar 2, Candle B = bar 1 (just closed).
   // Displacement window clamped to bar[1] only (bar[0] still forming).
   CheckSnrPair(2, 1);
   UpdateLifecycleAtBar(1);
   EnforceMaxLevels();
   SNR_DrawAll();

   return rates_total;
}
`;
}
