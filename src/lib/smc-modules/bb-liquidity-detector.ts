/**
 * SMC Liquidity Detector — BB (Breaker Block) Liquidity Build-up v1.1.0
 *
 * Price does not touch the BODY of a Breaker Block but builds up around it.
 * That liquidity makes the breaker a higher-probability reaction level.
 *
 * The breaker BODY is drawn as a filled rectangle (only after the OB flips
 * to a breaker). The closest-approach candle is labeled "BLq". Touching the
 * body consumes the liquidity (zone + label removed).
 *
 * LEVEL SOURCE:
 *   1. Detect an OB via displacement.
 *   2. OB becomes a BREAKER when price CLOSES through the OB zone:
 *        Bullish OB broken DOWN (close < obLow)  → Bear Breaker (resistance above).
 *        Bearish OB broken UP   (close > obHigh) → Bull Breaker (support below).
 *
 * BODY NEAR-EDGE of the breaker:
 *   The breaker's body edge = the original OB candle's CLOSE.
 *   (Polarity flips, so the body edge flips from OPEN to CLOSE vs a fresh OB.)
 *   Bull Breaker (support): touch = wick low  <= obClose
 *   Bear Breaker (resistance): touch = wick high >= obClose
 */

export const BB_LIQUIDITY_DETECTOR_VERSION = "1.1.0";
export const BB_LIQUIDITY_DETECTOR_MODULE = "BB_Liquidity_Detector";

