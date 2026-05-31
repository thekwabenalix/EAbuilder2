/**
 * SMC Liquidity Detector — FVG Liquidity Build-up v1.0.0
 *
 * A candle or series of candles come close to a Fair Value Gap (FVG)
 * without entering it. That creates liquidity (clustered stops) around
 * the gap, which makes the FVG a higher-probability trade level.
 *
 * LEVEL SOURCE (embedded):
 *   3-candle FVG pattern:
 *   Bullish FVG: C1.high < C3.low  → gap = [C1.high, C3.low]
 *   Bearish FVG: C1.low  > C3.high → gap = [C3.high, C1.low]
 *
 * NEAR EDGE (the side price approaches from):
 *   Bullish FVG: gap_top  = C3.low  (price approaches from above)
 *   Bearish FVG: gap_bottom = C3.high (price approaches from below)
 *
 * TOUCH (kills the level — liquidity consumed):
 *   Bullish FVG: wick low <= gap_top  (candle enters the gap)
 *   Bearish FVG: wick high >= gap_bottom
 *
 * LIQUIDITY LABEL: "FLq" on the candle with the minimum distance to the gap.
 *   The label updates if a closer candle appears. Wick touch deletes it.
 */

export const FVG_LIQUIDITY_DETECTOR_VERSION = "1.0.0";
export const FVG_LIQUIDITY_DETECTOR_MODULE  = "FVG_Liquidity_Detector";

