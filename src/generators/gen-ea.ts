/**
 * 4-Brain EA Generator (gen-ea.ts)
 *
 * Assembles a complete, always-compilable MQL5 EA from four brain generators:
 *   Direction Brain  → gBias (persistent BULL/BEAR/NEUTRAL)
 *   Setup Brain      → gSetupActive + gSetupDir + gSetupSLHint
 *   Execution Brain  → gExecSignal + gExecDir + gExecSL
 *   Management Brain → Risk%, R:R, Break-Even (static config, inputs)
 *
 * The OnTick loop runs each brain on its own timeframe bar-open.
 * Trade execution fires when the confluence gate passes.
 */

import type { FourBrainConfig, MQL5CodeGenParams, BrainModuleType } from "@/types/blueprint";
import { genDirectionBrain }      from "./gen-direction-brain";
import { genSetupBrain }          from "./gen-setup-brain";
import { genExecutionBrain }      from "./gen-execution-brain";
import { genFvgInversionSM }      from "./gen-ifvg-state-machine";

/** Collect all unique TFs that need an iFVG state machine instance. */
function collectIfvgTFs(config: FourBrainConfig): Map<string, string> {
  // Map: tf-label (e.g. "H1") → PERIOD constant
  const result = new Map<string, string>();
  const needs = (mods: BrainModuleType[] | undefined) =>
    mods?.includes("fvg_inversion") ?? false;
  const add = (tf: string) => {
    if (!tf) return;
    const u = tf.toUpperCase();
    const c = u === "MN" ? "PERIOD_MN1" : `PERIOD_${u}`;
    result.set(u, c);
  };
  if (needs(config.direction?.modules)) add(config.direction!.timeframe);
  if (needs(config.setup?.modules))     add(config.setup!.timeframe);
  if (needs(config.execution?.modules)) add(config.execution.timeframe);
  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tfConst(tf: string): string {
  const map: Record<string, string> = {
    M1: "PERIOD_M1",  M5: "PERIOD_M5",  M15: "PERIOD_M15", M30: "PERIOD_M30",
    H1: "PERIOD_H1",  H4: "PERIOD_H4",  D1: "PERIOD_D1",   W1: "PERIOD_W1",
    MN: "PERIOD_MN1",
  };
  return map[(tf ?? "H1").toUpperCase()] ?? "PERIOD_H1";
}

// ─── Main generator ───────────────────────────────────────────────────────────

export function generateEA(params: MQL5CodeGenParams): string {
  const { eaName, config, globalSymbol = "EURUSD", globalMagic = 990001 } = params;

  const dirMods  = config.direction?.modules?.join(" + ").toUpperCase() ?? "NONE";
  const dirTF    = config.direction?.timeframe ?? "D1";
  const setupMods = config.setup?.modules?.join(" + ").toUpperCase() ?? "NONE";
  const setupTF  = config.setup?.timeframe ?? "H4";
  const execMods = config.execution?.modules?.join(" + ").toUpperCase() ?? "NONE";
  const execTF   = config.execution?.timeframe ?? "H1";

  const mgmt       = config.management;
  const riskPct    = mgmt?.riskPercent   ?? 1.0;
  const rrRatio    = mgmt?.rewardRisk    ?? 2.0;
  const stopBuf    = mgmt?.stopBuffer    ?? 20;          // in POINTS (not price)
  const beEnabled  = mgmt?.breakEvenEnabled ?? false;
  const beAtR      = mgmt?.breakEvenAtR  ?? 1.0;
  const maxTrades  = mgmt?.maxOpenTrades ?? 1;

  const hasDirBrain   = Boolean(config.direction);
  const hasSetupBrain = Boolean(config.setup);

  // Generate inline iFVG state machine instances for all TFs that need one
  const ifvgTFs  = collectIfvgTFs(config);
  const smCode   = [...ifvgTFs.entries()]
    .map(([tf, TFconst]) => genFvgInversionSM(tf, TFconst, tf, 100))
    .join("\n");

  // Generate brain function bodies from modular generators
  const dirCode   = genDirectionBrain(config.direction);
  const setupCode = genSetupBrain(config.setup);
  const execCode  = genExecutionBrain(config.execution);

  // Build Tick() calls: each iFVG SM must be advanced BEFORE the brain that reads it.
  // Direction brain runs first (HTF), then Setup, then Execution.
  // If Setup/Exec share the same TF, only advance the SM once per bar.
  const dirTFUpper   = (config.direction?.timeframe ?? "").toUpperCase();
  const setupTFUpper = (config.setup?.timeframe ?? "").toUpperCase();
  const execTFUpper  = (config.execution.timeframe).toUpperCase();

  function smTickCall(tf: string): string {
    return ifvgTFs.has(tf) ? `IFVGSM_${tf}_Tick(1);` : "";
  }
  const dirSmTick   = smTickCall(dirTFUpper);
  const setupSmTick = smTickCall(setupTFUpper);
  // Don't tick exec SM twice if it's the same TF as setup
  const execSmTick  = (execTFUpper !== setupTFUpper) ? smTickCall(execTFUpper) : "";

  // Direction gate: if no direction brain, skip bias check
  const dirGate   = hasDirBrain
    ? `if(gBias == 0) { PrintFormat("[GATE] BLOCKED: no bias"); return; }`
    : `// Direction Brain disabled — no bias gate`;

  // Setup gate: if no setup brain, bypass
  const setupGate = hasSetupBrain
    ? `if(!gSetupActive) { PrintFormat("[GATE] BLOCKED: no setup"); return; }`
    : `// Setup Brain disabled — no zone gate`;

  // Break-even management code
  const breakEvenCode = beEnabled ? `
   // Break-Even Management
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL) != InpSymbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic)  continue;
      double openPx = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl     = PositionGetDouble(POSITION_SL);
      double tp     = PositionGetDouble(POSITION_TP);
      if(openPx <= 0 || sl <= 0) continue;
      double initRisk = MathAbs(openPx - sl);
      if(initRisk < SymbolInfoDouble(InpSymbol, SYMBOL_POINT)) continue;
      long   posType  = PositionGetInteger(POSITION_TYPE);
      double bid      = SymbolInfoDouble(InpSymbol, SYMBOL_BID);
      double ask      = SymbolInfoDouble(InpSymbol, SYMBOL_ASK);
      if(posType == POSITION_TYPE_BUY)
      {
         if(sl >= openPx) continue;                                    // already at BE
         if(bid - openPx >= initRisk * InpBEAtR)
            trade.PositionModify(ticket, openPx, tp);
      }
      else
      {
         if(sl <= openPx) continue;
         if(openPx - ask >= initRisk * InpBEAtR)
            trade.PositionModify(ticket, openPx, tp);
      }
   }` : `   // Break-even management disabled`;

  return `//+------------------------------------------------------------------+
//| ${eaName}.mq5
//| Generated by EAbuilder2 — 4-Brain Architecture
//|
//| Direction : ${dirMods} @ ${dirTF}
//| Setup     : ${setupMods} @ ${setupTF}
//| Execution : ${execMods} @ ${execTF}
//| Management: ${riskPct}% risk · ${rrRatio}R TP${beEnabled ? ` · BE@${beAtR}R` : ""}
//+------------------------------------------------------------------+
#property copyright "Generated by EAbuilder2"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>
CTrade trade;

//--- Inputs
input string          InpSymbol     = "${globalSymbol}";    // Trading symbol
input ulong           InpMagic      = ${globalMagic};       // EA magic number
input ENUM_TIMEFRAMES InpDirectionTF = ${tfConst(dirTF)};  // Direction Brain TF
input ENUM_TIMEFRAMES InpSetupTF     = ${tfConst(setupTF)};  // Setup Brain TF
input ENUM_TIMEFRAMES InpExecTF      = ${tfConst(execTF)};   // Execution Brain TF
input double          InpRiskPercent = ${riskPct};           // Risk per trade (% equity)
input double          InpRewardRisk  = ${rrRatio};           // Reward : Risk ratio
input int             InpStopBuffer  = ${stopBuf};           // Stop buffer (points)
input int             InpMaxSpread   = 25;                   // Max spread filter (0=off)
input int             InpMaxTrades   = ${maxTrades};         // Max simultaneous positions
${beEnabled ? `input double InpBEAtR = ${beAtR};  // Move SL to B/E at this R multiple` : ""}

//--- Global brain state (shared across all brains)
int    gBias        = 0;      // Direction Brain: 1=BULL, -1=BEAR, 0=NEUTRAL
bool   gSetupActive = false;  // Setup Brain: true when a valid zone is active
int    gSetupDir    = 0;      // Setup Brain: direction of active zone
double gSetupSLHint = 0.0;    // Setup Brain: zone far edge (SL hint)
bool   gExecSignal  = false;  // Execution Brain: true when entry pattern fires
int    gExecDir     = 0;      // Execution Brain: 1=BUY, -1=SELL
double gExecSL      = 0.0;    // Execution Brain: raw SL level from pattern

static datetime lastDirBar   = 0;
static datetime lastSetupBar = 0;
static datetime lastExecBar  = 0;

//+------------------------------------------------------------------+
//| Core helpers                                                     |
//+------------------------------------------------------------------+
double NormalizeVolume(double vol)
{
   double minL = SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_MIN);
   double maxL = SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_MAX);
   double step = SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_STEP);
   if(step <= 0) step = 0.01;
   vol = MathFloor(vol / step) * step;
   if(vol < minL) vol = minL;
   if(vol > maxL) vol = maxL;
   return NormalizeDouble(vol, 2);
}

