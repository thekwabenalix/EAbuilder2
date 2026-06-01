// ─── Phase 3 Universal State-Module Execution EA ─────────────────────────────
// EAbuilder2
//
// Generates a Phase 3 Expert Advisor that can consume ANY Phase 2 State Module
// via a simplified iCustom() call that passes only (InpTimeframe, InpLookback).
// Display / colour inputs in the state module use their compiled defaults — they
// have no effect on buffer values, so the EA signal logic is unaffected.
//
// All Phase 2 state modules that expose the standard 4-buffer contract are
// compatible:
//   Buffer 0 — BullConfirmBuf  (1.0 at bull CONFIRMED bar)
//   Buffer 1 — BearConfirmBuf  (1.0 at bear CONFIRMED bar)
//   Buffer 2 — BullSLBuf       (price — SL for bull entries)
//   Buffer 3 — BearSLBuf       (price — SL for bear entries)
//
// NOT compatible: BOS_State_Module and CHoCH_State_Module, which expose
// persistent trend buffers (not event-based confirms) and have no SL price.
// Use those in MTF orchestrators as bias-filter steps instead.
//
// Pre-configured instances are exported at the bottom for use in modules.tsx.

export const STATE_MODULE_EA_VERSION = "1.0.0";

export interface Phase3EaConfig {
  /** EA filename without .mq5 */
  eaName: string;
  /** Human-readable description for the MQL5 header block */
  description: string;
  /** Default Phase 2 state module name (no .mq5 extension) */
  defaultModuleName: string;
  /** Default magic number — must be unique per running EA instance */
  magic: number;
  /** Default risk per trade as % of account balance */
  riskPct: number;
  /** Default reward-to-risk ratio */
  rr: number;
  /** Move SL to breakeven when profit ≥ this multiple of initial risk (0 = off) */
  breakevenR: number;
  /** Default max concurrent positions with this magic */
  maxTrades: number;
  /** Default max spread in points before trade is blocked (0 = off) */
  maxSpreadPts: number;
  /** Default max slippage in points */
  slippage: number;
}

// ─── Generator ────────────────────────────────────────────────────────────────

