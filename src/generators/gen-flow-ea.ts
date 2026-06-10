/**
 * Strategy Flow EA generator — config-driven INSTANCE RUNTIME over the VERIFIED SMs.
 *
 * Each instance registers a TIMESTAMPED event; an entry instance fires only when
 * its dependencies happened BEFORE it, in order, direction-aligned, not expired.
 * Per-instance detection EMBEDS the module's existing verified state machine and
 * registers events from its real query functions — so the engine covers the whole
 * module library, not a hand-coded strategy.
 *
 * Covered modules (profile table below): ema, bos, choch, fvg, fvg_inversion, order_block.
 * Adding a module = adding one profile entry. flowSupportsModuleRole() lets the
 * caller fall back to the legacy assembler for anything not covered yet.
 */

import type { StrategyFlowConfig, StrategyStepConfig, FourBrainConfig } from "../types/blueprint";
import { genBosSM, type BosSmMode } from "./gen-bos-sm";
import { genEmaSM } from "./gen-ema-sm";
import { genFvgSM } from "./gen-fvg-sm";
import { genFvgInversionSM } from "./gen-ifvg-state-machine";
import { genObSM } from "./gen-ob-sm";
import { genBreakoutSM } from "./gen-breakout-sm";
import { genGapSnrSM } from "./gen-gap-snr-sm";
import { genLiqSweepSM } from "./gen-liqsweep-sm";
import { genMissSM } from "./gen-miss-sm";
import { genObFvgSM } from "./gen-obfvg-sm";
import { genRejectionSM } from "./gen-rejection-sm";
import { genRsiHdSM } from "./gen-rsi-hd-sm";
import { genSnrSM } from "./gen-snr-sm";
import { genEgSM } from "./gen-eg-sm";

export const FLOW_DEMO_EA_NAME = "FLOW_BOS_FVG_BOS_Demo";

type Params = Record<string, unknown>;
function pInt(p: Params | undefined, k: string, d: number): number {
  const v = p?.[k];
  return typeof v === "number" && isFinite(v) ? Math.trunc(v) : d;
}
function tfConst(tf: string): string {
  const u = (tf || "H1").toUpperCase();
  return u === "MN" ? "PERIOD_MN1" : `PERIOD_${u}`;
}
function isEntry(role: string): boolean {
  return role === "entry" || role === "confirmation";
}

