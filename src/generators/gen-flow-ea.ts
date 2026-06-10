/**
 * Strategy Flow EA generator — config-driven INSTANCE RUNTIME.
 *
 * Takes a StrategyFlowConfig (an ordered list of instances) and emits an EA where
 * every instance registers a TIMESTAMPED event and an entry instance only fires
 * when its dependencies happened BEFORE it, in order, direction-aligned, and not
 * expired. This is the engine that replaces the loose 4-Brain boolean gate.
 *
 * The event store + ordered gate are generic (N instances). Per-instance DETECTION
 * is dispatched by the instance's event type. Supported so far:
 *   - BOS_CONFIRMED  (module bos)  — direction role = persistent bias; entry role = trade trigger w/ swing SL
 *   - FVG_RETESTED   (module fvg)  — price pulls back INTO a gap in the bias direction
 *
 * `flowEaSupportsAllEvents(flow)` reports whether every step uses a supported
 * event, so the caller can fall back to the legacy assembler for combos not yet
 * covered. Coverage expands module-by-module.
 */

import type { StrategyFlowConfig, StrategyStepConfig } from "../types/blueprint";
import type { StrategyEventType } from "../lib/strategy-events";

export const FLOW_DEMO_EA_NAME = "FLOW_BOS_FVG_BOS_Demo";

/** Event types the flow EA generator can currently emit detection for. */
export const FLOW_EA_SUPPORTED_EVENTS: ReadonlySet<StrategyEventType> = new Set<StrategyEventType>([
  "BOS_CONFIRMED",
  "FVG_RETESTED",
]);

export function flowEaSupportsAllEvents(flow: StrategyFlowConfig): boolean {
  return (flow.steps ?? []).every((s) => FLOW_EA_SUPPORTED_EVENTS.has(s.event));
}

function tfConst(tf: string): string {
  const u = (tf || "H1").toUpperCase();
  return u === "MN" ? "PERIOD_MN1" : `PERIOD_${u}`;
}
function pInt(params: Record<string, unknown> | undefined, key: string, def: number): number {
  const v = params?.[key];
  return typeof v === "number" && isFinite(v) ? Math.trunc(v) : def;
}
function isEntry(role: string): boolean {
  return role === "entry" || role === "confirmation";
}
function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9]/g, "");
}

/** Resolve the index of the instance that supplies a step's direction (bias). */
function biasIndex(step: StrategyStepConfig, steps: StrategyStepConfig[]): number {
  if (step.directionSource?.mode === "from_step" && step.directionSource.stepId) {
    const i = steps.findIndex((s) => s.id === step.directionSource!.stepId);
    if (i >= 0) return i;
  }
  for (const dep of step.dependsOn ?? []) {
    const i = steps.findIndex((s) => s.id === dep.stepId && s.role === "direction");
    if (i >= 0) return i;
  }
  return -1;
}

function depIndices(step: StrategyStepConfig, steps: StrategyStepConfig[]): number[] {
  const out: number[] = [];
  for (const dep of step.dependsOn ?? []) {
    const i = steps.findIndex((s) => s.id === dep.stepId);
    if (i >= 0) out.push(i);
  }
  return out;
}

// ── Per-instance detection emitters ──────────────────────────────────────────
function emitBosDetection(i: number, persistent: boolean): string {
  const reg = persistent
    ? `   if(c1 > swH && (!gFired[${i}] || gDir[${i}] != 1))  RegisterEvent(${i}, 1, t1, c1, 0.0);
   else if(c1 < swL && (!gFired[${i}] || gDir[${i}] != -1)) RegisterEvent(${i}, -1, t1, c1, 0.0);`
    : `   if(c1 > swH)      RegisterEvent(${i}, 1, t1, c1, swL);   // SL = swing low
   else if(c1 < swL) RegisterEvent(${i}, -1, t1, c1, swH);  // SL = swing high`;
  return `void DetectStep_${i}()
{
   int total = iBars(InpSymbol, gTF[${i}]);
   if(total < gLookback[${i}] + 3) return;
   double swH = iHigh(InpSymbol, gTF[${i}], 2);
   double swL = iLow (InpSymbol, gTF[${i}], 2);
   for(int k = 3; k <= gLookback[${i}]; k++) {
      double h = iHigh(InpSymbol, gTF[${i}], k);
      double l = iLow (InpSymbol, gTF[${i}], k);
      if(h > swH) swH = h;
      if(l < swL) swL = l;
   }
   double c1 = iClose(InpSymbol, gTF[${i}], 1);
   datetime t1 = iTime(InpSymbol, gTF[${i}], 1);
${reg}
}`;
}

