/**
 * SMC Liquidity Detector — OB Liquidity Build-up v1.1.0
 *
 * @deprecated Standalone visual only — superseded by Liquidity_Buildup.mq5 and
 * the zone_liq / ZLSM brain module. Kept for compile regression.
 *
 * A candle or series of candles come close to an Order Block (OB) without
 * touching its BODY. That accumulates liquidity (resting stops) around the
 * OB, turning it into a higher-probability reaction level.
 *
 * The OB BODY is drawn as a filled rectangle so the trader sees the level.
 * The closest-approach candle is labeled "OLq". Touching the body consumes
 * the liquidity (zone + label removed).
 *
 * LEVEL SOURCE (displacement-based):
 *   Bullish OB: last BEARISH candle before a bullish displacement (body >= mult x ATR).
 *   Bearish OB: last BULLISH candle before a bearish displacement.
 *
 * BODY NEAR-EDGE:
 *   Bullish OB (support below): body top = OB candle OPEN
 *   Bearish OB (resistance above): body bottom = OB candle OPEN
 *   → near edge = OB candle OPEN in both cases.
 *
 * TOUCH (kills the level — body entered):
 *   Bullish OB: wick low  <= obOpen
 *   Bearish OB: wick high >= obOpen
 */

export const OB_LIQUIDITY_DETECTOR_VERSION = "1.1.0";
export const OB_LIQUIDITY_DETECTOR_MODULE = "OB_Liquidity_Detector";

export function generateObLiquidityDetector(): string {
  return `//+------------------------------------------------------------------+
//| OB_Liquidity_Detector.mq5                                      |
//| SMC Liquidity v${OB_LIQUIDITY_DETECTOR_VERSION} — OB Liquidity Build-up    |
//|                                                                  |
//| The OB body is drawn as a filled box. Price approaches it       |
//| without touching the body — stops accumulate. Closest approach  |
//| labeled "OLq". Body entry removes the zone + label.             |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SMC Liquidity"
#property version   "1.10"
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
input bool            InpDrawZone    = true;           // Draw the OB body rectangle
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
   double   bodyFar;      // OB candle CLOSE — opposite body edge (for the box)
   double   zoneTop;      // max(open,close)
   double   zoneBot;      // min(open,close)
   datetime obTime;       // OB candle time (dedup key + box left edge)
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
string LiqLb(int id)  { return OBJ_PREFIX + IntegerToString(id) + "_lb"; }
string ZoneNm(int id) { return OBJ_PREFIX + IntegerToString(id) + "_zn"; }

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
void DrawZone(int i)
{
   if(!InpDrawZone) return;
   string nm = ZoneNm(levList[i].id);
   color  c  = (levList[i].dir == DIR_BULL) ? InpBullColor : InpBearColor;
   if(ObjectCreate(0, nm, OBJ_RECTANGLE, 0,
                   levList[i].obTime,      levList[i].zoneTop,
                   levList[i].confirmTime, levList[i].zoneBot))
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
void AddLevel(int dir, double bodyEdge, double bodyFar, datetime obT, datetime confT)
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
   levList[idx].bodyFar     = bodyFar;
   levList[idx].zoneTop     = MathMax(bodyEdge, bodyFar);
   levList[idx].zoneBot     = MathMin(bodyEdge, bodyFar);
   levList[idx].obTime      = obT;
   levList[idx].confirmTime = confT;
   levList[idx].dead        = false;
   levList[idx].ageCounter  = 0;
   levList[idx].bestLiqDist = DBL_MAX;
   DrawZone(idx);
}

//+------------------------------------------------------------------+
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
      // Bull OB: last bearish candle. body edge=open (top), far=close (bottom)
      if(dispDir == DIR_BULL && jCls < jOpn)
      {
         AddLevel(DIR_BULL, jOpn, jCls, iTime(_Symbol, InpTF, j), iTime(_Symbol, InpTF, dispShift));
         break;
      }
      // Bear OB: last bullish candle. body edge=open (bottom), far=close (top)
      if(dispDir == DIR_BEAR && jCls > jOpn)
      {
         AddLevel(DIR_BEAR, jOpn, jCls, iTime(_Symbol, InpTF, j), iTime(_Symbol, InpTF, dispShift));
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

   for(int i = 0; i < levTotal; i++)
   {
      if(levList[i].dead) continue;
      if(levList[i].confirmTime >= t) continue;
      ExtendZone(i, t);
      double edge = levList[i].bodyEdge;
      if(near <= 0) continue;

      if(levList[i].dir == DIR_BULL)
      {
         if(lo <= edge) { KillLevel(i); continue; }
         double dist = lo - edge;
         if(dist <= near && dist < levList[i].bestLiqDist)
         { levList[i].bestLiqDist = dist; UpdateLiqLabel(i, DIR_BULL, lo, t);
           if(InpShowLog) PrintFormat("OB_LIQ_BULL | body=%.5f | low=%.5f | dist=%.1f pts | %s", edge, lo, dist/_Point, TimeToString(t,TIME_DATE|TIME_MINUTES)); }
      }
      else
      {
         if(hi >= edge) { KillLevel(i); continue; }
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
      if(levList[i].ageCounter >= InpExpiryBars) KillLevel(i);
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
