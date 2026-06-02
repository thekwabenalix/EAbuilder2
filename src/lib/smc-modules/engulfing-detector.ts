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
//| Detects EG zones (multi-candle aware: an engulfing is any candle |
//| whose opposite wick is closed through, however many bars it takes)|
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
input int             InpMaxEngBars  = 20;   // max candles an engulf may take (0 = lookback)
input int             InpExpiryBars  = 100;
input bool            InpDraw        = true;
input int             InpFontSize    = 8;
input color           InpBullColor   = clrDodgerBlue;
input color           InpBearColor   = clrRed;
input color           InpEFColor     = clrOrange;
input bool            InpShowRoadblock = true;             // mark opposing zones in the path
input color           InpRoadblockColor = clrMagenta;
input bool            InpShowLog     = true;

struct ZoneRec
{
   int      id;
   int      dir;           // 1=bull, -1=bear
   bool     isEF;          // true if this zone is an EF (failed EG)
   int      state;
   double   hi;            // C1 upper wick
   double   lo;            // C1 lower wick
   datetime c1Time;        // C1 bar time (for EG, or flip time for EF)
   datetime confirmTime;   // when zone became valid
   bool     dead;
   int      ageCounter;
   int      parentId;      // for EF: links to parent EG id (-1 if EG)
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

   // Update label color and text
   string lblName = ZoneLabel(zones[i].id);
   if(ObjectFind(0, lblName) >= 0) {
      color c = zones[i].isEF ? InpEFColor :
                (zones[i].dir == DIR_BULL) ? InpBullColor : InpBearColor;
      ObjectSetInteger(0, lblName, OBJPROP_COLOR, c);

      string label_text = zones[i].isEF ? "EF" : "EG";
      ObjectSetString(0, lblName, OBJPROP_TEXT, label_text);
   }
}

void KillZone(int i)
{
   ObjectDelete(0, ZoneBox(zones[i].id));
   ObjectDelete(0, ZoneLabel(zones[i].id));
   zones[i].dead = true;
}

