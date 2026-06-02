/**
 * RBR / DBD Detector — Supply & Demand base zones
 *
 * RBR (Rally-Base-Rally)  = bullish continuation → the BASE is a DEMAND zone.
 * DBD (Drop-Base-Drop)    = bearish continuation → the BASE is a SUPPLY zone.
 *
 * Structure (oldest → newest):
 *   leg-in (strong impulse)  →  base (1–6 small candles)  →  leg-out (strong impulse, same dir)
 *
 * The important thing is not the pattern but the BASE: institutions likely
 * accumulated orders there, so price is expected to react from it later.
 *
 * Zone = the full range (high..low) of the base candles.
 *
 * Identification:
 *   - leg candle  : decisive body (body/range ≥ InpImpulseRatio) in the move direction
 *   - base candle : small body (body/range ≤ InpBaseMaxRatio), any direction
 *   - legs must be larger than the base (leg range ≥ InpLegBaseMult × avg base range)
 *   - leg-out must break OUT of the base (close beyond base high/low)
 *
 * Invalidation: a zone is "traded through" and removed when price CLOSES beyond
 *   it against the zone — demand dies on a close below it, supply on a close above.
 *
 * Pure detector (reference/debug tooling).
 */

export const RBR_DBD_DETECTOR_VERSION = "1.0.0";
export const RBR_DBD_DETECTOR_MODULE = "RBR_DBD_Detector";