double CalcLot(double slPoints)
{
   if(slPoints <= 0) return 0.0;
   double equity   = AccountInfoDouble(ACCOUNT_EQUITY);
   double riskAmt  = equity * (InpRiskPercent / 100.0);
   double tickVal  = SymbolInfoDouble(InpSymbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSz   = SymbolInfoDouble(InpSymbol, SYMBOL_TRADE_TICK_SIZE);
   double pt       = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   if(tickVal <= 0 || tickSz <= 0 || pt <= 0) return 0.0;
   double lossPerLot = (slPoints * pt / tickSz) * tickVal;
   if(lossPerLot <= 0) return 0.0;
   return NormalizeVolume(riskAmt / lossPerLot);
}

bool HasOpenPosition()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(!PositionSelectByTicket(t)) continue;
      if(PositionGetString(POSITION_SYMBOL) == InpSymbol &&
         PositionGetInteger(POSITION_MAGIC)  == InpMagic) return true;
   }
   return false;
}

int CountPositions()
{
   int cnt = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(!PositionSelectByTicket(t)) continue;
      if(PositionGetString(POSITION_SYMBOL) == InpSymbol &&
         PositionGetInteger(POSITION_MAGIC)  == InpMagic) cnt++;
   }
   return cnt;
}

bool SpreadOk()
{
   if(InpMaxSpread <= 0) return true;
   return (int)SymbolInfoInteger(InpSymbol, SYMBOL_SPREAD) <= InpMaxSpread;
}

