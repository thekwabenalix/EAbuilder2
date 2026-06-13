/**
 * Strategy Flow EA generator — config-driven INSTANCE RUNTIME over the VERIFIED SMs.
 *
 * State machines are embedded via sm-embed-registry.ts (shared with gen-ea.ts).
 */

import type {
  StrategyFlowConfig,
  StrategyStepConfig,
  FourBrainConfig,
  StrategyStepDependencyRelation,
} from "../types/blueprint";
import type { BuiltinFilterRef } from "@/lib/builtin-filter-contracts";
import {
  B4_FILTER_EXTRA_FUNCTIONS,
  B4_FILTER_INDICATOR_HELPERS,
  buildFlowEntryFilterChecks,
  flowNeedsFilterHelpers,
} from "./gen-builtin-filters";
import { fourBrainToStrategyFlow, validateStrategyFlowSchema } from "../lib/strategy-flow";
import { EaGenerationError } from "@/lib/blueprint-generation-gate";
import {
  emitStateMachineForModule,
  flowSupportsModuleRole,
  getSmFlowProfile,
  pInt,
  SM_MODULE_META,
  tickArgForSm,
  tfConst,
} from "./sm-embed-registry";

export { flowSupportsModuleRole, isFlowVerifiedModule } from "./sm-embed-registry";

export const FLOW_DEMO_EA_NAME = "FLOW_BOS_FVG_BOS_Demo";

function isEntry(role: string): boolean {
  return role === "entry" || role === "confirmation";
}

export function flowEaSupportsAllSteps(flow: StrategyFlowConfig): boolean {
  return (flow.steps ?? []).every((s) => flowSupportsModuleRole(s.module, s.role));
}

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

/** EMA state machine calls B4_DebugMark; flow EAs use a no-op unless chart debug is added later. */
const B4_DEBUG_MARK_STUB = `
void B4_DebugMark(const string key, ENUM_TIMEFRAMES tf, int shift, double price, color clr, const string text) { }
`;

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

function emaDirectionBiasIndex(steps: StrategyStepConfig[], tf: string): number {
  const emaDirIdx = steps.findIndex(
    (s) =>
      s.module === "ema" &&
      s.role === "direction" &&
      s.timeframe.toUpperCase() === tf.toUpperCase(),
  );
  if (emaDirIdx >= 0) return emaDirIdx;

  const emaStep = steps.find(
    (s) => s.module === "ema" && s.timeframe.toUpperCase() === tf.toUpperCase(),
  );
  if (emaStep) {
    const fromDep = biasIndex(emaStep, steps);
    if (fromDep >= 0) return fromDep;
  }

  return steps.findIndex(
    (s) => s.role === "direction" && s.timeframe.toUpperCase() === tf.toUpperCase(),
  );
}

function emaFlowTickBias(steps: StrategyStepConfig[], tf: string): string {
  const dirIdx = emaDirectionBiasIndex(steps, tf);
  return dirIdx >= 0 ? `gDir[${dirIdx}]` : "0";
}

function downstreamDependentIndices(fromIdx: number, steps: StrategyStepConfig[]): number[] {
  const fromId = steps[fromIdx]?.id;
  if (!fromId) return [];
  const seenIds = new Set<string>([fromId]);
  const out: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let j = 0; j < steps.length; j++) {
      if (j === fromIdx || out.includes(j)) continue;
      const deps = steps[j]?.dependsOn ?? [];
      if (deps.some((d) => seenIds.has(d.stepId))) {
        out.push(j);
        seenIds.add(steps[j]!.id);
        changed = true;
      }
    }
  }
  return out;
}

function emitClearDownstream(fromIdx: number, steps: StrategyStepConfig[]): string {
  const idxs = downstreamDependentIndices(fromIdx, steps);
  if (!idxs.length) return "";
  return idxs
    .map(
      (j) =>
        `      gFired[${j}] = false; gTime[${j}] = 0; gDir[${j}] = 0; gSL[${j}] = 0.0; gPrevA[${j}] = false; gPrevB[${j}] = false;`,
    )
    .join("\n");
}