function emitFvgRetestDetection(i: number, biasIdx: number): string {
  const biasGuard =
    biasIdx >= 0
      ? `   if(!gFired[${biasIdx}]) return;       // setup needs its direction instance first
   int bias = gDir[${biasIdx}];`
      : `   int bias = 0;                          // no direction instance — accept the gap's own side`;
  return `void DetectStep_${i}()
{
${biasGuard}
   int total = iBars(InpSymbol, gTF[${i}]);
   if(total < gLookback[${i}] + 3) return;
   double barHi = iHigh (InpSymbol, gTF[${i}], 1);
   double barLo = iLow  (InpSymbol, gTF[${i}], 1);
   datetime t1  = iTime (InpSymbol, gTF[${i}], 1);
   for(int j = 2; j <= gLookback[${i}]; j++)
   {
      if(j + 2 >= total) break;
      double hi_j  = iHigh(InpSymbol, gTF[${i}], j);
      double lo_j  = iLow (InpSymbol, gTF[${i}], j);
      double hi_j2 = iHigh(InpSymbol, gTF[${i}], j + 2);
      double lo_j2 = iLow (InpSymbol, gTF[${i}], j + 2);
      if((bias == 1 || bias == 0) && lo_j > hi_j2)            // bullish FVG [hi_j2 .. lo_j]
      {
         double zHi = lo_j, zLo = hi_j2;
         if(barLo <= zHi && barHi >= zLo) {
            if(!gFired[${i}] || gTime[${i}] != t1 || gDir[${i}] != 1)
               RegisterEvent(${i}, 1, t1, (zHi + zLo) * 0.5, zLo);
            return;
         }
      }
      else if((bias == -1 || bias == 0) && hi_j < lo_j2)      // bearish FVG [hi_j .. lo_j2]
      {
         double zHi = lo_j2, zLo = hi_j;
         if(barHi >= zLo && barLo <= zHi) {
            if(!gFired[${i}] || gTime[${i}] != t1 || gDir[${i}] != -1)
               RegisterEvent(${i}, -1, t1, (zHi + zLo) * 0.5, zHi);
            return;
         }
      }
   }
}`;
}

function emitDetection(step: StrategyStepConfig, i: number, steps: StrategyStepConfig[]): string {
  if (step.event === "BOS_CONFIRMED") return emitBosDetection(i, step.role === "direction");
  if (step.event === "FVG_RETESTED") return emitFvgRetestDetection(i, biasIndex(step, steps));
  // Unsupported event — emit a no-op so the EA still compiles; flowEaSupportsAllEvents() gates routing.
  return `void DetectStep_${i}() { /* event ${step.event} not yet supported by flow EA */ }`;
}

