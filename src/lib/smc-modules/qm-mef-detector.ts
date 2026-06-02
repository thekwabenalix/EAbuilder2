/**
 * QM_MEF Detector — Quasimodo Manipulation Entry Formula
 *
 * Detects a Quasimodo (QM) structure that is BORN FROM a higher-timeframe strong
 * engulfing candle. It is NOT a general Quasimodo detector — without an HTF
 * engulfing candle there is no valid QM_MEF.
 *
 *   HTF: a STRONG (2-candle) engulfing candle
 *   LTF: a Quasimodo structure inside the engulfing candle's time/range
 *        → the left shoulder is the entry level
 *   Optional confluence opposite/around the left shoulder: Gap SNR, RBR, or DBD
 *        → strength = "strong" when present, else "normal"
 *
 * Quasimodo (CLOSE-based — wicks are ignored; highs/lows use candle closes):
 *
 *   Bullish QM (after bearish move):
 *     LEFT SHOULDER low → pullback high → HEAD (lower low, close below LS) →
 *     higher high (close above pullback high). Price returns to the LS level =
 *     RIGHT SHOULDER = entry.
 *
 *   Bearish QM (after bullish move):
 *     LEFT SHOULDER high → pullback low → HEAD (higher high, close above LS) →
 *     lower low (close below pullback low). RIGHT SHOULDER = entry.
 *
 *   Bullish QM_MEF must come from a bullish HTF engulfing; bearish from bearish.
 *
 * Reference trade levels (output/drawn — this is detection only, no orders):
 *   Entry = LEFT SHOULDER (= where the RIGHT SHOULDER forms on return)
 *   SL    = beyond the HEAD (below the head for bull, above for bear)
 *   TP    = the pullback extreme (above the pullback high / below the pullback low)
 *
 * Invalidation: close beyond the HEAD kills the pattern.
 *
 * Detection only — no trade execution.
 */

export const QM_MEF_DETECTOR_VERSION = "1.0.0";
export const QM_MEF_DETECTOR_MODULE = "QM_MEF_Detector";