// ── Module profiles: embed the verified SM + register from its real queries ──────
// family:
//   "zone" — uniform verified API (BullJustConfirmed/BearJustConfirmed + ConfirmSL,
//            optional HasActiveBull/Bear). Serves setup (active or fired) + entry.
//   "bias_break" — BOS/CHoCH: Trend() bias + BullJustBroke/BearJustBroke (swing SL).
//   "ema" — EMA: Bias() / SetupActive+ActiveDir / JustConfirmed+ConfirmDir+ConfirmSL.
interface SmProfile {
  prefix: string;
  emitSM: (tf: string, p: Params) => string; // tf is uppercase id
  tickArg: (p: Params) => string;
  family: "zone" | "bias_break" | "ema";
  hasActive?: boolean; // zone family: HasActiveBull/Bear exists (setup via active zone)
}
const SM_PROFILES: Record<string, SmProfile> = {
  ema: {
    prefix: "EMASM",
    emitSM: (tf, p) =>
      genEmaSM(tf, tfConst(tf), tf, pInt(p, "fastPeriod", 12), pInt(p, "slowPeriod", 48)),
    tickArg: () => "0",
    family: "ema",
  },
  bos: {
    prefix: "BOSSM",
    emitSM: (tf, p) =>
      genBosSM(tf, tfConst(tf), tf, "bos" as BosSmMode, pInt(p, "swingLen", 5), pInt(p, "lookback", 20)),
    tickArg: (p) => `${pInt(p, "lookback", 20)}`,
    family: "bias_break",
  },
  choch: {
    prefix: "BOSSM",
    emitSM: (tf, p) =>
      genBosSM(tf, tfConst(tf), tf, "choch" as BosSmMode, pInt(p, "swingLen", 5), pInt(p, "lookback", 20)),
    tickArg: (p) => `${pInt(p, "lookback", 20)}`,
    family: "bias_break",
  },
  fvg: {
    prefix: "FVGSM",
    emitSM: (tf, p) => genFvgSM(tf, tfConst(tf), tf, pInt(p, "expiryBars", 100)),
    tickArg: (p) => `${pInt(p, "fvgLookback", 50)}`,
    family: "zone",
    hasActive: true,
  },
  fvg_inversion: {
    prefix: "IFVGSM",
    emitSM: (tf, p) => genFvgInversionSM(tf, tfConst(tf), tf, pInt(p, "expiryBars", 100)),
    tickArg: () => "1",
    family: "zone",
    hasActive: true,
  },
  order_block: {
    prefix: "OBSM",
    emitSM: (tf, p) =>
      genObSM(tf, tfConst(tf), tf, 0.6, pInt(p, "scanBack", 5), pInt(p, "expiryBars", 100)),
    tickArg: () => "50",
    family: "zone",
    hasActive: true,
  },
  ob_fvg: {
    prefix: "OBFVGSM",
    emitSM: (tf, p) => genObFvgSM(tf, tfConst(tf), tf, pInt(p, "expiryBars", 250)),
    tickArg: () => "50",
    family: "zone",
    hasActive: true,
  },
  engulfing: {
    prefix: "EGSM",
    emitSM: (tf, p) => genEgSM(tf, tfConst(tf), tf, pInt(p, "scanBack", 3), pInt(p, "expiryBars", 100)),
    tickArg: () => "50",
    family: "zone",
    hasActive: true,
  },
  snr: {
    prefix: "SNRSM",
    emitSM: (tf, p) => genSnrSM(tf, tfConst(tf), tf, pInt(p, "lookback", 20), pInt(p, "expiryBars", 100)),
    tickArg: () => "50",
    family: "zone",
    hasActive: true,
  },
  gap_snr: {
    prefix: "GSNRSM",
    emitSM: (tf, p) => genGapSnrSM(tf, tfConst(tf), tf, pInt(p, "lookback", 20), pInt(p, "expiryBars", 100)),
    tickArg: () => "50",
    family: "zone",
    hasActive: true,
  },
  breakout: {
    prefix: "BRKSM",
    emitSM: (tf, p) => genBreakoutSM(tf, tfConst(tf), tf, pInt(p, "lookback", 20), pInt(p, "expiryBars", 100)),
    tickArg: () => "50",
    family: "zone",
    hasActive: true,
  },
  rejection: {
    prefix: "REJSM",
    emitSM: (tf, p) => genRejectionSM(tf, tfConst(tf), tf, pInt(p, "lookback", 30), 0.5, pInt(p, "expiryBars", 150)),
    tickArg: () => "50",
    family: "zone",
    hasActive: true,
  },
  miss: {
    prefix: "MISSSM",
    emitSM: (tf, p) =>
      genMissSM(tf, tfConst(tf), tf, pInt(p, "lookback", 40), pInt(p, "swingLen", 3), pInt(p, "nearPoints", 50), pInt(p, "expiryBars", 200)),
    tickArg: () => "50",
    family: "zone",
    hasActive: true,
  },
  rsi_hd: {
    prefix: "RSIHDSM",
    emitSM: (tf, p) =>
      genRsiHdSM(tf, tfConst(tf), tf, pInt(p, "rsiPeriod", 14), pInt(p, "pivotLeft", 3), pInt(p, "pivotRight", 3), pInt(p, "minBars", 5), pInt(p, "maxBars", 50), pInt(p, "expiryBars", 60)),
    tickArg: () => "50",
    family: "zone",
    hasActive: true,
  },
  liqsweep: {
    prefix: "LSSM",
    emitSM: (tf, p) => genLiqSweepSM(tf, tfConst(tf), tf, pInt(p, "swingLen", 3), pInt(p, "lookback", 20)),
    tickArg: () => "50",
    family: "zone",
    hasActive: false, // no HasActive — setup arms on the fired sweep event
  },
};