// ── Gate for an entry instance ───────────────────────────────────────────────
function emitGate(entryIdx: number, step: StrategyStepConfig, steps: StrategyStepConfig[]): string {
  const deps = depIndices(step, steps);
  // setup dep (for expiry/freshness) = the latest non-direction dep, else the only dep
  const setupDep = deps.find((d) => steps[d].role !== "direction");
  const checks = deps
    .map((d) => {
      const nm = sanitize(steps[d].name) || `step${d}`;
      return `   if(!gFired[${d}]) { gLastGate = "BLOCKED: ${nm} not fired"; if(InpAudit) Print("[GATE] " + gLastGate); return; }
   if(!(gTime[${d}] < gTime[${entryIdx}])) { gLastGate = "BLOCKED: ${nm} not before entry"; if(InpAudit) Print("[GATE] " + gLastGate); return; }
   if(gDir[${d}] != dir) { gLastGate = "BLOCKED: direction mismatch"; if(InpAudit) Print("[GATE] " + gLastGate); return; }`;
    })
    .join("\n");
  const expiry =
    setupDep !== undefined
      ? `   if((int)(gTime[${entryIdx}] - gTime[${setupDep}]) > gExpirySec) { gLastGate = "BLOCKED: setup expired"; if(InpAudit) Print("[GATE] " + gLastGate); return; }`
      : "";
  return `void EvaluateEntry_${entryIdx}()
{
   if(!gFired[${entryIdx}]) return;
   if(gTime[${entryIdx}] != iTime(InpSymbol, gTF[${entryIdx}], 1)) return;
   if(gLastTraded[${entryIdx}] == gTime[${entryIdx}]) return;
   int dir = gDir[${entryIdx}];
${checks}
${expiry}
   if(OpenPositions() >= InpMaxOpenTrades) return;
   OpenTrade(${entryIdx}, dir);
}`;
}