export function generateQmMefDetector(): string {
  return `//+------------------------------------------------------------------+
//| QM_MEF_Detector.mq5 — Quasimodo Manipulation Entry Formula      |
//| QM_MEF Detector v${QM_MEF_DETECTOR_VERSION}                              |
//|                                                                  |
//| Strong HTF engulfing → LTF close-based Quasimodo → left shoulder |
//| entry, + optional Gap SNR / RBR / DBD confluence (strength).    |
//| Quasimodo uses candle CLOSES, not wicks. Detection only.       |
//+------------------------------------------------------------------+
#property copyright "EA Builder — QM_MEF"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define DIR_BULL    1
#define DIR_BEAR   -1
#define CONF_NONE   0
#define CONF_GAP    1
#define CONF_RBR    2
#define CONF_DBD    3
#define MAX_QM      300
#define OBJ_PREFIX  "SMQMM_"

//--- Timeframes
input ENUM_TIMEFRAMES InpMainTF = PERIOD_H4;    // HTF engulfing timeframe
input ENUM_TIMEFRAMES InpQmTF   = PERIOD_M15;   // LTF Quasimodo timeframe
input ENUM_TIMEFRAMES InpConfTF = PERIOD_M5;    // confluence timeframe (Gap/RBR/DBD)

input int    InpLookback       = 300;   // main-TF bars to scan
input int    InpExpiryBars     = 150;   // main-TF bars until a QM_MEF is removed

//--- Confluence tuning (RBR/DBD on the confluence TF)
input double InpImpulseRatio   = 0.5;   // leg candle body/range
input double InpBaseMaxRatio   = 0.5;   // base candle body/range
input int    InpMaxBaseCandles = 6;
input double InpLegBaseMult     = 1.3;
input double InpConfTolFrac     = 0.30;  // "near left shoulder" tolerance as frac of QM range

input bool   InpDraw           = true;
input int    InpFontSize       = 6;
input color  InpBullColor      = clrLimeGreen;
input color  InpBearColor      = clrOrangeRed;
input color  InpShoulderColor  = clrGold;
input color  InpConfColor      = clrMediumPurple;
input bool   InpShowLog        = true;

struct QmRec
{
   int      id;
   int      dir;          // 1 bull, -1 bear
   double   engHi;        // HTF engulfing candle high
   double   engLo;        // HTF engulfing candle low
   datetime engTime;      // engulfing window start (C1)
   datetime engEnd;       // engulfing window end
   double   lsLevel;      // LEFT SHOULDER (entry) — close-based
   double   headLevel;    // HEAD extreme: LL close (bull) / HH close (bear) → SL beyond
   double   pbLevel;      // pullback high (bull) / pullback low (bear) → TP
   double   confirmLevel; // higher-high (bull) / lower-low (bear) close
   datetime headTime;     // LTF head (LL bull / HH bear) time
   datetime lsTime;       // LEFT SHOULDER time
   int      conf;         // CONF_NONE/GAP/RBR/DBD
   double   confGap;      // gap level if CONF_GAP
   double   confBaseHi;   // base hi if CONF_RBR/DBD
   double   confBaseLo;   // base lo
   bool     strong;       // true if any confluence present
   bool     lsTouched;    // true once price taps the left shoulder (entry)
   datetime lsEnd;        // current right edge of the left-shoulder line
   bool     dead;
   int      ageCounter;
};

QmRec    qms[MAX_QM];
int      qmTotal     = 0;
int      nextId      = 0;
datetime lastMainBar = 0;

//+------------------------------------------------------------------+
// Per-timeframe candle helpers.
double BR(ENUM_TIMEFRAMES tf, int sh)
{
   double o = iOpen (_Symbol, tf, sh);
   double c = iClose(_Symbol, tf, sh);
   double r = iHigh (_Symbol, tf, sh) - iLow(_Symbol, tf, sh);
   if(r <= 0.0) return 0.0;
   return MathAbs(c - o) / r;
}
double RNG (ENUM_TIMEFRAMES tf, int sh) { return iHigh(_Symbol, tf, sh) - iLow(_Symbol, tf, sh); }
bool   BULL(ENUM_TIMEFRAMES tf, int sh) { return iClose(_Symbol, tf, sh) > iOpen(_Symbol, tf, sh); }
bool   BEAR(ENUM_TIMEFRAMES tf, int sh) { return iClose(_Symbol, tf, sh) < iOpen(_Symbol, tf, sh); }
bool   STRONG(ENUM_TIMEFRAMES tf, int sh) { return BR(tf, sh) >= InpImpulseRatio; }
bool   SMALL (ENUM_TIMEFRAMES tf, int sh) { return BR(tf, sh) <= InpBaseMaxRatio; }

//+------------------------------------------------------------------+
// Close-based Quasimodo detection inside [wStart,wEnd] on the QM TF.
// Returns true and fills the left shoulder + confirmation + head time.
bool DetectQM(int dir, datetime wStart, datetime wEnd,
              double &lsLevel, double &confirmLevel, double &headLevel, double &pbLevel,
              datetime &headTime, datetime &lsTime)
{
   int shOld = iBarShift(_Symbol, InpQmTF, wStart);  // oldest (largest shift)
   int shNew = iBarShift(_Symbol, InpQmTF, wEnd);    // newest (smallest shift)
   if(shOld < 0 || shNew < 0) return false;
   int n = shOld - shNew + 1;
   if(n < 4 || n > 1000) return false;

   if(dir == DIR_BULL)
   {
      // head = lowest close (lower low)
      int pLL = -1; double minC = 1e18;
      for(int i = 0; i < n; i++) { double c = iClose(_Symbol, InpQmTF, shOld - i);
         if(c < minC) { minC = c; pLL = i; } }
      if(pLL < 2) return false;
      // pullback high = highest close before the head
      int pPBH = -1; double maxC = -1e18;
      for(int i = 0; i < pLL; i++) { double c = iClose(_Symbol, InpQmTF, shOld - i);
         if(c > maxC) { maxC = c; pPBH = i; } }
      if(pPBH < 1) return false;
      // left shoulder low = lowest close before the pullback high
      int pLS = -1; double minLS = 1e18;
      for(int i = 0; i < pPBH; i++) { double c = iClose(_Symbol, InpQmTF, shOld - i);
         if(c < minLS) { minLS = c; pLS = i; } }
      if(pLS < 0) return false;
      if(!(minC  < minLS)) return false;   // head is a LOWER low vs shoulder
      if(!(maxC  > minLS)) return false;   // pullback high above shoulder
      // higher-high confirmation: a close above the pullback high AFTER the head
      int q = -1;
      for(int i = pLL + 1; i < n; i++)
         if(iClose(_Symbol, InpQmTF, shOld - i) > maxC) { q = i; break; }
      if(q < 0) return false;

      lsLevel      = minLS;
      confirmLevel = iClose(_Symbol, InpQmTF, shOld - q);
      headLevel    = minC;   // head = lower low (bull) → invalid on close below
      pbLevel      = maxC;   // pullback high → TP (above the pullback high)
      headTime     = iTime (_Symbol, InpQmTF, shOld - pLL);
      lsTime       = iTime (_Symbol, InpQmTF, shOld - pLS);
      return true;
   }
   else
   {
      // head = highest close (higher high)
      int pHH = -1; double maxC = -1e18;
      for(int i = 0; i < n; i++) { double c = iClose(_Symbol, InpQmTF, shOld - i);
         if(c > maxC) { maxC = c; pHH = i; } }
      if(pHH < 2) return false;
      // pullback low = lowest close before the head
      int pPBL = -1; double minC = 1e18;
      for(int i = 0; i < pHH; i++) { double c = iClose(_Symbol, InpQmTF, shOld - i);
         if(c < minC) { minC = c; pPBL = i; } }
      if(pPBL < 1) return false;
      // left shoulder high = highest close before the pullback low
      int pLS = -1; double maxLS = -1e18;
      for(int i = 0; i < pPBL; i++) { double c = iClose(_Symbol, InpQmTF, shOld - i);
         if(c > maxLS) { maxLS = c; pLS = i; } }
      if(pLS < 0) return false;
      if(!(maxC > maxLS)) return false;    // head is a HIGHER high vs shoulder
      if(!(minC < maxLS)) return false;    // pullback low below shoulder
      // lower-low confirmation: a close below the pullback low AFTER the head
      int q = -1;
      for(int i = pHH + 1; i < n; i++)
         if(iClose(_Symbol, InpQmTF, shOld - i) < minC) { q = i; break; }
      if(q < 0) return false;

      lsLevel      = maxLS;
      confirmLevel = iClose(_Symbol, InpQmTF, shOld - q);
      headLevel    = maxC;   // head = higher high (bear) → invalid on close above
      pbLevel      = minC;   // pullback low → TP (below the pullback low)
      headTime     = iTime (_Symbol, InpQmTF, shOld - pHH);
      lsTime       = iTime (_Symbol, InpQmTF, shOld - pLS);
      return true;
   }
}

//+------------------------------------------------------------------+
// Gap SNR near a level within [wStart,wEnd] on the confluence TF.
double FindGapSnrNear(int dir, datetime wStart, datetime wEnd, double level, double tol)
{
   int shOld = iBarShift(_Symbol, InpConfTF, wStart);
   int shNew = iBarShift(_Symbol, InpConfTF, wEnd);
   if(shOld < 1 || shNew < 0) return 0.0;
   for(int a = shOld; a >= shNew + 1; a--)
   {
      int b = a - 1;
      if(b < 0) break;
      datetime tA = iTime(_Symbol, InpConfTF, a);
      datetime tB = iTime(_Symbol, InpConfTF, b);
      if(tA < wStart || tB > wEnd) continue;
      bool match = (dir == DIR_BULL) ? (BULL(InpConfTF, a) && BULL(InpConfTF, b))
                                     : (BEAR(InpConfTF, a) && BEAR(InpConfTF, b));
      if(!match) continue;
      double lvl = iClose(_Symbol, InpConfTF, a);
      if(MathAbs(lvl - level) <= tol) return lvl;
   }
   return 0.0;
}

//+------------------------------------------------------------------+
// RBR (dir=+1) / DBD (dir=-1) whose base brackets a level (within tol).
bool FindRbrDbdNear(int dir, datetime wStart, datetime wEnd, double level, double tol,
                    double &outHi, double &outLo)
{
   int avail = iBars(_Symbol, InpConfTF);
   int shOld = iBarShift(_Symbol, InpConfTF, wStart);
   int shNew = iBarShift(_Symbol, InpConfTF, wEnd);
   if(shOld < 0 || shNew < 0) return false;

   for(int b = shNew; b <= shOld; b++)
   {
      if(b + 2 >= avail) continue;
      datetime tb = iTime(_Symbol, InpConfTF, b);
      if(tb < wStart || tb > wEnd) continue;
      if(!STRONG(InpConfTF, b)) continue;
      if(dir == DIR_BULL && !BULL(InpConfTF, b)) continue;
      if(dir == DIR_BEAR && !BEAR(InpConfTF, b)) continue;

      int baseLen = 0;
      while(baseLen < InpMaxBaseCandles
            && (b + 1 + baseLen) < avail
            && SMALL(InpConfTF, b + 1 + baseLen))
         baseLen++;
      if(baseLen < 1) continue;
      int legIn = b + 1 + baseLen;
      if(legIn >= avail) continue;
      if(!STRONG(InpConfTF, legIn)) continue;
      if(dir == DIR_BULL && !BULL(InpConfTF, legIn)) continue;
      if(dir == DIR_BEAR && !BEAR(InpConfTF, legIn)) continue;

      double bHi = -1.0, bLo = 1e18, sumR = 0.0;
      for(int k = 0; k < baseLen; k++) {
         int bb = b + 1 + k;
         double h = iHigh(_Symbol, InpConfTF, bb);
         double l = iLow (_Symbol, InpConfTF, bb);
         if(h > bHi) bHi = h;
         if(l < bLo) bLo = l;
         sumR += (h - l);
      }
      double avgR = sumR / baseLen;
      if(avgR <= 0.0) continue;
      if(RNG(InpConfTF, b)     < InpLegBaseMult * avgR) continue;
      if(RNG(InpConfTF, legIn) < InpLegBaseMult * avgR) continue;
      double lc = iClose(_Symbol, InpConfTF, b);
      if(dir == DIR_BULL && lc <= bHi) continue;
      if(dir == DIR_BEAR && lc >= bLo) continue;

      // base must bracket the left-shoulder level (within tolerance)
      if(level < bLo - tol || level > bHi + tol) continue;

      outHi = bHi; outLo = bLo;
      return true;
   }
   return false;
}

//+------------------------------------------------------------------+
string ObjBox(int id)    { return OBJ_PREFIX + IntegerToString(id) + "_eng"; }
string ObjLbl(int id)    { return OBJ_PREFIX + IntegerToString(id) + "_lbl"; }
string ObjLS(int id)     { return OBJ_PREFIX + IntegerToString(id) + "_ls"; }   // left shoulder / entry ray
string ObjLSL(int id)    { return OBJ_PREFIX + IntegerToString(id) + "_lsl"; }  // "Left Shoulder (entry)"
string ObjRS(int id)     { return OBJ_PREFIX + IntegerToString(id) + "_rs"; }   // "Right Shoulder (entry)"
string ObjHead(int id)   { return OBJ_PREFIX + IntegerToString(id) + "_head"; } // head vline
string ObjHeadL(int id)  { return OBJ_PREFIX + IntegerToString(id) + "_headl"; }// head level + SL label
string ObjTP(int id)     { return OBJ_PREFIX + IntegerToString(id) + "_tp"; }   // take-profit (pullback) level
string ObjConf(int id)   { return OBJ_PREFIX + IntegerToString(id) + "_conf"; }

void DrawQm(int i)
{
   if(!InpDraw) return;
   color c = (qms[i].dir == DIR_BULL) ? InpBullColor : InpBearColor;

   // HTF engulfing zone
   string box = ObjBox(qms[i].id);
   if(ObjectCreate(0, box, OBJ_RECTANGLE, 0, qms[i].engTime, qms[i].engHi,
                   qms[i].engEnd, qms[i].engLo)) {
      ObjectSetInteger(0, box, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, box, OBJPROP_WIDTH,      2);
      ObjectSetInteger(0, box, OBJPROP_FILL,       false);
      ObjectSetInteger(0, box, OBJPROP_BACK,       true);
      ObjectSetInteger(0, box, OBJPROP_SELECTABLE, false);
   }
   string lbl = ObjLbl(qms[i].id);
   double anchor = (qms[i].dir == DIR_BULL) ? qms[i].engHi : qms[i].engLo;
   if(ObjectCreate(0, lbl, OBJ_TEXT, 0, qms[i].engTime, anchor)) {
      string txt = (qms[i].dir == DIR_BULL ? "Bull QM_MEF" : "Bear QM_MEF");
      txt = txt + (qms[i].strong ? " [STRONG]" : " [normal]");
      ObjectSetString (0, lbl, OBJPROP_TEXT,       txt);
      ObjectSetInteger(0, lbl, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, lbl, OBJPROP_FONTSIZE,   InpFontSize);
      ObjectSetInteger(0, lbl, OBJPROP_ANCHOR,
                       qms[i].dir == DIR_BULL ? ANCHOR_LOWER : ANCHOR_UPPER);
      ObjectSetInteger(0, lbl, OBJPROP_SELECTABLE, false);
   }
   // LEFT SHOULDER (entry) level — SHORT line (no ray). It grows only until price
   // taps the level (the entry), then it is frozen. Right edge = lsEnd.
   string ls = ObjLS(qms[i].id);
   if(ObjectCreate(0, ls, OBJ_TREND, 0, qms[i].lsTime, qms[i].lsLevel,
                   qms[i].lsEnd, qms[i].lsLevel)) {
      ObjectSetInteger(0, ls, OBJPROP_COLOR,      InpShoulderColor);
      ObjectSetInteger(0, ls, OBJPROP_STYLE,      STYLE_SOLID);
      ObjectSetInteger(0, ls, OBJPROP_WIDTH,      2);
      ObjectSetInteger(0, ls, OBJPROP_RAY_RIGHT,  false);
      ObjectSetInteger(0, ls, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, ls, OBJPROP_BACK,       true);
   }
   string lsl = ObjLSL(qms[i].id);
   if(ObjectCreate(0, lsl, OBJ_TEXT, 0, qms[i].lsTime, qms[i].lsLevel)) {
      ObjectSetString (0, lsl, OBJPROP_TEXT,       "Left Shoulder (entry)");
      ObjectSetInteger(0, lsl, OBJPROP_COLOR,      InpShoulderColor);
      ObjectSetInteger(0, lsl, OBJPROP_FONTSIZE,   InpFontSize);
      ObjectSetInteger(0, lsl, OBJPROP_ANCHOR,     ANCHOR_LEFT_LOWER);
      ObjectSetInteger(0, lsl, OBJPROP_SELECTABLE, false);
   }
   // RIGHT SHOULDER label at the same (LS) level, on the right where price returns to enter.
   string rs = ObjRS(qms[i].id);
   if(ObjectCreate(0, rs, OBJ_TEXT, 0, qms[i].engEnd, qms[i].lsLevel)) {
      ObjectSetString (0, rs, OBJPROP_TEXT,        "Right Shoulder (entry)");
      ObjectSetInteger(0, rs, OBJPROP_COLOR,       InpShoulderColor);
      ObjectSetInteger(0, rs, OBJPROP_FONTSIZE,    InpFontSize);
      ObjectSetInteger(0, rs, OBJPROP_ANCHOR,      ANCHOR_RIGHT_UPPER);
      ObjectSetInteger(0, rs, OBJPROP_SELECTABLE,  false);
   }
   // HEAD marker (LL bull / HH bear) — SL goes beyond the head.
   string hd = ObjHead(qms[i].id);
   if(ObjectCreate(0, hd, OBJ_VLINE, 0, qms[i].headTime, 0)) {
      ObjectSetInteger(0, hd, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, hd, OBJPROP_STYLE,      STYLE_DOT);
      ObjectSetInteger(0, hd, OBJPROP_BACK,       true);
      ObjectSetInteger(0, hd, OBJPROP_SELECTABLE, false);
   }
   string hdl = ObjHeadL(qms[i].id);
   if(ObjectCreate(0, hdl, OBJ_TREND, 0, qms[i].headTime, qms[i].headLevel,
                   qms[i].engEnd, qms[i].headLevel)) {
      ObjectSetInteger(0, hdl, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, hdl, OBJPROP_STYLE,      STYLE_DOT);
      ObjectSetInteger(0, hdl, OBJPROP_WIDTH,      1);
      ObjectSetInteger(0, hdl, OBJPROP_RAY_RIGHT,  false);
      ObjectSetInteger(0, hdl, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, hdl, OBJPROP_BACK,       true);
   }
   string hdt = ObjHeadL(qms[i].id) + "t";
   if(ObjectCreate(0, hdt, OBJ_TEXT, 0, qms[i].headTime, qms[i].headLevel)) {
      ObjectSetString (0, hdt, OBJPROP_TEXT,       "Head (SL beyond)");
      ObjectSetInteger(0, hdt, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, hdt, OBJPROP_FONTSIZE,   InpFontSize);
      ObjectSetInteger(0, hdt, OBJPROP_ANCHOR,
                       qms[i].dir == DIR_BULL ? ANCHOR_LEFT_UPPER : ANCHOR_LEFT_LOWER);
      ObjectSetInteger(0, hdt, OBJPROP_SELECTABLE, false);
   }
   // TAKE PROFIT — the high (bull) / low (bear) that created the pullback.
   string tp = ObjTP(qms[i].id);
   if(ObjectCreate(0, tp, OBJ_TREND, 0, qms[i].engTime, qms[i].pbLevel,
                   qms[i].engEnd, qms[i].pbLevel)) {
      ObjectSetInteger(0, tp, OBJPROP_COLOR,      clrDeepSkyBlue);
      ObjectSetInteger(0, tp, OBJPROP_STYLE,      STYLE_DASHDOT);
      ObjectSetInteger(0, tp, OBJPROP_WIDTH,      1);
      ObjectSetInteger(0, tp, OBJPROP_RAY_RIGHT,  true);
      ObjectSetInteger(0, tp, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, tp, OBJPROP_BACK,       true);
   }
   string tpl = ObjTP(qms[i].id) + "t";
   if(ObjectCreate(0, tpl, OBJ_TEXT, 0, qms[i].engTime, qms[i].pbLevel)) {
      ObjectSetString (0, tpl, OBJPROP_TEXT,       "TP (pullback)");
      ObjectSetInteger(0, tpl, OBJPROP_COLOR,      clrDeepSkyBlue);
      ObjectSetInteger(0, tpl, OBJPROP_FONTSIZE,   InpFontSize);
      ObjectSetInteger(0, tpl, OBJPROP_ANCHOR,
                       qms[i].dir == DIR_BULL ? ANCHOR_LEFT_LOWER : ANCHOR_LEFT_UPPER);
      ObjectSetInteger(0, tpl, OBJPROP_SELECTABLE, false);
   }
   // Confluence
   if(qms[i].conf == CONF_GAP) {
      string cf = ObjConf(qms[i].id);
      if(ObjectCreate(0, cf, OBJ_TREND, 0, qms[i].engTime, qms[i].confGap,
                      qms[i].engEnd, qms[i].confGap)) {
         ObjectSetInteger(0, cf, OBJPROP_COLOR,      InpConfColor);
         ObjectSetInteger(0, cf, OBJPROP_STYLE,      STYLE_DASH);
         ObjectSetInteger(0, cf, OBJPROP_RAY_RIGHT,  false);
         ObjectSetInteger(0, cf, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, cf, OBJPROP_BACK,       true);
      }
   } else if(qms[i].conf == CONF_RBR || qms[i].conf == CONF_DBD) {
      string cf = ObjConf(qms[i].id);
      if(ObjectCreate(0, cf, OBJ_RECTANGLE, 0, qms[i].engTime, qms[i].confBaseHi,
                      qms[i].engEnd, qms[i].confBaseLo)) {
         ObjectSetInteger(0, cf, OBJPROP_COLOR,      InpConfColor);
         ObjectSetInteger(0, cf, OBJPROP_FILL,       true);
         ObjectSetInteger(0, cf, OBJPROP_BACK,       true);
         ObjectSetInteger(0, cf, OBJPROP_SELECTABLE, false);
      }
   }
}

void KillQm(int i)
{
   ObjectDelete(0, ObjBox  (qms[i].id));
   ObjectDelete(0, ObjLbl  (qms[i].id));
   ObjectDelete(0, ObjLS   (qms[i].id));
   ObjectDelete(0, ObjLSL  (qms[i].id));
   ObjectDelete(0, ObjRS   (qms[i].id));
   ObjectDelete(0, ObjHead (qms[i].id));
   ObjectDelete(0, ObjHeadL(qms[i].id));
   ObjectDelete(0, ObjHeadL(qms[i].id) + "t");
   ObjectDelete(0, ObjTP   (qms[i].id));
   ObjectDelete(0, ObjTP   (qms[i].id) + "t");
   ObjectDelete(0, ObjConf (qms[i].id));
   qms[i].dead = true;
}

string ConfName(int conf)
{
   if(conf == CONF_GAP) return "GAP_SNR";
   if(conf == CONF_RBR) return "RBR";
   if(conf == CONF_DBD) return "DBD";
   return "none";
}

//+------------------------------------------------------------------+
// Detect a QM_MEF whose HTF strong engulfing completes at bar s.
void DetectQmMef(int s)
{
   int avail = iBars(_Symbol, InpMainTF);
   if(s + 1 >= avail) return;

   double c2o = iOpen (_Symbol, InpMainTF, s);
   double c2c = iClose(_Symbol, InpMainTF, s);
   double c2h = iHigh (_Symbol, InpMainTF, s);
   double c2l = iLow  (_Symbol, InpMainTF, s);
   double c1o = iOpen (_Symbol, InpMainTF, s + 1);
   double c1c = iClose(_Symbol, InpMainTF, s + 1);
   double c1h = iHigh (_Symbol, InpMainTF, s + 1);
   double c1l = iLow  (_Symbol, InpMainTF, s + 1);

   // STRONG (2-candle) engulfing only.
   bool isBull = (c1c < c1o) && (c2c > c2o) && (c2c > c1h);
   bool isBear = (c1c > c1o) && (c2c < c2o) && (c2c < c1l);
   if(!isBull && !isBear) return;
   int dir = isBull ? DIR_BULL : DIR_BEAR;

   datetime engTime = iTime(_Symbol, InpMainTF, s + 1);
   datetime engEnd  = iTime(_Symbol, InpMainTF, s) + PeriodSeconds(InpMainTF);

   // Dedup: one QM_MEF per engulfing candle.
   for(int _k = 0; _k < qmTotal; _k++)
      if(!qms[_k].dead && qms[_k].engTime == engTime) return;

   // LTF Quasimodo inside the engulfing window.
   double lsLevel = 0.0, confirmLevel = 0.0, headLevel = 0.0, pbLevel = 0.0;
   datetime headTime = 0, lsTime = 0;
   if(!DetectQM(dir, engTime, engEnd, lsLevel, confirmLevel, headLevel, pbLevel, headTime, lsTime)) return;

   // Confluence near the left shoulder (tolerance from QM structure size).
   double tol = MathAbs(confirmLevel - lsLevel) * InpConfTolFrac;
   if(tol <= 0.0) tol = (c2h - c2l) * InpConfTolFrac;
   int    conf   = CONF_NONE;
   double confGap = 0.0, baseHi = 0.0, baseLo = 0.0;
   double g = FindGapSnrNear(dir, engTime, engEnd, lsLevel, tol);
   if(g != 0.0) { conf = CONF_GAP; confGap = g; }
   else if(FindRbrDbdNear(dir, engTime, engEnd, lsLevel, tol, baseHi, baseLo))
      conf = (dir == DIR_BULL) ? CONF_RBR : CONF_DBD;

   int idx = -1;
   for(int _k = 0; _k < qmTotal; _k++)
      if(qms[_k].dead) { idx = _k; break; }
   if(idx < 0 && qmTotal < MAX_QM) idx = qmTotal++;
   if(idx < 0) return;

   qms[idx].id           = nextId++;
   qms[idx].dir          = dir;
   qms[idx].engHi        = c2h;
   qms[idx].engLo        = c2l;
   qms[idx].engTime      = engTime;
   qms[idx].engEnd       = engEnd;
   qms[idx].lsLevel      = lsLevel;
   qms[idx].confirmLevel = confirmLevel;
   qms[idx].headLevel    = headLevel;
   qms[idx].pbLevel      = pbLevel;
   qms[idx].headTime     = headTime;
   qms[idx].lsTime       = lsTime;
   qms[idx].conf         = conf;
   qms[idx].confGap      = confGap;
   qms[idx].confBaseHi   = baseHi;
   qms[idx].confBaseLo   = baseLo;
   qms[idx].strong       = (conf != CONF_NONE);
   qms[idx].lsTouched    = false;
   qms[idx].lsEnd        = engEnd;
   qms[idx].dead         = false;
   qms[idx].ageCounter   = 0;

   DrawQm(idx);
   if(InpShowLog)
      PrintFormat("QM_MEF_CREATED | %s | HTF=%s LTF=%s | engulf=%s | left_shoulder(entry)=%.5f | head(SL)=%.5f | TP(pullback)=%.5f | confluence=%s | strength=%s",
                  dir == DIR_BULL ? "BULL" : "BEAR",
                  EnumToString(InpMainTF), EnumToString(InpQmTF),
                  TimeToString(iTime(_Symbol, InpMainTF, s), TIME_DATE|TIME_MINUTES),
                  lsLevel, headLevel, pbLevel, ConfName(conf), qms[idx].strong ? "strong" : "normal");
}

//+------------------------------------------------------------------+
void Maintain(int s)
{
   datetime t  = iTime (_Symbol, InpMainTF, s);
   double   cl = iClose(_Symbol, InpMainTF, s);
   double   bl = iLow  (_Symbol, InpMainTF, s);
   double   bh = iHigh (_Symbol, InpMainTF, s);
   for(int i = 0; i < qmTotal; i++) {
      if(qms[i].dead) continue;
      if(qms[i].engEnd >= t) continue;

      // Left shoulder line: grow to the current bar until price taps the level,
      // then freeze it (do not extend after it is touched).
      if(!qms[i].lsTouched) {
         bool touched = (qms[i].dir == DIR_BULL) ? (bl <= qms[i].lsLevel)
                                                 : (bh >= qms[i].lsLevel);
         qms[i].lsEnd = t;
         ObjectSetInteger(0, ObjLS(qms[i].id), OBJPROP_TIME, 1, t);
         if(touched) {
            qms[i].lsTouched = true;
            ObjectSetInteger(0, ObjRS(qms[i].id), OBJPROP_TIME, 0, t); // RS label at the tap
            if(InpShowLog)
               PrintFormat("QM_MEF_LS_TOUCHED (entry) | LS=%.5f | %s",
                           qms[i].lsLevel, TimeToString(t, TIME_DATE|TIME_MINUTES));
         }
      }

      // Head break → invalid: the head is the pattern extreme. A bullish QM dies
      // when price CLOSES below the head (lower low); a bearish QM dies on a
      // close above the head (higher high).
      if(qms[i].dir == DIR_BULL && cl < qms[i].headLevel) {
         if(InpShowLog) PrintFormat("QM_MEF_INVALIDATED (head broken) | head=%.5f LS=%.5f",
                                    qms[i].headLevel, qms[i].lsLevel);
         KillQm(i);
         continue;
      }
      if(qms[i].dir == DIR_BEAR && cl > qms[i].headLevel) {
         if(InpShowLog) PrintFormat("QM_MEF_INVALIDATED (head broken) | head=%.5f LS=%.5f",
                                    qms[i].headLevel, qms[i].lsLevel);
         KillQm(i);
         continue;
      }

      qms[i].ageCounter++;
      if(qms[i].ageCounter >= InpExpiryBars) {
         if(InpShowLog) PrintFormat("QM_MEF_EXPIRED | LS=%.5f", qms[i].lsLevel);
         KillQm(i);
      }
   }
}

//+------------------------------------------------------------------+
void Rebuild()
{
   ObjectsDeleteAll(0, OBJ_PREFIX);
   qmTotal = 0; nextId = 0;
   int scan = MathMin(InpLookback, iBars(_Symbol, InpMainTF) - 2);
   if(scan < 2) return;
   for(int s = scan; s >= 1; s--) {
      DetectQmMef(s);
      Maintain(s);
   }
}

//+------------------------------------------------------------------+
int OnInit()
{
   lastMainBar = 0;
   Rebuild();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { ObjectsDeleteAll(0, OBJ_PREFIX); }

int OnCalculate(const int rates_total, const int prev_calculated,
                const datetime &time[], const double &open[],
                const double &high[], const double &low[],
                const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
{
   datetime curMain = iTime(_Symbol, InpMainTF, 0);
   if(curMain != lastMainBar) {
      lastMainBar = curMain;
      DetectQmMef(1);
      Maintain(1);
   }
   return rates_total;
}
`;
}