// Indicator-handle helper the EMA SM depends on (B4_MA / B4_MAval), included only
// when an EMA instance is present.
const B4_MA_HELPER = `
int            B4_indHandles[];
string         B4_indKey[];
ENUM_TIMEFRAMES B4_indTf[];
int            B4_indPeriod[];
int            B4_indMethod[];
int            B4_indCount = 0;

int B4_RegisterHandle(string key, int handle, int subWindow)
{
   if(handle == INVALID_HANDLE) return INVALID_HANDLE;
   for(int _i = 0; _i < B4_indCount; _i++)
      if(B4_indKey[_i] == key || B4_indHandles[_i] == handle) return B4_indHandles[_i];
   ChartIndicatorAdd(0, subWindow, handle);
   int n = B4_indCount + 1;
   ArrayResize(B4_indHandles, n); ArrayResize(B4_indKey, n); ArrayResize(B4_indTf, n);
   ArrayResize(B4_indPeriod, n);  ArrayResize(B4_indMethod, n);
   B4_indHandles[B4_indCount] = handle; B4_indKey[B4_indCount] = key;
   B4_indTf[B4_indCount] = PERIOD_CURRENT; B4_indPeriod[B4_indCount] = 0; B4_indMethod[B4_indCount] = 0;
   B4_indCount++;
   return handle;
}

int B4_MA(ENUM_TIMEFRAMES tf, int period, ENUM_MA_METHOD method)
{
   string key = StringFormat("MA|%d|%d|%d", (int)tf, period, (int)method);
   for(int _i = 0; _i < B4_indCount; _i++)
      if(B4_indKey[_i] == key || (B4_indTf[_i] == tf && B4_indPeriod[_i] == period && B4_indMethod[_i] == (int)method))
         return B4_indHandles[_i];
   int h = iMA(InpSymbol, tf, period, 0, method, PRICE_CLOSE);
   if(h == INVALID_HANDLE) return INVALID_HANDLE;
   B4_RegisterHandle(key, h, 0);
   B4_indTf[B4_indCount - 1] = tf;
   B4_indPeriod[B4_indCount - 1] = period;
   B4_indMethod[B4_indCount - 1] = (int)method;
   return h;
}

double B4_Buf(int handle, int buffer, int shift)
{
   double _b[];
   if(handle == INVALID_HANDLE || CopyBuffer(handle, buffer, shift, 1, _b) != 1) return 0.0;
   return _b[0];
}
double B4_MAval(int handle, int shift) { return B4_Buf(handle, 0, shift); }
`;

/** Can the flow engine handle this module in this role? */
export function flowSupportsModuleRole(module: string, role: string): boolean {
  const prof = SM_PROFILES[module];
  if (!prof) return false;
  if (role === "direction") return prof.family === "ema" || prof.family === "bias_break";
  if (role === "setup" || role === "filter" || isEntry(role)) return true; // every covered module
  return false;
}
export function flowEaSupportsAllSteps(flow: StrategyFlowConfig): boolean {
  return (flow.steps ?? []).every((s) => flowSupportsModuleRole(s.module, s.role));
}

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