//+------------------------------------------------------------------+
//| Info panel — corner dashboard showing live brain states         |
//+------------------------------------------------------------------+
void DrawInfoPanel()
{
   string bias_txt   = (gBias > 0) ? "BULL ▲" : (gBias < 0) ? "BEAR ▼" : "NEUTRAL";
   color  bias_clr   = (gBias > 0) ? clrDodgerBlue : (gBias < 0) ? clrOrangeRed : clrGray;
   string setup_txt  = gSetupActive
                       ? (gSetupDir > 0 ? "BULL ACTIVE ✓" : "BEAR ACTIVE ✓")
                       : "waiting...";
   color  setup_clr  = gSetupActive ? clrMediumSeaGreen : clrGray;
   string exec_txt   = gExecSignal
                       ? (gExecDir > 0 ? "BUY SIGNAL ✓" : "SELL SIGNAL ✓")
                       : "watching...";
   color  exec_clr   = gExecSignal ? clrLime : clrGray;

   struct PanelRow { string name; string text; color clr; int y; };
   PanelRow rows[] = {
      { "4B_P0", "═══ 4-Brain EA ═══",          clrGold,      15 },
      { "4B_P1", "DIR : " + bias_txt,            bias_clr,     30 },
      { "4B_P2", "SETUP: " + setup_txt,          setup_clr,    45 },
      { "4B_P3", "EXEC : " + exec_txt,           exec_clr,     60 },
      { "4B_P4", StringFormat("Risk: %.1f%% | R:R %.1fx", InpRiskPercent, InpRewardRisk),
                                                  clrSilver,   75 },
   };

   for(int _i = 0; _i < ArraySize(rows); _i++)
   {
      if(ObjectFind(0, rows[_i].name) < 0)
         ObjectCreate(0, rows[_i].name, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, rows[_i].name, OBJPROP_CORNER,    CORNER_LEFT_UPPER);
      ObjectSetInteger(0, rows[_i].name, OBJPROP_XDISTANCE, 8);
      ObjectSetInteger(0, rows[_i].name, OBJPROP_YDISTANCE, rows[_i].y);
      ObjectSetString (0, rows[_i].name, OBJPROP_TEXT,      rows[_i].text);
      ObjectSetInteger(0, rows[_i].name, OBJPROP_COLOR,     rows[_i].clr);
      ObjectSetInteger(0, rows[_i].name, OBJPROP_FONTSIZE,  9);
      ObjectSetInteger(0, rows[_i].name, OBJPROP_SELECTABLE,false);
   }
}

