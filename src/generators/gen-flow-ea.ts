/**
 * Strategy Flow EA generator — INSTANCE RUNTIME proof-of-feasibility.
 *
 * This is the heart of the "unlimited instances" upgrade: instead of brain
 * booleans (gSetupActive) that can all be true on the same tick, every instance
 * registers a TIMESTAMPED event, and an entry instance only fires when its
 * dependencies happened BEFORE it, in order, direction-aligned, and not expired.
 *
 * The EVENT STORE + the ORDERED GATE are generic (N instances). The per-instance
 * DETECTION here is inlined for the three event types the demo flow needs:
 *   - BOS_CONFIRMED   (direction, H1)
 *   - FVG_RETESTED    (setup, H1)   <- "price pulled back INTO the gap", not "gap exists"
 *   - BOS_CONFIRMED   (entry, M5)
 *
 * Demo flow proven here:  H1 BOS  ->  H1 FVG retest  ->  M5 BOS  ->  enter.
 * Compile in MetaEditor (F7) and backtest; the journal prints a TRADE AUDIT with
 * the ordered proof chain for every entry.
 */

export const FLOW_DEMO_EA_NAME = "FLOW_BOS_FVG_BOS_Demo";

export function generateFlowDemoEA(): string {
  return `//+------------------------------------------------------------------+
//| ${FLOW_DEMO_EA_NAME}.mq5                                          |
//| Strategy Flow runtime proof: timestamped event gate (instances)  |
//|                                                                  |
//| Instance 1 (Direction): BOS @ H1  -> registers BOS_CONFIRMED     |
//| Instance 2 (Setup):     FVG retest @ H1 -> FVG_RETESTED          |
//| Instance 3 (Entry):     BOS @ M5  -> BOS_CONFIRMED               |
//|                                                                  |
//| Gate: time(dir) <= time(setup) < time(entry), same direction,    |
//|       setup not expired. Same-timestamp setup+entry is BLOCKED.  |
//+------------------------------------------------------------------+
#property copyright "EA Builder — Strategy Flow runtime"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>
CTrade trade;

//--- Inputs
input long             InpMagic        = 770120;
input double           InpRiskPct      = 1.0;     // risk per trade (% balance)
input double           InpRewardRisk   = 3.0;     // TP = RR * risk
input int              InpMaxStopPts    = 0;      // 0 = no cap; else skip if SL > this (points)
input ENUM_TIMEFRAMES  InpDirTF        = PERIOD_H1;   // Instance 1 timeframe
input ENUM_TIMEFRAMES  InpSetupTF      = PERIOD_H1;   // Instance 2 timeframe
input ENUM_TIMEFRAMES  InpEntryTF      = PERIOD_M5;   // Instance 3 timeframe
input int              InpBosLookback  = 20;      // swing lookback for BOS (bars)
input int              InpFvgLookback  = 30;      // bars scanned for an H1 FVG
input int              InpSetupExpiryBars = 24;   // setup valid for N entry-TF bars after arming
input int              InpMaxOpenTrades = 1;
input bool             InpAudit        = true;

string InpSymbol;

//==================================================================
//  GENERIC INSTANCE EVENT STORE  (one latest event slot per step)
//==================================================================
#define STEP_DIR    0
#define STEP_SETUP  1
#define STEP_ENTRY  2
#define STEP_COUNT  3

string   gStepName[STEP_COUNT];
bool     gFired[STEP_COUNT];
int      gDir[STEP_COUNT];        // 1 bull, -1 bear
datetime gTime[STEP_COUNT];       // event time (real bar time)
double   gPrice[STEP_COUNT];
double   gSL[STEP_COUNT];
double   gZoneHi[STEP_COUNT];
double   gZoneLo[STEP_COUNT];

datetime gLastTradedEntry = 0;
string   gLastGate = "idle";
int      gTradeCount = 0;

string DirTxt(int d) { return d == 1 ? "BULL" : d == -1 ? "BEAR" : "-"; }

void UpdatePanel()
{
   string s = "FLOW EA (instance runtime)\\n";
   s += "Instance 1 Direction(BOS): " + (gFired[STEP_DIR]   ? DirTxt(gDir[STEP_DIR])   + " @ " + TimeToString(gTime[STEP_DIR],   TIME_DATE|TIME_MINUTES) : "waiting") + "\\n";
   s += "Instance 2 Setup(FVG-retest): " + (gFired[STEP_SETUP] ? DirTxt(gDir[STEP_SETUP]) + " @ " + TimeToString(gTime[STEP_SETUP], TIME_DATE|TIME_MINUTES) : "waiting") + "\\n";
   s += "Instance 3 Entry(BOS): " + (gFired[STEP_ENTRY] ? DirTxt(gDir[STEP_ENTRY]) + " @ " + TimeToString(gTime[STEP_ENTRY], TIME_DATE|TIME_MINUTES) : "watching") + "\\n";
   s += "Last gate: " + gLastGate + "\\n";
   s += "Trades opened: " + IntegerToString(gTradeCount) + "\\n";
   s += "Risk " + DoubleToString(InpRiskPct, 1) + "%  R:R " + DoubleToString(InpRewardRisk, 1) + "x";
   Comment(s);
}

void RegisterEvent(int step, int dir, datetime t, double price, double sl)
{
   gFired[step]  = true;
   gDir[step]    = dir;
   gTime[step]   = t;
   gPrice[step]  = price;
   gSL[step]     = sl;
   if(InpAudit)
      PrintFormat("[EVENT] %s | dir=%d | %s | price=%.5f | sl=%.5f",
                  gStepName[step], dir, TimeToString(t, TIME_DATE|TIME_MINUTES), price, sl);
}

//==================================================================
//  INSTANCE 1 — Direction: BOS @ DirTF  (persistent bias)
//==================================================================
void DetectDirBOS()
{
   int total = iBars(InpSymbol, InpDirTF);
   if(total < InpBosLookback + 3) return;
   double swH = iHigh(InpSymbol, InpDirTF, 2);
   double swL = iLow (InpSymbol, InpDirTF, 2);
   for(int k = 3; k <= InpBosLookback; k++) {
      double h = iHigh(InpSymbol, InpDirTF, k);
      double l = iLow (InpSymbol, InpDirTF, k);
      if(h > swH) swH = h;
      if(l < swL) swL = l;
   }
   double c1 = iClose(InpSymbol, InpDirTF, 1);
   datetime t1 = iTime(InpSymbol, InpDirTF, 1);
   if(c1 > swH && (!gFired[STEP_DIR] || gDir[STEP_DIR] != 1))
      RegisterEvent(STEP_DIR, 1, t1, c1, 0.0);
   else if(c1 < swL && (!gFired[STEP_DIR] || gDir[STEP_DIR] != -1))
      RegisterEvent(STEP_DIR, -1, t1, c1, 0.0);
}

//==================================================================
//  INSTANCE 2 — Setup: FVG RETESTED @ SetupTF (in the bias direction)
//  An FVG must EXIST and price must PULL BACK INTO it (not just exist).
//==================================================================
void DetectSetupFvgRetest()
{
   if(!gFired[STEP_DIR]) return;                 // setup needs a direction first
   int bias = gDir[STEP_DIR];
   int total = iBars(InpSymbol, InpSetupTF);
   if(total < InpFvgLookback + 3) return;

   double barHi = iHigh (InpSymbol, InpSetupTF, 1);
   double barLo = iLow  (InpSymbol, InpSetupTF, 1);
   datetime t1  = iTime (InpSymbol, InpSetupTF, 1);

   // find the most recent FVG in the bias direction, then test if bar 1 entered it
   for(int i = 2; i <= InpFvgLookback; i++)
   {
      if(i + 2 >= total) break;
      double hi_i  = iHigh(InpSymbol, InpSetupTF, i);
      double lo_i  = iLow (InpSymbol, InpSetupTF, i);
      double hi_i2 = iHigh(InpSymbol, InpSetupTF, i + 2);
      double lo_i2 = iLow (InpSymbol, InpSetupTF, i + 2);

      if(bias == 1 && lo_i > hi_i2)              // bullish FVG gap [hi_i2 .. lo_i]
      {
         double zHi = lo_i, zLo = hi_i2;
         if(barLo <= zHi && barHi >= zLo)        // bar 1 pulled back into the gap
         {
            // dedup: only re-arm if this is a newer retest than the stored one
            if(!gFired[STEP_SETUP] || gTime[STEP_SETUP] != t1 || gDir[STEP_SETUP] != 1)
               RegisterEvent(STEP_SETUP, 1, t1, (zHi + zLo) * 0.5, zLo);
            return;
         }
      }
      else if(bias == -1 && hi_i < lo_i2)        // bearish FVG gap [hi_i .. lo_i2]
      {
         double zHi = lo_i2, zLo = hi_i;
         if(barHi >= zLo && barLo <= zHi)        // bar 1 pulled back into the gap
         {
            if(!gFired[STEP_SETUP] || gTime[STEP_SETUP] != t1 || gDir[STEP_SETUP] != -1)
               RegisterEvent(STEP_SETUP, -1, t1, (zHi + zLo) * 0.5, zHi);
            return;
         }
      }
   }
}

//==================================================================
//  INSTANCE 3 — Entry: BOS @ EntryTF  (the trade trigger)
//==================================================================
void DetectEntryBOS()
{
   int total = iBars(InpSymbol, InpEntryTF);
   if(total < InpBosLookback + 3) return;
   double swH = iHigh(InpSymbol, InpEntryTF, 2);
   double swL = iLow (InpSymbol, InpEntryTF, 2);
   for(int k = 3; k <= InpBosLookback; k++) {
      double h = iHigh(InpSymbol, InpEntryTF, k);
      double l = iLow (InpSymbol, InpEntryTF, k);
      if(h > swH) swH = h;
      if(l < swL) swL = l;
   }
   double c1 = iClose(InpSymbol, InpEntryTF, 1);
   datetime t1 = iTime(InpSymbol, InpEntryTF, 1);
   if(c1 > swH)
      RegisterEvent(STEP_ENTRY, 1, t1, c1, swL);   // SL = swing low
   else if(c1 < swL)
      RegisterEvent(STEP_ENTRY, -1, t1, c1, swH);  // SL = swing high
}

//==================================================================
//  THE ORDERED GATE  (generic: deps must precede entry, aligned, fresh)
//==================================================================
double LotsForRisk(double slDistance)
{
   if(slDistance <= 0) return 0.0;
   double bal   = AccountInfoDouble(ACCOUNT_BALANCE);
   double risk  = bal * InpRiskPct / 100.0;
   double tick  = SymbolInfoDouble(InpSymbol, SYMBOL_TRADE_TICK_VALUE);
   double tsize = SymbolInfoDouble(InpSymbol, SYMBOL_TRADE_TICK_SIZE);
   if(tick <= 0 || tsize <= 0) return 0.0;
   double lossPerLot = (slDistance / tsize) * tick;
   if(lossPerLot <= 0) return 0.0;
   double lots = risk / lossPerLot;
   double minL = SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_MIN);
   double stepL= SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_STEP);
   if(stepL > 0) lots = MathFloor(lots / stepL) * stepL;
   if(lots < minL) lots = minL;
   return lots;
}

int OpenPositions()
{
   int n = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      ulong tk = PositionGetTicket(i);
      if(!PositionSelectByTicket(tk)) continue;
      if(PositionGetString(POSITION_SYMBOL) != InpSymbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      n++;
   }
   return n;
}

void EvaluateGate()
{
   // Only act when a fresh entry event fired from the just-closed entry bar.
   if(!gFired[STEP_ENTRY]) return;
   if(gTime[STEP_ENTRY] != iTime(InpSymbol, InpEntryTF, 1)) return;
   if(gLastTradedEntry == gTime[STEP_ENTRY]) return;

   int dir = gDir[STEP_ENTRY];

   if(!gFired[STEP_DIR])  { gLastGate = "BLOCKED: no direction yet"; if(InpAudit) Print("[GATE] " + gLastGate); return; }
   if(!gFired[STEP_SETUP]){ gLastGate = "BLOCKED: no setup yet";     if(InpAudit) Print("[GATE] " + gLastGate); return; }

   // ORDER: direction <= setup < entry   (strict: entry must be AFTER setup)
   if(!(gTime[STEP_DIR] <= gTime[STEP_SETUP]))
   { gLastGate = "BLOCKED: direction not before setup"; if(InpAudit) Print("[GATE] " + gLastGate); return; }
   if(!(gTime[STEP_SETUP] < gTime[STEP_ENTRY]))
   { gLastGate = "BLOCKED: execution not after setup"; if(InpAudit) Print("[GATE] " + gLastGate); return; }

   // DIRECTION aligned across instances
   if(gDir[STEP_DIR] != dir || gDir[STEP_SETUP] != dir)
   { gLastGate = "BLOCKED: direction mismatch"; if(InpAudit) Print("[GATE] " + gLastGate); return; }

   // SETUP freshness (expiry in entry-TF bars)
   int expirySec = InpSetupExpiryBars * PeriodSeconds(InpEntryTF);
   if((int)(gTime[STEP_ENTRY] - gTime[STEP_SETUP]) > expirySec)
   { gLastGate = "BLOCKED: setup expired"; if(InpAudit) Print("[GATE] " + gLastGate); return; }

   if(OpenPositions() >= InpMaxOpenTrades) return;

   // Risk
   double entryPx = (dir == 1) ? SymbolInfoDouble(InpSymbol, SYMBOL_ASK)
                               : SymbolInfoDouble(InpSymbol, SYMBOL_BID);
   double sl = gSL[STEP_ENTRY];
   if(sl <= 0) { if(InpAudit) Print("[GATE] BLOCKED: no SL from entry"); return; }
   double slDist = MathAbs(entryPx - sl);
   double pt = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   if(InpMaxStopPts > 0 && pt > 0 && (slDist / pt) > InpMaxStopPts)
   { if(InpAudit) PrintFormat("[GATE] SKIP: SL %.0f pts > max %d", slDist / pt, InpMaxStopPts); return; }

   double tp = (dir == 1) ? entryPx + InpRewardRisk * slDist
                          : entryPx - InpRewardRisk * slDist;
   double lots = LotsForRisk(slDist);
   if(lots <= 0) { if(InpAudit) Print("[GATE] BLOCKED: lot calc failed"); return; }

   bool ok = (dir == 1) ? trade.Buy(lots, InpSymbol, entryPx, sl, tp)
                        : trade.Sell(lots, InpSymbol, entryPx, sl, tp);
   if(ok)
   {
      gLastTradedEntry = gTime[STEP_ENTRY];
      gTradeCount++;
      gLastGate = "TRADE " + (dir == 1 ? "BUY" : "SELL") + " @ " + TimeToString(gTime[STEP_ENTRY], TIME_DATE|TIME_MINUTES);
      if(InpAudit)
      {
         Print("===== TRADE AUDIT =====");
         PrintFormat("  Instance 1 %s : %s @ %s", gStepName[STEP_DIR],
                     gDir[STEP_DIR] == 1 ? "BULL" : "BEAR",
                     TimeToString(gTime[STEP_DIR], TIME_DATE|TIME_MINUTES));
         PrintFormat("  Instance 2 %s : %s @ %s", gStepName[STEP_SETUP],
                     gDir[STEP_SETUP] == 1 ? "BULL" : "BEAR",
                     TimeToString(gTime[STEP_SETUP], TIME_DATE|TIME_MINUTES));
         PrintFormat("  Instance 3 %s : %s @ %s  (strictly after setup OK)", gStepName[STEP_ENTRY],
                     dir == 1 ? "BULL" : "BEAR",
                     TimeToString(gTime[STEP_ENTRY], TIME_DATE|TIME_MINUTES));
         PrintFormat("  ENTRY %s  lots=%.2f  SL=%.5f  TP=%.5f",
                     dir == 1 ? "BUY" : "SELL", lots, sl, tp);
         Print("=======================");
      }
   }
}

//==================================================================
int OnInit()
{
   InpSymbol = _Symbol;
   trade.SetExpertMagicNumber((ulong)InpMagic);
   gStepName[STEP_DIR]   = "Direction(BOS)";
   gStepName[STEP_SETUP] = "Setup(FVG-retest)";
   gStepName[STEP_ENTRY] = "Entry(BOS)";
   for(int i = 0; i < STEP_COUNT; i++) { gFired[i] = false; gDir[i] = 0; gTime[i] = 0; }
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { Comment(""); }

datetime gLastDirBar = 0, gLastSetupBar = 0, gLastEntryBar = 0;

void OnTick()
{
   datetime dBar = iTime(InpSymbol, InpDirTF, 0);
   if(dBar != gLastDirBar) { gLastDirBar = dBar; DetectDirBOS(); }

   datetime sBar = iTime(InpSymbol, InpSetupTF, 0);
   if(sBar != gLastSetupBar) { gLastSetupBar = sBar; DetectSetupFvgRetest(); }

   datetime eBar = iTime(InpSymbol, InpEntryTF, 0);
   if(eBar != gLastEntryBar) { gLastEntryBar = eBar; DetectEntryBOS(); EvaluateGate(); }

   UpdatePanel();
}
`;
}
