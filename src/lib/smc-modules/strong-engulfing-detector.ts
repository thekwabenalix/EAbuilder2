/**
 * Strong Engulfing (SEG) Detector
 *
 * A STRONG engulfing is a 2-candle engulfing — the decisive case where the
 * SECOND candle alone breaks and closes beyond the wick of the FIRST candle.
 * (Contrast with the general engulfing, which may take several candles to close
 *  through the wick — that weaker, multi-candle form is the ENG detector's job.)
 *
 * Bullish SEG : C1 bearish, C2 bullish and C2 closes ABOVE C1's high (upper wick)
 * Bearish SEG : C1 bullish, C2 bearish and C2 closes BELOW C1's low  (lower wick)
 * Zone = C1's full wick range (hi = C1.High, lo = C1.Low).
 *
 * This is a pure detector (reference/debug tooling). It marks zones and keeps
 * them until they expire; it does NOT model the EF inversion lifecycle.
 */

export const SEG_DETECTOR_VERSION = "1.0.0";
export const SEG_DETECTOR_MODULE = "SEG_Detector";

export function generateStrongEngulfingDetector(): string {
  return `//+------------------------------------------------------------------+
//| SEG_Detector.mq5 — Strong Engulfing (2-candle)                  |
//| Strong Engulfing Detector v${SEG_DETECTOR_VERSION}                       |
//|                                                                  |
//| A strong engulfing is a 2-candle engulfing: the 2nd candle alone |
//| closes beyond the wick of the 1st candle.                       |
//|   Bullish SEG: C1 bearish, C2 bullish, C2.close > C1.high       |
//|   Bearish SEG: C1 bullish, C2 bearish, C2.close < C1.low        |
//| Zone = C1 full wick range. Bull = blue, Bear = red.             |
//+------------------------------------------------------------------+
#property copyright "EA Builder — Strong Engulfing"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define DIR_BULL    1
#define DIR_BEAR   -1
#define MAX_ZONES   500
#define OBJ_PREFIX  "SMSEG_"

input ENUM_TIMEFRAMES InpTF         = PERIOD_CURRENT;
input int             InpLookback   = 300;
input int             InpExpiryBars = 100;       // bars until a zone is removed
input bool            InpDraw       = true;
input int             InpFontSize   = 8;
input color           InpBullColor  = clrDodgerBlue;
input color           InpBearColor  = clrRed;
input bool            InpShowLog    = true;

struct ZoneRec
{
   int      id;
   int      dir;          // 1 = bull, -1 = bear
   double   hi;           // C1 upper wick
   double   lo;           // C1 lower wick
   datetime c1Time;       // C1 bar time
   datetime c2Time;       // C2 bar time (completion)
   bool     dead;
   int      ageCounter;
};

ZoneRec zones[MAX_ZONES];
int      zonesTotal  = 0;
int      nextId      = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
string ZoneBox(int id)   { return OBJ_PREFIX + IntegerToString(id) + "_box"; }
string ZoneLabel(int id) { return OBJ_PREFIX + IntegerToString(id) + "_lbl"; }

//+------------------------------------------------------------------+
void DrawZone(int i)
{
   if(!InpDraw) return;
   color c = (zones[i].dir == DIR_BULL) ? InpBullColor : InpBearColor;

   string boxName = ZoneBox(zones[i].id);
   if(ObjectCreate(0, boxName, OBJ_RECTANGLE, 0, zones[i].c1Time, zones[i].hi,
                   iTime(_Symbol, InpTF, 0), zones[i].lo)) {
      ObjectSetInteger(0, boxName, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, boxName, OBJPROP_WIDTH,      2);
      ObjectSetInteger(0, boxName, OBJPROP_FILL,       true);
      ObjectSetInteger(0, boxName, OBJPROP_BACK,       true);
      ObjectSetInteger(0, boxName, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, boxName, OBJPROP_HIDDEN,     true);
   }

   string lblName = ZoneLabel(zones[i].id);
   double anchor = (zones[i].dir == DIR_BULL) ? zones[i].lo : zones[i].hi;
   if(ObjectCreate(0, lblName, OBJ_TEXT, 0, zones[i].c1Time, anchor)) {
      ObjectSetString (0, lblName, OBJPROP_TEXT,       "SEG");
      ObjectSetInteger(0, lblName, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, lblName, OBJPROP_FONTSIZE,   InpFontSize);
      ObjectSetInteger(0, lblName, OBJPROP_ANCHOR,
                       zones[i].dir == DIR_BULL ? ANCHOR_UPPER : ANCHOR_LOWER);
      ObjectSetInteger(0, lblName, OBJPROP_SELECTABLE, false);
   }
}

void UpdateZoneBox(int i)
{
   if(!InpDraw) return;
   string boxName = ZoneBox(zones[i].id);
   if(ObjectFind(0, boxName) >= 0)
      ObjectSetInteger(0, boxName, OBJPROP_TIME, 1, iTime(_Symbol, InpTF, 0));
}

void KillZone(int i)
{
   ObjectDelete(0, ZoneBox(zones[i].id));
   ObjectDelete(0, ZoneLabel(zones[i].id));
   zones[i].dead = true;
}

//+------------------------------------------------------------------+
// Detect a STRONG (2-candle) engulfing at bar sh (C2 = sh, C1 = sh+1).
void DetectSEG(int sh)
{
   int avail = iBars(_Symbol, InpTF);
   if(sh + 1 >= avail) return;

   double c2o = iOpen (_Symbol, InpTF, sh);
   double c2c = iClose(_Symbol, InpTF, sh);
   double c1o = iOpen (_Symbol, InpTF, sh + 1);
   double c1c = iClose(_Symbol, InpTF, sh + 1);
   double c1h = iHigh (_Symbol, InpTF, sh + 1);
   double c1l = iLow  (_Symbol, InpTF, sh + 1);
   datetime t1 = iTime(_Symbol, InpTF, sh + 1);
   datetime t2 = iTime(_Symbol, InpTF, sh);

   // Bullish strong EG: C1 bearish, C2 bullish, C2 closes above C1 upper wick
   bool isBull = (c1c < c1o) && (c2c > c2o) && (c2c > c1h);
   // Bearish strong EG: C1 bullish, C2 bearish, C2 closes below C1 lower wick
   bool isBear = (c1c > c1o) && (c2c < c2o) && (c2c < c1l);
   if(!isBull && !isBear) return;

   // Dedup: one zone per C1 time
   for(int _k = 0; _k < zonesTotal; _k++)
      if(zones[_k].c1Time == t1 && !zones[_k].dead) return;

   int idx = -1;
   for(int _k = 0; _k < zonesTotal; _k++)
      if(zones[_k].dead) { idx = _k; break; }
   if(idx < 0 && zonesTotal < MAX_ZONES) idx = zonesTotal++;
   if(idx < 0) return;

   zones[idx].id         = nextId++;
   zones[idx].dir        = isBull ? DIR_BULL : DIR_BEAR;
   zones[idx].hi         = c1h;
   zones[idx].lo         = c1l;
   zones[idx].c1Time     = t1;
   zones[idx].c2Time     = t2;
   zones[idx].dead       = false;
   zones[idx].ageCounter = 0;

   DrawZone(idx);
   if(InpShowLog)
      PrintFormat("SEG_%s | zone=[%.5f,%.5f] | %s",
                  isBull ? "BULL" : "BEAR", c1h, c1l,
                  TimeToString(t1, TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
// Extend boxes to the current bar and expire old zones.
void Maintain(int sh)
{
   datetime t = iTime(_Symbol, InpTF, sh);
   for(int i = 0; i < zonesTotal; i++) {
      if(zones[i].dead) continue;
      if(zones[i].c2Time >= t) continue;
      UpdateZoneBox(i);
      zones[i].ageCounter++;
      if(zones[i].ageCounter >= InpExpiryBars) {
         if(InpShowLog) PrintFormat("SEG_EXPIRED | zone=[%.5f,%.5f]", zones[i].hi, zones[i].lo);
         KillZone(i);
      }
   }
}

//+------------------------------------------------------------------+
void Rebuild()
{
   ObjectsDeleteAll(0, OBJ_PREFIX);
   zonesTotal = 0; nextId = 0;
   int scan = MathMin(InpLookback, iBars(_Symbol, InpTF) - 2);
   if(scan < 2) return;
   for(int sh = scan; sh >= 1; sh--) {
      DetectSEG(sh);
      Maintain(sh);
   }
}

//+------------------------------------------------------------------+
int OnInit()  {
   lastBarTime = 0;
   Rebuild();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) {
   ObjectsDeleteAll(0, OBJ_PREFIX);
}

int OnCalculate(const int rates_total, const int prev_calculated,
                const datetime &time[], const double &open[],
                const double &high[], const double &low[],
                const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
{
   datetime curBar = iTime(_Symbol, InpTF, 0);
   if(curBar != lastBarTime) {
      lastBarTime = curBar;
      DetectSEG(1);
      Maintain(1);
   }
   return rates_total;
}
`;
}