function defaultSetupExpiryBars(step?: StrategyStepConfig): number {
  if (!step) return 100;
  if (step.params?.expiryBars !== undefined && step.params?.expiryBars !== null) {
    return pInt(step.params, "expiryBars", 100);
  }
  if (step.module === "ema") return 0;
  return 100;
}

function priorConfirmationIndex(i: number, steps: StrategyStepConfig[]): number {
  for (const dep of steps[i].dependsOn ?? []) {
    const j = steps.findIndex((s) => s.id === dep.stepId);
    if (j >= 0 && steps[j].role === "confirmation") return j;
  }
  for (let j = i - 1; j >= 0; j--) {
    if (steps[j].role === "confirmation" && steps[j].module === steps[i].module) return j;
  }
  return -1;
}

function isZoneRetestEvent(event: string): boolean {
  return event.endsWith("_RETESTED") || event === "EMA_RETEST" || event === "UNICORN_RETESTED";
}

function isZoneRejectionEvent(event: string): boolean {
  return (
    event.endsWith("_CONFIRMED") ||
    event === "REJECTION_CONFIRMED" ||
    event === "ENGULFING_CONFIRMED" ||
    event === "PIN_BAR_CONFIRMED"
  );
}

function emitNextBarAfterConfirmEntry(
  wrap: (body: string) => string,
  biasGuard: string,
  i: number,
  confIdx: number,
  T1: string,
  C1: string,
): string {
  return wrap(
    `${biasGuard}   if(!gFired[${confIdx}]) return;
   datetime _confT = gTime[${confIdx}];
   if(_confT <= 0 || ${T1} <= _confT) return;
   int _bias = gDir[${confIdx}];
   if(_bias != 0 && !gPrevA[${i}]) {
      RegisterEvent(${i}, _bias, ${T1}, ${C1}, gSL[${confIdx}]);
      gPrevA[${i}] = true;
   } else if(_bias == 0) {
      gPrevA[${i}] = false;
   }`,
  );
}
function emitZoneRetestDetect(
  wrap: (body: string) => string,
  biasGuard: string,
  biasExpr: string,
  i: number,
  P: string,
  T1: string,
  C1: string,
): string {
  return wrap(
    `${biasGuard}   int _bias = ${biasExpr};
   if((_bias == 0 || _bias == 1) && ${P}_BullJustRetested()) RegisterEvent(${i}, 1, ${T1}, ${C1}, 0.0);
   else if((_bias == 0 || _bias == -1) && ${P}_BearJustRetested()) RegisterEvent(${i}, -1, ${T1}, ${C1}, 0.0);`,
  );
}

function emitZoneRejectionDetect(
  wrap: (body: string) => string,
  biasGuard: string,
  i: number,
  P: string,
  T1: string,
  C1: string,
): string {
  return wrap(
    `${biasGuard}   if(${P}_BullJustConfirmed())      RegisterEvent(${i}, 1, ${T1}, ${C1}, ${P}_BullConfirmSL());
   else if(${P}_BearJustConfirmed()) RegisterEvent(${i}, -1, ${T1}, ${C1}, ${P}_BearConfirmSL());`,
  );
}