//+------------------------------------------------------------------+
// Add a confirmed EG zone for engulfed candle c1, completed by candle c2.
void AddZone(int c1, int c2, bool isBull, double c1h, double c1l, datetime t1)
{
   // Dedup: one zone per C1 time
   for(int _k = 0; _k < zonesTotal; _k++)
      if(zones[_k].c1Time == t1 && !zones[_k].dead) return;

   // Consolidate: remove older live zones overlapping this new zone (keep recent)
   for(int _k = 0; _k < zonesTotal; _k++) {
      if(zones[_k].dead) continue;
      if(zones[_k].lo <= c1h && c1l <= zones[_k].hi) {  // price ranges overlap
         if(InpShowLog)
            PrintFormat("OVERLAP_SUPERSEDED | old=[%.5f,%.5f] by new=[%.5f,%.5f]",
                        zones[_k].hi, zones[_k].lo, c1h, c1l);
         KillZone(_k);
      }
   }

   int idx = -1;
   for(int _k = 0; _k < zonesTotal; _k++)
      if(zones[_k].dead) { idx = _k; break; }
   if(idx < 0 && zonesTotal < MAX_ZONES) idx = zonesTotal++;
   if(idx < 0) return;

   zones[idx].id          = nextId++;
   zones[idx].dir         = isBull ? DIR_BULL : DIR_BEAR;
   zones[idx].isEF        = false;
   zones[idx].state       = ST_ACTIVE;
   zones[idx].hi          = c1h;
   zones[idx].lo          = c1l;
   zones[idx].c1Time      = t1;
   zones[idx].confirmTime = iTime(_Symbol, InpTF, c2);
   zones[idx].dead        = false;
   zones[idx].ageCounter  = 0;

   DrawZone(idx);
   if(InpShowLog)
      PrintFormat("EG_%s | zone=[%.5f,%.5f] | took %d candle(s) | C1=%s",
                  isBull ? "BULL" : "BEAR", c1h, c1l, (c1 - c2),
                  TimeToString(t1, TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
// Detect EG completed at bar c2 (multi-candle aware).
// An engulfing = a candle whose OPPOSITE wick is closed through, no matter how
// many candles it takes. We treat c2 as the completing candle and scan back to
// the NEAREST prior candle C1 whose opposite wick c2 just closed beyond — and
// require c2 to be the FIRST bar to break that wick (so each event fires once).
void DetectEG(int c2)
{
   int avail = iBars(_Symbol, InpTF);
   if(c2 + 1 >= avail) return;

   double c2o = iOpen (_Symbol, InpTF, c2);
   double c2c = iClose(_Symbol, InpTF, c2);

   int maxBack = (InpMaxEngBars > 0) ? InpMaxEngBars : InpLookback;

   for(int k = 1; k <= maxBack; k++) {
      int c1 = c2 + k;
      if(c1 >= avail) break;

      double c1o = iOpen (_Symbol, InpTF, c1);
      double c1c = iClose(_Symbol, InpTF, c1);
      double c1h = iHigh (_Symbol, InpTF, c1);
      double c1l = iLow  (_Symbol, InpTF, c1);
      datetime t1 = iTime(_Symbol, InpTF, c1);

      bool c1Bear = (c1c < c1o);
      bool c1Bull = (c1c > c1o);

      // Bullish EG: bearish C1, completing candle bullish & closes ABOVE C1 upper wick
      bool isBullEG = c1Bear && (c2c > c2o) && (c2c > c1h);
      // Bearish EG: bullish C1, completing candle bearish & closes BELOW C1 lower wick
      bool isBearEG = c1Bull && (c2c < c2o) && (c2c < c1l);
      if(!isBullEG && !isBearEG) continue;

      // c2 must be the FIRST bar after C1 to close beyond that wick.
      // Check intermediate bars (more recent than C1, older than c2).
      bool firstBreak = true;
      for(int m = c1 - 1; m > c2; m--) {
         double mc = iClose(_Symbol, InpTF, m);
         if(isBullEG && mc > c1h) { firstBreak = false; break; }
         if(isBearEG && mc < c1l) { firstBreak = false; break; }
      }
      if(!firstBreak) continue;

      AddZone(c1, c2, isBullEG, c1h, c1l, t1);
      return;  // nearest qualifying C1 only — one engulfing per completing candle
   }
}

//+------------------------------------------------------------------+
// Flip an EG zone into an EF zone (in place, once only)
void FlipToEF(int i, int efDir)
{
   zones[i].dir   = efDir;
   zones[i].isEF  = true;
   zones[i].state = ST_ACTIVE;
   // keep ageCounter so EF still expires relative to original; reset for fresh life
   zones[i].ageCounter = 0;
   UpdateZoneBox(i);  // recolor to orange + relabel "EF"
   if(InpShowLog)
      PrintFormat("EF_%s_FORMED | zone=[%.5f,%.5f]",
                  efDir == DIR_BULL ? "BULL" : "BEAR", zones[i].hi, zones[i].lo);
}

//+------------------------------------------------------------------+
// Lifecycle: retest, confirm, EG->EF flip (once), EF break (delete), expire
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
         if(InpShowLog) PrintFormat("%s_EXPIRED", zones[i].isEF ? "EF" : "EG");
         KillZone(i);
         continue;
      }

      double zoneHi = zones[i].hi;
      double zoneLo = zones[i].lo;

      // ---------------- EF zones: break = delete (a second flip is invalid) ----------
      if(zones[i].isEF) {
         // Bullish EF (was bear EG) breaks when price closes back below the zone
         if(zones[i].dir == DIR_BULL && cl < zoneLo) {
            if(InpShowLog) PrintFormat("BULL_EF_BROKEN -> DELETE | zone=[%.5f,%.5f]", zoneHi, zoneLo);
            KillZone(i);
            continue;
         }
         // Bearish EF (was bull EG) breaks when price closes back above the zone
         if(zones[i].dir == DIR_BEAR && cl > zoneHi) {
            if(InpShowLog) PrintFormat("BEAR_EF_BROKEN -> DELETE | zone=[%.5f,%.5f]", zoneHi, zoneLo);
            KillZone(i);
            continue;
         }
         continue; // EF zones do not run EG retest/confirm logic
      }

      // ---------------- EG zones: flip once on failure, else retest/confirm ----------
      if(zones[i].dir == DIR_BULL) {
         // Bull EG fails when price CLOSES below the zone -> flip to bearish EF
         if(cl < zoneLo) {
            if(InpShowLog) PrintFormat("EG_BULL_FAILED -> EF | zone=[%.5f,%.5f]", zoneHi, zoneLo);
            FlipToEF(i, DIR_BEAR);
            continue;
         }
         // Bull EG lifecycle: ACTIVE -> RETESTED -> CONFIRMED
         if(zones[i].state == ST_ACTIVE && lo <= zoneHi) {
            zones[i].state = ST_RETESTED;
            if(InpShowLog) Print("EG_BULL_RETESTED");
         }
         if(zones[i].state == ST_RETESTED && cl > zoneHi) {
            zones[i].state = ST_CONFIRM;
            if(InpShowLog) PrintFormat("EG_BULL_CONFIRMED | zone=%.5f,%.5f", zoneHi, zoneLo);
         }
      } else {
         // Bear EG fails when price CLOSES above the zone -> flip to bullish EF
         if(cl > zoneHi) {
            if(InpShowLog) PrintFormat("EG_BEAR_FAILED -> EF | zone=[%.5f,%.5f]", zoneHi, zoneLo);
            FlipToEF(i, DIR_BULL);
            continue;
         }
         // Bear EG lifecycle: ACTIVE -> RETESTED -> CONFIRMED
         if(zones[i].state == ST_ACTIVE && hi >= zoneLo) {
            zones[i].state = ST_RETESTED;
            if(InpShowLog) Print("EG_BEAR_RETESTED");
         }
         if(zones[i].state == ST_RETESTED && cl < zoneLo) {
            zones[i].state = ST_CONFIRM;
            if(InpShowLog) PrintFormat("EG_BEAR_CONFIRMED | zone=%.5f,%.5f", zoneHi, zoneLo);
         }
      }
   }
}

