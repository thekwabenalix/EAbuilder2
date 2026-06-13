/**
 * SNRC1 Detector — Strong SNR Continuation 1
 *
 * SNRC1_Detector v1.0.0
 * ────────────────────────────────────────────────
 * A trend-continuation pattern that combines:
 *
 *   1. A STRONG SNR that has been BROKEN
 *      (Classic SNR with ATR-qualified displacement — the same pair
 *       logic as Strong_SNR_Detector: opposite-direction A→B + strong
 *       displacement on B)
 *
 *   2. An ENTRY ZONE on the pre-breakout side of the broken level:
 *      • RBR demand base (for bullish breakout)  — DIR_RBR  = +1
 *      • DBD supply base (for bearish breakout)  — DIR_DBD  = -1
 *      • Gap SNR of the matching direction       — within ATR proximity
 *
 * PATTERN (BULLISH SNRC1):
 *   Strong Resistance → broken UP (close > level)
 *   + RBR base (demand zone) or Bullish Gap SNR near the broken level
 *   → Entry when price pulls back to the RBR base or Gap SNR level.
 *   On a line chart: A-shape at the strong resistance, V-shape at entry.
 *
 * PATTERN (BEARISH SNRC1):
 *   Strong Support → broken DOWN (close < level)
 *   + DBD base (supply zone) or Bearish Gap SNR near the broken level
 *   → Entry when price rallies back to the DBD base or Gap SNR level.
 *
 * SNRC1 LIFECYCLE:
 *   ACTIVE    → pattern matched, waiting for price to reach entry zone
 *   TOUCHED   → wick enters the entry zone (RBR base or Gap SNR level)
 *   CONFIRMED → close holds correctly from the zone  ← entry signal bar
 *   BROKEN    → close through the zone against direction → setup failed
 *   EXPIRED   → InpExpiryBars elapsed without being tested
 *
 * DRAWN OBJECTS:
 *   "SMCSNRC1_{id}_ref"  — dashed gray reference line at the broken SSNR level
 *   "SMCSNRC1_{id}_zon"  — filled rectangle (RBR/DBD base) or flat OBJ_TREND (Gap SNR)
 *   "SMCSNRC1_{id}_lbl"  — "SNRC1↑ RBR" / "SNRC1↓ DBD" / "SNRC1↑ G-Sup" etc.
 *
 * JOURNAL:
 *   SNRC1_FORMED | id | dir | entry_type | ssnr_level | entry_zone | time
 *   SNRC1_TOUCHED | id | dir | time
 *   SNRC1_CONFIRMED | id | dir | time        ← the entry bar
 *   SNRC1_BROKEN | id | dir | time
 *   SNRC1_EXPIRED | id | dir | time
 */

export const SNRC1_DETECTOR_VERSION = "1.0.0";
export const SNRC1_DETECTOR_MODULE = "SNRC1_Detector";