void DeleteAllChartObjects()
{
   string prefixes[] = { "4B_DIR_", "4B_SETUP_", "4B_EXEC_", "4B_P0", "4B_P1", "4B_P2", "4B_P3", "4B_P4" };
   for(int _p = 0; _p < ArraySize(prefixes); _p++)
   {
      for(int _i = ObjectsTotal(0) - 1; _i >= 0; _i--)
      {
         string _n = ObjectName(0, _i);
         if(StringFind(_n, prefixes[_p]) == 0) ObjectDelete(0, _n);
      }
   }
}

//+------------------------------------------------------------------+
//| iFVG State Machine instances (Phase 3 inline, one per TF)       |
//+------------------------------------------------------------------+
${smCode}
//+------------------------------------------------------------------+
//| Brain implementations (generated from selected modules)         |
//+------------------------------------------------------------------+
${dirCode}
${setupCode}
${execCode}

//+------------------------------------------------------------------+
//| OnInit                                                           |
//+------------------------------------------------------------------+
int OnInit()
{
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetTypeFillingBySymbol(InpSymbol);
   // Initialise all iFVG state machine instances
   ${[...ifvgTFs.keys()].map(tf => `IFVGSM_${tf}_Reset();`).join(" ")}
   PrintFormat("[INIT] ${eaName} loaded");
   PrintFormat("[CONFIG] Direction: ${dirMods} @ ${dirTF}");
   PrintFormat("[CONFIG] Setup    : ${setupMods} @ ${setupTF}");
   PrintFormat("[CONFIG] Execution: ${execMods} @ ${execTF}");
   PrintFormat("[CONFIG] Risk: %.1f%% | R:R %.1f | StopBuf: %d pts",
               InpRiskPercent, InpRewardRisk, InpStopBuffer);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   DeleteAllChartObjects();
   PrintFormat("[DEINIT] ${eaName} removed (reason=%d)", reason);
}