export function generatePhase3Ea(cfg: Phase3EaConfig): string {
  const ver = STATE_MODULE_EA_VERSION;
  return `
//+------------------------------------------------------------------+
//| ${cfg.eaName}.mq5
//| Phase 3 Execution EA — EAbuilder2 v${ver}
//|
//| ${cfg.description}
//|
//| Compatible with ANY Phase 2 State Module that exposes the
//| standard 4-buffer contract:
//|   Buffer 0 — BullConfirmBuf  Buffer 2 — BullSLBuf
//|   Buffer 1 — BearConfirmBuf  Buffer 3 — BearSLBuf
//|
//| SIGNAL (evaluated on first tick after each bar close):
//|   BullConfirmBuf[1] == 1.0 AND BullSLBuf[1] > 0 → BUY at open
//|   BearConfirmBuf[1] == 1.0 AND BearSLBuf[1] > 0 → SELL at open
//|
//| ⚠  Place in MQL5/Experts/
//| ⚠  State module .mq5 must be compiled in MQL5/Indicators/
//+------------------------------------------------------------------+
#property copyright "EAbuilder2 — Phase 3 Execution Module"
#property version   "${ver.replace(".", "").padStart(3, "0").slice(0, 3)}"
#property strict

#include <Trade\\Trade.mqh>
#include <Trade\\PositionInfo.mqh>

// ─── Buffer indices — standard Phase 2 contract ───────────────────
#define BUF_BULL_CONFIRM  0
#define BUF_BEAR_CONFIRM  1
#define BUF_BULL_SL       2
#define BUF_BEAR_SL       3

//=== Inputs — State module =========================================
input string          InpModuleName     = "${cfg.defaultModuleName}"; // State module filename (no .mq5)
input ENUM_TIMEFRAMES InpModuleTF       = PERIOD_CURRENT;             // Timeframe — match state module
input int             InpModuleLookback = 500;                        // Lookback  — match state module

//=== Inputs — Trade direction ======================================
input bool   InpTradeBull  = true;   // Enable bull signals
input bool   InpTradeBear  = true;   // Enable bear signals

//=== Inputs — Risk management ======================================
input int    InpMagic      = ${cfg.magic}; // Magic number (unique per EA instance)
input double InpRiskPct    = ${cfg.riskPct.toFixed(1)};  // Risk per trade (% of account balance)
input double InpRR         = ${cfg.rr.toFixed(1)};        // Reward-to-risk ratio
input double InpBreakevenR = ${cfg.breakevenR.toFixed(1)}; // Breakeven trigger (× initial risk, 0=off)
input int    InpSlippage   = ${cfg.slippage};              // Max entry slippage in points

//=== Inputs — Filters ==============================================
input int    InpMaxTrades    = ${cfg.maxTrades};    // Max concurrent positions (0 = unlimited)
input int    InpMaxSpreadPts = ${cfg.maxSpreadPts}; // Max spread in points    (0 = off)

// ─── Globals ─────────────────────────────────────────────────────
CTrade        trade;
CPositionInfo pos;
int           hState      = INVALID_HANDLE;
datetime      lastBarTime = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpSlippage);
   trade.LogLevel(LOG_LEVEL_ERRORS);

   // Simplified iCustom() — passes only the two universal inputs:
   //   InpTimeframe  (position 0 in every Phase 2 state module)
   //   InpLookback   (position 1 in every Phase 2 state module)
   // All display/colour inputs use the state module's compiled defaults.
   // This works with FVG, OB, Breakout, BB, LiqSweep, IFVG, SNR modules.
   hState = iCustom(_Symbol, InpModuleTF, InpModuleName,
      InpModuleTF,        // InpTimeframe
      InpModuleLookback   // InpLookback
   );

   if(hState == INVALID_HANDLE)
   {
      PrintFormat("${cfg.eaName}: FAILED to load '%s'. "
                  "Ensure the .mq5 is compiled in MQL5/Indicators/.",
                  InpModuleName);
      return(INIT_FAILED);
   }

   PrintFormat("${cfg.eaName} v${ver} ready | module=%s | TF=%s | magic=%d "
               "| risk=%.1f%% | RR=%.1f | be=%.2fR | maxTrades=%d",
      InpModuleName, EnumToString(InpModuleTF), InpMagic,
      InpRiskPct, InpRR, InpBreakevenR, InpMaxTrades);
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   if(hState != INVALID_HANDLE)
   {
      IndicatorRelease(hState);
      hState = INVALID_HANDLE;
   }
}

//+------------------------------------------------------------------+
void OnTick()
{
   // ── Breakeven on every tick ──────────────────────────────────────
   if(InpBreakevenR > 0.0) ManageBreakeven();

   // ── New-bar guard ────────────────────────────────────────────────
   datetime currentBar = iTime(_Symbol, InpModuleTF, 0);
   if(currentBar == lastBarTime) return;
   lastBarTime = currentBar;

   // ── Read state module buffers at bar[1] (last closed bar) ───────
   double bullConf[1], bearConf[1], bullSL[1], bearSL[1];
   if(CopyBuffer(hState, BUF_BULL_CONFIRM, 1, 1, bullConf) < 1) return;
   if(CopyBuffer(hState, BUF_BEAR_CONFIRM, 1, 1, bearConf) < 1) return;
   if(CopyBuffer(hState, BUF_BULL_SL,      1, 1, bullSL)   < 1) return;
   if(CopyBuffer(hState, BUF_BEAR_SL,      1, 1, bearSL)   < 1) return;

   bool hasBull = (InpTradeBull && bullConf[0] == 1.0 && bullSL[0] > 0.0);
   bool hasBear = (InpTradeBear && bearConf[0] == 1.0 && bearSL[0] > 0.0);
   if(!hasBull && !hasBear) return;

   // ── Spread filter ────────────────────────────────────────────────
   if(InpMaxSpreadPts > 0)
   {
      long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
      if(spread > InpMaxSpreadPts)
      {
         PrintFormat("SIGNAL_BLOCKED | reason=spread | spread=%d | max=%d",
                     spread, InpMaxSpreadPts);
         return;
      }
   }

   // ── Max trades filter ────────────────────────────────────────────
   if(InpMaxTrades > 0)
   {
      int open = CountMyPositions();
      if(open >= InpMaxTrades)
      {
         PrintFormat("SIGNAL_BLOCKED | reason=max_trades | open=%d | max=%d",
                     open, InpMaxTrades);
         return;
      }
   }

   if(hasBull) OpenTrade(ORDER_TYPE_BUY,  bullSL[0]);
   if(hasBear) OpenTrade(ORDER_TYPE_SELL, bearSL[0]);
}

//+------------------------------------------------------------------+
bool OpenTrade(ENUM_ORDER_TYPE type, double sl)
{
   bool   isBull = (type == ORDER_TYPE_BUY);
   double entry  = isBull ? SymbolInfoDouble(_Symbol, SYMBOL_ASK)
                           : SymbolInfoDouble(_Symbol, SYMBOL_BID);

   if(isBull && sl >= entry)
   {
      PrintFormat("SIGNAL_BLOCKED | reason=sl_invalid | dir=BUY | entry=%.5f | sl=%.5f",
                  entry, sl);
      return false;
   }
   if(!isBull && sl <= entry)
   {
      PrintFormat("SIGNAL_BLOCKED | reason=sl_invalid | dir=SELL | entry=%.5f | sl=%.5f",
                  entry, sl);
      return false;
   }

   double slDist  = MathAbs(entry - sl);
   double minStop = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   if(slDist < minStop)
   {
      PrintFormat("SIGNAL_BLOCKED | reason=sl_too_close | sl_dist=%.5f | min_stop=%.5f",
                  slDist, minStop);
      return false;
   }

   double tp   = isBull ? entry + slDist * InpRR : entry - slDist * InpRR;
   double lots = CalcLots(slDist);
   if(lots <= 0.0)
   {
      PrintFormat("SIGNAL_BLOCKED | reason=zero_lots | sl_dist=%.5f | risk=%.1f%%",
                  slDist, InpRiskPct);
      return false;
   }

   bool ok = isBull ? trade.Buy (lots, _Symbol, entry, sl, tp, "${cfg.eaName}")
                    : trade.Sell(lots, _Symbol, entry, sl, tp, "${cfg.eaName}");

   if(ok)
      PrintFormat("TRADE_OPENED | dir=%s | entry=%.5f | sl=%.5f | tp=%.5f | lots=%.2f",
                  isBull ? "BUY" : "SELL", entry, sl, tp, lots);
   else
      PrintFormat("TRADE_FAILED | dir=%s | retcode=%d | entry=%.5f | sl=%.5f",
                  isBull ? "BUY" : "SELL", trade.ResultRetcode(), entry, sl);

   return ok;
}

//+------------------------------------------------------------------+
double CalcLots(double slDist)
{
   if(slDist <= 0.0) return 0.0;
   double balance    = AccountInfoDouble(ACCOUNT_BALANCE);
   double riskAmount = balance * InpRiskPct / 100.0;
   double tickVal    = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSz     = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tickSz <= 0.0 || tickVal <= 0.0) return 0.0;
   double valuePerUnit = tickVal / tickSz;
   double lots         = riskAmount / (slDist * valuePerUnit);
   double minLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(lotStep <= 0.0) return 0.0;
   lots = MathFloor(lots / lotStep) * lotStep;
   return MathMax(minLot, MathMin(maxLot, lots));
}

//+------------------------------------------------------------------+
void ManageBreakeven()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!pos.SelectByTicket(ticket)) continue;
      if(pos.Magic()  != (ulong)InpMagic) continue;
      if(pos.Symbol() != _Symbol) continue;

      double openPrice  = pos.PriceOpen();
      double curSL      = pos.StopLoss();
      double curTP      = pos.TakeProfit();
      bool   isBull     = (pos.PositionType() == POSITION_TYPE_BUY);

      if(curSL <= 0.0) continue;
      if( isBull && curSL >= openPrice) continue;
      if(!isBull && curSL <= openPrice) continue;

      double initialRisk = MathAbs(openPrice - curSL);
      if(initialRisk <= 0.0) continue;

      double curPrice = isBull ? SymbolInfoDouble(_Symbol, SYMBOL_BID)
                                : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      double profit   = isBull ? (curPrice - openPrice)
                                : (openPrice - curPrice);

      if(profit < InpBreakevenR * initialRisk) continue;

      if(trade.PositionModify(ticket, openPrice, curTP))
         PrintFormat("BREAKEVEN_SET | ticket=%I64u | dir=%s | entry=%.5f",
                     ticket, isBull ? "BUY" : "SELL", openPrice);
      else
         PrintFormat("BREAKEVEN_FAILED | ticket=%I64u | retcode=%d",
                     ticket, trade.ResultRetcode());
   }
}

//+------------------------------------------------------------------+
int CountMyPositions()
{
   int cnt = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol)  continue;
      cnt++;
   }
   return cnt;
}
`.trim();
}