export function generateSnrc1Detector(): string {
  return `//+------------------------------------------------------------------+
//| SNRC1_Detector.mq5                                             |
//| SNRC1 Detector v${SNRC1_DETECTOR_VERSION} — Strong SNR Continuation 1         |
//|                                                                  |
//| Trend continuation: a Strong SNR (displaced reversal pair) that  |
//| is broken by momentum, with an RBR / DBD base OR Gap SNR on the |
//| pre-breakout side.  Entry = pullback to the base / Gap SNR.     |
//|                                                                  |
//| Embeds: Strong SNR · RBR/DBD · Gap SNR detection inline.        |
//| NO trading logic. Detection and visualisation only.            |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SNR Module Library"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

// ── Strong SNR types / states ─────────────────────────────────────
#define SSNR_RES        1    // resistance (Bullish A → Bearish B)
#define SSNR_SUP        2    // support    (Bearish A → Bullish B)
#define SSNR_LIVE       0    // active or touched (not yet broken)
#define SSNR_BROKEN     1
#define SSNR_EXPIRED    2

// ── RBR/DBD base directions ───────────────────────────────────────
#define DIR_RBR         1    // Rally-Base-Rally  (demand zone)
#define DIR_DBD        -1    // Drop-Base-Drop    (supply zone)

// ── Gap SNR types ─────────────────────────────────────────────────
#define GAP_SUP         1    // Gap Support    (Bull A → Bull B)
#define GAP_RES         2    // Gap Resistance (Bear A → Bear B)

// ── SNRC1 states ──────────────────────────────────────────────────
#define C1_ACTIVE       0
#define C1_TOUCHED      1
#define C1_CONFIRMED    2
#define C1_BROKEN       3
#define C1_EXPIRED      4
#define C1_UNDRAWN     -1

// ── SNRC1 entry types ─────────────────────────────────────────────
#define C1_ENTRY_BASE   1    // RBR or DBD base
#define C1_ENTRY_GAP    2    // Gap SNR level

// ── Array limits ─────────────────────────────────────────────────
#define SSNR_MAX    500
#define BASE_MAX    400
#define GAP_MAX     500
#define SNRC1_MAX   200

#define OBJ_PFX "SMCSNRC1_"

// ─── Inputs ────────────────────────────────────────────────────────
input ENUM_TIMEFRAMES InpTF            = PERIOD_CURRENT; // Timeframe
input int             InpLookback      = 500;            // Bars to scan on init
//--- Strong SNR qualifier
input double          InpDispMult      = 1.5;   // Displacement >= N x ATR
input int             InpDispAtrPer    = 14;    // ATR period for displacement
input int             InpDispBars      = 3;     // Bars to accumulate displacement (incl B)
input bool            InpIgnoreDoji    = true;  // Skip neutral candles in pair detection
input int             InpDojiPoints    = 0;     // Doji body threshold in points (0=exact)
//--- RBR/DBD base qualifier
input double          InpImpulseRatio  = 0.50;  // Leg body/range >= this to qualify
input double          InpBaseMaxRatio  = 0.50;  // Base body/range <= this to qualify
input int             InpMaxBaseLen    = 6;     // Max consecutive base candles
input double          InpLegBaseMult   = 1.30;  // Leg range >= N x avg base range
//--- SNRC1 pairing
input double          InpProxATR       = 1.50;  // Max distance from broken level to entry zone (ATR)
//--- SNRC1 lifecycle
input int             InpExpiryBars    = 150;   // Bars until SNRC1 expires (0 = never)
input int             InpMaxSnrc1      = 50;    // Max active SNRC1 setups
//--- Display
input color           InpBullColor     = clrLimeGreen;   // Bullish SNRC1 entry zone
input color           InpBearColor     = clrCrimson;     // Bearish SNRC1 entry zone
input color           InpTouchColor    = clrGold;        // Entry zone when TOUCHED
input color           InpConfirmColor  = clrDodgerBlue;  // Entry zone when CONFIRMED
input color           InpRefColor      = clrDimGray;     // Broken SSNR reference line
input int             InpOpacity       = 75;             // Zone fill opacity (0-100)
input bool            InpShowLog       = true;

// ─── Structs ───────────────────────────────────────────────────────
struct SsnrRec          // Strong SNR levels (internal — not drawn individually)
{
   int      id;
   int      stype;        // SSNR_RES or SSNR_SUP
   int      sstate;       // SSNR_LIVE / SSNR_BROKEN / SSNR_EXPIRED
   double   level;        // Candle A close
   datetime candleATime;
   datetime candleBTime;
   datetime endTime;      // time of break / expiry
   int      ageCounter;
   bool     paired;       // an SNRC1 was already created for this break
};

struct BaseRec          // RBR/DBD base zones
{
   int      id;
   int      bdir;         // DIR_RBR or DIR_DBD
   double   zhi;          // base high (zone upper)
   double   zlo;          // base low  (zone lower)
   datetime baseLeft;     // oldest base candle time
   datetime legOutTime;   // confirmation bar time
   bool     dead;
   int      ageCounter;
};

struct GapRec           // Gap SNR levels
{
   int      id;
   int      gtype;        // GAP_SUP or GAP_RES
   int      gstate;       // SSNR_LIVE / SSNR_BROKEN / SSNR_EXPIRED (reuse defs)
   double   level;
   datetime candleATime;
   datetime candleBTime;
   int      ageCounter;
};

struct Snrc1Rec         // The matched SNRC1 setup
{
   int      id;
   int      c1dir;        // +1 bull / -1 bear
   int      entryType;    // C1_ENTRY_BASE or C1_ENTRY_GAP
   double   brokenLevel;  // the broken Strong SNR level
   datetime breakTime;    // bar when the SSNR was broken
   double   entryHi;      // entry zone top
   double   entryLo;      // entry zone bottom (= entryHi for Gap SNR line)
   datetime entryLeft;    // left edge of entry zone
   int      c1state;
   int      drawnState;
   int      ageCounter;
};

SsnrRec  ssnrList[SSNR_MAX];  int ssnrTotal = 0;
BaseRec  baseList[BASE_MAX];  int baseTotal = 0;
GapRec   gapList[GAP_MAX];   int gapTotal  = 0;
Snrc1Rec snrc1List[SNRC1_MAX]; int snrc1Total = 0;
int      nextSsnrId = 0, nextBaseId = 0, nextGapId = 0, nextC1Id = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
//| Shared helpers                                                   |
//+------------------------------------------------------------------+
color BlendWithBg(color base, int pct)
{
   color  bg = (color)ChartGetInteger(0, CHART_COLOR_BACKGROUND);
   double t  = MathMax(0.0, MathMin(100.0, (double)pct)) / 100.0;
   int r = (int)(( base & 0xFF)        * t + ( bg & 0xFF)        * (1.0 - t));
   int g = (int)(((base >>  8) & 0xFF) * t + ((bg >>  8) & 0xFF) * (1.0 - t));
   int b = (int)(((base >> 16) & 0xFF) * t + ((bg >> 16) & 0xFF) * (1.0 - t));
   return (color)(r | (g << 8) | (b << 16));
}

double CalcATR(int sh)
{
   int avail = iBars(_Symbol, InpTF);
   if(avail < sh + InpDispAtrPer + 2) return 0.0;
   double sum = 0.0;
   for(int k = sh + 1; k <= sh + InpDispAtrPer; k++)
   {
      double h  = iHigh (_Symbol, InpTF, k);
      double l  = iLow  (_Symbol, InpTF, k);
      double pc = iClose(_Symbol, InpTF, k + 1);
      sum += MathMax(h - l, MathMax(MathAbs(h - pc), MathAbs(l - pc)));
   }
   return sum / (double)InpDispAtrPer;
}

int CandleDir(int sh)   // +1 bull / -1 bear / 0 doji
{
   double c = iClose(_Symbol, InpTF, sh);
   double o = iOpen (_Symbol, InpTF, sh);
   if(InpIgnoreDoji)
   {
      double thr = (InpDojiPoints > 0) ? InpDojiPoints * _Point : 0.0;
      if(MathAbs(c - o) <= thr) return 0;
   }
   return (c > o) ? 1 : (c < o) ? -1 : 0;
}

double BodyRatio(int sh) // body / range for RBR/DBD base detection
{
   double o = iOpen (_Symbol, InpTF, sh);
   double c = iClose(_Symbol, InpTF, sh);
   double r = iHigh (_Symbol, InpTF, sh) - iLow(_Symbol, InpTF, sh);
   return (r > 0.0) ? MathAbs(c - o) / r : 0.0;
}

double SumDisp(int shStart, int shEnd, int reqDir) // cumulative displacement bodies
{
   double total = 0.0;
   int lo = MathMin(shStart, shEnd), hi = MathMax(shStart, shEnd);
   for(int b = hi; b >= lo; b--)
   {
      double o = iOpen (_Symbol, InpTF, b);
      double c = iClose(_Symbol, InpTF, b);
      if(reqDir > 0 && c > o) total += (c - o);
      if(reqDir < 0 && c < o) total += (o - c);
   }
   return total;
}

//+------------------------------------------------------------------+
//| ─── STRONG SNR DETECTION ────────────────────────────────────── |
//+------------------------------------------------------------------+
void CheckStrongSnr(int shA, int shB)
{
   int avail = iBars(_Symbol, InpTF);
   if(shA >= avail || shB < 0) return;

   int dirA = CandleDir(shA), dirB = CandleDir(shB);
   if(dirA == 0 || dirB == 0 || dirA == dirB) return;  // doji or same dir

   int stype = (dirA > 0) ? SSNR_RES : SSNR_SUP;
   int dispDir = -dirA;   // displacement direction opposite to A

   double atr = CalcATR(shA);
   if(atr <= 0.0) return;

   // Clamp displacement window to bar[1] in live mode
   int endShift = shB - (InpDispBars - 1);
   if(endShift < 1) endShift = 1;
   double disp = SumDisp(shB, endShift, dispDir);
   if(disp < InpDispMult * atr) return;   // not strong enough

   double   lvl   = iClose(_Symbol, InpTF, shA);
   datetime timeA = iTime (_Symbol, InpTF, shA);
   datetime timeB = iTime (_Symbol, InpTF, shB);

   for(int i = 0; i < ssnrTotal; i++)
      if(ssnrList[i].candleATime == timeA && ssnrList[i].stype == stype) return;

   if(ssnrTotal >= SSNR_MAX) return;
   int idx = ssnrTotal++;
   ssnrList[idx].id          = nextSsnrId++;
   ssnrList[idx].stype       = stype;
   ssnrList[idx].sstate      = SSNR_LIVE;
   ssnrList[idx].level       = lvl;
   ssnrList[idx].candleATime = timeA;
   ssnrList[idx].candleBTime = timeB;
   ssnrList[idx].endTime     = 0;
   ssnrList[idx].ageCounter  = 0;
   ssnrList[idx].paired      = false;
}

//+------------------------------------------------------------------+
//| ─── RBR / DBD BASE DETECTION ───────────────────────────────── |
//+------------------------------------------------------------------+
void DetectBase(int sh)   // sh = leg-out (breakout) bar
{
   int avail = iBars(_Symbol, InpTF);
   if(sh + 2 >= avail) return;

   // Leg-out must be a strong impulse
   if(BodyRatio(sh) < InpImpulseRatio) return;
   int bdir;
   double co = iClose(_Symbol, InpTF, sh), oo = iOpen(_Symbol, InpTF, sh);
   if(co > oo)      bdir = DIR_RBR;
   else if(co < oo) bdir = DIR_DBD;
   else return;

   // Collect consecutive small-body base candles just before leg-out
   int baseLen = 0;
   while(baseLen < InpMaxBaseLen && (sh + 1 + baseLen) < avail
         && BodyRatio(sh + 1 + baseLen) <= InpBaseMaxRatio)
      baseLen++;
   if(baseLen < 1) return;

   int legInSh = sh + 1 + baseLen;
   if(legInSh >= avail) return;

   // Leg-in: strong impulse in the SAME direction
   if(BodyRatio(legInSh) < InpImpulseRatio) return;
   double ci = iClose(_Symbol, InpTF, legInSh), oi = iOpen(_Symbol, InpTF, legInSh);
   if(bdir == DIR_RBR && ci <= oi) return;
   if(bdir == DIR_DBD && ci >= oi) return;

   // Measure base extent
   double bhi = -1.0, blo = 1e18, sumR = 0.0;
   for(int k = 0; k < baseLen; k++)
   {
      int b = sh + 1 + k;
      double h = iHigh(_Symbol, InpTF, b), l = iLow(_Symbol, InpTF, b);
      if(h > bhi) bhi = h;
      if(l < blo) blo = l;
      sumR += (h - l);
   }
   double avgR = sumR / baseLen;
   if(avgR <= 0.0) return;

   double legOutR = iHigh(_Symbol, InpTF, sh) - iLow(_Symbol, InpTF, sh);
   double legInR  = iHigh(_Symbol, InpTF, legInSh) - iLow(_Symbol, InpTF, legInSh);
   if(legOutR < InpLegBaseMult * avgR || legInR < InpLegBaseMult * avgR) return;

   // Leg-out must break out of the base
   if(bdir == DIR_RBR && co <= bhi) return;
   if(bdir == DIR_DBD && co >= blo) return;

   datetime bt = iTime(_Symbol, InpTF, sh + baseLen);  // oldest base candle
   datetime lt = iTime(_Symbol, InpTF, sh);

   for(int k = 0; k < baseTotal; k++)
      if(!baseList[k].dead && baseList[k].baseLeft == bt) return;   // dedup

   if(baseTotal >= BASE_MAX) return;
   int idx = baseTotal++;
   baseList[idx].id         = nextBaseId++;
   baseList[idx].bdir       = bdir;
   baseList[idx].zhi        = bhi;
   baseList[idx].zlo        = blo;
   baseList[idx].baseLeft   = bt;
   baseList[idx].legOutTime = lt;
   baseList[idx].dead       = false;
   baseList[idx].ageCounter = 0;
}

//+------------------------------------------------------------------+
//| ─── GAP SNR DETECTION ──────────────────────────────────────── |
//+------------------------------------------------------------------+
void CheckGapPair(int shA, int shB)
{
   int avail = iBars(_Symbol, InpTF);
   if(shA >= avail || shB < 0) return;

   int dirA = CandleDir(shA), dirB = CandleDir(shB);
   if(dirA == 0 || dirB == 0) return;
   if(dirA != dirB) return;   // opposite = Classic SNR, not Gap SNR

   int gtype = (dirA > 0) ? GAP_SUP : GAP_RES;
   double   lvl   = iClose(_Symbol, InpTF, shA);
   datetime timeA = iTime (_Symbol, InpTF, shA);
   datetime timeB = iTime (_Symbol, InpTF, shB);

   for(int i = 0; i < gapTotal; i++)
      if(gapList[i].candleATime == timeA && gapList[i].gtype == gtype) return;

   if(gapTotal >= GAP_MAX) return;
   int idx = gapTotal++;
   gapList[idx].id          = nextGapId++;
   gapList[idx].gtype       = gtype;
   gapList[idx].gstate      = SSNR_LIVE;
   gapList[idx].level       = lvl;
   gapList[idx].candleATime = timeA;
   gapList[idx].candleBTime = timeB;
   gapList[idx].ageCounter  = 0;
}

//+------------------------------------------------------------------+
//| Object name helpers                                              |
//+------------------------------------------------------------------+
string RefNm(int id)  { return OBJ_PFX + IntegerToString(id) + "_ref"; }
string ZonNm(int id)  { return OBJ_PFX + IntegerToString(id) + "_zon"; }
string LblNm(int id)  { return OBJ_PFX + IntegerToString(id) + "_lbl"; }

//+------------------------------------------------------------------+
//| Draw one SNRC1 setup                                            |
//+------------------------------------------------------------------+
void DrawSnrc1One(int idx)
{
   snrc1List[idx].drawnState = snrc1List[idx].c1state;

   ObjectDelete(0, RefNm(snrc1List[idx].id));
   ObjectDelete(0, ZonNm(snrc1List[idx].id));
   ObjectDelete(0, LblNm(snrc1List[idx].id));

   int    st   = snrc1List[idx].c1state;
   int    dir  = snrc1List[idx].c1dir;
   bool   live = (st == C1_ACTIVE || st == C1_TOUCHED || st == C1_CONFIRMED);
   if(!live) return;   // remove objects for terminal states

   // ── Reference line: the broken Strong SNR level ────────────────
   color refClr = BlendWithBg(InpRefColor, 60);
   datetime refT2 = snrc1List[idx].breakTime;
   if(ObjectCreate(0, RefNm(snrc1List[idx].id), OBJ_TREND, 0,
                   snrc1List[idx].entryLeft, snrc1List[idx].brokenLevel,
                   refT2,                    snrc1List[idx].brokenLevel))
   {
      ObjectSetInteger(0, RefNm(snrc1List[idx].id), OBJPROP_COLOR,     refClr);
      ObjectSetInteger(0, RefNm(snrc1List[idx].id), OBJPROP_STYLE,     STYLE_DASH);
      ObjectSetInteger(0, RefNm(snrc1List[idx].id), OBJPROP_WIDTH,     1);
      ObjectSetInteger(0, RefNm(snrc1List[idx].id), OBJPROP_RAY_RIGHT, 0);
      ObjectSetInteger(0, RefNm(snrc1List[idx].id), OBJPROP_SELECTABLE,false);
      ObjectSetInteger(0, RefNm(snrc1List[idx].id), OBJPROP_HIDDEN,    true);
      ObjectSetInteger(0, RefNm(snrc1List[idx].id), OBJPROP_BACK,      true);
   }

   // ── Entry zone color based on state ───────────────────────────
   color rawZoneClr;
   if(st == C1_TOUCHED)   rawZoneClr = InpTouchColor;
   else if(st == C1_CONFIRMED) rawZoneClr = InpConfirmColor;
   else                   rawZoneClr = (dir > 0) ? InpBullColor : InpBearColor;
   color zoneClr = BlendWithBg(rawZoneClr, InpOpacity);

   // ── Entry zone ─────────────────────────────────────────────────
   double hi = snrc1List[idx].entryHi, lo = snrc1List[idx].entryLo;
   datetime eLeft  = snrc1List[idx].entryLeft;
   datetime eRight = iTime(_Symbol, InpTF, 0);   // live bar (right edge extends)

   if(snrc1List[idx].entryType == C1_ENTRY_BASE)
   {
      // Filled rectangle for RBR/DBD base
      if(ObjectCreate(0, ZonNm(snrc1List[idx].id), OBJ_RECTANGLE, 0,
                      eLeft, hi, eRight, lo))
      {
         ObjectSetInteger(0, ZonNm(snrc1List[idx].id), OBJPROP_COLOR,     zoneClr);
         ObjectSetInteger(0, ZonNm(snrc1List[idx].id), OBJPROP_WIDTH,     2);
         ObjectSetInteger(0, ZonNm(snrc1List[idx].id), OBJPROP_FILL,      true);
         ObjectSetInteger(0, ZonNm(snrc1List[idx].id), OBJPROP_BACK,      true);
         ObjectSetInteger(0, ZonNm(snrc1List[idx].id), OBJPROP_SELECTABLE,false);
         ObjectSetInteger(0, ZonNm(snrc1List[idx].id), OBJPROP_HIDDEN,    true);
      }
   }
   else
   {
      // Flat OBJ_TREND line for Gap SNR (hi == lo == the level)
      if(ObjectCreate(0, ZonNm(snrc1List[idx].id), OBJ_TREND, 0,
                      eLeft, hi, eRight, hi))
      {
         ObjectSetInteger(0, ZonNm(snrc1List[idx].id), OBJPROP_COLOR,     zoneClr);
         ObjectSetInteger(0, ZonNm(snrc1List[idx].id), OBJPROP_STYLE,     STYLE_SOLID);
         ObjectSetInteger(0, ZonNm(snrc1List[idx].id), OBJPROP_WIDTH,     2);
         ObjectSetInteger(0, ZonNm(snrc1List[idx].id), OBJPROP_RAY_RIGHT, 1);
         ObjectSetInteger(0, ZonNm(snrc1List[idx].id), OBJPROP_SELECTABLE,false);
         ObjectSetInteger(0, ZonNm(snrc1List[idx].id), OBJPROP_HIDDEN,    true);
         ObjectSetInteger(0, ZonNm(snrc1List[idx].id), OBJPROP_BACK,      true);
      }
   }

   // ── Label ──────────────────────────────────────────────────────
   string arrow = dir > 0 ? "↑" : "↓";
   string etype = snrc1List[idx].entryType == C1_ENTRY_BASE
                  ? (dir > 0 ? "RBR" : "DBD") : (dir > 0 ? "G-Sup" : "G-Res");
   string stTag = st == C1_CONFIRMED ? " ✓" : (st == C1_TOUCHED ? " ~" : "");
   string lbl   = "SNRC1" + arrow + " " + etype + stTag;
   double lbPrc = dir > 0 ? lo : hi;

   if(ObjectCreate(0, LblNm(snrc1List[idx].id), OBJ_TEXT, 0, eLeft, lbPrc))
   {
      ObjectSetString( 0, LblNm(snrc1List[idx].id), OBJPROP_TEXT,   lbl);
      ObjectSetInteger(0, LblNm(snrc1List[idx].id), OBJPROP_COLOR,  BlendWithBg(rawZoneClr, 100));
      ObjectSetInteger(0, LblNm(snrc1List[idx].id), OBJPROP_FONTSIZE, 8);
      ObjectSetInteger(0, LblNm(snrc1List[idx].id), OBJPROP_ANCHOR,
         dir > 0 ? ANCHOR_LEFT_UPPER : ANCHOR_LEFT_LOWER);
      ObjectSetInteger(0, LblNm(snrc1List[idx].id), OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, LblNm(snrc1List[idx].id), OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, LblNm(snrc1List[idx].id), OBJPROP_BACK,       false);
   }
}

void DrawAll()
{
   for(int i = 0; i < snrc1Total; i++)
      if(snrc1List[i].drawnState != snrc1List[i].c1state)
         DrawSnrc1One(i);
   ChartRedraw(0);
}

void ExtendZones()
{
   datetime now = iTime(_Symbol, InpTF, 0);
   for(int i = 0; i < snrc1Total; i++)
   {
      if(snrc1List[i].c1state > C1_CONFIRMED) continue;
      if(snrc1List[i].entryType == C1_ENTRY_BASE)
         ObjectSetInteger(0, ZonNm(snrc1List[i].id), OBJPROP_TIME, 1, now);
      else
         ObjectSetInteger(0, ZonNm(snrc1List[i].id), OBJPROP_TIME, 1, now);
   }
}

void DeleteAllObjects()
{
   for(int i = ObjectsTotal(0) - 1; i >= 0; i--)
   {
      string nm = ObjectName(0, i);
      if(StringFind(nm, OBJ_PFX) == 0) ObjectDelete(0, nm);
   }
}

//+------------------------------------------------------------------+
//| SNRC1 pairing: scan for a post-break RBR/DBD/Gap SNR match.     |
//|                                                                  |
//| KEY RULE: the entry zone (RBR/DBD/Gap SNR) must form AFTER the  |
//| Strong SNR is broken — the SNR (left) comes before the base     |
//| (right).  Pairing is attempted every bar by ScanPendingMatches. |
//+------------------------------------------------------------------+
void TryCreateSnrc1(int ssnrIdx, int currentSh)
{
   if(ssnrList[ssnrIdx].paired) return;
   if(ssnrList[ssnrIdx].sstate != SSNR_BROKEN) return;
   if(snrc1Total >= SNRC1_MAX) return;

   datetime breakTime  = ssnrList[ssnrIdx].endTime;   // bar when SSNR was broken
   double   brokenLvl  = ssnrList[ssnrIdx].level;
   int      stype      = ssnrList[ssnrIdx].stype;
   int      dir        = (stype == SSNR_RES) ? 1 : -1;

   double atr = CalcATR(currentSh);
   if(atr <= 0.0) atr = 10 * _Point;
   double prox = InpProxATR * atr;

   // ── Helper: distance from brokenLvl to nearest edge of base zone ─
   // Returns 0 if level is inside [zlo, zhi], else gap to nearest edge.

   // ── Try RBR/DBD base that confirmed AFTER the break ─────────────
   int bestBase = -1; double bestDist = prox + 1.0;
   for(int i = 0; i < baseTotal; i++)
   {
      if(baseList[i].dead) continue;
      if(dir > 0 && baseList[i].bdir != DIR_RBR) continue;
      if(dir < 0 && baseList[i].bdir != DIR_DBD) continue;

      // *** KEY FIX: base leg-out (confirmation) must come AFTER the break ***
      if(baseList[i].legOutTime <= breakTime) continue;

      // Distance from the broken level to the nearest edge of the base zone
      // 0 if the level overlaps the zone; positive if there is a gap
      double dist;
      if(brokenLvl >= baseList[i].zlo && brokenLvl <= baseList[i].zhi)
         dist = 0.0;                          // broken level inside the base
      else if(brokenLvl > baseList[i].zhi)
         dist = brokenLvl - baseList[i].zhi;  // level above base top
      else
         dist = baseList[i].zlo - brokenLvl;  // level below base bottom

      if(dist > prox) continue;
      if(dist < bestDist) { bestDist = dist; bestBase = i; }
   }

   if(bestBase >= 0)
   {
      int idx = snrc1Total++;
      snrc1List[idx].id           = nextC1Id++;
      snrc1List[idx].c1dir        = dir;
      snrc1List[idx].entryType    = C1_ENTRY_BASE;
      snrc1List[idx].brokenLevel  = brokenLvl;
      snrc1List[idx].breakTime    = breakTime;
      snrc1List[idx].entryHi      = baseList[bestBase].zhi;
      snrc1List[idx].entryLo      = baseList[bestBase].zlo;
      snrc1List[idx].entryLeft    = baseList[bestBase].baseLeft;
      snrc1List[idx].c1state      = C1_ACTIVE;
      snrc1List[idx].drawnState   = C1_UNDRAWN;
      snrc1List[idx].ageCounter   = 0;
      ssnrList[ssnrIdx].paired    = true;
      if(InpShowLog)
         PrintFormat("SNRC1_FORMED | id=%d | dir=%s | entry=BASE(%s) | ssnr=%.5f | zone=[%.5f,%.5f] | break=%s",
            snrc1List[idx].id, dir > 0 ? "BULL" : "BEAR",
            dir > 0 ? "RBR" : "DBD",
            brokenLvl, snrc1List[idx].entryHi, snrc1List[idx].entryLo,
            TimeToString(breakTime, TIME_DATE|TIME_MINUTES));
      return;
   }

   // ── Try Gap SNR that confirmed AFTER the break ───────────────────
   int reqGapType = (dir > 0) ? GAP_SUP : GAP_RES;
   int bestGap = -1; bestDist = prox + 1.0;
   for(int i = 0; i < gapTotal; i++)
   {
      if(gapList[i].gstate != SSNR_LIVE) continue;
      if(gapList[i].gtype != reqGapType) continue;

      // *** KEY FIX: Gap SNR must be confirmed AFTER the break ***
      if(gapList[i].candleBTime <= breakTime) continue;

      double dist = MathAbs(gapList[i].level - brokenLvl);
      if(dist > prox) continue;
      if(dist < bestDist) { bestDist = dist; bestGap = i; }
   }

   if(bestGap >= 0)
   {
      int idx = snrc1Total++;
      snrc1List[idx].id           = nextC1Id++;
      snrc1List[idx].c1dir        = dir;
      snrc1List[idx].entryType    = C1_ENTRY_GAP;
      snrc1List[idx].brokenLevel  = brokenLvl;
      snrc1List[idx].breakTime    = breakTime;
      snrc1List[idx].entryHi      = gapList[bestGap].level;
      snrc1List[idx].entryLo      = gapList[bestGap].level;
      snrc1List[idx].entryLeft    = gapList[bestGap].candleATime;
      snrc1List[idx].c1state      = C1_ACTIVE;
      snrc1List[idx].drawnState   = C1_UNDRAWN;
      snrc1List[idx].ageCounter   = 0;
      ssnrList[ssnrIdx].paired    = true;
      if(InpShowLog)
         PrintFormat("SNRC1_FORMED | id=%d | dir=%s | entry=GAP(%s) | ssnr=%.5f | level=%.5f | break=%s",
            snrc1List[idx].id, dir > 0 ? "BULL" : "BEAR",
            dir > 0 ? "G-Sup" : "G-Res",
            brokenLvl, gapList[bestGap].level,
            TimeToString(breakTime, TIME_DATE|TIME_MINUTES));
   }
}

// Run on every bar: attempt pairing for all broken, unmatched SSNRs
void ScanPendingMatches(int sh)
{
   for(int i = 0; i < ssnrTotal; i++)
      TryCreateSnrc1(i, sh);
}

//+------------------------------------------------------------------+
//| Lifecycle updates per bar                                       |
//+------------------------------------------------------------------+

// Update Strong SNR list — detect breaks (pairing is deferred to ScanPendingMatches)
void UpdateSsnrAtBar(int sh)
{
   double   cl = iClose(_Symbol, InpTF, sh);
   datetime bt = iTime (_Symbol, InpTF, sh);
   for(int i = 0; i < ssnrTotal; i++)
   {
      if(ssnrList[i].sstate != SSNR_LIVE) continue;
      if(ssnrList[i].candleBTime >= bt) continue;
      ssnrList[i].ageCounter++;
      // Expiry (use same InpExpiryBars as SNRC1 for consistency)
      if(InpExpiryBars > 0 && ssnrList[i].ageCounter >= InpExpiryBars)
         { ssnrList[i].sstate = SSNR_EXPIRED; ssnrList[i].endTime = bt; continue; }
      // Break detection — record break time so ScanPendingMatches can filter post-break bases
      bool brokeUp   = (ssnrList[i].stype == SSNR_RES && cl > ssnrList[i].level);
      bool brokeDown = (ssnrList[i].stype == SSNR_SUP && cl < ssnrList[i].level);
      if(brokeUp || brokeDown)
      {
         ssnrList[i].sstate = SSNR_BROKEN;
         ssnrList[i].endTime = bt;
         // Pairing is NOT attempted here — ScanPendingMatches runs after all detectors on this bar
      }
   }
}

// Update RBR/DBD base list — expire bases traded through
void UpdateBaseAtBar(int sh)
{
   double cl = iClose(_Symbol, InpTF, sh);
   for(int i = 0; i < baseTotal; i++)
   {
      if(baseList[i].dead) continue;
      if(baseList[i].legOutTime >= iTime(_Symbol, InpTF, sh)) continue;
      baseList[i].ageCounter++;
      if((baseList[i].bdir == DIR_RBR && cl < baseList[i].zlo) ||
         (baseList[i].bdir == DIR_DBD && cl > baseList[i].zhi))
         baseList[i].dead = true;
   }
}

// Update Gap SNR list — detect breaks
void UpdateGapAtBar(int sh)
{
   double cl = iClose(_Symbol, InpTF, sh);
   datetime bt = iTime(_Symbol, InpTF, sh);
   for(int i = 0; i < gapTotal; i++)
   {
      if(gapList[i].gstate != SSNR_LIVE) continue;
      if(gapList[i].candleBTime >= bt) continue;
      gapList[i].ageCounter++;
      bool broke = (gapList[i].gtype == GAP_SUP   && cl < gapList[i].level) ||
                   (gapList[i].gtype == GAP_RES && cl > gapList[i].level);
      if(broke) gapList[i].gstate = SSNR_BROKEN;
   }
}

// Update SNRC1 setups — touched / confirmed / broken / expired
void UpdateSnrc1AtBar(int sh)
{
   double   hi = iHigh (_Symbol, InpTF, sh);
   double   lo = iLow  (_Symbol, InpTF, sh);
   double   cl = iClose(_Symbol, InpTF, sh);
   datetime bt = iTime (_Symbol, InpTF, sh);

   for(int i = 0; i < snrc1Total; i++)
   {
      if(snrc1List[i].c1state >= C1_BROKEN) continue;
      if(snrc1List[i].breakTime >= bt) continue;  // only check after the break bar

      snrc1List[i].ageCounter++;
      if(InpExpiryBars > 0 && snrc1List[i].ageCounter >= InpExpiryBars)
      {
         snrc1List[i].c1state = C1_EXPIRED;
         if(InpShowLog)
            PrintFormat("SNRC1_EXPIRED | id=%d | dir=%s | time=%s",
               snrc1List[i].id, snrc1List[i].c1dir > 0 ? "BULL" : "BEAR",
               TimeToString(bt, TIME_DATE|TIME_MINUTES));
         continue;
      }

      int    dir = snrc1List[i].c1dir;
      double eHi = snrc1List[i].entryHi, eLo = snrc1List[i].entryLo;

      // ── BROKEN check (close through entry zone against direction) ─
      bool broken = (dir > 0 && cl < eLo) || (dir < 0 && cl > eHi);
      if(broken)
      {
         snrc1List[i].c1state = C1_BROKEN;
         if(InpShowLog)
            PrintFormat("SNRC1_BROKEN | id=%d | dir=%s | time=%s",
               snrc1List[i].id, dir > 0 ? "BULL" : "BEAR",
               TimeToString(bt, TIME_DATE|TIME_MINUTES));
         continue;
      }

      // ── TOUCHED check (wick enters zone) ──────────────────────────
      bool touchedZone = (dir > 0 && lo <= eHi) || (dir < 0 && hi >= eLo);

      if(touchedZone)
      {
         // ── CONFIRMED: wick in zone AND close holds correctly ───────
         bool confirmed = (dir > 0 && cl >= eLo) || (dir < 0 && cl <= eHi);
         if(confirmed && snrc1List[i].c1state == C1_TOUCHED)
         {
            snrc1List[i].c1state = C1_CONFIRMED;
            if(InpShowLog)
               PrintFormat("SNRC1_CONFIRMED | id=%d | dir=%s | entry=%s | time=%s",
                  snrc1List[i].id, dir > 0 ? "BULL" : "BEAR",
                  snrc1List[i].entryType == C1_ENTRY_BASE ? (dir > 0 ? "RBR" : "DBD") : "Gap",
                  TimeToString(bt, TIME_DATE|TIME_MINUTES));
         }
         else if(snrc1List[i].c1state == C1_ACTIVE)
         {
            snrc1List[i].c1state = C1_TOUCHED;
            if(InpShowLog)
               PrintFormat("SNRC1_TOUCHED | id=%d | dir=%s | time=%s",
                  snrc1List[i].id, dir > 0 ? "BULL" : "BEAR",
                  TimeToString(bt, TIME_DATE|TIME_MINUTES));
         }
      }
   }
}

// Enforce max SNRC1 count (drop oldest active)
void EnforceMaxSnrc1()
{
   if(InpMaxSnrc1 <= 0) return;
   int cnt = 0;
   for(int i = 0; i < snrc1Total; i++)
      if(snrc1List[i].c1state < C1_BROKEN) cnt++;
   while(cnt > InpMaxSnrc1)
   {
      int oldest = -1; datetime oldestT = (datetime)LONG_MAX;
      for(int i = 0; i < snrc1Total; i++)
      {
         if(snrc1List[i].c1state >= C1_BROKEN) continue;
         if(snrc1List[i].breakTime < oldestT) { oldestT = snrc1List[i].breakTime; oldest = i; }
      }
      if(oldest < 0) break;
      snrc1List[oldest].c1state = C1_EXPIRED;
      cnt--;
   }
}

//+------------------------------------------------------------------+
int OnInit()
{
   DeleteAllObjects();
   ssnrTotal = 0; baseTotal = 0; gapTotal = 0; snrc1Total = 0;
   nextSsnrId = 0; nextBaseId = 0; nextGapId = 0; nextC1Id = 0;

   int avail = iBars(_Symbol, InpTF);
   if(avail < InpDispBars + 5) { Print("SNRC1_Detector: not enough bars."); return INIT_FAILED; }

   int limit   = MathMin(InpLookback, avail - InpDispBars - 3);
   int startSh = MathMax(2, InpDispBars + 1);

   // ── Pass 1: Detect all levels (oldest → newest) ─────────────────
   for(int sh = limit; sh >= startSh; sh--)
   {
      CheckStrongSnr(sh, sh - 1);    // SSNR pair
      DetectBase(sh);                // RBR/DBD at leg-out bar
      CheckGapPair(sh, sh - 1);     // Gap SNR pair
   }

   // ── Pass 2: Lifecycle replay (oldest → newest).  After all detectors ─
   // have run for the bar, ScanPendingMatches tries to pair every broken   ─
   // SSNR with any RBR/DBD/Gap SNR that confirmed ON THIS bar or earlier.  ─
   for(int sh = limit - 1; sh >= 1; sh--)
   {
      UpdateSsnrAtBar(sh);
      UpdateBaseAtBar(sh);
      UpdateGapAtBar(sh);
      ScanPendingMatches(sh);  // pair broken SSNRs with post-break bases/gaps
      UpdateSnrc1AtBar(sh);
   }

   EnforceMaxSnrc1();
   DrawAll();

   int nA=0, nT=0, nC=0, nBr=0, nEx=0;
   for(int i = 0; i < snrc1Total; i++)
      switch(snrc1List[i].c1state) {
         case C1_ACTIVE:    nA++;  break;
         case C1_TOUCHED:   nT++;  break;
         case C1_CONFIRMED: nC++;  break;
         case C1_BROKEN:    nBr++; break;
         case C1_EXPIRED:   nEx++; break;
      }
   PrintFormat("SNRC1_Detector v${SNRC1_DETECTOR_VERSION} ready | active=%d touched=%d confirmed=%d broken=%d expired=%d | disp>=%.1fx ATR(%d) | %s %s",
      nA, nT, nC, nBr, nEx, InpDispMult, InpDispAtrPer, _Symbol, EnumToString(InpTF));
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { DeleteAllObjects(); ChartRedraw(0); }

int OnCalculate(const int rates_total, const int prev_calculated,
                const datetime &time[], const double &open[],
                const double &high[], const double &low[],
                const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
{
   datetime cur = iTime(_Symbol, InpTF, 0);
   if(cur == lastBarTime) return rates_total;
   lastBarTime = cur;

   // Detect new formations on just-closed bars (shA=2, shB=1)
   CheckStrongSnr(2, 1);
   DetectBase(1);
   CheckGapPair(2, 1);

   // Update lifecycle, then pair any newly broken SSNR with post-break bases/gaps
   UpdateSsnrAtBar(1);
   UpdateBaseAtBar(1);
   UpdateGapAtBar(1);
   ScanPendingMatches(1);   // pair broken SSNRs with post-break RBR/DBD/Gap SNRs
   UpdateSnrc1AtBar(1);

   EnforceMaxSnrc1();
   ExtendZones();
   DrawAll();

   return rates_total;
}
`;
}