export function generateBbLiquidityDetector(): string {
  return `//+------------------------------------------------------------------+
//| BB_Liquidity_Detector.mq5                                      |
//| SMC Liquidity v${BB_LIQUIDITY_DETECTOR_VERSION} — Breaker Block Liquidity  |
//|                                                                  |
//| The breaker body is drawn as a filled box once the OB flips.    |
//| Price approaches the body without touching — stops accumulate.  |
//| Closest approach labeled "BLq". Body entry removes zone+label.  |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SMC Liquidity"
#property version   "1.10"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define DIR_BULL    1
#define DIR_BEAR   -1
#define PHASE_OB    0   // tracking an OB, waiting for it to break
#define PHASE_BB    1   // active breaker — liquidity tracking
#define LVL_MAX    400
#define OBJ_PREFIX "SMCBBLIQ_"

input ENUM_TIMEFRAMES InpTF          = PERIOD_CURRENT;
input int             InpLookback    = 500;
input double          InpDispMult    = 1.5;            // Displacement body >= N x ATR
input int             InpDispAtrPer  = 14;             // ATR period for displacement
input int             InpObScanBack  = 5;              // Bars back from displacement for OB candle
input double          InpNearATR     = 0.20;           // Proximity as ATR fraction
input int             InpNearAtrPer  = 14;             // ATR period for proximity
input int             InpNearPoints  = 0;              // Override: fixed points (0 = ATR)
input int             InpObExpiry    = 300;            // Bars an unbroken OB waits before expiry
input int             InpBBExpiry    = 200;            // Bars a breaker lives before expiry
input bool            InpDraw        = true;
input bool            InpDrawZone    = true;           // Draw the breaker body rectangle
input string          InpLabel       = "BLq";
input int             InpFontSize    = 8;
input color           InpBullColor   = clrMediumSeaGreen;
input color           InpBearColor   = clrTomato;
input bool            InpShowLog     = true;

struct LevelRec
{
   int      id;
   int      phase;        // PHASE_OB or PHASE_BB
   int      dir;          // OB dir while PHASE_OB; FLIPPED breaker dir while PHASE_BB
   double   obHi;         // OB candle high (break detection)
   double   obLo;         // OB candle low  (break detection)
   double   obOpen;       // OB candle open  (body box edge)
   double   obClose;      // OB candle close (breaker body edge + box)
   double   bodyEdge;     // active body edge once PHASE_BB (= obClose)
   double   zoneTop;      // max(open,close)
   double   zoneBot;      // min(open,close)
   datetime obTime;       // OB candle time (dedup key + box left edge)
   datetime confirmTime;  // displacement candle time
   datetime breakTime;    // time the breaker formed (box left edge)
   bool     dead;
   int      obAge;
   int      bbAge;
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
                   levList[i].obTime,    levList[i].zoneTop,
                   levList[i].breakTime, levList[i].zoneBot))
   {
      ObjectSetInteger(0, nm, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, nm, OBJPROP_STYLE,      STYLE_DASH);  // breaker = dashed border
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
void AddOB(int dir, double hi, double lo, double opn, double cls, datetime obT, datetime confT)
{
   for(int i = 0; i < levTotal; i++)
      if(levList[i].obTime == obT && !levList[i].dead) return;
   int idx = -1;
   for(int i = 0; i < levTotal; i++)
      if(levList[i].dead) { idx = i; break; }
   if(idx < 0 && levTotal < LVL_MAX) idx = levTotal++;
   if(idx < 0) return;
   levList[idx].id          = nextId++;
   levList[idx].phase       = PHASE_OB;
   levList[idx].dir         = dir;
   levList[idx].obHi        = hi;
   levList[idx].obLo        = lo;
   levList[idx].obOpen      = opn;
   levList[idx].obClose     = cls;
   levList[idx].bodyEdge    = 0.0;
   levList[idx].zoneTop     = 0.0;
   levList[idx].zoneBot     = 0.0;
   levList[idx].obTime      = obT;
   levList[idx].confirmTime = confT;
   levList[idx].breakTime   = 0;
   levList[idx].dead        = false;
   levList[idx].obAge       = 0;
   levList[idx].bbAge       = 0;
   levList[idx].bestLiqDist = DBL_MAX;
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
      if(dispDir == DIR_BULL && jCls < jOpn)
      {
         AddOB(DIR_BULL, iHigh(_Symbol,InpTF,j), iLow(_Symbol,InpTF,j), jOpn, jCls,
               iTime(_Symbol,InpTF,j), iTime(_Symbol,InpTF,dispShift));
         break;
      }
      if(dispDir == DIR_BEAR && jCls > jOpn)
      {
         AddOB(DIR_BEAR, iHigh(_Symbol,InpTF,j), iLow(_Symbol,InpTF,j), jOpn, jCls,
               iTime(_Symbol,InpTF,j), iTime(_Symbol,InpTF,dispShift));
         break;
      }
   }
}

//+------------------------------------------------------------------+
// Tracked OBs that close through their zone flip into breakers.
void CheckBreaks(int sh)
{
   double barClose = iClose(_Symbol, InpTF, sh);
   datetime t      = iTime (_Symbol, InpTF, sh);
   for(int i = 0; i < levTotal; i++)
   {
      if(levList[i].dead || levList[i].phase != PHASE_OB) continue;
      if(levList[i].confirmTime >= t) continue;
      bool broke = false; int newDir = 0;
      if(levList[i].dir == DIR_BULL && barClose < levList[i].obLo)   { broke = true; newDir = DIR_BEAR; }
      else if(levList[i].dir == DIR_BEAR && barClose > levList[i].obHi) { broke = true; newDir = DIR_BULL; }
      if(!broke) continue;
      levList[i].phase    = PHASE_BB;
      levList[i].dir      = newDir;
      levList[i].bodyEdge = levList[i].obClose;
      levList[i].zoneTop  = MathMax(levList[i].obOpen, levList[i].obClose);
      levList[i].zoneBot  = MathMin(levList[i].obOpen, levList[i].obClose);
      levList[i].breakTime = t;
      levList[i].bbAge    = 0;
      levList[i].bestLiqDist = DBL_MAX;
      DrawZone(i);
      if(InpShowLog)
         PrintFormat("BB_FORMED | dir=%d | bodyEdge=%.5f | %s",
            newDir, levList[i].bodyEdge, TimeToString(t,TIME_DATE|TIME_MINUTES));
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
      if(levList[i].dead || levList[i].phase != PHASE_BB) continue;
      ExtendZone(i, t);
      double edge = levList[i].bodyEdge;
      if(near <= 0) continue;

      if(levList[i].dir == DIR_BULL)   // bull breaker = support below
      {
         if(lo <= edge) { KillLevel(i); continue; }
         double dist = lo - edge;
         if(dist <= near && dist < levList[i].bestLiqDist)
         { levList[i].bestLiqDist = dist; UpdateLiqLabel(i, DIR_BULL, lo, t);
           if(InpShowLog) PrintFormat("BB_LIQ_BULL | body=%.5f | low=%.5f | dist=%.1f pts | %s", edge, lo, dist/_Point, TimeToString(t,TIME_DATE|TIME_MINUTES)); }
      }
      else                              // bear breaker = resistance above
      {
         if(hi >= edge) { KillLevel(i); continue; }
         double dist = edge - hi;
         if(dist <= near && dist < levList[i].bestLiqDist)
         { levList[i].bestLiqDist = dist; UpdateLiqLabel(i, DIR_BEAR, hi, t);
           if(InpShowLog) PrintFormat("BB_LIQ_BEAR | body=%.5f | high=%.5f | dist=%.1f pts | %s", edge, hi, dist/_Point, TimeToString(t,TIME_DATE|TIME_MINUTES)); }
      }
   }
}

//+------------------------------------------------------------------+
void AgeLevels()
{
   for(int i = 0; i < levTotal; i++)
   {
      if(levList[i].dead) continue;
      if(levList[i].phase == PHASE_OB)
      {
         if(InpObExpiry <= 0) continue;
         levList[i].obAge++;
         if(levList[i].obAge >= InpObExpiry) levList[i].dead = true;  // never broke — discard (no objects drawn yet)
      }
      else
      {
         if(InpBBExpiry <= 0) continue;
         levList[i].bbAge++;
         if(levList[i].bbAge >= InpBBExpiry) KillLevel(i);
      }
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
      { DetectOB(sh); CheckBreaks(sh); CheckLiquidity(sh); AgeLevels(); }
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
      { lastBarTime = curBar; DetectOB(1); CheckBreaks(1); CheckLiquidity(1); AgeLevels(); }
   return rates_total;
}
`;
}