// ── Per-instance detection (registers events from the module's SM queries) ───────
function emitDetection(step: StrategyStepConfig, i: number, steps: StrategyStepConfig[]): string {
  const m = step.module;
  const tf = step.timeframe.toUpperCase();
  const prof = SM_PROFILES[m];
  if (!prof) return `void DetectStep_${i}() { /* ${m} not supported */ }`;
  const P = `${prof.prefix}_${tf}`;
  const T1 = `iTime(InpSymbol, gTF[${i}], 1)`;
  const C1 = `iClose(InpSymbol, gTF[${i}], 1)`;
  const biasIdx = biasIndex(step, steps);
  const role = step.role;
  const biasGuard = biasIdx >= 0 ? `   if(!gFired[${biasIdx}]) return;\n` : "";
  const biasExpr = biasIdx >= 0 ? `gDir[${biasIdx}]` : "0";
  const wrap = (body: string) => `void DetectStep_${i}()\n{\n${body}\n}`;

  // swing-SL helper for bias_break entries (BOS/CHoCH carry no ConfirmSL)
  const swingSL = (lb: number) => `   int _total = iBars(InpSymbol, gTF[${i}]);
   if(_total < ${lb} + 3) return;
   double _swH = iHigh(InpSymbol, gTF[${i}], 2);
   double _swL = iLow (InpSymbol, gTF[${i}], 2);
   for(int _k = 3; _k <= ${lb}; _k++) {
      double _h = iHigh(InpSymbol, gTF[${i}], _k);
      double _l = iLow (InpSymbol, gTF[${i}], _k);
      if(_h > _swH) _swH = _h;
      if(_l < _swL) _swL = _l;
   }`;

  // DIRECTION — persistent bias (ema / bias_break only)
  if (role === "direction") {
    const fn = prof.family === "ema" ? `${P}_Bias()` : `${P}_Trend()`;
    return wrap(
      `   int _d = ${fn};
   if(_d != 0 && (!gFired[${i}] || gDir[${i}] != _d)) RegisterEvent(${i}, _d, ${T1}, ${C1}, 0.0);`,
    );
  }

  // SETUP — arm in the bias direction (fires once per arming)
  if (role === "setup" || role === "filter") {
    if (prof.family === "ema") {
      return wrap(
        `   bool _sa = ${P}_SetupActive();
   if(_sa && !gPrevA[${i}]) { int _d = ${P}_ActiveDir(); if(_d != 0) RegisterEvent(${i}, _d, ${T1}, ${C1}, 0.0); }
   gPrevA[${i}] = _sa;`,
      );
    }
    if (prof.family === "zone" && prof.hasActive) {
      return wrap(
        `${biasGuard}   int _bias = ${biasExpr};
   bool _ab = ${P}_HasActiveBull();
   bool _bb = ${P}_HasActiveBear();
   if((_bias == 0 || _bias == 1) && _ab && !gPrevA[${i}]) RegisterEvent(${i}, 1, ${T1}, ${C1}, 0.0);
   else if((_bias == 0 || _bias == -1) && _bb && !gPrevB[${i}]) RegisterEvent(${i}, -1, ${T1}, ${C1}, 0.0);
   gPrevA[${i}] = _ab; gPrevB[${i}] = _bb;`,
      );
    }
    // zone-without-active (liqsweep) or bias_break — arm on the discrete fired event
    const bull = prof.family === "bias_break" ? `${P}_BullJustBroke()` : `${P}_BullJustConfirmed()`;
    const bear = prof.family === "bias_break" ? `${P}_BearJustBroke()` : `${P}_BearJustConfirmed()`;
    return wrap(
      `${biasGuard}   int _bias = ${biasExpr};
   if((_bias == 0 || _bias == 1) && ${bull}) RegisterEvent(${i}, 1, ${T1}, ${C1}, 0.0);
   else if((_bias == 0 || _bias == -1) && ${bear}) RegisterEvent(${i}, -1, ${T1}, ${C1}, 0.0);`,
    );
  }

  // ENTRY — discrete confirmation, carries SL
  if (isEntry(role)) {
    if (prof.family === "ema") {
      return wrap(
        `   if(${P}_JustConfirmed()) { int _d = ${P}_ConfirmDir(); RegisterEvent(${i}, _d, ${T1}, ${C1}, ${P}_ConfirmSL()); }`,
      );
    }
    if (prof.family === "bias_break") {
      const lb = pInt(step.params, "lookback", 20);
      return wrap(
        `${swingSL(lb)}
   if(${P}_BullJustBroke())      RegisterEvent(${i}, 1, ${T1}, ${C1}, _swL);
   else if(${P}_BearJustBroke()) RegisterEvent(${i}, -1, ${T1}, ${C1}, _swH);`,
      );
    }
    // zone family (all carry ConfirmSL)
    return wrap(
      `   if(${P}_BullJustConfirmed())      RegisterEvent(${i}, 1, ${T1}, ${C1}, ${P}_BullConfirmSL());
   else if(${P}_BearJustConfirmed()) RegisterEvent(${i}, -1, ${T1}, ${C1}, ${P}_BearConfirmSL());`,
    );
  }

  return `void DetectStep_${i}() { /* ${m}/${role} not supported */ }`;
}