//+------------------------------------------------------------------+
//| OnTick — 4-Brain event loop                                     |
//+------------------------------------------------------------------+
void OnTick()
{
   DrawInfoPanel();  // Update corner panel every tick
${breakEvenCode}

   // ── Direction Brain (${dirTF}) ──────────────────────────────────────────────
   datetime dBar = iTime(InpSymbol, InpDirectionTF, 0);
   if(dBar != lastDirBar)
   {
      lastDirBar = dBar;
      ${dirSmTick}
      Direction_Brain_Execute();
      PrintFormat("[D/${dirTF}] gBias=%d (%s)",
                  gBias, gBias>0 ? "BULL" : gBias<0 ? "BEAR" : "NEUTRAL");
   }

   // ── Setup Brain (${setupTF}) ────────────────────────────────────────────────
   datetime sBar = iTime(InpSymbol, InpSetupTF, 0);
   if(sBar != lastSetupBar)
   {
      lastSetupBar = sBar;
      ${setupSmTick}
      Setup_Brain_Execute();
      PrintFormat("[S/${setupTF}] gSetupActive=%d dir=%d SLhint=%.5f",
                  gSetupActive, gSetupDir, gSetupSLHint);
   }

   // ── Execution Brain (${execTF}) ─────────────────────────────────────────────
   datetime eBar = iTime(InpSymbol, InpExecTF, 0);
   if(eBar != lastExecBar)
   {
      lastExecBar = eBar;
      ${execSmTick}
      Execution_Brain_Execute();
      PrintFormat("[E/${execTF}] gExecSignal=%d dir=%d SL=%.5f",
                  gExecSignal, gExecDir, gExecSL);

      // ── Confluence Gate ──────────────────────────────────────────────────────
      ${dirGate}
      ${setupGate}
      if(!gExecSignal) { PrintFormat("[GATE] BLOCKED: no exec signal"); return; }
      if(!SpreadOk())  { PrintFormat("[GATE] BLOCKED: spread too wide"); return; }
      if(CountPositions() >= InpMaxTrades) { PrintFormat("[GATE] BLOCKED: max trades %d", InpMaxTrades); return; }

      PrintFormat("[GATE] OPEN — bias=%d setup=%d execDir=%d SL=%.5f",
                  gBias, gSetupActive, gExecDir, gExecSL);

      // ── Trade Execution ──────────────────────────────────────────────────────
      double pt      = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
      double ask     = SymbolInfoDouble(InpSymbol, SYMBOL_ASK);
      double bid     = SymbolInfoDouble(InpSymbol, SYMBOL_BID);
      int    digits  = (int)SymbolInfoInteger(InpSymbol, SYMBOL_DIGITS);
      long   stops   = SymbolInfoInteger(InpSymbol, SYMBOL_TRADE_STOPS_LEVEL);
      double buf     = InpStopBuffer * pt;

      if(gExecDir == 1)   // ── BUY ──────────────────────────────────────────
      {
         // SL: raw level from execution brain, pushed further down by buffer
         double sl   = (gExecSL > 0)
                       ? NormalizeDouble(gExecSL - buf, digits)
                       : NormalizeDouble(ask - 100 * pt, digits);  // fallback
         double dist = (ask - sl) / pt;
         if(dist < (double)stops) { PrintFormat("[EXEC] BUY rejected: stops_level=%d dist=%.0f", stops, dist); return; }
         double lot  = CalcLot(dist);
         if(lot <= 0) { PrintFormat("[EXEC] BUY rejected: lot=0"); return; }
         double tp   = NormalizeDouble(ask + dist * InpRewardRisk * pt, digits);
         PrintFormat("[EXEC] BUY lot=%.2f entry=%.5f SL=%.5f TP=%.5f dist=%.0f pts",
                     lot, ask, sl, tp, dist);
         trade.Buy(lot, InpSymbol, ask, sl, tp, StringFormat("4Brain:%s", "${execMods}"));
      }
      else if(gExecDir == -1)  // ── SELL ────────────────────────────────────
      {
         double sl   = (gExecSL > 0)
                       ? NormalizeDouble(gExecSL + buf, digits)
                       : NormalizeDouble(bid + 100 * pt, digits);  // fallback
         double dist = (sl - bid) / pt;
         if(dist < (double)stops) { PrintFormat("[EXEC] SELL rejected: stops_level=%d dist=%.0f", stops, dist); return; }
         double lot  = CalcLot(dist);
         if(lot <= 0) { PrintFormat("[EXEC] SELL rejected: lot=0"); return; }
         double tp   = NormalizeDouble(bid - dist * InpRewardRisk * pt, digits);
         PrintFormat("[EXEC] SELL lot=%.2f entry=%.5f SL=%.5f TP=%.5f dist=%.0f pts",
                     lot, bid, sl, tp, dist);
         trade.Sell(lot, InpSymbol, bid, sl, tp, StringFormat("4Brain:%s", "${execMods}"));
      }
   }
}
`;
}
