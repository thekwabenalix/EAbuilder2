/**
 * SMC Combination Detector — Unicorn (BB + FVG) v1.0.0
 *
 * The ICT Unicorn model: a Breaker Block whose zone overlaps a Fair Value Gap
 * of the same (flipped) direction. The overlap is a high-probability entry pocket.
 *
 *   Bullish Unicorn: bullish Breaker (bearish OB broken UP) overlapping a bullish FVG.
 *   Bearish Unicorn: bearish Breaker (bullish OB broken DOWN) overlapping a bearish FVG.
 *
 * DETECTION (combination of existing modules):
 *   1. Detect OBs via displacement; track until price CLOSES through the zone →
 *      the OB flips polarity into a Breaker (same range, opposite bias).
 *   2. Detect FVGs (3-candle gaps) independently.
 *   3. When a Breaker and a same-direction FVG OVERLAP in price and are within
 *      InpPairWindowBars of each other → Unicorn. Entry = the overlap pocket.
 *
 * LIFECYCLE: ACTIVE → INVALIDATED (close back through breaker) / EXPIRED.
 */

export const UNICORN_DETECTOR_VERSION = "1.0.0";
export const UNICORN_DETECTOR_MODULE  = "Unicorn_Detector";

export function generateUnicornDetector(): string {
  return `//+------------------------------------------------------------------+
//| Unicorn_Detector.mq5                                           |
//| SMC Combination v${UNICORN_DETECTOR_VERSION} — Unicorn (Breaker + FVG)   |
//|                                                                  |
//| A Breaker Block overlapping a same-direction FVG. The overlap   |
//| pocket is the high-probability entry.                          |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SMC Combination"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define DIR_BULL    1
#define DIR_BEAR   -1
#define PHASE_OB    0
#define PHASE_BB    1
#define OB_MAX     400
#define FVG_MAX    400
#define OBJ_PREFIX "SMCUNI_"

input ENUM_TIMEFRAMES InpTF           = PERIOD_CURRENT;
input int             InpLookback     = 500;
input double          InpDispMult     = 1.5;           // Displacement body >= N x ATR
input int             InpDispAtrPer   = 14;
input int             InpObScanBack   = 5;
input int             InpPairWindow   = 15;            // Max bars between breaker & FVG
input int             InpObExpiry     = 300;           // Unbroken OB discard
input int             InpUniExpiry    = 250;           // Unicorn life
input bool            InpDraw         = true;
input string          InpLabel        = "Unicorn";
input int             InpFontSize     = 9;
input color           InpBullColor    = clrMediumSeaGreen;
input color           InpBearColor    = clrTomato;
input color           InpFvgColor     = clrSlateGray;
input bool            InpShowLog      = true;

//--- OB / Breaker record
struct OBRec
{
   int      id;
   int      phase;        // PHASE_OB or PHASE_BB
   int      dir;          // OB dir while OB; flipped breaker dir while BB
   double   hi;           // zone high (OB candle high)
   double   lo;           // zone low  (OB candle low)
   datetime obTime;
   datetime confirmTime;  // displacement time
   datetime breakTime;    // breaker birth
   bool     matched;      // already became a Unicorn
   bool     dead;
   int      obAge;
   int      uniAge;
   // matched-FVG overlap (drawn when Unicorn forms)
   double   uTop;
   double   uBot;
};

//--- FVG record
struct FvgRec
{
   int      dir;
   double   top;
   double   bot;
   datetime c1Time;       // box left edge
   datetime confirmTime;  // C3 time
   bool     used;
};

OBRec  obList[OB_MAX];
FvgRec fvgList[FVG_MAX];
int    obTotal = 0, fvgTotal = 0;
int    nextId  = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
string ZBrk(int id) { return OBJ_PREFIX + IntegerToString(id) + "_bk"; }
string ZFvg(int id) { return OBJ_PREFIX + IntegerToString(id) + "_fv"; }
string ZOvl(int id) { return OBJ_PREFIX + IntegerToString(id) + "_ov"; }
string ZLbl(int id) { return OBJ_PREFIX + IntegerToString(id) + "_lb"; }

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
void Rect(string nm, datetime t1, double p1, datetime t2, double p2, color c, int style, bool fill, int width)
{
   if(ObjectCreate(0, nm, OBJ_RECTANGLE, 0, t1, p1, t2, p2))
   {
      ObjectSetInteger(0, nm, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, nm, OBJPROP_STYLE,      style);
      ObjectSetInteger(0, nm, OBJPROP_WIDTH,      width);
      ObjectSetInteger(0, nm, OBJPROP_FILL,       fill);
      ObjectSetInteger(0, nm, OBJPROP_BACK,       true);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, nm, OBJPROP_HIDDEN,     true);
   }
}

//+------------------------------------------------------------------+
void AddOB(int dir, double hi, double lo, datetime obT, datetime confT)
{
   for(int i = 0; i < obTotal; i++)
      if(obList[i].obTime == obT && !obList[i].dead) return;
   int idx = -1;
   for(int i = 0; i < obTotal; i++)
      if(obList[i].dead) { idx = i; break; }
   if(idx < 0 && obTotal < OB_MAX) idx = obTotal++;
   if(idx < 0) return;
   obList[idx].id          = nextId++;
   obList[idx].phase       = PHASE_OB;
   obList[idx].dir         = dir;
   obList[idx].hi          = hi;
   obList[idx].lo          = lo;
   obList[idx].obTime      = obT;
   obList[idx].confirmTime = confT;
   obList[idx].breakTime   = 0;
   obList[idx].matched     = false;
   obList[idx].dead        = false;
   obList[idx].obAge       = 0;
   obList[idx].uniAge      = 0;
   obList[idx].uTop        = 0;
   obList[idx].uBot        = 0;
}

void AddFVG(int dir, double top, double bot, datetime c1T, datetime confT)
{
   int idx = -1;
   for(int i = 0; i < fvgTotal; i++)
      if(fvgList[i].used) { idx = i; break; }
   if(idx < 0 && fvgTotal < FVG_MAX) idx = fvgTotal++;
   if(idx < 0) return;
   fvgList[idx].dir         = dir;
   fvgList[idx].top         = top;
   fvgList[idx].bot         = bot;
   fvgList[idx].c1Time      = c1T;
   fvgList[idx].confirmTime = confT;
   fvgList[idx].used        = false;
}

//+------------------------------------------------------------------+
void DetectOB(int d)
{
   if(d < 1) return;
   double atr = CalcATR(d, InpDispAtrPer);
   if(atr <= 0.0) return;
   double dOpn = iOpen (_Symbol, InpTF, d);
   double dCls = iClose(_Symbol, InpTF, d);
   if(MathAbs(dCls - dOpn) < InpDispMult * atr) return;
   int dispDir = (dCls > dOpn) ? DIR_BULL : DIR_BEAR;
   int available = iBars(_Symbol, InpTF);
   int scanEnd   = d + InpObScanBack;
   if(scanEnd >= available - 1) scanEnd = available - 2;
   for(int j = d + 1; j <= scanEnd; j++)
   {
      double jOpn = iOpen (_Symbol, InpTF, j);
      double jCls = iClose(_Symbol, InpTF, j);
      if(dispDir == DIR_BULL && jCls < jOpn)
         { AddOB(DIR_BULL, iHigh(_Symbol,InpTF,j), iLow(_Symbol,InpTF,j), iTime(_Symbol,InpTF,j), iTime(_Symbol,InpTF,d)); return; }
      if(dispDir == DIR_BEAR && jCls > jOpn)
         { AddOB(DIR_BEAR, iHigh(_Symbol,InpTF,j), iLow(_Symbol,InpTF,j), iTime(_Symbol,InpTF,j), iTime(_Symbol,InpTF,d)); return; }
   }
}

void DetectFVG(int sh)
{
   int avail = iBars(_Symbol, InpTF);
   if(sh + 2 >= avail) return;
   double c1h = iHigh(_Symbol, InpTF, sh + 2);
   double c1l = iLow (_Symbol, InpTF, sh + 2);
   double c3h = iHigh(_Symbol, InpTF, sh);
   double c3l = iLow (_Symbol, InpTF, sh);
   datetime t1 = iTime(_Symbol, InpTF, sh + 2);
   datetime t3 = iTime(_Symbol, InpTF, sh);
   if(c1h < c3l) AddFVG(DIR_BULL, c3l, c1h, t1, t3);
   if(c1l > c3h) AddFVG(DIR_BEAR, c1l, c3h, t1, t3);
}

//+------------------------------------------------------------------+
// OBs that close through their zone flip into breakers.
void CheckBreaks(int sh)
{
   double cl = iClose(_Symbol, InpTF, sh);
   datetime t = iTime(_Symbol, InpTF, sh);
   for(int i = 0; i < obTotal; i++)
   {
      if(obList[i].dead || obList[i].phase != PHASE_OB) continue;
      if(obList[i].confirmTime >= t) continue;
      bool broke = false; int nd = 0;
      if(obList[i].dir == DIR_BULL && cl < obList[i].lo) { broke = true; nd = DIR_BEAR; }
      else if(obList[i].dir == DIR_BEAR && cl > obList[i].hi) { broke = true; nd = DIR_BULL; }
      if(!broke) continue;
      obList[i].phase     = PHASE_BB;
      obList[i].dir       = nd;
      obList[i].breakTime = t;
      obList[i].uniAge    = 0;
   }
}

//+------------------------------------------------------------------+
void DrawUnicorn(int i)
{
   if(!InpDraw) return;
   int    id = obList[i].id;
   color  c  = (obList[i].dir == DIR_BULL) ? InpBullColor : InpBearColor;
   datetime t2 = obList[i].breakTime;
   // breaker zone (dashed), FVG already implied; overlap pocket (solid, width 2)
   Rect(ZBrk(id), obList[i].obTime, obList[i].hi, t2, obList[i].lo, c, STYLE_DASH, false, 1);
   Rect(ZOvl(id), obList[i].obTime, obList[i].uTop, t2, obList[i].uBot, c, STYLE_SOLID, true, 2);
   double anchor = (obList[i].dir == DIR_BULL) ? obList[i].uBot : obList[i].uTop;
   if(ObjectCreate(0, ZLbl(id), OBJ_TEXT, 0, obList[i].obTime, anchor))
   {
      ObjectSetString (0, ZLbl(id), OBJPROP_TEXT,       InpLabel);
      ObjectSetInteger(0, ZLbl(id), OBJPROP_COLOR,      c);
      ObjectSetInteger(0, ZLbl(id), OBJPROP_FONTSIZE,   InpFontSize);
      ObjectSetInteger(0, ZLbl(id), OBJPROP_ANCHOR,     obList[i].dir == DIR_BULL ? ANCHOR_UPPER : ANCHOR_LOWER);
      ObjectSetInteger(0, ZLbl(id), OBJPROP_SELECTABLE, false);
   }
}

void ExtendUnicorn(int i, datetime t)
{
   if(!InpDraw) return;
   int id = obList[i].id;
   if(ObjectFind(0, ZBrk(id)) >= 0) ObjectSetInteger(0, ZBrk(id), OBJPROP_TIME, 1, t);
   if(ObjectFind(0, ZOvl(id)) >= 0) ObjectSetInteger(0, ZOvl(id), OBJPROP_TIME, 1, t);
}

void KillUnicorn(int i)
{
   int id = obList[i].id;
   ObjectDelete(0, ZBrk(id));
   ObjectDelete(0, ZFvg(id));
   ObjectDelete(0, ZOvl(id));
   ObjectDelete(0, ZLbl(id));
   obList[i].dead = true;
}

//+------------------------------------------------------------------+
// Match active breakers against same-dir overlapping FVGs → Unicorn.
void MatchPass()
{
   long windowSecs = (long)PeriodSeconds(InpTF) * (long)InpPairWindow;
   for(int i = 0; i < obTotal; i++)
   {
      if(obList[i].dead || obList[i].phase != PHASE_BB || obList[i].matched) continue;
      for(int f = 0; f < fvgTotal; f++)
      {
         if(fvgList[f].used) continue;
         if(fvgList[f].dir != obList[i].dir) continue;             // same (flipped) direction
         long dt = (long)(fvgList[f].confirmTime - obList[i].breakTime);
         if(dt < 0) dt = -dt;
         if(dt > windowSecs) continue;                              // within recency window
         // price overlap of breaker zone and FVG gap
         double ovTop = MathMin(obList[i].hi, fvgList[f].top);
         double ovBot = MathMax(obList[i].lo, fvgList[f].bot);
         if(ovBot >= ovTop) continue;                              // no overlap
         obList[i].uTop    = ovTop;
         obList[i].uBot    = ovBot;
         obList[i].matched = true;
         fvgList[f].used   = true;
         DrawUnicorn(i);
         if(InpShowLog)
            PrintFormat("UNICORN_%s | overlap=[%.5f,%.5f] | %s",
               obList[i].dir == DIR_BULL ? "BULL" : "BEAR", ovBot, ovTop,
               TimeToString(obList[i].breakTime, TIME_DATE|TIME_MINUTES));
         break;
      }
   }
}

//+------------------------------------------------------------------+
void Lifecycle(int sh)
{
   double cl = iClose(_Symbol, InpTF, sh);
   datetime t = iTime(_Symbol, InpTF, sh);
   for(int i = 0; i < obTotal; i++)
   {
      if(obList[i].dead || !obList[i].matched) continue;
      ExtendUnicorn(i, t);
      // invalidation: close back through the breaker zone
      if(obList[i].dir == DIR_BULL && cl < obList[i].lo) { KillUnicorn(i); continue; }
      if(obList[i].dir == DIR_BEAR && cl > obList[i].hi) { KillUnicorn(i); continue; }
   }
}

//+------------------------------------------------------------------+
void AgeLevels()
{
   for(int i = 0; i < obTotal; i++)
   {
      if(obList[i].dead) continue;
      if(obList[i].phase == PHASE_OB)
      {
         if(InpObExpiry <= 0) continue;
         obList[i].obAge++;
         if(obList[i].obAge >= InpObExpiry) obList[i].dead = true;
      }
      else if(obList[i].matched)
      {
         if(InpUniExpiry <= 0) continue;
         obList[i].uniAge++;
         if(obList[i].uniAge >= InpUniExpiry) KillUnicorn(i);
      }
      else
      {
         if(InpUniExpiry <= 0) continue;
         obList[i].uniAge++;
         if(obList[i].uniAge >= InpUniExpiry) obList[i].dead = true; // breaker never matched
      }
   }
}

//+------------------------------------------------------------------+
void Rebuild()
{
   ObjectsDeleteAll(0, OBJ_PREFIX);
   obTotal = 0; fvgTotal = 0; nextId = 0;
   int scan = MathMin(InpLookback, iBars(_Symbol, InpTF) - InpObScanBack - 3);
   if(scan < 3) return;
   for(int sh = scan; sh >= 1; sh--)
   {
      DetectOB(sh);
      DetectFVG(sh);
      CheckBreaks(sh);
      MatchPass();
      Lifecycle(sh);
      AgeLevels();
   }
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
   {
      lastBarTime = curBar;
      DetectOB(1); DetectFVG(1); CheckBreaks(1); MatchPass(); Lifecycle(1); AgeLevels();
   }
   return rates_total;
}
`;
}