function emitGate(entryIdx: number, step: StrategyStepConfig, steps: StrategyStepConfig[]): string {
  const deps = depIndices(step, steps);
  const setupDep = deps.find((d) => steps[d].role !== "direction");
  const checks = deps
    .map((d) => {
      const nm = (steps[d].name || `step${d}`).replace(/[^A-Za-z0-9 ]/g, "");
      return `   if(!gFired[${d}]) { gLastGate = "BLOCKED: ${nm} not fired"; return; }
   if(!(gTime[${d}] < gTime[${entryIdx}])) { gLastGate = "BLOCKED: ${nm} not before entry"; return; }
   if(gDir[${d}] != dir) { gLastGate = "BLOCKED: direction mismatch"; return; }`;
    })
    .join("\n");
  const expiry =
    setupDep !== undefined
      ? `   if((int)(gTime[${entryIdx}] - gTime[${setupDep}]) > gExpirySec) { gLastGate = "BLOCKED: setup expired"; return; }`
      : "";
  const consume = deps
    .filter((d) => steps[d].role !== "direction")
    .map((d) => `         gFired[${d}] = false; gPrevA[${d}] = false; gPrevB[${d}] = false;`)
    .join("\n");
  return `void EvaluateEntry_${entryIdx}()
{
   if(!gFired[${entryIdx}]) return;
   if(gTime[${entryIdx}] != iTime(InpSymbol, gTF[${entryIdx}], 1)) return;
   if(gLastTraded[${entryIdx}] == gTime[${entryIdx}]) return;
   int dir = gDir[${entryIdx}];
${checks}
${expiry}
   if(OpenPositions() >= InpMaxOpenTrades) return;
   if(OpenTrade(${entryIdx}, dir))
   {
${consume || "         /* no setup to consume */"}
   }
}`;
}