//+------------------------------------------------------------------+
// Roadblock: the nearest opposing live zone in the path of a move.
// Bull move blocked by nearest active BEAR zone ABOVE price; bear move blocked
// by nearest active BULL zone BELOW price. Drawn as magenta lines labelled RB.
void MarkRoadblocks()
{
   ObjectsDeleteAll(0, OBJ_PREFIX + "RB_");
   if(!InpShowRoadblock) return;

   double px = iClose(_Symbol, InpTF, 0);
   double bullBlock = 0.0;   // nearest bear-zone lower edge above price
   double bearBlock = 0.0;   // nearest bull-zone upper edge below price

   for(int i = 0; i < zonesTotal; i++) {
      if(zones[i].dead) continue;
      if(zones[i].dir == DIR_BEAR && zones[i].lo > px)
         if(bullBlock == 0.0 || zones[i].lo < bullBlock) bullBlock = zones[i].lo;
      if(zones[i].dir == DIR_BULL && zones[i].hi < px)
         if(bearBlock == 0.0 || zones[i].hi > bearBlock) bearBlock = zones[i].hi;
   }

   datetime t0 = iTime(_Symbol, InpTF, 0);
   if(bullBlock > 0.0) {
      string ln = OBJ_PREFIX + "RB_UP";
      if(ObjectCreate(0, ln, OBJ_HLINE, 0, 0, bullBlock)) {
         ObjectSetInteger(0, ln, OBJPROP_COLOR, InpRoadblockColor);
         ObjectSetInteger(0, ln, OBJPROP_STYLE, STYLE_DASH);
         ObjectSetInteger(0, ln, OBJPROP_SELECTABLE, false);
      }
      string lb = OBJ_PREFIX + "RB_UP_LBL";
      if(ObjectCreate(0, lb, OBJ_TEXT, 0, t0, bullBlock)) {
         ObjectSetString(0, lb, OBJPROP_TEXT, "RB (bull blocked)");
         ObjectSetInteger(0, lb, OBJPROP_COLOR, InpRoadblockColor);
         ObjectSetInteger(0, lb, OBJPROP_FONTSIZE, InpFontSize);
         ObjectSetInteger(0, lb, OBJPROP_ANCHOR, ANCHOR_LOWER);
         ObjectSetInteger(0, lb, OBJPROP_SELECTABLE, false);
      }
   }
   if(bearBlock > 0.0) {
      string ln = OBJ_PREFIX + "RB_DN";
      if(ObjectCreate(0, ln, OBJ_HLINE, 0, 0, bearBlock)) {
         ObjectSetInteger(0, ln, OBJPROP_COLOR, InpRoadblockColor);
         ObjectSetInteger(0, ln, OBJPROP_STYLE, STYLE_DASH);
         ObjectSetInteger(0, ln, OBJPROP_SELECTABLE, false);
      }
      string lb = OBJ_PREFIX + "RB_DN_LBL";
      if(ObjectCreate(0, lb, OBJ_TEXT, 0, t0, bearBlock)) {
         ObjectSetString(0, lb, OBJPROP_TEXT, "RB (bear blocked)");
         ObjectSetInteger(0, lb, OBJPROP_COLOR, InpRoadblockColor);
         ObjectSetInteger(0, lb, OBJPROP_FONTSIZE, InpFontSize);
         ObjectSetInteger(0, lb, OBJPROP_ANCHOR, ANCHOR_UPPER);
         ObjectSetInteger(0, lb, OBJPROP_SELECTABLE, false);
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
   MarkRoadblocks();
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
      MarkRoadblocks();
   }
   return rates_total;
}
`;
}
