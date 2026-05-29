/**
 * Phase 3 Execution Modules — FVG Execution EA
 *
 * FVG_Execution_EA v1.0.0
 * ─────────────────────────────────────────────
 * Reads signals from FVG_State_Module v1.1.0+ via iCustom().
 * NO FVG detection or state logic inside this EA.
 *
 * SIGNAL LOGIC (evaluated on every new bar close):
 *   BullConfirmBuf[1] == 1.0  AND  BullSLBuf[1] > 0  →  BUY  at new bar open (Ask)
 *   BearConfirmBuf[1] == 1.0  AND  BearSLBuf[1] > 0  →  SELL at new bar open (Bid)
 *
 * STATE MODULE BUFFERS CONSUMED (FVG_State_Module v1.1.0):
 *   0  BullConfirmBuf  — 1.0 when a bull FVG zone entered CONFIRMED state
 *   1  BearConfirmBuf  — 1.0 when a bear FVG zone entered CONFIRMED state
 *   2  BullSLBuf       — retestLow  at that bar (SL price for buy entry)
 *   3  BearSLBuf       — retestHigh at that bar (SL price for sell entry)
 *
 * TRADE SETUP:
 *   Entry : market order at Ask (buy) / Bid (sell)
 *   SL    : retestLow (buy) / retestHigh (sell) — from state module buffer
 *   TP    : Entry ± SL_distance × InpRR
 *   Lots  : (balance × InpRiskPct / 100) / (SL_distance × pip_value_per_lot)
 *
 * BREAKEVEN:
 *   On every tick, if profit ≥ InpBreakevenR × initial_risk → move SL to entry
 *
 * TRADE BLOCKED WHEN:
 *   · Confirmation buffer ≠ 1.0 or SL buffer = 0
 *   · SL is on the wrong side of entry (invalid signal)
 *   · SL distance < broker minimum stop level
 *   · Current spread > InpMaxSpreadPts
 *   · Open positions with this magic ≥ InpMaxTrades
 *
 * ⚠  PLACE FILE IN: MetaTrader 5 / MQL5 / Experts /
 *    (not Indicators — this is an Expert Advisor)
 *
 * DEPENDENCY: FVG_State_Module.mq5 must be compiled in MQL5/Indicators/
 *
 * JOURNAL EVENTS:
 *   TRADE_OPENED | TRADE_FAILED | BREAKEVEN_SET | BREAKEVEN_FAILED
 *   SIGNAL_BLOCKED (reason: spread / max_trades / sl_invalid / zero_lots / sl_too_close)
 */

export const FVG_EXECUTION_EA_VERSION = "1.0.0";
export const FVG_EXECUTION_EA_MODULE  = "FVG_Execution_EA";