// ── Per-instance detection (registers events from the module's SM queries) ───────
function emitDetection(step: StrategyStepConfig, i: number, steps: StrategyStepConfig[]): string {
  const m = step.module;
  const tf = step.timeframe.toUpperCase();
  const prof = getSmFlowProfile(m);
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
    if (prof.family === "ema" && step.event === "EMA_CROSS") {
      const fast = pInt(step.params, "fastPeriod", 12);
      const slow = pInt(step.params, "slowPeriod", 48);
      return wrap(
        `   int hFast = B4_MA(gTF[${i}], ${fast}, MODE_EMA);
   int hSlow = B4_MA(gTF[${i}], ${slow}, MODE_EMA);
   double f1 = B4_MAval(hFast, 1), s1 = B4_MAval(hSlow, 1);
   double f2 = B4_MAval(hFast, 2), s2 = B4_MAval(hSlow, 2);
   int _d = 0;
   if(f2 <= s2 && f1 > s1) _d = 1;
   else if(f2 >= s2 && f1 < s1) _d = -1;
   if(_d != 0 && (!gFired[${i}] || gDir[${i}] != _d)) RegisterEvent(${i}, _d, ${T1}, ${C1}, 0.0);`,
      );
    }
    const fn = prof.family === "ema" ? `${P}_Bias()` : `${P}_Trend()`;
    return wrap(
      `   int _d = ${fn};
   if(_d != 0 && (!gFired[${i}] || gDir[${i}] != _d)) RegisterEvent(${i}, _d, ${T1}, ${C1}, 0.0);`,
    );
  }

  // SETUP — arm in the bias direction (fires once per arming)
  if (role === "setup" || role === "filter") {
    if (prof.family === "ema" && step.event === "EMA_RETEST") {
      const fast = pInt(step.params, "fastPeriod", 12);
      const slow = pInt(step.params, "slowPeriod", 48);
      const retestPoints = pInt(step.params, "retestPoints", 5);
      const target = String(step.params?.retestTarget ?? "either").toLowerCase();
      const touchExpr =
        target === "fast"
          ? "touchedFast"
          : target === "slow"
            ? "touchedSlow"
            : "(touchedFast || touchedSlow)";
      const barTime = `iTime(InpSymbol, gTF[${i}], 1)`;
      return wrap(
        `${biasGuard}   int hFast = B4_MA(gTF[${i}], ${fast}, MODE_EMA);
   int hSlow = B4_MA(gTF[${i}], ${slow}, MODE_EMA);
   double fastMa = B4_MAval(hFast, 1), slowMa = B4_MAval(hSlow, 1);
   double hi = iHigh(InpSymbol, gTF[${i}], 1), lo = iLow(InpSymbol, gTF[${i}], 1);
   double retestTol = ${retestPoints} * SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   bool touchedFast = (lo <= fastMa + retestTol && hi >= fastMa - retestTol);
   bool touchedSlow = (lo <= slowMa + retestTol && hi >= slowMa - retestTol);
   int _bias = ${biasExpr};
   if(_bias != 0 && ${biasIdx >= 0 ? `gFired[${biasIdx}] && ${barTime} > gTime[${biasIdx}] &&` : ""} ${touchExpr} && !gPrevA[${i}]) {
      RegisterEvent(${i}, _bias, ${T1}, ${C1}, 0.0);
      gPrevA[${i}] = true;
   } else if(!${touchExpr}) {
      gPrevA[${i}] = false;
   }`,
      );
    }
    if (prof.family === "ema") {
      const clearDown = emitClearDownstream(i, steps);
      return wrap(
        `   bool _sa = ${P}_SetupActive();
   bool _rt = ${P}_RetestActive();
   int _sd = ${P}_ActiveDir();
   if(_rt && !gPrevB[${i}] && _sd != 0) {
      RegisterEvent(${i}, _sd, ${T1}, ${C1}, 0.0);
${clearDown}
      gPrevB[${i}] = true;
   } else if(!_rt) {
      gPrevB[${i}] = false;
   }
   if(_sa && !gPrevA[${i}] && _sd != 0) {
      RegisterEvent(${i}, _sd, ${T1}, ${C1}, 0.0);
${clearDown}
   }
   gPrevA[${i}] = _sa;`,
      );
    }
    if (prof.family === "zone" && prof.hasActive && isZoneRetestEvent(step.event)) {
      return emitZoneRetestDetect(wrap, biasGuard, biasExpr, i, P, T1, C1);
    }
    if (
      prof.family === "zone" &&
      isZoneRejectionEvent(step.event) &&
      !isZoneRetestEvent(step.event)
    ) {
      return emitZoneRejectionDetect(wrap, biasGuard, i, P, T1, C1);
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
    if (step.event === "BAR_AFTER_CONFIRM") {
      const confIdx = priorConfirmationIndex(i, steps);
      if (confIdx >= 0) {
        return emitNextBarAfterConfirmEntry(wrap, biasGuard, i, confIdx, T1, C1);
      }
    }
    if (prof.family === "zone" && isZoneRetestEvent(step.event)) {
      return emitZoneRetestDetect(wrap, biasGuard, biasExpr, i, P, T1, C1);
    }
    if (prof.family === "ema") {
      const confIdx = role === "entry" ? priorConfirmationIndex(i, steps) : -1;
      if (confIdx >= 0) {
        const fast = pInt(step.params, "fastPeriod", 12);
        return emitNextBarAfterConfirmEntry(
          wrap,
          `${biasGuard}   int hFast = B4_MA(gTF[${i}], ${fast}, MODE_EMA);
   double f1 = B4_MAval(hFast, 1);
   double cl = iClose(InpSymbol, gTF[${i}], 1);
   bool _ok = (gDir[${confIdx}] == 1 && cl > f1) || (gDir[${confIdx}] == -1 && cl < f1);
   if(!_ok) return;
`,
          i,
          confIdx,
          T1,
          C1,
        );
      }
      return wrap(
        `   if(${P}_JustConfirmed()) { int _d = ${P}_ConfirmDir(); RegisterEvent(${i}, _d, ${T1}, ${C1}, ${P}_ConfirmSL()); }`,
      );
    }
    if (prof.family === "zone" && m === "fvg_inversion" && step.event === "IFVG_FORMED") {
      return wrap(
        `   if(${P}_BullJustInverted())      RegisterEvent(${i}, 1, ${T1}, ${C1}, ${P}_BullInversionSL());
   else if(${P}_BearJustInverted()) RegisterEvent(${i}, -1, ${T1}, ${C1}, ${P}_BearInversionSL());`,
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

function depTimeRelationExpr(
  stepIdx: number,
  entryIdx: number,
  relation: StrategyStepDependencyRelation = "after",
): { expr: string; failMsg: string } {
  switch (relation) {
    case "same_or_after":
      return {
        expr: `gTime[${stepIdx}] <= gTime[${entryIdx}]`,
        failMsg: "not same bar or before entry",
      };
    case "before":
      return {
        expr: `gTime[${stepIdx}] > gTime[${entryIdx}]`,
        failMsg: "not after entry bar",
      };
    default:
      return {
        expr: `gTime[${stepIdx}] < gTime[${entryIdx}]`,
        failMsg: "not before entry",
      };
  }
}

function emitDepCheck(
  stepIdx: number,
  entryIdx: number,
  steps: StrategyStepConfig[],
  relation: StrategyStepDependencyRelation = "after",
): string {
  const nm = (steps[stepIdx].name || `step${stepIdx}`).replace(/[^A-Za-z0-9 ]/g, "");
  const { expr, failMsg } = depTimeRelationExpr(stepIdx, entryIdx, relation);
  return `   if(!gFired[${stepIdx}]) { gLastGate = "BLOCKED: ${nm} not fired"; return; }
   if(!(${expr})) { gLastGate = "BLOCKED: ${nm} ${failMsg}"; return; }
   if(gDir[${stepIdx}] != dir) { gLastGate = "BLOCKED: direction mismatch"; return; }`;
}

function emitGate(
  entryIdx: number,
  step: StrategyStepConfig,
  steps: StrategyStepConfig[],
  filterRefs?: BuiltinFilterRef[],
): string {
  const dependsOn = step.dependsOn ?? [];
  const andDeps = dependsOn.filter((dep) => !dep.orGroup);
  const orGroups = new Map<string, typeof dependsOn>();
  for (const dep of dependsOn) {
    if (!dep.orGroup) continue;
    const list = orGroups.get(dep.orGroup) ?? [];
    list.push(dep);
    orGroups.set(dep.orGroup, list);
  }

  const andChecks = andDeps
    .map((dep) => {
      const i = steps.findIndex((s) => s.id === dep.stepId);
      return i >= 0 ? emitDepCheck(i, entryIdx, steps, dep.relation ?? "after") : "";
    })
    .filter(Boolean)
    .join("\n");

  const orChecks = [...orGroups.entries()]
    .map(([group, groupDeps]) => {
      const clauses = groupDeps
        .map((dep) => {
          const i = steps.findIndex((s) => s.id === dep.stepId);
          if (i < 0) return "false";
          const { expr } = depTimeRelationExpr(i, entryIdx, dep.relation ?? "after");
          return `(gFired[${i}] && (${expr}) && gDir[${i}] == dir)`;
        })
        .join(" || ");
      return `   if(!(${clauses})) { gLastGate = "BLOCKED: ${group} not satisfied"; return; }`;
    })
    .join("\n");

  const depIndicesLegacy = dependsOn
    .map((dep) => steps.findIndex((s) => s.id === dep.stepId))
    .filter((i) => i >= 0);
  const setupDep = depIndicesLegacy.find((d) => steps[d].role !== "direction");
  const expiry =
    setupDep !== undefined
      ? `   if(InpSetupExpiryBars > 0 && (int)(gTime[${entryIdx}] - gTime[${setupDep}]) > gExpirySec) { gLastGate = "BLOCKED: setup expired"; return; }`
      : "";
  const consume = depIndicesLegacy
    .filter((d) => steps[d].role !== "direction")
    .map((d) => `         gFired[${d}] = false; gPrevA[${d}] = false; gPrevB[${d}] = false;`)
    .join("\n");
  const filterChecks = buildFlowEntryFilterChecks(filterRefs);

  return `void EvaluateEntry_${entryIdx}()
{
   if(!gFired[${entryIdx}]) return;
   if(gTime[${entryIdx}] != iTime(InpSymbol, gTF[${entryIdx}], 1)) return;
   if(gLastTraded[${entryIdx}] == gTime[${entryIdx}]) return;
   int dir = gDir[${entryIdx}];
${andChecks}
${orChecks}
${expiry}
${filterChecks}
   if(OpenPositions() >= InpMaxOpenTrades) return;
   if(OpenTrade(${entryIdx}, dir))
   {
${consume || "         /* no setup to consume */"}
   }
}`;
}

// ── Main generator ───────────────────────────────────────────────────────────────
export function generateFlowEA(
  flow: StrategyFlowConfig,
  eaName = "FLOW_EA",
  filterRefs?: BuiltinFilterRef[],
): string {
  const validation = validateStrategyFlowSchema(flow);
  if (!validation.ok) {
    throw new EaGenerationError(
      `Strategy flow validation failed:\n${validation.errors.join("\n")}`,
      validation.errors,
    );
  }

  const steps = flow.steps ?? [];
  const n = steps.length;
  const mgmt = flow.management;
  const risk = mgmt?.riskPercent ?? 1.0;
  const rr = mgmt?.rewardRisk ?? 3.0;
  const maxStop = mgmt?.maxStopPoints ?? 0;
  const maxOpen = mgmt?.maxOpenTrades ?? 1;
  const entryIdxs = steps.map((s, i) => (isEntry(s.role) ? i : -1)).filter((i) => i >= 0);
  const setupStep = steps.find((s) => s.role === "setup" || s.role === "filter");
  const expiryBars = defaultSetupExpiryBars(setupStep);

  // unique SMs by (prefix, tf)
  const smKey = (s: StrategyStepConfig) => {
    const prefix = SM_MODULE_META[s.module]?.prefix ?? getSmFlowProfile(s.module)?.prefix ?? "SM";
    return `${prefix}_${s.timeframe.toUpperCase()}`;
  };
  const smEmit = new Map<string, string>();
  const smReset: string[] = [];
  const smTickByTf = new Map<string, string[]>();
  for (const s of steps) {
    const prof = getSmFlowProfile(s.module);
    const meta = SM_MODULE_META[s.module];
    if (!prof || !meta) continue;
    const tf = s.timeframe.toUpperCase();
    const key = smKey(s);
    if (!smEmit.has(key)) {
      smEmit.set(key, emitStateMachineForModule(s.module, s.timeframe, s.params ?? {}));
      smReset.push(`   ${prof.prefix}_${tf}_Reset();`);
      const tfc = tfConst(s.timeframe);
      if (!smTickByTf.has(tfc)) smTickByTf.set(tfc, []);
      const tickArg =
        meta.type === "ema"
          ? emaFlowTickBias(steps, tf)
          : tickArgForSm(meta.type, s.params ?? {}, "flow_bar");
      smTickByTf.get(tfc)!.push(`${prof.prefix}_${tf}_Tick(${tickArg});`);
    }
  }

  const tfInit = steps.map((s, i) => `   gTF[${i}] = ${tfConst(s.timeframe)};`).join("\n");
  const nameInit = steps
    .map((s, i) => `   gStepName[${i}] = "${(s.name || s.role).replace(/"/g, "")}";`)
    .join("\n");
  const detections = steps.map((s, i) => emitDetection(s, i, steps)).join("\n\n");
  const gates = entryIdxs.map((i) => emitGate(i, steps[i], steps, filterRefs)).join("\n\n");

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
      const dirDets = idxs
        .filter((i) => steps[i]!.role === "direction")
        .map((i) => `DetectStep_${i}();`)
        .join(" ");
      const ticks = (smTickByTf.get(tfc) ?? []).join(" ");
      const otherDets = idxs
        .filter((i) => steps[i]!.role !== "direction")
        .map((i) => `DetectStep_${i}();`)
        .join(" ");
      const gateCalls = (entryTFs.get(tfc) ?? []).map((i) => `EvaluateEntry_${i}();`).join(" ");
      // Direction must register gDir before EMA SM Tick reads external bias (same-bar cross/setup).
      const body = [dirDets, ticks, otherDets, gateCalls].filter(Boolean).join(" ");
      return `   { datetime b = iTime(InpSymbol, ${tfc}, 0); if(b != gLastBar[${mySlot}]) { gLastBar[${mySlot}] = b; ${body} } }`;
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
  const hasEma = steps.some((s) => s.module === "ema");
  const hasFilters = flowNeedsFilterHelpers(filterRefs);
  const indicatorHelpers = hasEma
    ? `${B4_MA_HELPER}${B4_DEBUG_MARK_STUB}${hasFilters ? B4_FILTER_EXTRA_FUNCTIONS : ""}`
    : hasFilters
      ? B4_FILTER_INDICATOR_HELPERS
      : "";

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

${indicatorHelpers}
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
   gExpirySec = InpSetupExpiryBars > 0 ? InpSetupExpiryBars * PeriodSeconds(${entryTF0}) : 0;
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

// ── 4-Brain -> flow EA (uses shared strategy-flow adapter) ───────────────────────
export function tryGenerateFlowEAFromFourBrain(
  config: FourBrainConfig,
  eaName = "FLOW_EA",
): string | null {
  const flow = fourBrainToStrategyFlow(config);
  if (!flowEaSupportsAllSteps(flow)) return null;
  const validation = validateStrategyFlowSchema(flow);
  if (!validation.ok) return null;
  return generateFlowEA(flow, eaName);
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