// ─── Pre-configured EA instances ─────────────────────────────────────────────

export const OB_EA_CONFIG: Phase3EaConfig = {
  eaName: "OB_Execution_EA",
  description: "Reads confirmed Order Block signals from OB_State_Module via iCustom().",
  defaultModuleName: "OB_State_Module",
  magic: 20250602,
  riskPct: 1.0,
  rr: 2.0,
  breakevenR: 0.5,
  maxTrades: 1,
  maxSpreadPts: 20,
  slippage: 3,
};

export const BREAKOUT_EA_CONFIG: Phase3EaConfig = {
  eaName: "Breakout_Execution_EA",
  description: "Reads confirmed RBS/SBR signals from Breakout_State_Module via iCustom().",
  defaultModuleName: "Breakout_State_Module",
  magic: 20250603,
  riskPct: 1.0,
  rr: 2.0,
  breakevenR: 0.5,
  maxTrades: 1,
  maxSpreadPts: 20,
  slippage: 3,
};

export const BB_EA_CONFIG: Phase3EaConfig = {
  eaName: "BB_Execution_EA",
  description: "Reads confirmed Breaker Block signals from BB_State_Module via iCustom().",
  defaultModuleName: "BB_State_Module",
  magic: 20250604,
  riskPct: 1.0,
  rr: 2.0,
  breakevenR: 0.5,
  maxTrades: 1,
  maxSpreadPts: 20,
  slippage: 3,
};