// ── Main generator ───────────────────────────────────────────────────────────────
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
  const expiryBars = pInt(setupStep?.params, "expiryBars", 100);

  // unique SMs by (prefix, tf)
  const smKey = (s: StrategyStepConfig) => `${SM_PROFILES[s.module]?.prefix}_${s.timeframe.toUpperCase()}`;
  const smEmit = new Map<string, string>();
  const smReset: string[] = [];
  const smTickByTf = new Map<string, string[]>();
  for (const s of steps) {
    const prof = SM_PROFILES[s.module];
    if (!prof) continue;
    const tf = s.timeframe.toUpperCase();
    const key = smKey(s);
    if (!smEmit.has(key)) {
      smEmit.set(key, prof.emitSM(tf, s.params ?? {}));
      smReset.push(`   ${prof.prefix}_${tf}_Reset();`);
      const tfc = tfConst(s.timeframe);
      if (!smTickByTf.has(tfc)) smTickByTf.set(tfc, []);
      smTickByTf.get(tfc)!.push(`${prof.prefix}_${tf}_Tick(${prof.tickArg(s.params ?? {})});`);
    }
  }

  const tfInit = steps.map((s, i) => `   gTF[${i}] = ${tfConst(s.timeframe)};`).join("\n");
  const nameInit = steps
    .map((s, i) => `   gStepName[${i}] = "${(s.name || s.role).replace(/"/g, "")}";`)
    .join("\n");
  const detections = steps.map((s, i) => emitDetection(s, i, steps)).join("\n\n");
  const gates = entryIdxs.map((i) => emitGate(i, steps[i], steps)).join("\n\n");

  // OnTick: per TF bar -> tick SMs on that TF, run detections on that TF, then entry gates
  const tfGroups = new Map<string, number[]>();
  steps.forEach((s, i) => {
    const c = tfConst(s.timeframe);
    if (!tfGroups.has(c)) tfGroups.set(c, []);
    tfGroups.get(c)!.push(i);
  });
  const entryTFs = new Map<string, number[]>();
  entryIdxs.forEach((i) => {
    const c = tfConst(steps[i].timeframe);
    if (!entryTFs.has(c)) entryTFs.set(c, []);
    entryTFs.get(c)!.push(i);
  });
  let slot = 0;
  const onTickBody = [...tfGroups.entries()]
    .map(([tfc, idxs]) => {
      const mySlot = slot++;
      const ticks = (smTickByTf.get(tfc) ?? []).join(" ");
      const dets = idxs.map((i) => `DetectStep_${i}();`).join(" ");
      const gateCalls = (entryTFs.get(tfc) ?? []).map((i) => `EvaluateEntry_${i}();`).join(" ");
      return `   { datetime b = iTime(InpSymbol, ${tfc}, 0); if(b != gLastBar[${mySlot}]) { gLastBar[${mySlot}] = b; ${ticks} ${dets} ${gateCalls} } }`;
    })
    .join("\n");
  const tfSlots = Math.max(slot, 1);

  const panelLines = steps
    .map(
      (s, i) =>
        `   s += "${(s.name || s.role).replace(/"/g, "")}: " + (gFired[${i}] ? DirTxt(gDir[${i}]) + " @ " + TimeToString(gTime[${i}], TIME_DATE|TIME_MINUTES) : "waiting") + "\\n";`,
    )
    .join("\n");
  const entryTF0 = entryIdxs.length ? tfConst(steps[entryIdxs[0]].timeframe) : "PERIOD_M5";

  return `//+------------------------------------------------------------------+
//| ${eaName}.mq5  —  Strategy Flow runtime over verified SMs         |
//| ${n} instances; entries gated on ordered, timestamped events.     |
//+------------------------------------------------------------------+
#property copyright "EA Builder — Strategy Flow runtime"
#property version   "1.00"
#property strict
#include <Trade/Trade.mqh>
CTrade trade;

input long   InpMagic         = 770120;
input double InpRiskPct        = ${risk};
input double InpRewardRisk     = ${rr};
input int    InpMaxStopPts     = ${maxStop};
input int    InpMaxOpenTrades  = ${maxOpen};
input int    InpSetupExpiryBars = ${expiryBars};
input bool   InpAudit         = true;

string InpSymbol;

#define STEP_COUNT ${n}
string          gStepName[STEP_COUNT];
ENUM_TIMEFRAMES gTF[STEP_COUNT];
bool            gFired[STEP_COUNT];
int             gDir[STEP_COUNT];
datetime        gTime[STEP_COUNT];
double          gSL[STEP_COUNT];
datetime        gLastTraded[STEP_COUNT];
bool            gPrevA[STEP_COUNT];
bool            gPrevB[STEP_COUNT];
datetime        gLastBar[${tfSlots}];
int             gExpirySec = 0;
string          gLastGate = "idle";
int             gTradeCount = 0;

string DirTxt(int d) { return d == 1 ? "BULL" : d == -1 ? "BEAR" : "-"; }

void RegisterEvent(int step, int dir, datetime t, double price, double sl)
{
   gFired[step] = true; gDir[step] = dir; gTime[step] = t; gSL[step] = sl;
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

bool OpenTrade(int entryIdx, int dir)
{
   double entryPx = (dir == 1) ? SymbolInfoDouble(InpSymbol, SYMBOL_ASK)
                               : SymbolInfoDouble(InpSymbol, SYMBOL_BID);
   double sl = gSL[entryIdx];
   if(sl <= 0) { gLastGate = "BLOCKED: no SL"; return false; }
   double slDist = MathAbs(entryPx - sl);
   double pt = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   if(InpMaxStopPts > 0 && pt > 0 && (slDist / pt) > InpMaxStopPts)
   { gLastGate = "SKIP: SL too wide"; return false; }
   double tp = (dir == 1) ? entryPx + InpRewardRisk * slDist : entryPx - InpRewardRisk * slDist;
   double lots = LotsForRisk(slDist);
   if(lots <= 0) { gLastGate = "BLOCKED: lot calc"; return false; }
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
               PrintFormat("  %s : %s @ %s", gStepName[s], DirTxt(gDir[s]), TimeToString(gTime[s], TIME_DATE|TIME_MINUTES));
         PrintFormat("  ENTRY %s lots=%.2f SL=%.5f TP=%.5f", dir == 1 ? "BUY" : "SELL", lots, sl, tp);
         Print("=======================");
      }
   }
   return ok;
}

${steps.some((s) => s.module === "ema") ? B4_MA_HELPER : ""}
// ── Embedded verified state machines ──────────────────────────────────────────
${[...smEmit.values()].join("\n")}

// ── Per-instance detection ────────────────────────────────────────────────────
${detections}

// ── Entry gate(s) ─────────────────────────────────────────────────────────────
${gates}

void UpdatePanel()
{
   string s = "${eaName} (flow over verified SMs)\\n";
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
${nameInit}
   for(int i = 0; i < STEP_COUNT; i++) { gFired[i]=false; gDir[i]=0; gTime[i]=0; gLastTraded[i]=0; gPrevA[i]=false; gPrevB[i]=false; }
   for(int b = 0; b < ${tfSlots}; b++) gLastBar[b] = 0;
   gExpirySec = InpSetupExpiryBars * PeriodSeconds(${entryTF0});
${smReset.join("\n")}
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { Comment(""); }

void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
{
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;
   ulong ticket = trans.deal;
   if(ticket == 0 || !HistoryDealSelect(ticket)) return;
   if((long)HistoryDealGetInteger(ticket, DEAL_MAGIC) != InpMagic) return;
   if(HistoryDealGetInteger(ticket, DEAL_ENTRY) != DEAL_ENTRY_OUT) return;
   double profit  = HistoryDealGetDouble(ticket, DEAL_PROFIT)
                  + HistoryDealGetDouble(ticket, DEAL_SWAP)
                  + HistoryDealGetDouble(ticket, DEAL_COMMISSION);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity  = AccountInfoDouble(ACCOUNT_EQUITY);
   datetime dt    = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
   PrintFormat("EA_BUILDER_EQUITY|time=%s|balance=%.2f|equity=%.2f|profit=%.2f|deal=%I64u",
               TimeToString(dt, TIME_DATE|TIME_MINUTES), balance, equity, profit, ticket);
}

void OnTick()
{
${onTickBody}
   UpdatePanel();
}
`;
}

