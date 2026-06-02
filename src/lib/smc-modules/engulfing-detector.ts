/**
 * Malaysian Engulfing Strategy (MES) Detector — EG + EF
 *
 * Detects engulfing zones and tracks their lifecycle.
 * When an EG zone is violated by price, it becomes an EF zone (opposite direction).
 *
 * EG (Engulfing):
 *   - C2 closes beyond C1's full wick (hi=C1.High, lo=C1.Low)
 *   - Bullish EG: C1 bearish, C2 bullish close > C1.High
 *   - Bearish EG: C1 bullish, C2 bearish close < C1.Low
 *   - Zone = C1 wick range
 *
 * EF (Engulfing Failed):
 *   - An EG zone that was violated by price closing through it
 *   - Bull EG fails → bear EF (same zone, opposite direction)
 *   - Bear EG fails → bull EF (same zone, opposite direction)
 *
 * LIFECYCLE:
 *   ACTIVE → RETESTED → CONFIRMED | EF flip (violation) | EXPIRED
 */

export const ENG_DETECTOR_VERSION = "1.0.0";
export const ENG_DETECTOR_MODULE = "ENG_Detector";

export function generateEngulfingDetector(): string {
  return `//+------------------------------------------------------------------+
//| ENG_Detector.mq5 — Malaysian Engulfing (EG + EF)               |
//| Engulfing Pattern Detector v${ENG_DETECTOR_VERSION}                        |
//|                                                                  |
//| Detects EG zones (2-candle engulfing patterns).                |
//| Tracks lifecycle: ACTIVE → RETESTED → CONFIRMED.               |
//| When price closes through zone, zone flips to EF (opposite dir).|
//| EG marked green/red (bullish/bearish).                         |
//| EF marked orange (failed zone, now opposite direction).        |
//+------------------------------------------------------------------+
#property copyright "EA Builder — Malaysian Engulfing Strategy"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define DIR_BULL    1
#define DIR_BEAR   -1
#define ST_ACTIVE   0
#define ST_RETESTED 1
#define ST_CONFIRM  2
#define ST_EXPIRED  3
#define MAX_ZONES   500
#define OBJ_PREFIX  "SMEGS_"

input ENUM_TIMEFRAMES InpTF          = PERIOD_CURRENT;
input int             InpLookback    = 300;
input int             InpExpiryBars  = 100;
input bool            InpDraw        = true;
input int             InpFontSize    = 8;
input color           InpBullColor   = clrDodgerBlue;
input color           InpBearColor   = clrOrangeRed;
input color           InpEFColor     = clrOrange;
input bool            InpShowLog     = true;

struct ZoneRec
{
   int      id;
   int      dir;           // 1=bull, -1=bear (may flip if EF)
   bool     isEF;          // true if this zone is an EF (failed EG)
   int      state;
   double   hi;            // C1 upper wick
   double   lo;            // C1 lower wick
   datetime c1Time;        // C1 bar time
   datetime confirmTime;   // C3/C2 time (when zone became valid)
   bool     dead;
   int      ageCounter;
};

ZoneRec zones[MAX_ZONES];
int     zonesTotal  = 0;
int     nextId      = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
string ZoneBox(int id)  { return OBJ_PREFIX + IntegerToString(id) + "_box"; }
string ZoneLabel(int id) { return OBJ_PREFIX + IntegerToString(id) + "_lbl"; }

//+------------------------------------------------------------------+
void DrawZone(int i)
{
   if(!InpDraw) return;

   // Choose color based on current direction and EF status
   color c = clrGray;
   if(zones[i].isEF) {
      c = InpEFColor;  // Orange for EF zones
   } else {
      c = (zones[i].dir == DIR_BULL) ? InpBullColor : InpBearColor;
   }

   // Rectangle from C1 time to current bar
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

   // Label
   string lblName = ZoneLabel(zones[i].id);
   double anchor_price = (zones[i].dir == DIR_BULL) ? zones[i].lo : zones[i].hi;
   if(ObjectCreate(0, lblName, OBJ_TEXT, 0, zones[i].c1Time, anchor_price)) {
      string label_text = zones[i].isEF ? "EF" : "EG";
      ObjectSetString(0, lblName, OBJPROP_TEXT,       label_text);
      ObjectSetInteger(0, lblName, OBJPROP_COLOR,     c);
      ObjectSetInteger(0, lblName, OBJPROP_FONTSIZE,  InpFontSize);
      ObjectSetInteger(0, lblName, OBJPROP_ANCHOR,
                       zones[i].dir == DIR_BULL ? ANCHOR_LOWER : ANCHOR_UPPER);
      ObjectSetInteger(0, lblName, OBJPROP_SELECTABLE, false);
   }
}

void UpdateZoneBox(int i)
{
   if(!InpDraw) return;
   string boxName = ZoneBox(zones[i].id);
   if(ObjectFind(0, boxName) >= 0) {
      ObjectSetInteger(0, boxName, OBJPROP_TIME, 1, iTime(_Symbol, InpTF, 0));

      // Update color if EF
      color c = clrGray;
      if(zones[i].isEF) {
         c = InpEFColor;
      } else {
         c = (zones[i].dir == DIR_BULL) ? InpBullColor : InpBearColor;
      }
      ObjectSetInteger(0, boxName, OBJPROP_COLOR, c);
   }
}

void KillZone(int i)
{
   ObjectDelete(0, ZoneBox(zones[i].id));
   ObjectDelete(0, ZoneLabel(zones[i].id));
   zones[i].dead = true;
}

//+------------------------------------------------------------------+
// Detect 2-candle EG at bar sh (C2=sh, C1=sh+1)
void DetectEG(int sh)
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

   // Bullish EG: C1 bearish, C2 bullish close > C1.High
   bool isBullEG = (c1c < c1o) && (c2c > c2o) && (c2c > c1h);

   // Bearish EG: C1 bullish, C2 bearish close < C1.Low
   bool isBearEG = (c1c > c1o) && (c2c < c2o) && (c2c < c1l);

   if(!isBullEG && !isBearEG) return;

   // Dedup: one zone per C1 time
   for(int _k = 0; _k < zonesTotal; _k++)
      if(zones[_k].c1Time == t1 && !zones[_k].dead) return;

   // Add zone
   int idx = -1;
   for(int _k = 0; _k < zonesTotal; _k++)
      if(zones[_k].dead) { idx = _k; break; }
   if(idx < 0 && zonesTotal < MAX_ZONES) idx = zonesTotal++;
   if(idx < 0) return;

   zones[idx].id         = nextId++;
   zones[idx].dir        = isBullEG ? DIR_BULL : DIR_BEAR;
   zones[idx].isEF       = false;
   zones[idx].state      = ST_ACTIVE;
   zones[idx].hi         = c1h;
   zones[idx].lo         = c1l;
   zones[idx].c1Time     = t1;
   zones[idx].confirmTime = iTime(_Symbol, InpTF, sh);
   zones[idx].dead       = false;
   zones[idx].ageCounter = 0;

   DrawZone(idx);
   if(InpShowLog)
      PrintFormat("EG_%s | zone=[%.5f,%.5f] | %s",
                  isBullEG ? "BULL" : "BEAR", c1h, c1l,
                  TimeToString(t1, TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
// Lifecycle: retested, confirmed, failed->EF, expired
void Lifecycle(int sh)
{
   double hi = iHigh (_Symbol, InpTF, sh);
   double lo = iLow  (_Symbol, InpTF, sh);
   double cl = iClose(_Symbol, InpTF, sh);
   datetime t = iTime(_Symbol, InpTF, sh);

   for(int i = 0; i < zonesTotal; i++) {
      if(zones[i].dead) continue;
      if(zones[i].confirmTime >= t) continue;

      UpdateZoneBox(i);

      zones[i].ageCounter++;
      if(zones[i].ageCounter >= InpExpiryBars) {
         if(InpShowLog) PrintFormat("EG_%s_EXPIRED", zones[i].isEF ? "EF" : "EG");
         KillZone(i);
         continue;
      }

      double zoneHi = zones[i].hi;
      double zoneLo = zones[i].lo;

      if(zones[i].dir == DIR_BULL) {
         // Bull zone: check for EG failure (close below lo)
         if(!zones[i].isEF && cl < zoneLo) {
            // EG failed -> flip to Bear EF
            zones[i].dir  = DIR_BEAR;
            zones[i].isEF = true;
            zones[i].state = ST_ACTIVE;
            zones[i].ageCounter = 0;
            UpdateZoneBox(i);
            if(InpShowLog)
               PrintFormat("EG_BULL_FAILED -> BEAR_EF | zone=[%.5f,%.5f]", zoneHi, zoneLo);
            continue;
         }

         // Bull zone lifecycle: ACTIVE → RETESTED → CONFIRMED
         if(zones[i].state == ST_ACTIVE && lo <= zoneHi) {
            zones[i].state = ST_RETESTED;
            if(InpShowLog)
               PrintFormat("EG_%s_RETESTED", zones[i].isEF ? "EF" : "EG");
         }
         if(zones[i].state == ST_RETESTED && cl > zoneHi) {
            zones[i].state = ST_CONFIRM;
            if(InpShowLog)
               PrintFormat("EG_%s_CONFIRMED | zone=%.5f,%.5f",
                           zones[i].isEF ? "EF" : "EG", zoneHi, zoneLo);
         }
      } else {
         // Bear zone: check for EG failure (close above hi)
         if(!zones[i].isEF && cl > zoneHi) {
            // EG failed -> flip to Bull EF
            zones[i].dir  = DIR_BULL;
            zones[i].isEF = true;
            zones[i].state = ST_ACTIVE;
            zones[i].ageCounter = 0;
            UpdateZoneBox(i);
            if(InpShowLog)
               PrintFormat("EG_BEAR_FAILED -> BULL_EF | zone=[%.5f,%.5f]", zoneHi, zoneLo);
            continue;
         }

         // Bear zone lifecycle: ACTIVE → RETESTED → CONFIRMED
         if(zones[i].state == ST_ACTIVE && hi >= zoneLo) {
            zones[i].state = ST_RETESTED;
            if(InpShowLog)
               PrintFormat("EG_%s_RETESTED", zones[i].isEF ? "EF" : "EG");
         }
         if(zones[i].state == ST_RETESTED && cl < zoneLo) {
            zones[i].state = ST_CONFIRM;
            if(InpShowLog)
               PrintFormat("EG_%s_CONFIRMED | zone=%.5f,%.5f",
                           zones[i].isEF ? "EF" : "EG", zoneHi, zoneLo);
         }
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
      DetectEG(sh);
      Lifecycle(sh);
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
      DetectEG(1);
      Lifecycle(1);
   }
   return rates_total;
}
`;
}