export function generateRbrDbdDetector(): string {
  return `//+------------------------------------------------------------------+
//| RBR_DBD_Detector.mq5 — Supply & Demand base zones               |
//| RBR/DBD Detector v${RBR_DBD_DETECTOR_VERSION}                            |
//|                                                                  |
//| RBR (Rally-Base-Rally) → DEMAND zone (base of a bullish leg-leg) |
//| DBD (Drop-Base-Drop)   → SUPPLY zone (base of a bearish leg-leg) |
//| Pattern: strong leg → 1-6 small base candles → strong leg (same |
//| direction) breaking out of the base. Zone = base high..low.     |
//| Traded through (close beyond zone) → invalid.                   |
//+------------------------------------------------------------------+
#property copyright "EA Builder — RBR/DBD Supply & Demand"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define DIR_DEMAND   1     // RBR — bullish base
#define DIR_SUPPLY  -1     // DBD — bearish base
#define MAX_ZONES    500
#define OBJ_PREFIX   "SMRBR_"

input ENUM_TIMEFRAMES InpTF           = PERIOD_CURRENT;
input int             InpLookback     = 400;
input int             InpExpiryBars   = 200;     // bars until an untested zone is removed
input double          InpImpulseRatio = 0.5;     // leg candle: body/range must be >= this
input double          InpBaseMaxRatio = 0.5;     // base candle: body/range must be <= this
input int             InpMaxBaseCandles = 6;     // max candles allowed in a base
input double          InpLegBaseMult  = 1.3;     // leg range must be >= this * avg base range
input bool            InpDraw         = true;
input int             InpFontSize     = 8;
input color           InpDemandColor  = clrSeaGreen;
input color           InpSupplyColor  = clrIndianRed;
input bool            InpShowLog      = true;

struct ZoneRec
{
   int      id;
   int      dir;          // 1 = demand (RBR), -1 = supply (DBD)
   double   hi;           // base high (zone upper)
   double   lo;           // base low  (zone lower)
   datetime baseTime;     // time of the oldest base candle (left edge)
   datetime legOutTime;   // time of the breakout candle (zone confirmed)
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

double BodyRatio(int sh)
{
   double o = iOpen (_Symbol, InpTF, sh);
   double c = iClose(_Symbol, InpTF, sh);
   double r = iHigh (_Symbol, InpTF, sh) - iLow(_Symbol, InpTF, sh);
   if(r <= 0.0) return 0.0;
   return MathAbs(c - o) / r;
}
double Range(int sh) { return iHigh(_Symbol, InpTF, sh) - iLow(_Symbol, InpTF, sh); }
bool IsBull(int sh)  { return iClose(_Symbol, InpTF, sh) > iOpen(_Symbol, InpTF, sh); }
bool IsBear(int sh)  { return iClose(_Symbol, InpTF, sh) < iOpen(_Symbol, InpTF, sh); }
bool IsStrong(int sh){ return BodyRatio(sh) >= InpImpulseRatio; }
bool IsSmall(int sh) { return BodyRatio(sh) <= InpBaseMaxRatio; }

//+------------------------------------------------------------------+
void DrawZone(int i)
{
   if(!InpDraw) return;
   color c = (zones[i].dir == DIR_DEMAND) ? InpDemandColor : InpSupplyColor;

   string boxName = ZoneBox(zones[i].id);
   if(ObjectCreate(0, boxName, OBJ_RECTANGLE, 0, zones[i].baseTime, zones[i].hi,
                   iTime(_Symbol, InpTF, 0), zones[i].lo)) {
      ObjectSetInteger(0, boxName, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, boxName, OBJPROP_WIDTH,      2);
      ObjectSetInteger(0, boxName, OBJPROP_FILL,       true);
      ObjectSetInteger(0, boxName, OBJPROP_BACK,       true);
      ObjectSetInteger(0, boxName, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, boxName, OBJPROP_HIDDEN,     true);
   }

   string lblName = ZoneLabel(zones[i].id);
   double anchor  = (zones[i].dir == DIR_DEMAND) ? zones[i].lo : zones[i].hi;
   if(ObjectCreate(0, lblName, OBJ_TEXT, 0, zones[i].baseTime, anchor)) {
      ObjectSetString (0, lblName, OBJPROP_TEXT,
                       zones[i].dir == DIR_DEMAND ? "RBR (Demand)" : "DBD (Supply)");
      ObjectSetInteger(0, lblName, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, lblName, OBJPROP_FONTSIZE,   InpFontSize);
      ObjectSetInteger(0, lblName, OBJPROP_ANCHOR,
                       zones[i].dir == DIR_DEMAND ? ANCHOR_UPPER : ANCHOR_LOWER);
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
// Detect an RBR/DBD with the breakout (leg-out) candle at bar sh.
void DetectRbrDbd(int sh)
{
   int avail = iBars(_Symbol, InpTF);
   // need: legOut(sh) + base(>=1) + legIn(1)  →  at least sh+2 bars back
   if(sh + 2 >= avail) return;

   // Leg-out must be a strong, directional impulse candle.
   if(!IsStrong(sh)) return;
   int dir;
   if(IsBull(sh))      dir = DIR_DEMAND;   // RBR
   else if(IsBear(sh)) dir = DIR_SUPPLY;   // DBD
   else return;

   // Collect the consecutive run of small base candles immediately before leg-out.
   int baseLen = 0;
   while(baseLen < InpMaxBaseCandles
         && (sh + 1 + baseLen) < avail
         && IsSmall(sh + 1 + baseLen))
      baseLen++;
   if(baseLen < 1) return;

   int legInSh = sh + 1 + baseLen;
   if(legInSh >= avail) return;

   // Leg-in must be a strong impulse in the SAME direction.
   if(!IsStrong(legInSh)) return;
   if(dir == DIR_DEMAND && !IsBull(legInSh)) return;
   if(dir == DIR_SUPPLY && !IsBear(legInSh)) return;

   // Base extent + average base range.
   double baseHi = -1.0, baseLo = 1e18, sumRange = 0.0;
   for(int k = 0; k < baseLen; k++) {
      int b = sh + 1 + k;
      double h = iHigh(_Symbol, InpTF, b);
      double l = iLow (_Symbol, InpTF, b);
      if(h > baseHi) baseHi = h;
      if(l < baseLo) baseLo = l;
      sumRange += (h - l);
   }
   double avgBaseRange = sumRange / baseLen;
   if(avgBaseRange <= 0.0) return;

   // Legs must be meaningfully larger than the base (lower base volatility).
   if(Range(sh)      < InpLegBaseMult * avgBaseRange) return;
   if(Range(legInSh) < InpLegBaseMult * avgBaseRange) return;

   // Leg-out must break OUT of the base.
   double legOutClose = iClose(_Symbol, InpTF, sh);
   if(dir == DIR_DEMAND && legOutClose <= baseHi) return;
   if(dir == DIR_SUPPLY && legOutClose >= baseLo) return;

   datetime baseTime   = iTime(_Symbol, InpTF, sh + baseLen);  // oldest base candle
   datetime legOutTime = iTime(_Symbol, InpTF, sh);

   // Dedup: one zone per base anchor.
   for(int _k = 0; _k < zonesTotal; _k++)
      if(!zones[_k].dead && zones[_k].baseTime == baseTime) return;

   int idx = -1;
   for(int _k = 0; _k < zonesTotal; _k++)
      if(zones[_k].dead) { idx = _k; break; }
   if(idx < 0 && zonesTotal < MAX_ZONES) idx = zonesTotal++;
   if(idx < 0) return;

   zones[idx].id         = nextId++;
   zones[idx].dir        = dir;
   zones[idx].hi         = baseHi;
   zones[idx].lo         = baseLo;
   zones[idx].baseTime   = baseTime;
   zones[idx].legOutTime = legOutTime;
   zones[idx].dead       = false;
   zones[idx].ageCounter = 0;

   DrawZone(idx);
   if(InpShowLog)
      PrintFormat("%s | base=%d candle(s) | zone=[%.5f,%.5f] | %s",
                  dir == DIR_DEMAND ? "RBR_DEMAND" : "DBD_SUPPLY",
                  baseLen, baseHi, baseLo,
                  TimeToString(baseTime, TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
// Extend boxes, invalidate traded-through zones, expire old ones.
void Maintain(int sh)
{
   datetime t  = iTime (_Symbol, InpTF, sh);
   double   cl = iClose(_Symbol, InpTF, sh);
   for(int i = 0; i < zonesTotal; i++) {
      if(zones[i].dead) continue;
      if(zones[i].legOutTime >= t) continue;
      UpdateZoneBox(i);

      // Traded through → invalid (deleted).
      // Demand dies on a close below the zone; supply on a close above it.
      if(zones[i].dir == DIR_DEMAND && cl < zones[i].lo) {
         if(InpShowLog) PrintFormat("RBR_DEMAND_INVALIDATED (traded through) | zone=[%.5f,%.5f]",
                                    zones[i].hi, zones[i].lo);
         KillZone(i);
         continue;
      }
      if(zones[i].dir == DIR_SUPPLY && cl > zones[i].hi) {
         if(InpShowLog) PrintFormat("DBD_SUPPLY_INVALIDATED (traded through) | zone=[%.5f,%.5f]",
                                    zones[i].hi, zones[i].lo);
         KillZone(i);
         continue;
      }

      zones[i].ageCounter++;
      if(zones[i].ageCounter >= InpExpiryBars) {
         if(InpShowLog) PrintFormat("RBR_DBD_EXPIRED | zone=[%.5f,%.5f]", zones[i].hi, zones[i].lo);
         KillZone(i);
      }
   }
}

//+------------------------------------------------------------------+
void Rebuild()
{
   ObjectsDeleteAll(0, OBJ_PREFIX);
   zonesTotal = 0; nextId = 0;
   int scan = MathMin(InpLookback, iBars(_Symbol, InpTF) - 3);
   if(scan < 3) return;
   for(int sh = scan; sh >= 1; sh--) {
      DetectRbrDbd(sh);
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
      DetectRbrDbd(1);
      Maintain(1);
   }
   return rates_total;
}
`;
}
