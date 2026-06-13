/**
 * SMC Liquidity Detector — FVG Liquidity Build-up v1.1.0
 *
 * @deprecated Standalone visual only — superseded by Liquidity_Buildup.mq5 and
 * the zone_liq / ZLSM brain module (unified OB+BB+FVG pool). Kept for compile regression.
 *
 * A candle or series of candles come close to a Fair Value Gap (FVG)
 * without entering it. That creates liquidity (clustered stops) around
 * the gap, which makes the FVG a higher-probability trade level.
 *
 * The FVG itself is drawn as a filled rectangle so the trader can see the
 * level the liquidity is building around. The closest-approach candle is
 * labeled "FLq". Entering the gap consumes the liquidity (zone + label removed).
 *
 * LEVEL SOURCE:
 *   Bullish FVG: C1.high < C3.low  → gap = [C1.high, C3.low], near edge = C3.low
 *   Bearish FVG: C1.low  > C3.high → gap = [C3.high, C1.low], near edge = C3.high
 *
 * TOUCH (kills the level):
 *   Bullish FVG: wick low  <= gap top (C3.low)
 *   Bearish FVG: wick high >= gap bottom (C3.high)
 */

export const FVG_LIQUIDITY_DETECTOR_VERSION = "1.1.0";
export const FVG_LIQUIDITY_DETECTOR_MODULE = "FVG_Liquidity_Detector";

export function generateFvgLiquidityDetector(): string {
  return `//+------------------------------------------------------------------+
//| FVG_Liquidity_Detector.mq5                                     |
//| SMC Liquidity v${FVG_LIQUIDITY_DETECTOR_VERSION} — FVG Liquidity Build-up   |
//|                                                                  |
//| The FVG is drawn as a filled box. Price approaches it without   |
//| entering — stops accumulate. Closest approach labeled "FLq".    |
//| Entering the gap removes the zone + label (liquidity consumed). |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SMC Liquidity"
#property version   "1.10"
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
input bool            InpDrawZone   = true;            // Draw the FVG rectangle
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
   double   farEdge;      // opposite gap edge
   double   zoneTop;      // max(near,far)
   double   zoneBot;      // min(near,far)
   datetime zoneStart;    // C1 time — left edge of the gap box
   datetime levelTime;    // C3 close time — level valid after this
   bool     dead;
   int      ageCounter;
   double   bestLiqDist;
};

LevelRec levList[LVL_MAX];
int      levTotal    = 0;
int      nextId      = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
string LiqLb(int id)  { return OBJ_PREFIX + IntegerToString(id) + "_lb"; }
string ZoneNm(int id) { return OBJ_PREFIX + IntegerToString(id) + "_zn"; }

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
void DrawZone(int i)
{
   if(!InpDrawZone) return;
   string nm = ZoneNm(levList[i].id);
   color  c  = (levList[i].dir == DIR_BULL) ? InpBullColor : InpBearColor;
   if(ObjectCreate(0, nm, OBJ_RECTANGLE, 0,
                   levList[i].zoneStart, levList[i].zoneTop,
                   levList[i].levelTime, levList[i].zoneBot))
   {
      ObjectSetInteger(0, nm, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, nm, OBJPROP_STYLE,      STYLE_SOLID);
      ObjectSetInteger(0, nm, OBJPROP_WIDTH,      1);
      ObjectSetInteger(0, nm, OBJPROP_FILL,       true);
      ObjectSetInteger(0, nm, OBJPROP_BACK,       true);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, nm, OBJPROP_HIDDEN,     true);
   }
}

void ExtendZone(int i, datetime t)
{
   if(!InpDrawZone) return;
   string nm = ZoneNm(levList[i].id);
   if(ObjectFind(0, nm) >= 0) ObjectSetInteger(0, nm, OBJPROP_TIME, 1, t);
}

void KillLevel(int i)
{
   ObjectDelete(0, LiqLb(levList[i].id));
   ObjectDelete(0, ZoneNm(levList[i].id));
   levList[i].dead = true;
}

//+------------------------------------------------------------------+
void AddLevel(int dir, double nearEdge, double farEdge, datetime zoneStart, datetime t)
{
   for(int i = 0; i < levTotal; i++)
      if(MathAbs(levList[i].nearEdge - nearEdge) < _Point && levList[i].dir == dir) return;
   int idx = -1;
   for(int i = 0; i < levTotal; i++)
      if(levList[i].dead) { idx = i; break; }
   if(idx < 0 && levTotal < LVL_MAX) idx = levTotal++;
   if(idx < 0) return;
   levList[idx].id          = nextId++;
   levList[idx].dir         = dir;
   levList[idx].nearEdge    = nearEdge;
   levList[idx].farEdge     = farEdge;
   levList[idx].zoneTop     = MathMax(nearEdge, farEdge);
   levList[idx].zoneBot     = MathMin(nearEdge, farEdge);
   levList[idx].zoneStart   = zoneStart;
   levList[idx].levelTime   = t;
   levList[idx].dead        = false;
   levList[idx].ageCounter  = 0;
   levList[idx].bestLiqDist = DBL_MAX;
   DrawZone(idx);
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
   datetime t1 = iTime(_Symbol, InpTF, sh + 2);  // C1 time = box left edge
   datetime t3 = iTime(_Symbol, InpTF, sh);      // C3 time = level confirm
   if(c1h < c3l) AddLevel(DIR_BULL, c3l, c1h, t1, t3);  // bullish gap
   if(c1l > c3h) AddLevel(DIR_BEAR, c3h, c1l, t1, t3);  // bearish gap
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

   for(int i = 0; i < levTotal; i++)
   {
      if(levList[i].dead) continue;
      if(levList[i].levelTime >= t) continue;
      ExtendZone(i, t);                       // grow the box to the live bar
      double edge = levList[i].nearEdge;
      if(near <= 0) continue;

      if(levList[i].dir == DIR_BULL)
      {
         if(lo <= edge) { KillLevel(i); continue; }
         double dist = lo - edge;
         if(dist <= near && dist < levList[i].bestLiqDist)
         { levList[i].bestLiqDist = dist; UpdateLiqLabel(i, DIR_BULL, lo, t);
           if(InpShowLog) PrintFormat("FVG_LIQ_BULL | gap=%.5f | low=%.5f | dist=%.1f pts | %s", edge, lo, dist/_Point, TimeToString(t,TIME_DATE|TIME_MINUTES)); }
      }
      else
      {
         if(hi >= edge) { KillLevel(i); continue; }
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
      if(levList[i].ageCounter >= InpExpiryBars) KillLevel(i);
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
