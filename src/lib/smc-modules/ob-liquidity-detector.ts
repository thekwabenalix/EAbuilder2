/**
 * SMC Liquidity Detector — OB Liquidity Build-up v1.0.0
 *
 * A candle or series of candles come close to an Order Block (OB) without
 * touching its BODY. That accumulates liquidity (resting stops) around the
 * OB, turning it into a higher-probability reaction level.
 *
 * LEVEL SOURCE (embedded, displacement-based):
 *   Bullish OB: last BEARISH candle before a bullish displacement (body >= mult x ATR).
 *   Bearish OB: last BULLISH candle before a bearish displacement.
 *
 * BODY NEAR-EDGE (the side price approaches, body not wick):
 *   Bullish OB (support below): body top = OB candle OPEN  (bearish candle: open > close)
 *   Bearish OB (resistance above): body bottom = OB candle OPEN (bullish candle: open < close)
 *   → In both cases the body edge price approaches = the OB candle's OPEN.
 *
 * TOUCH (kills the level — body entered, liquidity consumed):
 *   Bullish OB: wick low <= obOpen
 *   Bearish OB: wick high >= obOpen
 *
 * LIQUIDITY LABEL: "OLq" on the candle with the minimum distance to the body.
 *   Updates to a closer candle if one appears. Body touch deletes it.
 */

export const OB_LIQUIDITY_DETECTOR_VERSION = "1.0.0";
export const OB_LIQUIDITY_DETECTOR_MODULE  = "OB_Liquidity_Detector";