export function generateFvgExecutionEa(): string {
  return `//+------------------------------------------------------------------+
//| FVG_Execution_EA.mq5                                          |
//| Phase 3: FVG Execution EA v${FVG_EXECUTION_EA_VERSION}                      |
//|                                                                  |
//| Reads signals from FVG_State_Module v1.1.0+ via iCustom().    |
//| NO FVG detection or state logic inside this file.             |
//|                                                                  |
//| Bull: BullConfirmBuf[1]==1.0 + BullSLBuf[1]>0 → BUY at open  |
//| Bear: BearConfirmBuf[1]==1.0 + BearSLBuf[1]>0 → SELL at open |
//|                                                                  |
//| ⚠  Place in MQL5/Experts/ — this is an Expert Advisor.        |
//| ⚠  FVG_State_Module.mq5 must be compiled in MQL5/Indicators/  |
//+------------------------------------------------------------------+
#property copyright "EA Builder — Phase 3 Execution Module"
#property version   "1.00"
#property strict

#include <Trade\\Trade.mqh>
#include <Trade\\PositionInfo.mqh>

// ── State module buffer indices (must match FVG_State_Module) ─────
#define BUF_BULL_CONFIRM  0
#define BUF_BEAR_CONFIRM  1
#define BUF_BULL_SL       2
#define BUF_BEAR_SL       3

//=== Inputs — State module link ====================================
input string          InpModuleName     = "FVG_State_Module"; // State module filename (no .mq5)
input ENUM_TIMEFRAMES InpModuleTF       = PERIOD_CURRENT;     // Timeframe — MUST match state module
input int             InpModuleLookback = 500;                // Lookback  — MUST match state module
input bool            InpModuleShowBull = true;               // State module: track bull FVGs
input bool            InpModuleShowBear = true;               // State module: track bear FVGs
input int             InpModuleExpiry   = 100;                // State module: expiry bars

//=== Inputs — Execution ============================================
input int    InpMagic      = 20250528; // Magic number (unique per EA instance)
input bool   InpTradeBull  = true;     // Enable bullish FVG signals
input bool   InpTradeBear  = true;     // Enable bearish FVG signals
input int    InpSlippage   = 3;        // Max entry slippage in points

//=== Inputs — Risk management ======================================
input double InpRiskPct    = 1.0;  // Risk per trade (% of account balance)
input double InpRR         = 2.0;  // Risk:Reward ratio  (TP = entry ± SL_dist × RR)
input double InpBreakevenR = 0.5;  // Move SL to entry when profit ≥ X × risk  (0 = off)

//=== Inputs — Filters ==============================================
input int    InpMaxTrades    = 2;  // Max concurrent positions with this magic  (0 = unlimited)
input int    InpMaxSpreadPts = 20; // Max spread in points to allow entry        (0 = off)

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

   //--- Load FVG_State_Module via iCustom ---------------------------
   // Inputs are passed in declaration order from FVG_State_Module.mq5.
   // Colour / display inputs are hard-coded to defaults; they do not
   // affect buffer data. InpShowLog set false — EA logs its own events.
   //
   //  #  Parameter              Type             Value
   //  1  InpTF                  ENUM_TIMEFRAMES  InpModuleTF
   //  2  InpLookback            int              InpModuleLookback
   //  3  InpShowBull            bool             InpModuleShowBull
   //  4  InpShowBear            bool             InpModuleShowBear
   //  5  InpExpiryBars          int              InpModuleExpiry
   //  6  InpRemoveTerminal      bool             true
   //  7  InpMaxZones            int              50
   //  8  InpBullColor           color            clrForestGreen
   //  9  InpBearColor           color            clrCrimson
   // 10  InpRetestColor         color            clrGold
   // 11  InpConfirmBull         color            clrLimeGreen
   // 12  InpConfirmBear         color            clrOrangeRed
   // 13  InpMitColor            color            clrSilver
   // 14  InpInvalidColor        color            clrDimGray
   // 15  InpActiveOpacity       int              70
   // 16  InpFadeOpacity         int              25
   // 17  InpShowLog             bool             false
   hState = iCustom(_Symbol, InpModuleTF, InpModuleName,
      InpModuleTF,        // 1  InpTF
      InpModuleLookback,  // 2  InpLookback
      InpModuleShowBull,  // 3  InpShowBull
      InpModuleShowBear,  // 4  InpShowBear
      InpModuleExpiry,    // 5  InpExpiryBars
      true,               // 6  InpRemoveTerminal
      50,                 // 7  InpMaxZones
      clrForestGreen,     // 8  InpBullColor
      clrCrimson,         // 9  InpBearColor
      clrGold,            // 10 InpRetestColor
      clrLimeGreen,       // 11 InpConfirmBull
      clrOrangeRed,       // 12 InpConfirmBear
      clrSilver,          // 13 InpMitColor
      clrDimGray,         // 14 InpInvalidColor
      70,                 // 15 InpActiveOpacity
      25,                 // 16 InpFadeOpacity
      false               // 17 InpShowLog
   );

   if(hState == INVALID_HANDLE)
   {
      PrintFormat("FVG_Execution_EA: FAILED to load '%s'. "
                  "Ensure FVG_State_Module.mq5 is compiled in MQL5/Indicators/.",
                  InpModuleName);
      return INIT_FAILED;
   }

   PrintFormat("FVG_Execution_EA v1.0.0 ready | module=%s | TF=%s | magic=%d "
               "| risk=%.1f%% | RR=%.1f | be_trigger=%.2fR | max_trades=%d",
      InpModuleName, EnumToString(InpModuleTF), InpMagic,
      InpRiskPct, InpRR, InpBreakevenR, InpMaxTrades);
   return INIT_SUCCEEDED;
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
   // ── Breakeven management on every tick ──────────────────────────
   if(InpBreakevenR > 0.0) ManageBreakeven();

   // ── New bar guard — act only on the first tick after bar close ──
   datetime currentBar = iTime(_Symbol, InpModuleTF, 0);
   if(currentBar == lastBarTime) return;
   lastBarTime = currentBar;

   // ── Read state module buffers at bar[1] (last fully closed bar) ─
   double bullConf[1], bearConf[1], bullSL[1], bearSL[1];
   if(CopyBuffer(hState, BUF_BULL_CONFIRM, 1, 1, bullConf) < 1) return;
   if(CopyBuffer(hState, BUF_BEAR_CONFIRM, 1, 1, bearConf) < 1) return;
   if(CopyBuffer(hState, BUF_BULL_SL,      1, 1, bullSL)   < 1) return;
   if(CopyBuffer(hState, BUF_BEAR_SL,      1, 1, bearSL)   < 1) return;

   // Signal valid only when both confirmation AND SL buffer are set
   bool hasBull = (InpTradeBull && bullConf[0] == 1.0 && bullSL[0] > 0.0);
   bool hasBear = (InpTradeBear && bearConf[0] == 1.0 && bearSL[0] > 0.0);
   if(!hasBull && !hasBear) return;

   // ── Spread filter ────────────────────────────────────────────────
   if(InpMaxSpreadPts > 0)
   {
      long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
      if(spread > InpMaxSpreadPts)
      {
         PrintFormat("SIGNAL_BLOCKED | reason=spread | spread=%d pts | max=%d pts",
            spread, InpMaxSpreadPts);
         return;
      }
   }

   // ── Max open trades filter ───────────────────────────────────────
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

   // ── Execute signals ──────────────────────────────────────────────
   if(hasBull) OpenTrade(ORDER_TYPE_BUY,  bullSL[0]);
   if(hasBear) OpenTrade(ORDER_TYPE_SELL, bearSL[0]);
}

//+------------------------------------------------------------------+
//| Open a market order. SL comes from the state module buffer.    |
//| TP = entry ± SL_distance × InpRR.                              |
//| Lots derived from risk% of balance.                            |
//+------------------------------------------------------------------+
bool OpenTrade(ENUM_ORDER_TYPE type, double sl)
{
   bool   isBull = (type == ORDER_TYPE_BUY);
   double entry  = isBull ? SymbolInfoDouble(_Symbol, SYMBOL_ASK)
                           : SymbolInfoDouble(_Symbol, SYMBOL_BID);

   // Validate: SL must be on the correct side of entry
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

   // Validate: SL distance must exceed broker minimum stop level
   double slDist  = MathAbs(entry - sl);
   double minStop = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   if(slDist < minStop)
   {
      PrintFormat("SIGNAL_BLOCKED | reason=sl_too_close | sl_dist=%.5f | min_stop=%.5f",
         slDist, minStop);
      return false;
   }

   // TP: entry ± SL_distance × RR
   double tp   = isBull ? entry + slDist * InpRR
                        : entry - slDist * InpRR;

   // Lot size from risk%
   double lots = CalcLots(slDist);
   if(lots <= 0.0)
   {
      PrintFormat("SIGNAL_BLOCKED | reason=zero_lots | sl_dist=%.5f | risk=%.1f%%",
         slDist, InpRiskPct);
      return false;
   }

   bool ok = isBull
           ? trade.Buy (lots, _Symbol, entry, sl, tp, "FVG-C Buy")
           : trade.Sell(lots, _Symbol, entry, sl, tp, "FVG-C Sell");

   if(ok)
      PrintFormat("TRADE_OPENED | dir=%s | entry=%.5f | sl=%.5f | tp=%.5f "
                  "| lots=%.2f | risk=%.2f %s",
         isBull ? "BUY" : "SELL", entry, sl, tp, lots,
         AccountInfoDouble(ACCOUNT_BALANCE) * InpRiskPct / 100.0,
         AccountInfoString(ACCOUNT_CURRENCY));
   else
      PrintFormat("TRADE_FAILED | dir=%s | retcode=%d | entry=%.5f | sl=%.5f",
         isBull ? "BUY" : "SELL", trade.ResultRetcode(), entry, sl);

   return ok;
}

//+------------------------------------------------------------------+
//| Calculate lot size from risk% of account balance               |
//+------------------------------------------------------------------+
double CalcLots(double slDist)
{
   if(slDist <= 0.0) return 0.0;

   double balance    = AccountInfoDouble(ACCOUNT_BALANCE);
   double riskAmount = balance * InpRiskPct / 100.0;
   double tickVal    = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSz     = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tickSz <= 0.0 || tickVal <= 0.0) return 0.0;

   // Money value of a 1.0 price-unit move per 1 standard lot
   double valuePerUnit = tickVal / tickSz;
   double lots         = riskAmount / (slDist * valuePerUnit);

   double minLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(lotStep <= 0.0) return 0.0;

   // Floor to nearest lot step, then clamp to broker limits
   lots = MathFloor(lots / lotStep) * lotStep;
   return MathMax(minLot, MathMin(maxLot, lots));
}

//+------------------------------------------------------------------+
//| Move SL to breakeven when floating profit ≥ InpBreakevenR × R  |
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

      double openPrice = pos.PriceOpen();
      double curSL     = pos.StopLoss();
      double curTP     = pos.TakeProfit();
      bool   isBull    = (pos.PositionType() == POSITION_TYPE_BUY);

      if(curSL <= 0.0) continue;

      // Already at breakeven or better — skip
      if( isBull && curSL >= openPrice) continue;
      if(!isBull && curSL <= openPrice) continue;

      double initialRisk = MathAbs(openPrice - curSL);
      if(initialRisk <= 0.0) continue;

      // Current floating profit in price units
      double curPrice = isBull ? SymbolInfoDouble(_Symbol, SYMBOL_BID)
                                : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      double profit   = isBull ? (curPrice - openPrice)
                                : (openPrice - curPrice);

      if(profit < InpBreakevenR * initialRisk) continue;

      // Move SL to entry price
      if(trade.PositionModify(ticket, openPrice, curTP))
         PrintFormat("BREAKEVEN_SET | ticket=%I64u | dir=%s | entry=%.5f | profit_at_trigger=%.5f",
            ticket, isBull ? "BUY" : "SELL", openPrice, profit);
      else
         PrintFormat("BREAKEVEN_FAILED | ticket=%I64u | retcode=%d",
            ticket, trade.ResultRetcode());
   }
}

//+------------------------------------------------------------------+
//| Count open positions belonging to this EA on this symbol       |
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
`;
}