// ── Main generator ───────────────────────────────────────────────────────────
export function generateFlowEA(flow: StrategyFlowConfig, eaName = "FLOW_EA"): string {
  const steps = flow.steps ?? [];
  const n = steps.length;
  const mgmt = flow.management;
  const risk = mgmt?.riskPercent ?? 1.0;
  const rr = mgmt?.rewardRisk ?? 3.0;
  const maxStop = mgmt?.maxStopPoints ?? 0;
  const maxOpen = mgmt?.maxOpenTrades ?? 1;
  const entryIdxs = steps.map((s, i) => (isEntry(s.role) ? i : -1)).filter((i) => i >= 0);
  const setupStep = steps.find((s) => s.role === "setup" || s.role === "filter");
  const expiryBars = pInt(setupStep?.params, "expiryBars", 24);

  const tfInit = steps.map((s, i) => `   gTF[${i}] = ${tfConst(s.timeframe)};`).join("\n");
  const lbInit = steps
    .map((s, i) => `   gLookback[${i}] = ${pInt(s.params, s.event === "FVG_RETESTED" ? "fvgLookback" : "lookback", s.event === "FVG_RETESTED" ? 30 : 20)};`)
    .join("\n");
  const nameInit = steps
    .map((s, i) => `   gStepName[${i}] = "${(s.name || s.role).replace(/"/g, "")}";`)
    .join("\n");
  const detections = steps.map((s, i) => emitDetection(s, i, steps)).join("\n\n");
  const gates = entryIdxs.map((i) => emitGate(i, steps[i], steps)).join("\n\n");

  // group steps by TF so OnTick runs each instance once per its bar
  const tfGroups = new Map<string, number[]>();
  steps.forEach((s, i) => {
    const c = tfConst(s.timeframe);
    if (!tfGroups.has(c)) tfGroups.set(c, []);
    tfGroups.get(c)!.push(i);
  });
  const entryTFs = new Set(entryIdxs.map((i) => tfConst(steps[i].timeframe)));
  let tfIdx = 0;
  const onTickBody = [...tfGroups.entries()]
    .map(([tfc, idxs]) => {
      const slot = tfIdx++;
      const dets = idxs.map((i) => `DetectStep_${i}();`).join(" ");
      const gateCall = entryTFs.has(tfc)
        ? " " + entryIdxs.filter((i) => tfConst(steps[i].timeframe) === tfc).map((i) => `EvaluateEntry_${i}();`).join(" ")
        : "";
      return `   { datetime b = iTime(InpSymbol, ${tfc}, 0); if(b != gLastBar[${slot}]) { gLastBar[${slot}] = b; ${dets}${gateCall} } }`;
    })
    .join("\n");
  const tfSlots = tfIdx;

  const panelLines = steps
    .map(
      (s, i) =>
        `   s += "${(s.name || s.role).replace(/"/g, "")}: " + (gFired[${i}] ? DirTxt(gDir[${i}]) + " @ " + TimeToString(gTime[${i}], TIME_DATE|TIME_MINUTES) : "waiting") + "\\n";`,
    )
    .join("\n");

  return `//+------------------------------------------------------------------+
//| ${eaName}.mq5  —  Strategy Flow instance runtime (config-driven)  |
//| ${n} instances; entries gated on ordered, timestamped events.     |
//+------------------------------------------------------------------+
#property copyright "EA Builder — Strategy Flow runtime"
#property version   "1.00"
#property strict
#include <Trade/Trade.mqh>
CTrade trade;

input long   InpMagic        = 770120;
input double InpRiskPct       = ${risk};
input double InpRewardRisk    = ${rr};
input int    InpMaxStopPts    = ${maxStop};
input int    InpMaxOpenTrades = ${maxOpen};
input int    InpSetupExpiryBars = ${expiryBars};
input bool   InpAudit        = true;

string InpSymbol;

#define STEP_COUNT ${n}
string         gStepName[STEP_COUNT];
ENUM_TIMEFRAMES gTF[STEP_COUNT];
int            gLookback[STEP_COUNT];
bool           gFired[STEP_COUNT];
int            gDir[STEP_COUNT];
datetime       gTime[STEP_COUNT];
double         gPrice[STEP_COUNT];
double         gSL[STEP_COUNT];
datetime       gLastTraded[STEP_COUNT];
datetime       gLastBar[${Math.max(tfSlots, 1)}];
int            gExpirySec = 0;
string         gLastGate = "idle";
int            gTradeCount = 0;

string DirTxt(int d) { return d == 1 ? "BULL" : d == -1 ? "BEAR" : "-"; }

void RegisterEvent(int step, int dir, datetime t, double price, double sl)
{
   gFired[step] = true; gDir[step] = dir; gTime[step] = t; gPrice[step] = price; gSL[step] = sl;
   if(InpAudit) PrintFormat("[EVENT] %s | dir=%d | %s | sl=%.5f",
                  gStepName[step], dir, TimeToString(t, TIME_DATE|TIME_MINUTES), sl);
}

int OpenPositions()
{
   int c = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      ulong tk = PositionGetTicket(i);
      if(!PositionSelectByTicket(tk)) continue;
      if(PositionGetString(POSITION_SYMBOL) != InpSymbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      c++;
   }
   return c;
}

double LotsForRisk(double slDistance)
{
   if(slDistance <= 0) return 0.0;
   double risk  = AccountInfoDouble(ACCOUNT_BALANCE) * InpRiskPct / 100.0;
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

void OpenTrade(int entryIdx, int dir)
{
   double entryPx = (dir == 1) ? SymbolInfoDouble(InpSymbol, SYMBOL_ASK)
                               : SymbolInfoDouble(InpSymbol, SYMBOL_BID);
   double sl = gSL[entryIdx];
   if(sl <= 0) { gLastGate = "BLOCKED: no SL"; return; }
   double slDist = MathAbs(entryPx - sl);
   double pt = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   if(InpMaxStopPts > 0 && pt > 0 && (slDist / pt) > InpMaxStopPts)
   { gLastGate = "SKIP: SL too wide"; if(InpAudit) Print("[GATE] " + gLastGate); return; }
   double tp = (dir == 1) ? entryPx + InpRewardRisk * slDist : entryPx - InpRewardRisk * slDist;
   double lots = LotsForRisk(slDist);
   if(lots <= 0) { gLastGate = "BLOCKED: lot calc"; return; }
   bool ok = (dir == 1) ? trade.Buy(lots, InpSymbol, entryPx, sl, tp)
                        : trade.Sell(lots, InpSymbol, entryPx, sl, tp);
   if(ok) {
      gLastTraded[entryIdx] = gTime[entryIdx];
      gTradeCount++;
      gLastGate = "TRADE " + (dir == 1 ? "BUY" : "SELL") + " @ " + TimeToString(gTime[entryIdx], TIME_DATE|TIME_MINUTES);
      if(InpAudit) {
         Print("===== TRADE AUDIT =====");
         for(int s = 0; s < STEP_COUNT; s++)
            if(gFired[s])
               PrintFormat("  %s : %s @ %s", gStepName[s], DirTxt(gDir[s]),
                           TimeToString(gTime[s], TIME_DATE|TIME_MINUTES));
         PrintFormat("  ENTRY %s lots=%.2f SL=%.5f TP=%.5f", dir == 1 ? "BUY" : "SELL", lots, sl, tp);
         Print("=======================");
      }
   }
}

// ── Per-instance detection ────────────────────────────────────────────────────
${detections}

// ── Entry gate(s) ─────────────────────────────────────────────────────────────
${gates}

void UpdatePanel()
{
   string s = "${eaName} (instance runtime)\\n";
${panelLines}
   s += "Last gate: " + gLastGate + "\\n";
   s += "Trades opened: " + IntegerToString(gTradeCount) + "\\n";
   s += "Risk " + DoubleToString(InpRiskPct,1) + "%  R:R " + DoubleToString(InpRewardRisk,1) + "x";
   Comment(s);
}

int OnInit()
{
   InpSymbol = _Symbol;
   trade.SetExpertMagicNumber((ulong)InpMagic);
${tfInit}
${lbInit}
${nameInit}
   for(int i = 0; i < STEP_COUNT; i++) { gFired[i] = false; gDir[i] = 0; gTime[i] = 0; gLastTraded[i] = 0; }
   for(int b = 0; b < ${Math.max(tfSlots, 1)}; b++) gLastBar[b] = 0;
   gExpirySec = InpSetupExpiryBars * PeriodSeconds(${entryIdxs.length ? tfConst(steps[entryIdxs[0]].timeframe) : "PERIOD_M5"});
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { Comment(""); }

void OnTick()
{
${onTickBody}
   UpdatePanel();
}
`;
}