// ── 4-Brain -> flow EA (maps any module the engine covers) ──────────────────────
export function tryGenerateFlowEAFromFourBrain(
  config: FourBrainConfig,
  eaName = "FLOW_EA",
): string | null {
  const steps: StrategyStepConfig[] = [];

  if (config.direction) {
    const m = config.direction.modules?.[0] ?? "";
    if (!flowSupportsModuleRole(m, "direction")) return null;
    steps.push({
      id: "s_dir",
      name: `Direction ${m.toUpperCase()} ${config.direction.timeframe}`,
      role: "direction",
      module: m,
      timeframe: config.direction.timeframe,
      event: "BOS_CONFIRMED",
      params: config.direction.params ?? {},
      directionSource: { mode: "own_event" },
    });
  }
  if (config.setup) {
    const m = config.setup.modules?.[0] ?? "";
    if (!flowSupportsModuleRole(m, "setup")) return null;
    const dirId = steps[0]?.id;
    steps.push({
      id: "s_setup",
      name: `Setup ${m.toUpperCase()} ${config.setup.timeframe}`,
      role: "setup",
      module: m,
      timeframe: config.setup.timeframe,
      event: "FVG_RETESTED",
      params: config.setup.params ?? {},
      dependsOn: dirId ? [{ stepId: dirId, relation: "after", required: true }] : undefined,
      directionSource: dirId ? { mode: "from_step", stepId: dirId } : { mode: "neutral" },
    });
  }
  const em = config.execution.modules?.[0] ?? "";
  if (!flowSupportsModuleRole(em, "entry")) return null;
  const prevId = steps[steps.length - 1]?.id;
  steps.push({
    id: "s_entry",
    name: `Entry ${em.toUpperCase()} ${config.execution.timeframe}`,
    role: "entry",
    module: em,
    timeframe: config.execution.timeframe,
    event: "BOS_CONFIRMED",
    params: config.execution.params ?? {},
    dependsOn: prevId ? [{ stepId: prevId, relation: "after", required: true }] : undefined,
    directionSource: { mode: "own_event" },
    slSource: { mode: "event_sl", bufferPoints: 0 },
  });

  return generateFlowEA(
    { version: 1, mode: "simple_4brain", source: "fourbrain_adapter", steps, management: config.management },
    eaName,
  );
}

// ── Demo flow (verify-mql5 compile anchor) ──────────────────────────────────────
export function generateFlowDemoEA(): string {
  return tryGenerateFlowEAFromFourBrain(
    {
      direction: { modules: ["bos"], timeframe: "H1", params: { lookback: 20 } },
      setup: { modules: ["fvg"], timeframe: "H1", params: { expiryBars: 100 } },
      execution: { modules: ["bos"], timeframe: "M5", params: { lookback: 20 } },
      management: { riskPercent: 1.0, rewardRisk: 3.0, stopBuffer: 0, maxOpenTrades: 1 },
    } as FourBrainConfig,
    FLOW_DEMO_EA_NAME,
  )!;
}