export function generateObLiquidityDetector(): string {
  return `//+------------------------------------------------------------------+
//| OB_Liquidity_Detector.mq5                                      |
//| SMC Liquidity v${OB_LIQUIDITY_DETECTOR_VERSION} — OB Liquidity Build-up    |
//|                                                                  |
//| Price approaches an Order Block BODY without touching it —      |
//| stops accumulate. Closest approach labeled "OLq". Body entry    |
//| kills the level.                                                |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SMC Liquidity"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define DIR_BULL    1
#define DIR_BEAR   -1
#define LVL_MAX    400
#define OBJ_PREFIX "SMCOBLIQ_"

input ENUM_TIMEFRAMES InpTF          = PERIOD_CURRENT;
input int             InpLookback    = 500;
input double          InpDispMult    = 1.5;            // Displacement body >= N x ATR
input int             InpDispAtrPer  = 14;             // ATR period for displacement
input int             InpObScanBack  = 5;              // Bars back from displacement for OB candle
input double          InpNearATR     = 0.20;           // Proximity as ATR fraction
input int             InpNearAtrPer  = 14;             // ATR period for proximity
input int             InpNearPoints  = 0;              // Override: fixed points (0 = ATR)
input int             InpExpiryBars  = 200;
input bool            InpDraw        = true;
input string          InpLabel       = "OLq";
input int             InpFontSize    = 8;
input color           InpBullColor   = clrMediumSeaGreen;
input color           InpBearColor   = clrTomato;
input bool            InpShowLog     = true;

struct LevelRec
{
   int      id;
   int      dir;          // DIR_BULL or DIR_BEAR
   double   bodyEdge;     // OB candle OPEN — the body edge price approaches
   datetime obTime;       // OB candle time (dedup key)
   datetime confirmTime;  // displacement candle time — valid only after this
   bool     dead;
   int      ageCounter;
   double   bestLiqDist;
};

LevelRec levList[LVL_MAX];
int      levTotal    = 0;
int      nextId      = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
string LiqLb(int id) { return OBJ_PREFIX + IntegerToString(id) + "_lb"; }

double CalcATR(int sh, int period)
{
   int avail = iBars(_Symbol, InpTF);
   if(avail < sh + period + 2) return 0.0;
   double sum = 0.0;
   for(int k = sh + 1; k <= sh + period; k++)
   {
      double h = iHigh(_Symbol, InpTF, k), l = iLow(_Symbol, InpTF, k);
      double pc = iClose(_Symbol, InpTF, k + 1);
      sum += MathMax(h - l, MathMax(MathAbs(h - pc), MathAbs(l - pc)));
   }
   return sum / (double)period;
}

//+------------------------------------------------------------------+
void AddLevel(int dir, double bodyEdge, datetime obT, datetime confT)
{
   for(int i = 0; i < levTotal; i++)
      if(levList[i].obTime == obT && levList[i].dir == dir) return;
   int idx = -1;
   for(int i = 0; i < levTotal; i++)
      if(levList[i].dead) { idx = i; break; }
   if(idx < 0 && levTotal < LVL_MAX) idx = levTotal++;
   if(idx < 0) return;
   levList[idx].id          = nextId++;
   levList[idx].dir         = dir;
   levList[idx].bodyEdge    = bodyEdge;
   levList[idx].obTime      = obT;
   levList[idx].confirmTime = confT;
   levList[idx].dead        = false;
   levList[idx].ageCounter  = 0;
   levList[idx].bestLiqDist = DBL_MAX;
}

//+------------------------------------------------------------------+
// Scan bar dispShift as a displacement candle; if confirmed, find the OB.
void DetectOB(int dispShift)
{
   if(dispShift < 1) return;
   double atr = CalcATR(dispShift, InpDispAtrPer);
   if(atr <= 0.0) return;
   double dOpn = iOpen (_Symbol, InpTF, dispShift);
   double dCls = iClose(_Symbol, InpTF, dispShift);
   if(MathAbs(dCls - dOpn) < InpDispMult * atr) return;
   int dispDir = (dCls > dOpn) ? DIR_BULL : DIR_BEAR;

   int available = iBars(_Symbol, InpTF);
   int scanEnd   = dispShift + InpObScanBack;
   if(scanEnd >= available - 1) scanEnd = available - 2;

   for(int j = dispShift + 1; j <= scanEnd; j++)
   {
      double jOpn = iOpen (_Symbol, InpTF, j);
      double jCls = iClose(_Symbol, InpTF, j);
      // Bullish displacement → last bearish candle = Bull OB; body edge = open (body top)
      if(dispDir == DIR_BULL && jCls < jOpn)
      {
         AddLevel(DIR_BULL, jOpn, iTime(_Symbol, InpTF, j), iTime(_Symbol, InpTF, dispShift));
         break;
      }
      // Bearish displacement → last bullish candle = Bear OB; body edge = open (body bottom)
      if(dispDir == DIR_BEAR && jCls > jOpn)
      {
         AddLevel(DIR_BEAR, jOpn, iTime(_Symbol, InpTF, j), iTime(_Symbol, InpTF, dispShift));
         break;
      }
   }
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
   double atr  = CalcATR(sh, InpNearAtrPer);
   double near = (InpNearPoints > 0) ? InpNearPoints * _Point : InpNearATR * atr;
   if(near <= 0) return;

   for(int i = 0; i < levTotal; i++)
   {
      if(levList[i].dead) continue;
      if(levList[i].confirmTime >= t) continue;
      double edge = levList[i].bodyEdge;

      if(levList[i].dir == DIR_BULL)
      {
         if(lo <= edge) { ObjectDelete(0, LiqLb(levList[i].id)); levList[i].dead = true; continue; }
         double dist = lo - edge;
         if(dist <= near && dist < levList[i].bestLiqDist)
         { levList[i].bestLiqDist = dist; UpdateLiqLabel(i, DIR_BULL, lo, t);
           if(InpShowLog) PrintFormat("OB_LIQ_BULL | body=%.5f | low=%.5f | dist=%.1f pts | %s", edge, lo, dist/_Point, TimeToString(t,TIME_DATE|TIME_MINUTES)); }
      }
      else
      {
         if(hi >= edge) { ObjectDelete(0, LiqLb(levList[i].id)); levList[i].dead = true; continue; }
         double dist = edge - hi;
         if(dist <= near && dist < levList[i].bestLiqDist)
         { levList[i].bestLiqDist = dist; UpdateLiqLabel(i, DIR_BEAR, hi, t);
           if(InpShowLog) PrintFormat("OB_LIQ_BEAR | body=%.5f | high=%.5f | dist=%.1f pts | %s", edge, hi, dist/_Point, TimeToString(t,TIME_DATE|TIME_MINUTES)); }
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
   int scan = MathMin(InpLookback, iBars(_Symbol, InpTF) - InpObScanBack - 2);
   if(scan < 2) return;
   for(int sh = scan; sh >= 1; sh--)
      { DetectOB(sh); CheckLiquidity(sh); AgeLevels(); }
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
      { lastBarTime = curBar; DetectOB(1); CheckLiquidity(1); AgeLevels(); }
   return rates_total;
}
`;
}
