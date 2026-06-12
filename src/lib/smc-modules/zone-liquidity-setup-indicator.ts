/**
 * Liquidity Buildup — combined OB + BB + FVG liquidity detector.
 *
 * Replaces the old Zone_Liquidity_Setup. All three zone types share a
 * single level array and a unified CheckLiquidity pass.
 * Zone rectangle: OB = solid | BB = dashed | FVG = dotted.
 * Liquidity marker: horizontal OBJ_TREND line from zone origin to the
 * closest wick that approached the zone edge without entering.
 */

export const LIQUIDITY_BUILDUP_VERSION = "1.0.0";
export const LIQUIDITY_BUILDUP_MODULE = "Liquidity_Buildup";

// Legacy alias kept so existing imports in modules.tsx / verify-mql5.ts
// continue to compile without change.
export const ZONE_LIQ_SETUP_VERSION = LIQUIDITY_BUILDUP_VERSION;
export const ZONE_LIQ_SETUP_MODULE = LIQUIDITY_BUILDUP_MODULE;

export function generateLiquidityBuildup(): string {
  return `//+------------------------------------------------------------------+
//| Liquidity_Buildup.mq5                                           |
//| SMC Liquidity v${LIQUIDITY_BUILDUP_VERSION} — Combined OB + BB + FVG                  |
//|                                                                  |
//| Each zone (OB / Breaker / FVG) is drawn as a filled rectangle.  |
//| The closest wick that approaches the zone without entering is    |
//| marked with a horizontal line — the liquidity build-up level.   |
//| Entering the zone body removes both rect and line.              |
//|                                                                  |
//| Rectangle styles:  OB = solid | BB = dashed | FVG = dotted     |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SMC Liquidity"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define DIR_BULL      1
#define DIR_BEAR     -1
#define TYPE_OB       0
#define TYPE_BB       1
#define TYPE_FVG      2
#define PHASE_WAIT    0   // BB only: OB not yet broken into a breaker
#define PHASE_ACTIVE  1   // OB, FVG: always; BB: after break confirmed
#define LVL_MAX       600
#define OBJ_PREFIX    "SMCLBU_"

//--- General
input ENUM_TIMEFRAMES InpTF           = PERIOD_CURRENT;    // Timeframe
input int             InpLookback     = 500;               // History bars to scan on init
//--- Enable / disable each type
input bool            InpEnableOB     = true;              // Enable Order Blocks
input bool            InpEnableBB     = true;              // Enable Breaker Blocks
input bool            InpEnableFVG    = true;              // Enable Fair Value Gaps
//--- OB + BB shared displacement detection
input double          InpDispMult     = 1.5;               // Displacement body >= N x ATR
input int             InpDispAtrPer   = 14;                // ATR period for displacement
input int             InpObScanBack   = 5;                 // Bars back from disp. to scan for OB
//--- Expiry (bars)
input int             InpOBExpiry     = 200;               // OB active expiry
input int             InpBBObExpiry   = 300;               // BB unbroken-OB stage expiry
input int             InpBBExpiry     = 200;               // BB active-breaker expiry
input int             InpFVGExpiry    = 200;               // FVG expiry
//--- Proximity (liquidity detection threshold)
input double          InpNearATR      = 0.20;              // Proximity as ATR fraction
input int             InpNearAtrPer   = 14;                // ATR period for proximity
input int             InpNearPoints   = 0;                 // Override: fixed points (0 = ATR)
//--- Colors
input color           InpOBBullColor  = clrMediumSeaGreen; // OB bullish
input color           InpOBBearColor  = clrTomato;         // OB bearish
input color           InpBBBullColor  = clrDodgerBlue;     // BB bullish
input color           InpBBBearColor  = clrOrange;         // BB bearish
input color           InpFVGBullColor = clrLime;           // FVG bullish
input color           InpFVGBearColor = clrOrangeRed;      // FVG bearish
//--- Drawing
input bool            InpDrawZone     = true;              // Draw zone rectangles
input bool            InpDrawLiq      = true;              // Draw liquidity lines
input int             InpLiqWidth     = 2;                 // Liquidity line width
input bool            InpShowLog      = true;              // Print log on liquidity events

struct LevelRec
{
   int      id;
   int      ltype;        // TYPE_OB / TYPE_BB / TYPE_FVG
   int      phase;        // PHASE_WAIT (BB pending) or PHASE_ACTIVE
   int      dir;          // DIR_BULL or DIR_BEAR

   // Zone rectangle geometry
   double   zoneTop;
   double   zoneBot;
   datetime zoneLeft;     // left edge of rect
   datetime zoneRight;    // right edge (extended bar-by-bar)

   // Body edge: price that kills the zone when touched/crossed
   double   bodyEdge;

   // BB break-detection fields (only used while phase == PHASE_WAIT)
   double   obHi;
   double   obLo;
   double   obOpen;
   double   obClose;

   // No liquidity is tracked before confirmTime
   datetime confirmTime;

   // Aging
   bool     dead;
   int      age;          // bars in PHASE_ACTIVE
   int      obAge;        // bars in PHASE_WAIT (BB only)

   // Liquidity line: nearest wick to bodyEdge seen so far
   double   bestLiqDist;
   double   liqPrice;     // wick extreme of closest approach
   datetime liqBarTime;   // bar time of that wick
};

LevelRec levList[LVL_MAX];
int      levTotal    = 0;
int      nextId      = 0;
datetime lastBarTime = 0;

string ZoneNm(int id) { return OBJ_PREFIX + IntegerToString(id) + "_zn"; }
string LiqNm (int id) { return OBJ_PREFIX + IntegerToString(id) + "_lq"; }

//+------------------------------------------------------------------+
double CalcATR(int sh, int period)
{
   int avail = iBars(_Symbol, InpTF);
   if(avail < sh + period + 2) return 0.0;
   double sum = 0.0;
   for(int k = sh + 1; k <= sh + period; k++)
   {
      double h  = iHigh (_Symbol, InpTF, k);
      double l  = iLow  (_Symbol, InpTF, k);
      double pc = iClose(_Symbol, InpTF, k + 1);
      sum += MathMax(h - l, MathMax(MathAbs(h - pc), MathAbs(l - pc)));
   }
   return sum / (double)period;
}

color LevelColor(int ltype, int dir)
{
   if(ltype == TYPE_OB)  return (dir == DIR_BULL) ? InpOBBullColor  : InpOBBearColor;
   if(ltype == TYPE_BB)  return (dir == DIR_BULL) ? InpBBBullColor  : InpBBBearColor;
   return                        (dir == DIR_BULL) ? InpFVGBullColor : InpFVGBearColor;
}

//+------------------------------------------------------------------+
void DrawZoneRect(int i)
{
   if(!InpDrawZone) return;
   string nm  = ZoneNm(levList[i].id);
   color  c   = LevelColor(levList[i].ltype, levList[i].dir);
   ENUM_LINE_STYLE sty = (levList[i].ltype == TYPE_BB)  ? STYLE_DASH :
                         (levList[i].ltype == TYPE_FVG) ? STYLE_DOT  : STYLE_SOLID;
   if(ObjectCreate(0, nm, OBJ_RECTANGLE, 0,
                   levList[i].zoneLeft,  levList[i].zoneTop,
                   levList[i].zoneRight, levList[i].zoneBot))
   {
      ObjectSetInteger(0, nm, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, nm, OBJPROP_STYLE,      sty);
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
   if(ObjectFind(0, nm) >= 0)
      ObjectSetInteger(0, nm, OBJPROP_TIME, 1, t);
   levList[i].zoneRight = t;
}

//--- Horizontal trend line from zone origin to the closest-wick bar
void DrawLiqLine(int i)
{
   if(!InpDrawLiq || levList[i].liqBarTime == 0) return;
   string nm = LiqNm(levList[i].id);
   ObjectDelete(0, nm);
   color c = LevelColor(levList[i].ltype, levList[i].dir);
   if(ObjectCreate(0, nm, OBJ_TREND, 0,
                   levList[i].zoneLeft,   levList[i].liqPrice,
                   levList[i].liqBarTime, levList[i].liqPrice))
   {
      ObjectSetInteger(0, nm, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, nm, OBJPROP_STYLE,      STYLE_SOLID);
      ObjectSetInteger(0, nm, OBJPROP_WIDTH,      InpLiqWidth);
      ObjectSetInteger(0, nm, OBJPROP_RAY_RIGHT,  false);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, nm, OBJPROP_HIDDEN,     true);
   }
}

void KillLevel(int i)
{
   ObjectDelete(0, ZoneNm(levList[i].id));
   ObjectDelete(0, LiqNm (levList[i].id));
   levList[i].dead = true;
}

//+------------------------------------------------------------------+
int AllocSlot()
{
   for(int i = 0; i < levTotal; i++)
      if(levList[i].dead) return i;
   if(levTotal < LVL_MAX) return levTotal++;
   return -1;
}

//--- Add an active Order Block zone
void AddOB(int dir, double hi, double lo, double opn, double cls,
           datetime obT, datetime confT)
{
   if(!InpEnableOB) return;
   for(int i = 0; i < levTotal; i++)
      if(!levList[i].dead && levList[i].ltype == TYPE_OB &&
         levList[i].zoneLeft == obT && levList[i].dir == dir) return;
   int idx = AllocSlot(); if(idx < 0) return;
   levList[idx].id          = nextId++;
   levList[idx].ltype       = TYPE_OB;
   levList[idx].phase       = PHASE_ACTIVE;
   levList[idx].dir         = dir;
   levList[idx].bodyEdge    = opn;
   levList[idx].zoneTop     = MathMax(opn, cls);
   levList[idx].zoneBot     = MathMin(opn, cls);
   levList[idx].zoneLeft    = obT;
   levList[idx].zoneRight   = confT;
   levList[idx].obHi        = 0.0;
   levList[idx].obLo        = 0.0;
   levList[idx].obOpen      = 0.0;
   levList[idx].obClose     = 0.0;
   levList[idx].confirmTime = confT;
   levList[idx].dead        = false;
   levList[idx].age         = 0;
   levList[idx].obAge       = 0;
   levList[idx].bestLiqDist = DBL_MAX;
   levList[idx].liqPrice    = 0.0;
   levList[idx].liqBarTime  = 0;
   DrawZoneRect(idx);
}

//--- Track an OB as a pending Breaker (waits for price to close through it)
void AddBBPending(int dir, double hi, double lo, double opn, double cls,
                  datetime obT, datetime confT)
{
   if(!InpEnableBB) return;
   for(int i = 0; i < levTotal; i++)
      if(!levList[i].dead && levList[i].ltype == TYPE_BB &&
         levList[i].zoneLeft == obT) return;
   int idx = AllocSlot(); if(idx < 0) return;
   levList[idx].id          = nextId++;
   levList[idx].ltype       = TYPE_BB;
   levList[idx].phase       = PHASE_WAIT;
   levList[idx].dir         = dir;
   levList[idx].bodyEdge    = 0.0;
   levList[idx].zoneTop     = 0.0;
   levList[idx].zoneBot     = 0.0;
   levList[idx].zoneLeft    = obT;
   levList[idx].zoneRight   = obT;
   levList[idx].obHi        = hi;
   levList[idx].obLo        = lo;
   levList[idx].obOpen      = opn;
   levList[idx].obClose     = cls;
   levList[idx].confirmTime = confT;
   levList[idx].dead        = false;
   levList[idx].age         = 0;
   levList[idx].obAge       = 0;
   levList[idx].bestLiqDist = DBL_MAX;
   levList[idx].liqPrice    = 0.0;
   levList[idx].liqBarTime  = 0;
}

//--- Add an active Fair Value Gap zone
void AddFVG(int dir, double nearEdge, double farEdge, datetime c1T, datetime c3T)
{
   if(!InpEnableFVG) return;
   for(int i = 0; i < levTotal; i++)
      if(!levList[i].dead && levList[i].ltype == TYPE_FVG &&
         levList[i].dir == dir &&
         MathAbs(levList[i].bodyEdge - nearEdge) < _Point) return;
   int idx = AllocSlot(); if(idx < 0) return;
   levList[idx].id          = nextId++;
   levList[idx].ltype       = TYPE_FVG;
   levList[idx].phase       = PHASE_ACTIVE;
   levList[idx].dir         = dir;
   levList[idx].bodyEdge    = nearEdge;
   levList[idx].zoneTop     = MathMax(nearEdge, farEdge);
   levList[idx].zoneBot     = MathMin(nearEdge, farEdge);
   levList[idx].zoneLeft    = c1T;
   levList[idx].zoneRight   = c3T;
   levList[idx].obHi        = 0.0;
   levList[idx].obLo        = 0.0;
   levList[idx].obOpen      = 0.0;
   levList[idx].obClose     = 0.0;
   levList[idx].confirmTime = c3T;
   levList[idx].dead        = false;
   levList[idx].age         = 0;
   levList[idx].obAge       = 0;
   levList[idx].bestLiqDist = DBL_MAX;
   levList[idx].liqPrice    = 0.0;
   levList[idx].liqBarTime  = 0;
   DrawZoneRect(idx);
}

//+------------------------------------------------------------------+
//--- Scan bar[sh] as a potential displacement for OB + BB detection
void DetectOBandBB(int sh)
{
   if(sh < 1 || (!InpEnableOB && !InpEnableBB)) return;
   double atr = CalcATR(sh, InpDispAtrPer);
   if(atr <= 0.0) return;
   double dO = iOpen (_Symbol, InpTF, sh);
   double dC = iClose(_Symbol, InpTF, sh);
   if(MathAbs(dC - dO) < InpDispMult * atr) return;
   int dispDir = (dC > dO) ? DIR_BULL : DIR_BEAR;

   int avail   = iBars(_Symbol, InpTF);
   int scanEnd = sh + InpObScanBack;
   if(scanEnd >= avail - 1) scanEnd = avail - 2;

   for(int j = sh + 1; j <= scanEnd; j++)
   {
      double jO = iOpen (_Symbol, InpTF, j);
      double jC = iClose(_Symbol, InpTF, j);
      double jH = iHigh (_Symbol, InpTF, j);
      double jL = iLow  (_Symbol, InpTF, j);
      datetime obT   = iTime(_Symbol, InpTF, j);
      datetime confT = iTime(_Symbol, InpTF, sh);

      if(dispDir == DIR_BULL && jC < jO)
      {
         AddOB       (DIR_BULL, jH, jL, jO, jC, obT, confT);
         AddBBPending(DIR_BULL, jH, jL, jO, jC, obT, confT);
         break;
      }
      if(dispDir == DIR_BEAR && jC > jO)
      {
         AddOB       (DIR_BEAR, jH, jL, jO, jC, obT, confT);
         AddBBPending(DIR_BEAR, jH, jL, jO, jC, obT, confT);
         break;
      }
   }
}

//--- 3-candle FVG pattern
void DetectFVG(int sh)
{
   if(!InpEnableFVG) return;
   int avail = iBars(_Symbol, InpTF);
   if(sh + 2 >= avail) return;
   double c1h = iHigh(_Symbol, InpTF, sh + 2);
   double c1l = iLow (_Symbol, InpTF, sh + 2);
   double c3h = iHigh(_Symbol, InpTF, sh);
   double c3l = iLow (_Symbol, InpTF, sh);
   datetime c1T = iTime(_Symbol, InpTF, sh + 2);
   datetime c3T = iTime(_Symbol, InpTF, sh);
   if(c1h < c3l) AddFVG(DIR_BULL, c3l, c1h, c1T, c3T);
   if(c1l > c3h) AddFVG(DIR_BEAR, c3h, c1l, c1T, c3T);
}

//--- Promote PHASE_WAIT BBs that close through their OB body
void CheckBBBreaks(int sh)
{
   if(!InpEnableBB) return;
   double   barClose = iClose(_Symbol, InpTF, sh);
   datetime t        = iTime (_Symbol, InpTF, sh);
   for(int i = 0; i < levTotal; i++)
   {
      if(levList[i].dead || levList[i].ltype != TYPE_BB || levList[i].phase != PHASE_WAIT) continue;
      if(levList[i].confirmTime >= t) continue;
      bool broke = false; int newDir = 0;
      if(levList[i].dir == DIR_BULL && barClose < levList[i].obLo) { broke = true; newDir = DIR_BEAR; }
      if(levList[i].dir == DIR_BEAR && barClose > levList[i].obHi) { broke = true; newDir = DIR_BULL; }
      if(!broke) continue;

      levList[i].phase       = PHASE_ACTIVE;
      levList[i].dir         = newDir;
      levList[i].bodyEdge    = levList[i].obClose;
      levList[i].zoneTop     = MathMax(levList[i].obOpen, levList[i].obClose);
      levList[i].zoneBot     = MathMin(levList[i].obOpen, levList[i].obClose);
      levList[i].zoneRight   = t;
      levList[i].bestLiqDist = DBL_MAX;
      DrawZoneRect(i);
      if(InpShowLog)
         PrintFormat("LBU_BB_FORMED | id=%d | newDir=%d | bodyEdge=%.5f | %s",
            levList[i].id, newDir, levList[i].bodyEdge,
            TimeToString(t, TIME_DATE|TIME_MINUTES));
   }
}

//--- Check each active zone: extend rect, update liquidity line, kill if entered
void CheckLiquidity(int sh)
{
   double   hi   = iHigh(_Symbol, InpTF, sh);
   double   lo   = iLow (_Symbol, InpTF, sh);
   datetime t    = iTime(_Symbol, InpTF, sh);
   double   atr  = CalcATR(sh, InpNearAtrPer);
   double   near = (InpNearPoints > 0) ? InpNearPoints * _Point : InpNearATR * atr;

   for(int i = 0; i < levTotal; i++)
   {
      if(levList[i].dead || levList[i].phase != PHASE_ACTIVE) continue;
      if(levList[i].confirmTime >= t) continue;
      ExtendZone(i, t);
      double edge = levList[i].bodyEdge;
      if(near <= 0.0) continue;

      string tag = (levList[i].ltype == TYPE_OB) ? "OB" :
                   (levList[i].ltype == TYPE_BB) ? "BB" : "FVG";

      if(levList[i].dir == DIR_BULL)
      {
         if(lo <= edge) { KillLevel(i); continue; }
         double dist = lo - edge;
         if(dist <= near && dist < levList[i].bestLiqDist)
         {
            levList[i].bestLiqDist = dist;
            levList[i].liqPrice    = lo;
            levList[i].liqBarTime  = t;
            DrawLiqLine(i);
            if(InpShowLog)
               PrintFormat("LBU_%s_BULL | id=%d | edge=%.5f | low=%.5f | dist=%.1f pts | %s",
                  tag, levList[i].id, edge, lo, dist / _Point,
                  TimeToString(t, TIME_DATE|TIME_MINUTES));
         }
      }
      else
      {
         if(hi >= edge) { KillLevel(i); continue; }
         double dist = edge - hi;
         if(dist <= near && dist < levList[i].bestLiqDist)
         {
            levList[i].bestLiqDist = dist;
            levList[i].liqPrice    = hi;
            levList[i].liqBarTime  = t;
            DrawLiqLine(i);
            if(InpShowLog)
               PrintFormat("LBU_%s_BEAR | id=%d | edge=%.5f | high=%.5f | dist=%.1f pts | %s",
                  tag, levList[i].id, edge, hi, dist / _Point,
                  TimeToString(t, TIME_DATE|TIME_MINUTES));
         }
      }
   }
}

//--- Advance age counters and expire old zones
void AgeLevels()
{
   for(int i = 0; i < levTotal; i++)
   {
      if(levList[i].dead) continue;

      if(levList[i].ltype == TYPE_BB && levList[i].phase == PHASE_WAIT)
      {
         if(InpBBObExpiry <= 0) continue;
         levList[i].obAge++;
         if(levList[i].obAge >= InpBBObExpiry) levList[i].dead = true;
         continue;
      }

      int expiry = (levList[i].ltype == TYPE_OB)  ? InpOBExpiry  :
                   (levList[i].ltype == TYPE_BB)  ? InpBBExpiry  : InpFVGExpiry;
      if(expiry <= 0) continue;
      levList[i].age++;
      if(levList[i].age >= expiry) KillLevel(i);
   }
}

//+------------------------------------------------------------------+
void Rebuild()
{
   ObjectsDeleteAll(0, OBJ_PREFIX);
   levTotal = 0; nextId = 0;
   int avail = iBars(_Symbol, InpTF);
   int scan  = MathMin(InpLookback, avail - InpObScanBack - 3);
   if(scan < 2) return;
   for(int sh = scan; sh >= 1; sh--)
   {
      DetectOBandBB(sh);
      DetectFVG(sh);
      CheckBBBreaks(sh);
      CheckLiquidity(sh);
      AgeLevels();
   }
}

int OnInit()
{
   IndicatorSetString(INDICATOR_SHORTNAME, "Liquidity Buildup (OB+BB+FVG)");
   lastBarTime = 0;
   Rebuild();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { ObjectsDeleteAll(0, OBJ_PREFIX); }

int OnCalculate(const int rates_total,
                const int prev_calculated,
                const datetime &time[],
                const double   &open[],
                const double   &high[],
                const double   &low[],
                const double   &close[],
                const long     &tick_volume[],
                const long     &volume[],
                const int      &spread[])
{
   datetime curBar = iTime(_Symbol, InpTF, 0);
   if(curBar != lastBarTime)
   {
      lastBarTime = curBar;
      DetectOBandBB(1);
      DetectFVG(1);
      CheckBBBreaks(1);
      CheckLiquidity(1);
      AgeLevels();
   }
   return rates_total;
}
`;
}

// Legacy alias so existing callers compile without change.
export const generateZoneLiquiditySetupIndicator = generateLiquidityBuildup;