// ── Demo flow (proves the generic generator emits the working EA) ─────────────
function demoFlow(): StrategyFlowConfig {
  return {
    version: 1,
    mode: "advanced_instances",
    source: "user",
    steps: [
      {
        id: "s1",
        name: "Direction BOS H1",
        role: "direction",
        module: "bos",
        timeframe: "H1",
        event: "BOS_CONFIRMED",
        params: { lookback: 20 },
        directionSource: { mode: "own_event" },
      },
      {
        id: "s2",
        name: "Setup FVG retest H1",
        role: "setup",
        module: "fvg",
        timeframe: "H1",
        event: "FVG_RETESTED",
        params: { fvgLookback: 30, expiryBars: 24 },
        dependsOn: [{ stepId: "s1", relation: "after", required: true }],
        directionSource: { mode: "from_step", stepId: "s1" },
      },
      {
        id: "s3",
        name: "Entry BOS M5",
        role: "entry",
        module: "bos",
        timeframe: "M5",
        event: "BOS_CONFIRMED",
        params: { lookback: 20 },
        dependsOn: [{ stepId: "s2", relation: "after", required: true }],
        directionSource: { mode: "own_event" },
        slSource: { mode: "event_sl", bufferPoints: 0 },
      },
    ],
    management: { riskPercent: 1.0, rewardRisk: 3.0, stopBuffer: 0, maxOpenTrades: 1 },
  };
}

export function generateFlowDemoEA(): string {
  return generateFlowEA(demoFlow(), FLOW_DEMO_EA_NAME);
}
