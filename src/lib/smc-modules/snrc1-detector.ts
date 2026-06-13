/**
 * SNRC1_Detector v2.0.0
 *
 * An SNRC1 is a Classic SNR breakout that has a same-direction
 * RBR/DBD or Gap SNR near the broken level ("opposite it").
 *
 * Bullish SNR breakout (resistance broken up)
 *   → needs a Bullish Gap SNR (Gap Support) or RBR at/near the level
 *
 * Bearish SNR breakout (support broken down)
 *   → needs a Bearish Gap SNR (Gap Resistance) or DBD at/near the level
 *
 * Entry: the RBR/DBD zone (box) or Gap SNR (line).
 * Lifecycle: ACTIVE → TOUCHED → CONFIRMED (entry signal) / BROKEN / EXPIRED
 */

export const SNRC1_DETECTOR_VERSION = "2.0.0";
export const SNRC1_DETECTOR_MODULE  = "SNRC1_Detector";

export function generateSnrc1Detector(): string {
  return `//+------------------------------------------------------------------+
//| SNRC1_Detector.mq5  v${SNRC1_DETECTOR_VERSION}                         |
//|                                                                  |
//| SNRC1 = Classic SNR Breakout with a same-direction RBR/DBD or  |
//|         Gap SNR acting as the entry zone.                       |
//|                                                                  |
//| Bull breakout → RBR (demand) or Gap Support near broken level   |
//| Bear breakout → DBD (supply) or Gap Resistance near broken level|
//|                                                                  |
//| Entry is at the matching zone; the broken SNR level is shown    |
//| as a dashed reference line.                                      |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SNRC1 Detector"
#property version   "2.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

// ── Classic SNR types ─────────────────────────────────────────────
#define SNR_SUP      1     // Bear A → Bull B
#define SNR_RES      2     // Bull A → Bear B

// ── RBR / DBD direction ───────────────────────────────────────────
#define DIR_RBR      1     // Rally-Base-Rally  (demand / bullish)
#define DIR_DBD     -1     // Drop-Base-Drop    (supply  / bearish)

// ── Gap SNR types ─────────────────────────────────────────────────
#define GAP_SUP      1     // Bull A → Bull B  = Gap Support
#define GAP_RES      2     // Bear A → Bear B  = Gap Resistance

// ── Entry zone type ───────────────────────────────────────────────
#define ENTRY_BASE   1
#define ENTRY_GAP    2

// ── SNRC1 lifecycle ───────────────────────────────────────────────
#define C1_ACTIVE    0
#define C1_TOUCHED   1
#define C1_CONFIRMED 2
#define C1_BROKEN    3
#define C1_EXPIRED   4
#define C1_UNDRAWN  -1

#define SNR_MAX   600
#define BASE_MAX  400
#define GAP_MAX   600
#define SNRC1_MAX 200
#define OBJ_PFX   "SMCSNRC1_"

// ── Inputs ────────────────────────────────────────────────────────
input ENUM_TIMEFRAMES InpTF            = PERIOD_CURRENT; // Timeframe
input int             InpLookback      = 500;            // Historical bars to scan
input bool            InpIgnoreDoji    = true;           // Skip doji in Classic SNR detection
input int             InpDojiPoints    = 0;              // Doji body threshold (points; 0 = exact)

//--- RBR / DBD detection
input double InpImpulseRatio   = 0.5;  // Leg   body/range ≥ this (impulse qualifier)
input double InpBaseMaxRatio   = 0.5;  // Base  body/range ≤ this (base qualifier)
input int    InpMaxBaseCandles = 6;    // Max candles in base
input double InpLegBaseMult    = 1.3;  // Leg range ≥ N × avg base range

//--- Proximity — how close the zone must be to the broken Classic SNR level
input double InpProxATR    = 2.0;  // Zone proximity in ATR multiples
input int    InpProxAtrPer = 14;   // ATR period for proximity calculation

//--- Lifecycle
input int  InpExpiryBars = 100;   // Bars until an untouched SNRC1 expires (0 = never)
input int  InpMaxSnrc1   = 30;    // Max active SNRC1 setups on chart

//--- Display
input color InpBullColor  = C'30,130,210';  // Bull SNRC1 colour
input color InpBearColor  = C'210,60,40';   // Bear SNRC1 colour
input int   InpFontSize   = 8;
input bool  InpShowLog    = true;

//+------------------------------------------------------------------+
//| Structs                                                          |
//+------------------------------------------------------------------+
struct SnrRec
{
   int      id;
   int      stype;        // SNR_SUP or SNR_RES
   double   price;        // Candle A close (the Classic SNR level)
   datetime candleATime;
   datetime candleBTime;
   bool     broken;       // consumed by a breakout
};

struct BaseRec
{
   int      id;
   int      bdir;         // DIR_RBR or DIR_DBD
   double   zhi;          // base zone high
   double   zlo;          // base zone low
   datetime baseLeft;     // oldest base candle time (left anchor)
   datetime legOutTime;   // leg-out candle time (zone confirmed)
   bool     dead;
   int      ageCounter;
};

struct GapRec
{
   int      id;
   int      gtype;        // GAP_SUP or GAP_RES
   double   level;        // Candle A close
   datetime candleATime;
   datetime candleBTime;
   bool     dead;
   int      ageCounter;
};

struct Snrc1Rec
{
   int      id;
   int      c1dir;        // +1 bull, -1 bear
   int      entryType;    // ENTRY_BASE or ENTRY_GAP
   double   brokenLevel;  // the Classic SNR price
   datetime snrOrigin;    // candleATime of the Classic SNR
   datetime breakTime;    // bar when breakout was detected
   double   entryHi;      // entry zone top  (= level for gaps)
   double   entryLo;      // entry zone bottom (= level for gaps)
   datetime entryLeft;    // left anchor of entry zone
   int      c1state;
   int      drawnState;
   int      ageCounter;
};

SnrRec   snrList  [SNR_MAX ];
BaseRec  baseList [BASE_MAX];
GapRec   gapList  [GAP_MAX ];
Snrc1Rec snrc1List[SNRC1_MAX];

int      snrTotal = 0, baseTotal = 0, gapTotal = 0, snrc1Total = 0;
int      nextSnrId = 0, nextBaseId = 0, nextGapId = 0, nextC1Id = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
//| Object name helpers                                              |
//+------------------------------------------------------------------+
string ObjZone(int id) { return OBJ_PFX + IntegerToString(id) + "_z";   }
string ObjLvl (int id) { return OBJ_PFX + IntegerToString(id) + "_lv";  }
string ObjLine(int id) { return OBJ_PFX + IntegerToString(id) + "_ln";  }
string ObjLbl (int id) { return OBJ_PFX + IntegerToString(id) + "_lb";  }

//+------------------------------------------------------------------+
//| Candle helpers                                                   |
//+------------------------------------------------------------------+
int CandleDir(int sh)
{
   double c = iClose(_Symbol, InpTF, sh);
   double o = iOpen (_Symbol, InpTF, sh);
   double body = MathAbs(c - o);
   if(InpIgnoreDoji)
   {
      double thr = (InpDojiPoints > 0) ? InpDojiPoints * _Point : 0.0;
      if(body <= thr) return 0;
   }
   if(c > o) return  1;
   if(c < o) return -1;
   return 0;
}

double BodyRatio(int sh)
{
   double o = iOpen(_Symbol, InpTF, sh), c = iClose(_Symbol, InpTF, sh);
   double r = iHigh(_Symbol, InpTF, sh) - iLow(_Symbol, InpTF, sh);
   return r <= 0.0 ? 0.0 : MathAbs(c - o) / r;
}

double BarRng(int sh) { return iHigh(_Symbol, InpTF, sh) - iLow(_Symbol, InpTF, sh); }
bool IsBull(int sh)   { return iClose(_Symbol, InpTF, sh) > iOpen(_Symbol, InpTF, sh); }
bool IsBear(int sh)   { return iClose(_Symbol, InpTF, sh) < iOpen(_Symbol, InpTF, sh); }

//+------------------------------------------------------------------+
//| ATR (SMA of True Range)                                         |
//+------------------------------------------------------------------+
double CalcATR(int sh)
{
   int avail = iBars(_Symbol, InpTF);
   if(InpProxAtrPer <= 0 || sh + InpProxAtrPer + 1 >= avail) return _Point;
   double sum = 0.0;
   for(int i = 0; i < InpProxAtrPer; i++)
   {
      double hi = iHigh (_Symbol, InpTF, sh + i);
      double lo = iLow  (_Symbol, InpTF, sh + i);
      double pc = iClose(_Symbol, InpTF, sh + i + 1);
      sum += MathMax(hi - lo, MathMax(MathAbs(hi - pc), MathAbs(lo - pc)));
   }
   return sum / InpProxAtrPer;
}

//+------------------------------------------------------------------+
//| Distance from a price level to the nearest edge of [zlo, zhi].  |
//| Returns 0 if the level is inside (or on the boundary of) the   |
//| zone, otherwise the gap to the nearest edge.                    |
//+------------------------------------------------------------------+
double DistToZone(double lvl, double zhi, double zlo)
{
   if(lvl >= zlo && lvl <= zhi) return 0.0;
   if(lvl > zhi) return lvl - zhi;
   return zlo - lvl;
}

//+------------------------------------------------------------------+
//| Classic SNR Detection                                           |
//| shA = older candle, shB = newer candle                          |
//+------------------------------------------------------------------+
void AddSnrLevel(int shA, int shB)
{
   int avail = iBars(_Symbol, InpTF);
   if(shA >= avail || shB < 0) return;

   int dA = CandleDir(shA), dB = CandleDir(shB);
   if(dA == 0 || dB == 0) return;  // doji — skip

   int stype = 0;
   if(dA > 0 && dB < 0) stype = SNR_RES;  // Bull A → Bear B = Resistance
   if(dA < 0 && dB > 0) stype = SNR_SUP;  // Bear A → Bull B = Support
   if(stype == 0) return;                   // same direction = Gap SNR; not Classic

   double   lvl = iClose(_Symbol, InpTF, shA);
   datetime tA  = iTime(_Symbol, InpTF, shA);
   datetime tB  = iTime(_Symbol, InpTF, shB);

   for(int i = 0; i < snrTotal; i++)
      if(snrList[i].candleATime == tA && snrList[i].stype == stype) return;  // dedup

   if(snrTotal >= SNR_MAX) return;
   int idx = snrTotal++;
   snrList[idx].id          = nextSnrId++;
   snrList[idx].stype       = stype;
   snrList[idx].price       = lvl;
   snrList[idx].candleATime = tA;
   snrList[idx].candleBTime = tB;
   snrList[idx].broken      = false;
}

//+------------------------------------------------------------------+
//| Gap SNR Detection (same-direction candle pair)                  |
//+------------------------------------------------------------------+
void CheckGapPair(int shA, int shB)
{
   int avail = iBars(_Symbol, InpTF);
   if(shA >= avail || shB < 0) return;

   int dA = CandleDir(shA), dB = CandleDir(shB);
   if(dA == 0 || dB == 0) return;

   int gtype = 0;
   if(dA > 0 && dB > 0) gtype = GAP_SUP;  // both bull → Gap Support
   if(dA < 0 && dB < 0) gtype = GAP_RES;  // both bear → Gap Resistance
   if(gtype == 0) return;

   double   lvl = iClose(_Symbol, InpTF, shA);
   datetime tA  = iTime(_Symbol, InpTF, shA);
   datetime tB  = iTime(_Symbol, InpTF, shB);

   for(int i = 0; i < gapTotal; i++)
      if(gapList[i].candleATime == tA && gapList[i].gtype == gtype) return;

   if(gapTotal >= GAP_MAX) return;
   int idx = gapTotal++;
   gapList[idx].id          = nextGapId++;
   gapList[idx].gtype       = gtype;
   gapList[idx].level       = lvl;
   gapList[idx].candleATime = tA;
   gapList[idx].candleBTime = tB;
   gapList[idx].dead        = false;
   gapList[idx].ageCounter  = 0;
}

//+------------------------------------------------------------------+
//| RBR / DBD Detection                                             |
//| sh = the leg-out candle (breakout bar, confirming the pattern)  |
//+------------------------------------------------------------------+
void DetectBase(int sh)
{
   int avail = iBars(_Symbol, InpTF);
   if(sh + 2 >= avail) return;

   // Leg-out must be a strong impulse
   if(BodyRatio(sh) < InpImpulseRatio) return;
   int dir;
   if(IsBull(sh))      dir = DIR_RBR;
   else if(IsBear(sh)) dir = DIR_DBD;
   else return;

   // Collect the run of small-body base candles immediately before leg-out
   int baseLen = 0;
   while(baseLen < InpMaxBaseCandles
         && (sh + 1 + baseLen) < avail
         && BodyRatio(sh + 1 + baseLen) <= InpBaseMaxRatio)
      baseLen++;
   if(baseLen < 1) return;

   // Leg-in: strong impulse in the same direction
   int legInSh = sh + 1 + baseLen;
   if(legInSh >= avail) return;
   if(BodyRatio(legInSh) < InpImpulseRatio) return;
   if(dir == DIR_RBR && !IsBull(legInSh)) return;
   if(dir == DIR_DBD && !IsBear(legInSh)) return;

   // Base extent + average range
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

   // Legs must be larger than the base
   if(BarRng(sh)      < InpLegBaseMult * avgR) return;
   if(BarRng(legInSh) < InpLegBaseMult * avgR) return;

   // Leg-out must break OUT of the base
   double loClose = iClose(_Symbol, InpTF, sh);
   if(dir == DIR_RBR && loClose <= bhi) return;
   if(dir == DIR_DBD && loClose >= blo) return;

   datetime baseLeft  = iTime(_Symbol, InpTF, sh + baseLen);
   datetime legOutT   = iTime(_Symbol, InpTF, sh);

   for(int k = 0; k < baseTotal; k++)
      if(!baseList[k].dead && baseList[k].baseLeft == baseLeft) return;  // dedup

   if(baseTotal >= BASE_MAX) return;
   int idx = baseTotal++;
   baseList[idx].id          = nextBaseId++;
   baseList[idx].bdir        = dir;
   baseList[idx].zhi         = bhi;
   baseList[idx].zlo         = blo;
   baseList[idx].baseLeft    = baseLeft;
   baseList[idx].legOutTime  = legOutT;
   baseList[idx].dead        = false;
   baseList[idx].ageCounter  = 0;
}

//+------------------------------------------------------------------+
//| Try to pair a breakout with a same-direction RBR/DBD or Gap SNR |
//|                                                                  |
//| The zone must:                                                   |
//|   • match direction (bull break → RBR / Gap-Sup; bear → DBD / Gap-Res)
//|   • be within InpProxATR × ATR of the broken level              |
//| Pick the closest match. BASE wins over GAP when equidistant.   |
//+------------------------------------------------------------------+
void TryMatchSnrc1(int snrIdx, int sh)
{
   if(snrc1Total >= SNRC1_MAX) return;

   double   brokenLvl = snrList[snrIdx].price;
   datetime breakTime = iTime(_Symbol, InpTF, sh);
   datetime snrOrigin = snrList[snrIdx].candleATime;
   int      dir       = (snrList[snrIdx].stype == SNR_RES) ? +1 : -1;  // +1 bull break, -1 bear

   double atr  = CalcATR(sh);
   if(atr <= 0.0) atr = 10 * _Point;
   double prox = InpProxATR * atr;

   // ── Try RBR / DBD ────────────────────────────────────────────────
   int bestBase = -1; double bestBaseDist = prox + 1.0;
   int reqBaseDir = (dir > 0) ? DIR_RBR : DIR_DBD;
   for(int i = 0; i < baseTotal; i++)
   {
      if(baseList[i].dead) continue;
      if(baseList[i].bdir != reqBaseDir) continue;
      double dist = DistToZone(brokenLvl, baseList[i].zhi, baseList[i].zlo);
      if(dist > prox) continue;
      if(dist < bestBaseDist) { bestBaseDist = dist; bestBase = i; }
   }

   if(bestBase >= 0)
   {
      int idx = snrc1Total++;
      snrc1List[idx].id          = nextC1Id++;
      snrc1List[idx].c1dir       = dir;
      snrc1List[idx].entryType   = ENTRY_BASE;
      snrc1List[idx].brokenLevel = brokenLvl;
      snrc1List[idx].snrOrigin   = snrOrigin;
      snrc1List[idx].breakTime   = breakTime;
      snrc1List[idx].entryHi     = baseList[bestBase].zhi;
      snrc1List[idx].entryLo     = baseList[bestBase].zlo;
      snrc1List[idx].entryLeft   = baseList[bestBase].baseLeft;
      snrc1List[idx].c1state     = C1_ACTIVE;
      snrc1List[idx].drawnState  = C1_UNDRAWN;
      snrc1List[idx].ageCounter  = 0;
      if(InpShowLog)
         PrintFormat("SNRC1 | id=%d | %s | entry=%s | level=%.5f | zone=[%.5f,%.5f] | %s",
            snrc1List[idx].id, dir > 0 ? "BULL" : "BEAR",
            dir > 0 ? "RBR" : "DBD",
            brokenLvl, baseList[bestBase].zhi, baseList[bestBase].zlo,
            TimeToString(breakTime, TIME_DATE|TIME_MINUTES));
      return;
   }

   // ── Try Gap SNR ──────────────────────────────────────────────────
   int reqGap = (dir > 0) ? GAP_SUP : GAP_RES;
   int bestGap = -1; double bestGapDist = prox + 1.0;
   for(int i = 0; i < gapTotal; i++)
   {
      if(gapList[i].dead) continue;
      if(gapList[i].gtype != reqGap) continue;
      double dist = MathAbs(gapList[i].level - brokenLvl);
      if(dist > prox) continue;
      if(dist < bestGapDist) { bestGapDist = dist; bestGap = i; }
   }

   if(bestGap >= 0)
   {
      int idx = snrc1Total++;
      snrc1List[idx].id          = nextC1Id++;
      snrc1List[idx].c1dir       = dir;
      snrc1List[idx].entryType   = ENTRY_GAP;
      snrc1List[idx].brokenLevel = brokenLvl;
      snrc1List[idx].snrOrigin   = snrOrigin;
      snrc1List[idx].breakTime   = breakTime;
      snrc1List[idx].entryHi     = gapList[bestGap].level;
      snrc1List[idx].entryLo     = gapList[bestGap].level;
      snrc1List[idx].entryLeft   = gapList[bestGap].candleATime;
      snrc1List[idx].c1state     = C1_ACTIVE;
      snrc1List[idx].drawnState  = C1_UNDRAWN;
      snrc1List[idx].ageCounter  = 0;
      if(InpShowLog)
         PrintFormat("SNRC1 | id=%d | %s | entry=%s | level=%.5f | gap=%.5f | %s",
            snrc1List[idx].id, dir > 0 ? "BULL" : "BEAR",
            dir > 0 ? "G-Sup" : "G-Res",
            brokenLvl, gapList[bestGap].level,
            TimeToString(breakTime, TIME_DATE|TIME_MINUTES));
   }
}

//+------------------------------------------------------------------+
//| Check bar sh for breakouts of active Classic SNR levels.        |
//+------------------------------------------------------------------+
void CheckBreakout(int sh)
{
   double   cl = iClose(_Symbol, InpTF, sh);
   datetime bt = iTime (_Symbol, InpTF, sh);

   for(int i = 0; i < snrTotal; i++)
   {
      if(snrList[i].broken) continue;
      if(snrList[i].candleBTime >= bt) continue;  // level must be confirmed before this bar

      double lvl    = snrList[i].price;
      bool   boBull = (snrList[i].stype == SNR_RES && cl > lvl);
      bool   boBear = (snrList[i].stype == SNR_SUP && cl < lvl);
      if(!boBull && !boBear) continue;

      snrList[i].broken = true;
      TryMatchSnrc1(i, sh);
   }
}

//+------------------------------------------------------------------+
//| Update SNRC1 lifecycle at bar sh                                |
//|                                                                  |
//| Bull SNRC1 (entry zone BELOW broken resistance):                |
//|   Touch     : bar LOW  ≤ zone top  (price pulls back to zone)   |
//|   Confirmed : close    > zone top  (bounced up from zone)       |
//|   Broken    : close    < zone bottom (zone traded through)      |
//|                                                                  |
//| Bear SNRC1 (entry zone ABOVE broken support):                   |
//|   Touch     : bar HIGH ≥ zone bottom (price pulls back to zone) |
//|   Confirmed : close    < zone bottom (bounced down from zone)   |
//|   Broken    : close    > zone top  (zone traded through)        |
//+------------------------------------------------------------------+
void UpdateSnrc1AtBar(int sh)
{
   double   hi = iHigh (_Symbol, InpTF, sh);
   double   lo = iLow  (_Symbol, InpTF, sh);
   double   cl = iClose(_Symbol, InpTF, sh);
   datetime bt = iTime (_Symbol, InpTF, sh);

   for(int i = 0; i < snrc1Total; i++)
   {
      int st = snrc1List[i].c1state;
      if(st == C1_BROKEN || st == C1_EXPIRED) continue;
      if(snrc1List[i].breakTime >= bt) continue;

      snrc1List[i].ageCounter++;

      double   zhi    = snrc1List[i].entryHi;
      double   zlo    = snrc1List[i].entryLo;
      bool     isBull = (snrc1List[i].c1dir > 0);

      // ── Expiry ─────────────────────────────────────────────────────
      if(InpExpiryBars > 0 && snrc1List[i].ageCounter >= InpExpiryBars)
      {
         snrc1List[i].c1state = C1_EXPIRED;
         if(InpShowLog)
            PrintFormat("SNRC1_EXPIRED | id=%d | %s", snrc1List[i].id, isBull ? "BULL" : "BEAR");
         continue;
      }

      // ── Zone broken (close through in wrong direction) ─────────────
      bool broken = isBull ? (cl < zlo) : (cl > zhi);
      if(broken)
      {
         snrc1List[i].c1state = C1_BROKEN;
         if(InpShowLog)
            PrintFormat("SNRC1_BROKEN | id=%d | %s", snrc1List[i].id, isBull ? "BULL" : "BEAR");
         continue;
      }

      // ── Touch: price wicks into zone ───────────────────────────────
      bool touched = isBull ? (lo <= zhi) : (hi >= zlo);

      // ── Confirmed: bounced from zone in right direction ────────────
      bool confirmed = isBull ? (touched && cl > zhi) : (touched && cl < zlo);

      if(st == C1_ACTIVE && touched)
      {
         if(confirmed) snrc1List[i].c1state = C1_CONFIRMED;
         else          snrc1List[i].c1state = C1_TOUCHED;
         if(confirmed && InpShowLog)
            PrintFormat("SNRC1_CONFIRMED | id=%d | %s | entry=%.5f",
               snrc1List[i].id, isBull ? "BULL" : "BEAR", zhi);
      }
      else if(st == C1_TOUCHED && confirmed)
      {
         snrc1List[i].c1state = C1_CONFIRMED;
         if(InpShowLog)
            PrintFormat("SNRC1_CONFIRMED | id=%d | %s | entry=%.5f",
               snrc1List[i].id, isBull ? "BULL" : "BEAR", zhi);
      }
   }
}

void UpdateBaseAtBar(int sh)
{
   datetime bt = iTime(_Symbol, InpTF, sh);
   for(int i = 0; i < baseTotal; i++)
   {
      if(baseList[i].dead) continue;
      if(baseList[i].legOutTime >= bt) continue;
      baseList[i].ageCounter++;
      if(InpExpiryBars > 0 && baseList[i].ageCounter >= InpExpiryBars)
         baseList[i].dead = true;
   }
}

void UpdateGapAtBar(int sh)
{
   datetime bt = iTime(_Symbol, InpTF, sh);
   for(int i = 0; i < gapTotal; i++)
   {
      if(gapList[i].dead) continue;
      if(gapList[i].candleBTime >= bt) continue;
      gapList[i].ageCounter++;
      if(InpExpiryBars > 0 && gapList[i].ageCounter >= InpExpiryBars)
         gapList[i].dead = true;
   }
}

//+------------------------------------------------------------------+
//| Drawing                                                          |
//+------------------------------------------------------------------+
void DrawSnrc1(int i)
{
   int      st     = snrc1List[i].c1state;
   bool     isBull = (snrc1List[i].c1dir > 0);
   datetime tNow   = iTime(_Symbol, InpTF, 0);

   // Always delete and redraw from scratch
   ObjectDelete(0, ObjZone(snrc1List[i].id));
   ObjectDelete(0, ObjLine(snrc1List[i].id));
   ObjectDelete(0, ObjLvl (snrc1List[i].id));
   ObjectDelete(0, ObjLbl (snrc1List[i].id));

   // Terminal states — remove from chart
   if(st == C1_BROKEN || st == C1_EXPIRED)
   {
      snrc1List[i].drawnState = st;
      return;
   }

   // Colour: confirmed → brighter, otherwise base colour
   color clr = (st == C1_CONFIRMED)
               ? (isBull ? clrMediumSeaGreen : clrOrangeRed)
               : (isBull ? InpBullColor      : InpBearColor);

   bool     isGap  = (snrc1List[i].entryType == ENTRY_GAP);
   double   ehi    = snrc1List[i].entryHi;
   double   elo    = snrc1List[i].entryLo;
   datetime tLeft  = snrc1List[i].entryLeft;

   // ── Entry zone box (RBR/DBD) or gap line ─────────────────────────
   if(!isGap)
   {
      if(ObjectCreate(0, ObjZone(snrc1List[i].id), OBJ_RECTANGLE, 0, tLeft, ehi, tNow, elo))
      {
         ObjectSetInteger(0, ObjZone(snrc1List[i].id), OBJPROP_COLOR,      clr);
         ObjectSetInteger(0, ObjZone(snrc1List[i].id), OBJPROP_FILL,       true);
         ObjectSetInteger(0, ObjZone(snrc1List[i].id), OBJPROP_BACK,       true);
         ObjectSetInteger(0, ObjZone(snrc1List[i].id), OBJPROP_WIDTH,      1);
         ObjectSetInteger(0, ObjZone(snrc1List[i].id), OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, ObjZone(snrc1List[i].id), OBJPROP_HIDDEN,     true);
      }
   }
   else
   {
      // Gap SNR: a solid horizontal line at the gap level
      if(ObjectCreate(0, ObjLine(snrc1List[i].id), OBJ_TREND, 0, tLeft, ehi, tNow, ehi))
      {
         ObjectSetInteger(0, ObjLine(snrc1List[i].id), OBJPROP_COLOR,      clr);
         ObjectSetInteger(0, ObjLine(snrc1List[i].id), OBJPROP_WIDTH,      2);
         ObjectSetInteger(0, ObjLine(snrc1List[i].id), OBJPROP_STYLE,      STYLE_SOLID);
         ObjectSetInteger(0, ObjLine(snrc1List[i].id), OBJPROP_RAY_RIGHT,  true);
         ObjectSetInteger(0, ObjLine(snrc1List[i].id), OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, ObjLine(snrc1List[i].id), OBJPROP_HIDDEN,     true);
         ObjectSetInteger(0, ObjLine(snrc1List[i].id), OBJPROP_BACK,       true);
      }
   }

   // ── Broken Classic SNR reference line (dashed) ────────────────────
   datetime lvlLeft = snrc1List[i].snrOrigin;
   double   lvl     = snrc1List[i].brokenLevel;
   if(ObjectCreate(0, ObjLvl(snrc1List[i].id), OBJ_TREND, 0, lvlLeft, lvl, tNow, lvl))
   {
      ObjectSetInteger(0, ObjLvl(snrc1List[i].id), OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, ObjLvl(snrc1List[i].id), OBJPROP_STYLE,      STYLE_DASH);
      ObjectSetInteger(0, ObjLvl(snrc1List[i].id), OBJPROP_WIDTH,      1);
      ObjectSetInteger(0, ObjLvl(snrc1List[i].id), OBJPROP_RAY_RIGHT,  true);
      ObjectSetInteger(0, ObjLvl(snrc1List[i].id), OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, ObjLvl(snrc1List[i].id), OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, ObjLvl(snrc1List[i].id), OBJPROP_BACK,       true);
   }

   // ── Label ─────────────────────────────────────────────────────────
   string typeStr;
   if(snrc1List[i].entryType == ENTRY_BASE)
      typeStr = (isBull ? "RBR" : "DBD");
   else
      typeStr = (isBull ? "G-Sup" : "G-Res");

   string suffix = "";
   if(st == C1_TOUCHED)   suffix = " ~";
   if(st == C1_CONFIRMED) suffix = " ✓";

   string lbl = (isBull ? "SNRC1↑" : "SNRC1↓") + " " + typeStr + suffix;

   // Anchor label at the zone edge closest to the broken level
   double lblPrice = isBull ? ehi : elo;  // zone top for bull, zone bottom for bear
   if(ObjectCreate(0, ObjLbl(snrc1List[i].id), OBJ_TEXT, 0, tLeft, lblPrice))
   {
      ObjectSetString (0, ObjLbl(snrc1List[i].id), OBJPROP_TEXT,       lbl);
      ObjectSetInteger(0, ObjLbl(snrc1List[i].id), OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, ObjLbl(snrc1List[i].id), OBJPROP_FONTSIZE,   InpFontSize);
      ObjectSetInteger(0, ObjLbl(snrc1List[i].id), OBJPROP_ANCHOR,     isBull ? ANCHOR_LOWER : ANCHOR_UPPER);
      ObjectSetInteger(0, ObjLbl(snrc1List[i].id), OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, ObjLbl(snrc1List[i].id), OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, ObjLbl(snrc1List[i].id), OBJPROP_BACK,       false);
   }

   snrc1List[i].drawnState = st;
}

void DrawAll()
{
   for(int i = 0; i < snrc1Total; i++)
      if(snrc1List[i].drawnState != snrc1List[i].c1state)
         DrawSnrc1(i);
   ChartRedraw(0);
}

void ExtendZones()
{
   datetime tNow = iTime(_Symbol, InpTF, 0);
   for(int i = 0; i < snrc1Total; i++)
   {
      int st = snrc1List[i].c1state;
      if(st == C1_BROKEN || st == C1_EXPIRED) continue;

      string zn = ObjZone(snrc1List[i].id);
      if(ObjectFind(0, zn) >= 0) ObjectSetInteger(0, zn, OBJPROP_TIME, 1, tNow);

      string ln = ObjLine(snrc1List[i].id);
      if(ObjectFind(0, ln) >= 0) ObjectSetInteger(0, ln, OBJPROP_TIME, 1, tNow);

      string lv = ObjLvl(snrc1List[i].id);
      if(ObjectFind(0, lv) >= 0) ObjectSetInteger(0, lv, OBJPROP_TIME, 1, tNow);
   }
}

void EnforceMax()
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
      snrc1List[oldest].c1state    = C1_EXPIRED;
      snrc1List[oldest].drawnState = C1_UNDRAWN;
      cnt--;
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
//| OnInit — two-pass chronological scan                            |
//|                                                                  |
//| Pass 1: detect all Classic SNR levels, Gap SNRs, RBR/DBD bases |
//| Pass 2: replay bar-by-bar, detect breakouts + update lifecycle  |
//|                                                                  |
//| The two-pass approach ensures a breakout at bar sh can only     |
//| match zones that were detected in Pass 1 and thus existed at    |
//| or before bar sh.                                               |
//+------------------------------------------------------------------+
int OnInit()
{
   DeleteAllObjects();
   snrTotal = 0; baseTotal = 0; gapTotal = 0; snrc1Total = 0;
   nextSnrId = 0; nextBaseId = 0; nextGapId = 0; nextC1Id = 0;

   int avail = iBars(_Symbol, InpTF);
   if(avail < 4) { Print("SNRC1_Detector: not enough bars."); return INIT_FAILED; }
   int limit = MathMin(InpLookback, avail - 3);

   // ── Pass 1: Detection (oldest → newest) ─────────────────────────
   for(int sh = limit; sh >= 1; sh--)
   {
      AddSnrLevel(sh + 1, sh);  // Candle A = sh+1 (older), B = sh (newer)
      CheckGapPair(sh + 1, sh);
      DetectBase(sh);            // sh = leg-out bar
   }

   // ── Pass 2: Lifecycle replay (oldest → newest) ───────────────────
   for(int sh = limit; sh >= 1; sh--)
   {
      CheckBreakout(sh);
      UpdateBaseAtBar(sh);
      UpdateGapAtBar(sh);
      UpdateSnrc1AtBar(sh);
   }

   EnforceMax();
   DrawAll();

   int nA = 0, nT = 0, nC = 0, nBr = 0, nEx = 0;
   for(int i = 0; i < snrc1Total; i++)
      switch(snrc1List[i].c1state)
      {
         case C1_ACTIVE:    nA++;  break;
         case C1_TOUCHED:   nT++;  break;
         case C1_CONFIRMED: nC++;  break;
         case C1_BROKEN:    nBr++; break;
         case C1_EXPIRED:   nEx++; break;
      }
   PrintFormat("SNRC1_Detector v${SNRC1_DETECTOR_VERSION} ready | active=%d touched=%d confirmed=%d broken=%d expired=%d | prox=%.1f×ATR(%d) | %s %s",
      nA, nT, nC, nBr, nEx, InpProxATR, InpProxAtrPer, _Symbol, EnumToString(InpTF));
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { DeleteAllObjects(); ChartRedraw(0); }

//+------------------------------------------------------------------+
//| OnCalculate — new bar                                           |
//+------------------------------------------------------------------+
int OnCalculate(const int rates_total, const int prev_calculated,
                const datetime &time[], const double &open[],
                const double &high[], const double &low[],
                const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
{
   datetime cur = iTime(_Symbol, InpTF, 0);
   if(cur == lastBarTime) return rates_total;
   lastBarTime = cur;

   // Bar 1 just closed: detect new levels/zones from bars 2→1
   AddSnrLevel(2, 1);
   CheckGapPair(2, 1);
   DetectBase(1);

   // Check if bar 1 broke any Classic SNR and try to match a zone
   CheckBreakout(1);

   // Update lifecycle
   UpdateBaseAtBar(1);
   UpdateGapAtBar(1);
   UpdateSnrc1AtBar(1);

   EnforceMax();
   ExtendZones();
   DrawAll();

   return rates_total;
}
`;
}