export function generateFvgLiquidityDetector(): string {
  return `//+------------------------------------------------------------------+
//| FVG_Liquidity_Detector.mq5                                     |
//| SMC Liquidity v${FVG_LIQUIDITY_DETECTOR_VERSION} — FVG Liquidity Build-up   |
//|                                                                  |
//| Price approaches an FVG without entering it — stops accumulate. |
//| Closest approach candle labeled "FLq". Wick entry kills level.  |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SMC Liquidity"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define DIR_BULL    1
#define DIR_BEAR   -1
#define LVL_MAX    400
#define OBJ_PREFIX "SMCFVGLIQ_"

input ENUM_TIMEFRAMES InpTF         = PERIOD_CURRENT;
input int             InpLookback   = 500;
input double          InpNearATR    = 0.20;
input int             InpATRPeriod  = 14;
input int             InpNearPoints = 0;
input int             InpExpiryBars = 200;
input bool            InpDraw       = true;
input string          InpLabel      = "FLq";
input int             InpFontSize   = 8;
input color           InpBullColor  = clrMediumSeaGreen;
input color           InpBearColor  = clrTomato;
input bool            InpShowLog    = true;

struct LevelRec
{
   int      id;
   int      dir;          // DIR_BULL or DIR_BEAR
   double   nearEdge;     // gap edge price approaches
   double   farEdge;      // opposite edge (for reference)
   datetime levelTime;    // C3 close time — level valid after this
   bool     dead;
   int      ageCounter;
   double   bestLiqDist;  // smallest approach distance (DBL_MAX = none)
};

LevelRec levList[LVL_MAX];
int      levTotal    = 0;
int      nextId      = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
string LiqLb(int id) { return OBJ_PREFIX + IntegerToString(id) + "_lb"; }

double CalcATR(int sh)
{
   int avail = iBars(_Symbol, InpTF);
   if(avail < sh + InpATRPeriod + 2) return 0.0;
   double sum = 0.0;
   for(int k = sh + 1; k <= sh + InpATRPeriod; k++)
   {
      double h = iHigh(_Symbol, InpTF, k), l = iLow(_Symbol, InpTF, k);
      double pc = iClose(_Symbol, InpTF, k + 1);
      sum += MathMax(h - l, MathMax(MathAbs(h - pc), MathAbs(l - pc)));
   }
   return sum / (double)InpATRPeriod;
}

//+------------------------------------------------------------------+
void AddLevel(int dir, double nearEdge, double farEdge, datetime t)
{
   for(int i = 0; i < levTotal; i++)
      if(MathAbs(levList[i].nearEdge - nearEdge) < _Point && levList[i].dir == dir) return;
   int idx = -1;
   for(int i = 0; i < levTotal; i++)
      if(levList[i].dead) { idx = i; break; }
   if(idx < 0 && levTotal < LVL_MAX) idx = levTotal++;
   if(idx < 0) return;
   levList[idx].id           = nextId++;
   levList[idx].dir          = dir;
   levList[idx].nearEdge     = nearEdge;
   levList[idx].farEdge      = farEdge;
   levList[idx].levelTime    = t;
   levList[idx].dead         = false;
   levList[idx].ageCounter   = 0;
   levList[idx].bestLiqDist  = DBL_MAX;
}

//+------------------------------------------------------------------+
void DetectFVGs(int sh)
{
   int avail = iBars(_Symbol, InpTF);
   if(sh + 2 >= avail) return;
   double c1h = iHigh(_Symbol, InpTF, sh + 2);
   double c1l = iLow (_Symbol, InpTF, sh + 2);
   double c3l = iLow (_Symbol, InpTF, sh);
   double c3h = iHigh(_Symbol, InpTF, sh);
   datetime t = iTime(_Symbol, InpTF, sh);
   // Bullish FVG: gap between C1 high and C3 low
   if(c1h < c3l) AddLevel(DIR_BULL, c3l, c1h, t);
   // Bearish FVG: gap between C3 high and C1 low
   if(c1l > c3h) AddLevel(DIR_BEAR, c3h, c1l, t);
}

//+------------------------------------------------------------------+
void UpdateLiqLabel(int i, int dir, double wickExtreme, datetime t)
{
   if(!InpDraw) return;
   string nm = LiqLb(levList[i].id);
   ObjectDelete(0, nm);
   color c = (dir == DIR_BULL) ? InpBullColor : InpBearColor;
   if(ObjectCreate(0, nm, OBJ_TEXT, 0, t, wickExtreme))
   {
      ObjectSetString (0, nm, OBJPROP_TEXT,       InpLabel);
      ObjectSetInteger(0, nm, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, nm, OBJPROP_FONTSIZE,   InpFontSize);
      ObjectSetInteger(0, nm, OBJPROP_ANCHOR,     dir == DIR_BULL ? ANCHOR_UPPER : ANCHOR_LOWER);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
   }
}

//+------------------------------------------------------------------+
void CheckLiquidity(int sh)
{
   double hi = iHigh(_Symbol, InpTF, sh);
   double lo = iLow (_Symbol, InpTF, sh);
   datetime t = iTime(_Symbol, InpTF, sh);
   double atr  = CalcATR(sh);
   double near = (InpNearPoints > 0) ? InpNearPoints * _Point : InpNearATR * atr;
   if(near <= 0) return;

   for(int i = 0; i < levTotal; i++)
   {
      if(levList[i].dead) continue;
      if(levList[i].levelTime >= t) continue;
      double edge = levList[i].nearEdge;

      if(levList[i].dir == DIR_BULL)
      {
         if(lo <= edge) { ObjectDelete(0, LiqLb(levList[i].id)); levList[i].dead = true; continue; }
         double dist = lo - edge;
         if(dist <= near && dist < levList[i].bestLiqDist)
         { levList[i].bestLiqDist = dist; UpdateLiqLabel(i, DIR_BULL, lo, t);
           if(InpShowLog) PrintFormat("FVG_LIQ_BULL | gap=%.5f | low=%.5f | dist=%.1f pts | %s", edge, lo, dist/_Point, TimeToString(t,TIME_DATE|TIME_MINUTES)); }
      }
      else
      {
         if(hi >= edge) { ObjectDelete(0, LiqLb(levList[i].id)); levList[i].dead = true; continue; }
         double dist = edge - hi;
         if(dist <= near && dist < levList[i].bestLiqDist)
         { levList[i].bestLiqDist = dist; UpdateLiqLabel(i, DIR_BEAR, hi, t);
           if(InpShowLog) PrintFormat("FVG_LIQ_BEAR | gap=%.5f | high=%.5f | dist=%.1f pts | %s", edge, hi, dist/_Point, TimeToString(t,TIME_DATE|TIME_MINUTES)); }
      }
   }
}

//+------------------------------------------------------------------+
void AgeLevels()
{
   if(InpExpiryBars <= 0) return;
   for(int i = 0; i < levTotal; i++)
   {
      if(levList[i].dead) continue;
      levList[i].ageCounter++;
      if(levList[i].ageCounter >= InpExpiryBars)
         { ObjectDelete(0, LiqLb(levList[i].id)); levList[i].dead = true; }
   }
}

//+------------------------------------------------------------------+
void Rebuild()
{
   ObjectsDeleteAll(0, OBJ_PREFIX);
   levTotal = 0; nextId = 0;
   int scan = MathMin(InpLookback, iBars(_Symbol, InpTF) - 3);
   if(scan < 2) return;
   for(int sh = scan; sh >= 1; sh--)
      { DetectFVGs(sh); CheckLiquidity(sh); AgeLevels(); }
}

int OnInit()  { lastBarTime = 0; Rebuild(); return INIT_SUCCEEDED; }
void OnDeinit(const int reason) { ObjectsDeleteAll(0, OBJ_PREFIX); }

int OnCalculate(const int rates_total, const int prev_calculated,
                const datetime &time[], const double &open[],
                const double &high[], const double &low[],
                const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
{
   datetime curBar = iTime(_Symbol, InpTF, 0);
   if(curBar != lastBarTime)
      { lastBarTime = curBar; DetectFVGs(1); CheckLiquidity(1); AgeLevels(); }
   return rates_total;
}
`;
}