export const LIQSWEEP_EA_CONFIG: Phase3EaConfig = {
  eaName: "LiqSweep_Execution_EA",
  description: "Reads confirmed liquidity sweep signals from LiqSweep_State_Module via iCustom().",
  defaultModuleName: "LiqSweep_State_Module",
  magic: 20250605,
  riskPct: 1.0,
  rr: 2.0,
  breakevenR: 0.5,
  maxTrades: 2,
  maxSpreadPts: 20,
  slippage: 3,
};

export const IFVG_EA_CONFIG: Phase3EaConfig = {
  eaName: "FVG_Inversion_Execution_EA",
  description:
    "Reads confirmed Inversion FVG signals from FVG_Inversion_State_Module via iCustom().",
  defaultModuleName: "FVG_Inversion_State_Module",
  magic: 20250606,
  riskPct: 1.0,
  rr: 2.0,
  breakevenR: 0.5,
  maxTrades: 1,
  maxSpreadPts: 20,
  slippage: 3,
};

export const CLASSIC_SNR_EA_CONFIG: Phase3EaConfig = {
  eaName: "Classic_SNR_Execution_EA",
  description:
    "Reads confirmed Classic SNR level signals from Classic_SNR_State_Module via iCustom().",
  defaultModuleName: "Classic_SNR_State_Module",
  magic: 20250607,
  riskPct: 1.0,
  rr: 2.0,
  breakevenR: 0.5,
  maxTrades: 2,
  maxSpreadPts: 20,
  slippage: 3,
};

export const GAP_SNR_EA_CONFIG: Phase3EaConfig = {
  eaName: "Gap_SNR_Execution_EA",
  description: "Reads confirmed Gap SNR level signals from Gap_SNR_State_Module via iCustom().",
  defaultModuleName: "Gap_SNR_State_Module",
  magic: 20250608,
  riskPct: 1.0,
  rr: 2.0,
  breakevenR: 0.5,
  maxTrades: 2,
  maxSpreadPts: 20,
  slippage: 3,
};
