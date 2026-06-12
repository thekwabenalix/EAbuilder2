/**
 * 4-Brain EA Generator (gen-ea.ts)
 *
 * TWO MODES:
 *
 * 1. Blueprint mode (default): deterministic wiring from FourBrainConfig via
 *    buildBlueprintWiring() — same verified inline state machines as AI mode.
 *
 * 2. AI mode (params.aiWiring set): brain functions written by Claude using the
 *    module library. State machines are embedded based on aiWiring.sm_configs.
 *
 * 3. Legacy heuristic mode: only when pin_bar / bb / swing_structure modules are
 *    selected (no verified SM yet). Uses gen-*-brain switch-case fallbacks.
 *
 * Assembles a complete, always-compilable MQL5 EA.
 * The OnTick loop runs each brain on its own timeframe bar-open.
 * Trade execution fires when the confluence gate passes.
 */

import type { FourBrainConfig, MQL5CodeGenParams, BrainModuleType } from "@/types/blueprint";
import { genDirectionBrain } from "./gen-direction-brain";
import { genSetupBrain } from "./gen-setup-brain";
import { genExecutionBrain } from "./gen-execution-brain";
import type { AiBrainWiring } from "@/lib/api-client";
import { buildAssemblerFilterCode } from "./gen-builtin-filters";
import { buildBlueprintWiring, configUsesLegacyHeuristics } from "./gen-blueprint-wiring";
import {
  emitStateMachine,
  periodConst,
  SM_PREFIX_REGEX,
  SM_PREFIX_TYPE,
  smPrefixForType,
  tfConst,
  tickArgForSm,
} from "./sm-embed-registry";

/** Collect all unique TFs that need an iFVG state machine instance. */
function collectIfvgTFs(config: FourBrainConfig): Map<string, string> {
  // Map: tf-label (e.g. "H1") → PERIOD constant
  const result = new Map<string, string>();
  const needs = (mods: BrainModuleType[] | undefined) => mods?.includes("fvg_inversion") ?? false;
  const add = (tf: string) => {
    if (!tf) return;
    const u = tf.toUpperCase();
    const c = u === "MN" ? "PERIOD_MN1" : `PERIOD_${u}`;
    result.set(u, c);
  };
  if (needs(config.direction?.modules)) add(config.direction!.timeframe);
  if (needs(config.setup?.modules)) add(config.setup!.timeframe);
  if (needs(config.execution?.modules)) add(config.execution.timeframe);
  return result;
}

function collectEngulfingTFs(config: FourBrainConfig): Map<string, string> {
  // Map: tf-label (e.g. "H4") → PERIOD constant — TFs where any brain uses engulfing.
  const result = new Map<string, string>();
  const needs = (mods: BrainModuleType[] | undefined) => mods?.includes("engulfing") ?? false;
  const add = (tf: string) => {
    if (!tf) return;
    const u = tf.toUpperCase();
    const c = u === "MN" ? "PERIOD_MN1" : `PERIOD_${u}`;
    result.set(u, c);
  };
  if (needs(config.direction?.modules)) add(config.direction!.timeframe);
  if (needs(config.setup?.modules)) add(config.setup!.timeframe);
  if (needs(config.execution?.modules)) add(config.execution.timeframe);
  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function collectRsiHdTFs(config: FourBrainConfig): Map<string, string> {
  const result = new Map<string, string>();
  const needs = (mods: BrainModuleType[] | undefined) => mods?.includes("rsi_hd") ?? false;
  const add = (tf: string) => {
    if (!tf) return;
    const u = tf.toUpperCase();
    const c = u === "MN" ? "PERIOD_MN1" : `PERIOD_${u}`;
    result.set(u, c);
  };
  if (needs(config.direction?.modules)) add(config.direction!.timeframe);
  if (needs(config.setup?.modules)) add(config.setup!.timeframe);
  if (needs(config.execution?.modules)) add(config.execution.timeframe);
  return result;
}

function isEmaCtcParams(params: Record<string, unknown> | undefined): boolean {
  return (
    params?.sequenceMode === "cross_test_close" ||
    params?.entryEvent === "close_confirmation" ||
    (params?.requireCross === true && typeof params?.retestTarget === "string")
  );
}

function paramsOfBrain(
  brain: FourBrainConfig["direction"] | FourBrainConfig["setup"] | FourBrainConfig["execution"],
): Record<string, unknown> {
  return brain?.params && typeof brain.params === "object" ? brain.params : {};
}

function collectEmaCtcTFs(config: FourBrainConfig): Map<string, string> {
  const result = new Map<string, string>();
  const add = (tf: string) => {
    if (!tf) return;
    const u = tf.toUpperCase();
    const c = u === "MN" ? "PERIOD_MN1" : `PERIOD_${u}`;
    result.set(u, c);
  };
  const maybeAdd = (
    brain: FourBrainConfig["direction"] | FourBrainConfig["setup"] | FourBrainConfig["execution"],
  ) => {
    if (!brain?.modules?.includes("ema")) return;
    if (isEmaCtcParams(paramsOfBrain(brain))) add(brain.timeframe);
  };
  maybeAdd(config.direction);
  maybeAdd(config.setup);
  maybeAdd(config.execution);
  return result;
}

function emaCtcParamsForTf(
  config: FourBrainConfig,
  tf: string,
): {
  fastPeriod: number;
  slowPeriod: number;
  retestPoints: number;
  requireCross: boolean;
  repeatAfterConfirmation: boolean;
} {
  const brains = [config.setup, config.execution, config.direction];
  for (const brain of brains) {
    if (!brain?.modules?.includes("ema")) continue;
    if (brain.timeframe.toUpperCase() !== tf.toUpperCase()) continue;
    const params = paramsOfBrain(brain);
    if (!isEmaCtcParams(params)) continue;
    return {
      fastPeriod: typeof params.fastPeriod === "number" ? params.fastPeriod : 12,
      slowPeriod: typeof params.slowPeriod === "number" ? params.slowPeriod : 48,
      retestPoints: typeof params.retestPoints === "number" ? params.retestPoints : 0,
      requireCross: typeof params.requireCross === "boolean" ? params.requireCross : true,
      repeatAfterConfirmation:
        typeof params.repeatAfterConfirmation === "boolean" ? params.repeatAfterConfirmation : true,
    };
  }
  return {
    fastPeriod: 12,
    slowPeriod: 48,
    retestPoints: 0,
    requireCross: true,
    repeatAfterConfirmation: true,
  };
}

function rsiHdParamsForTf(
  config: FourBrainConfig,
  tf: string,
): {
  rsiPeriod: number;
  pivotLeft: number;
  pivotRight: number;
  minBars: number;
  maxBars: number;
  expiryBars: number;
} {
  const brains = [config.setup, config.execution, config.direction];
  for (const brain of brains) {
    if (!brain?.modules?.includes("rsi_hd")) continue;
    if (brain.timeframe.toUpperCase() !== tf.toUpperCase()) continue;
    const params = paramsOfBrain(brain);
    return {
      rsiPeriod: typeof params.rsiPeriod === "number" ? params.rsiPeriod : 14,
      pivotLeft: typeof params.pivotLeft === "number" ? params.pivotLeft : 3,
      pivotRight: typeof params.pivotRight === "number" ? params.pivotRight : 3,
      minBars: typeof params.minBars === "number" ? params.minBars : 5,
      maxBars:
        typeof params.maxBars === "number"
          ? params.maxBars
          : typeof params.lookback === "number"
            ? params.lookback
            : 50,
      expiryBars: typeof params.expiryBars === "number" ? params.expiryBars : 60,
    };
  }
  return {
    rsiPeriod: 14,
    pivotLeft: 3,
    pivotRight: 3,
    minBars: 5,
    maxBars: 50,
    expiryBars: 60,
  };
}

// ─── AI-mode: build state machine code from sm_configs ────────────────────────

/**
 * RECONCILE: scan the AI-generated brain code for every state-machine function
 * it references (e.g. BOSSM_M5_Tick, FVGSM_H4_BullJustConfirmed), and make sure
 * each referenced (prefix, id) pair has a matching entry in sm_configs.
 *
 * This is the safety net for the common failure where Claude calls a function
 * but forgets to declare its sm_config — which caused "undeclared identifier"
 * compile errors. After this runs, every referenced SM is guaranteed embedded.
 */
function reconcileStateMachines(aiWiring: AiBrainWiring): AiBrainWiring["sm_configs"] {
  const configs: AiBrainWiring["sm_configs"] = { ...(aiWiring.sm_configs ?? {}) };

  // Index existing configs by (type, id) so we can detect duplicates
  const haveKey = new Set<string>();
  for (const c of Object.values(configs)) {
    haveKey.add(`${c.type}|${c.id.toUpperCase()}`);
  }

  const allCode = [
    aiWiring.direction_brain ?? "",
    aiWiring.setup_brain ?? "",
    aiWiring.execution_brain ?? "",
  ].join("\n");

  // Match  PREFIX_ID_  where PREFIX is a known SM prefix and ID is the TF label.
  // IFVGSM must precede FVGSM in the alternation so the longer prefix wins.
  const re = new RegExp(`\\b(${SM_PREFIX_REGEX})_([A-Za-z0-9]+)_`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(allCode)) !== null) {
    const prefix = m[1];
    const id = m[2];
    const type = SM_PREFIX_TYPE[prefix];
    if (!type) continue;
    const dedupKey = `${type}|${id.toUpperCase()}`;
    if (haveKey.has(dedupKey)) continue;

    // Auto-add the missing config so the SM gets embedded
    haveKey.add(dedupKey);
    const autoKey = `${type}_${id}`;
    configs[autoKey] = {
      type,
      id,
      TF: periodConst(id),
      tf: id.toUpperCase(),
      params: {},
    };
    console.warn(
      `[reconcile] Auto-added missing SM config: ${autoKey} (referenced but undeclared)`,
    );
  }

  return configs;
}

function buildAiStateMachines(configs: AiBrainWiring["sm_configs"]): string {
  const parts: string[] = [];
  const emitted = new Set<string>();

  for (const [, cfg] of Object.entries(configs)) {
    const prefix = smPrefixForType(cfg.type);
    const emitKey = `${prefix}|${cfg.id.toUpperCase()}`;
    if (emitted.has(emitKey)) continue;
    emitted.add(emitKey);
    parts.push(emitStateMachine(cfg.type, cfg.id, cfg.TF, cfg.tf, cfg.params ?? {}));
  }
  return parts.join("\n");
}

// ─── Main generator ───────────────────────────────────────────────────────────

function smInstanceName(cfg: AiBrainWiring["sm_configs"][string]): string {
  return `${smPrefixForType(cfg.type)}_${cfg.id}`;
}

function smWrapperName(cfg: AiBrainWiring["sm_configs"][string]): string {
  return `B4_TickOnce_${smInstanceName(cfg)}`;
}

function buildAiTickWrappers(configs: AiBrainWiring["sm_configs"]): string {
  const emitted = new Set<string>();
  const wrappers: string[] = [];

  for (const cfg of Object.values(configs)) {
    const instance = smInstanceName(cfg);
    if (emitted.has(instance)) continue;
    emitted.add(instance);

    const wrapper = smWrapperName(cfg);
    const lastBar = `${wrapper}_lastBar`;
    wrappers.push(`
datetime ${lastBar} = 0;
void ${wrapper}()
{
   datetime _bt = iTime(InpSymbol, ${cfg.TF}, 0);
   if(_bt == ${lastBar}) return;
   ${lastBar} = _bt;
   ${instance}_Tick(${tickArgForSm(cfg.type, cfg.params ?? {}, "assembler_brain")});
}`);
  }

  return wrappers.join("\n");
}

function referencedSmConfigs(
  code: string,
  configs: AiBrainWiring["sm_configs"],
): AiBrainWiring["sm_configs"][string][] {
  const refs: AiBrainWiring["sm_configs"][string][] = [];
  const seen = new Set<string>();

  for (const cfg of Object.values(configs)) {
    const instance = smInstanceName(cfg);
    if (seen.has(instance)) continue;
    if (!new RegExp(`\\b${instance}_`).test(code)) continue;
    seen.add(instance);
    refs.push(cfg);
  }

  return refs;
}

function buildAiBrainTickPreamble(code: string, configs: AiBrainWiring["sm_configs"]): string {
  return referencedSmConfigs(code, configs)
    .map((cfg) => `${smWrapperName(cfg)}();`)
    .join(" ");
}

function stripAiTickCalls(code: string): string {
  return code.replace(
    /\s*\b(?:RSIHDSM|OBFVGSM|EMASM|IFVGSM|FVGSM|OBSM|BOSSM|LSSM|GSNRSM|SNRSM|BRKSM|REJSM|MISSSM)_[A-Za-z0-9]+_Tick\s*\([^;]*\);/g,
    "",
  );
}

function auditText(value: unknown): string {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateAudit(value: unknown, max = 120): string {
  const text = auditText(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function buildAiAuditHeader(aiWiring?: AiBrainWiring): string {
  if (!aiWiring) return "";

  const semantics = aiWiring.semantics;
  const validation = aiWiring.validation;
  const lines: string[] = [];

  lines.push(`//| AI validation: ${auditText(validation?.status ?? "not_reported")}`);
  lines.push(
    `//| AI repair    : ${auditText((aiWiring.repairAttempts ?? 0) > 0 ? "one_retry_used" : "not_needed")}`,
  );
  if (validation?.errors?.length) {
    lines.push(`//| AI errors    : ${truncateAudit(validation.errors.join(" | "))}`);
  }
  if (validation?.warnings?.length) {
    lines.push(`//| AI warnings  : ${truncateAudit(validation.warnings.join(" | "))}`);
  }
  if (semantics?.source) lines.push(`//| AI source    : ${auditText(semantics.source)}`);
  if (semantics?.timeframe) lines.push(`//| AI timeframe : ${auditText(semantics.timeframe)}`);
  if (semantics?.direction) {
    const periods =
      semantics.direction.fastPeriod && semantics.direction.slowPeriod
        ? ` ${semantics.direction.fastPeriod}/${semantics.direction.slowPeriod}`
        : "";
    lines.push(
      `//| AI direction : ${truncateAudit(`${semantics.direction.module} ${semantics.direction.event}${periods}`)}`,
    );
  }
  if (semantics?.setup) {
    const target = semantics.setup.targetLabel ?? semantics.setup.target ?? "";
    lines.push(
      `//| AI setup     : ${truncateAudit(`${semantics.setup.gate}${target ? ` on ${target}` : ""}`)}`,
    );
  }
  if (semantics?.execution) {
    lines.push(
      `//| AI entry     : ${truncateAudit(`${semantics.execution.module} ${semantics.execution.entryEvent}`)}`,
    );
  }
  if (semantics?.filters?.length) {
    lines.push(
      `//| AI filters   : ${truncateAudit(
        semantics.filters
          .map((filter) => `${filter.id} ${filter.role} ${filter.timeframe}`)
          .join(" | "),
      )}`,
    );
  }
  if (semantics?.assumptions?.length) {
    lines.push(`//| AI assumes   : ${truncateAudit(semantics.assumptions.join(" | "))}`);
  }
  if (aiWiring.notes) lines.push(`//| AI notes     : ${truncateAudit(aiWiring.notes)}`);

  return lines.join("\n");
}

function injectBeforeFinalBrace(code: string, snippet: string): string {
  if (!snippet.trim()) return code;
  const idx = code.lastIndexOf("}");
  if (idx < 0) return `${code}\n${snippet}`;
  return `${code.slice(0, idx)}${snippet}\n${code.slice(idx)}`;
}

export function generateEA(params: MQL5CodeGenParams): string {
  const {
    eaName,
    config,
    globalSymbol = "EURUSD",
    globalMagic = 990001,
    filterRefs,
    aiWiring,
  } = params;

  const dirMods = config.direction?.modules?.join(" + ").toUpperCase() ?? "NONE";
  const dirTF = config.direction?.timeframe ?? "D1";
  const setupMods = config.setup?.modules?.join(" + ").toUpperCase() ?? "NONE";
  const setupTF = config.setup?.timeframe ?? "H4";
  const execMods = config.execution?.modules?.join(" + ").toUpperCase() ?? "NONE";
  const execTF = config.execution?.timeframe ?? "H1";

  const mgmt = config.management;
  const riskPct = mgmt?.riskPercent ?? 1.0;
  const rrRatio = mgmt?.rewardRisk ?? 2.0;
  const stopBuf = mgmt?.stopBuffer ?? 20; // in POINTS (not price)
  const beEnabled = mgmt?.breakEvenEnabled ?? false;
  const beAtR = mgmt?.breakEvenAtR ?? 1.0;
  const maxTrades = mgmt?.maxOpenTrades ?? 1;
  const maxStopPts = mgmt?.maxStopPoints ?? 0; // 0 = no limit
  const useLegacyHeuristics = !aiWiring && configUsesLegacyHeuristics(config);
  const blueprintWiring =
    aiWiring ?? (useLegacyHeuristics ? undefined : buildBlueprintWiring(config, filterRefs));
  const effectiveWiring = aiWiring ?? blueprintWiring;
  const aiAuditHeader = buildAiAuditHeader(effectiveWiring);

  const hasDirBrain = Boolean(config.direction);
  const hasSetupBrain = Boolean(config.setup);

  // ── State machine code ──────────────────────────────────────────────────────
  // AI and blueprint modes share verified SM embedding + tick wrappers.
  // Reconcile sm_configs with functions actually referenced in brain code.
  const reconciledConfigs = effectiveWiring ? reconcileStateMachines(effectiveWiring) : {};

  let smCode: string;
  let aiTickWrappers = "";
  if (effectiveWiring) {
    smCode = buildAiStateMachines(reconciledConfigs);
    aiTickWrappers = buildAiTickWrappers(reconciledConfigs);
  } else {
    smCode = "";
    aiTickWrappers = "";
  }

  // ── Brain function bodies ───────────────────────────────────────────────────
  let dirCode: string, setupCode: string, execCode: string;
  let aiModeLabel = "";
  if (effectiveWiring) {
    dirCode = stripAiTickCalls(effectiveWiring.direction_brain);
    setupCode = stripAiTickCalls(effectiveWiring.setup_brain);
    execCode = stripAiTickCalls(effectiveWiring.execution_brain);
    if (aiWiring) {
      aiModeLabel = `// Generated by Claude AI — module library wiring\n// ${aiWiring.notes ?? ""}`;
    } else {
      aiModeLabel = `// Blueprint wiring — verified inline state machines\n// ${blueprintWiring?.notes ?? ""}`;
    }
    if (!aiWiring) {
      setupCode = injectBeforeFinalBrace(setupCode, buildAssemblerFilterCode(filterRefs, "setup"));
      execCode = injectBeforeFinalBrace(
        execCode,
        buildAssemblerFilterCode(filterRefs, "execution"),
      );
    }
  } else {
    dirCode = genDirectionBrain(config.direction);
    setupCode = genSetupBrain(config.setup);
    execCode = genExecutionBrain(config.execution);
    setupCode = injectBeforeFinalBrace(setupCode, buildAssemblerFilterCode(filterRefs, "setup"));
    execCode = injectBeforeFinalBrace(execCode, buildAssemblerFilterCode(filterRefs, "execution"));
  }

  let dirSmTick = "",
    setupSmTick = "",
    execSmTick = "";
  if (effectiveWiring) {
    dirSmTick = buildAiBrainTickPreamble(dirCode, reconciledConfigs);
    setupSmTick = buildAiBrainTickPreamble(setupCode, reconciledConfigs);
    execSmTick = buildAiBrainTickPreamble(execCode, reconciledConfigs);
  }

  // Direction gate: require a bias AND that the execution direction AGREES with it.
  // (Confluence = all active brains agree. A BULL bias must never open a SELL.)
  const dirGate = hasDirBrain
    ? `if(gBias == 0) { B4_DebugGate("NO_BIAS", "BLOCKED: no bias", clrSilver); return; }
      if(gExecDir != 0 && gExecDir != gBias) { PrintFormat("[GATE] BLOCKED: exec dir %d disagrees with bias %d", gExecDir, gBias); B4_DebugGate("DIR_MISMATCH", "BLOCKED: direction mismatch", clrTomato); return; }`
    : `// Direction Brain disabled — no bias gate`;

  // Setup gate: require an active setup AND that exec direction agrees with the setup direction.
  const setupGate = hasSetupBrain
    ? `if(!gSetupActive) { B4_DebugGate("NO_SETUP", "BLOCKED: no setup", clrSilver); return; }
      if(gSetupDir != 0 && gExecDir != 0 && gExecDir != gSetupDir) { PrintFormat("[GATE] BLOCKED: exec dir %d disagrees with setup dir %d", gExecDir, gSetupDir); B4_DebugGate("SETUP_MISMATCH", "BLOCKED: setup mismatch", clrTomato); return; }`
    : `// Setup Brain disabled — no zone gate`;

  // Break-even management code
  const breakEvenCode = beEnabled
    ? `
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
   }`
    : `   // Break-even management disabled`;

  // Build OnInit SM resets from reconciled configs (AI + blueprint modes)
  const aiSmResets = effectiveWiring
    ? (() => {
        const seen = new Set<string>();
        const resets: string[] = [];
        for (const cfg of Object.values(reconciledConfigs)) {
          const prefix = smPrefixForType(cfg.type);
          const key = `${prefix}_${cfg.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          resets.push(`${key}_Reset();`);
        }
        return resets.join(" ");
      })()
    : "";

  return `//+------------------------------------------------------------------+
//| ${eaName}.mq5
//| Generated by EAbuilder2 — 4-Brain Architecture${effectiveWiring ? (aiWiring ? " (AI mode)" : " (blueprint SM)") : useLegacyHeuristics ? " (legacy heuristic)" : ""}
//|
//| Direction : ${dirMods} @ ${dirTF}
//| Setup     : ${setupMods} @ ${setupTF}
//| Execution : ${execMods} @ ${execTF}
//| Management: ${riskPct}% risk · ${rrRatio}R TP${beEnabled ? ` · BE@${beAtR}R` : ""}
${aiAuditHeader}
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
input int             InpMaxStopPts  = ${maxStopPts};         // Max SL distance (points, 0=no limit)
input int             InpMaxTrades   = ${maxTrades};         // Max simultaneous positions
input bool            InpDebugMarkers = true;                // Draw rule/gate markers on chart
input bool            InpDebugJournal = true;                // Print rule/gate diagnostics
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
// Helper: upsert one OBJ_LABEL and set all properties in one call.
void DrawPanelRow(const string name, const string text, color clr, int y)
{
   if(ObjectFind(0, name) < 0)
      ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_CORNER,     CORNER_LEFT_UPPER);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE,  8);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE,  y);
   ObjectSetString (0, name, OBJPROP_TEXT,       text);
   ObjectSetInteger(0, name, OBJPROP_COLOR,      clr);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE,   9);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
}

void DrawInfoPanel()
{
   string bias_txt  = (gBias > 0) ? "BULL  ^" : (gBias < 0) ? "BEAR  v" : "NEUTRAL";
   color  bias_clr  = (gBias > 0) ? clrDodgerBlue : (gBias < 0) ? clrOrangeRed : clrGray;
   string setup_txt = gSetupActive
                      ? (gSetupDir > 0 ? "BULL ACTIVE" : "BEAR ACTIVE")
                      : "waiting...";
   color  setup_clr = gSetupActive ? clrMediumSeaGreen : clrGray;
   string exec_txt  = gExecSignal
                      ? (gExecDir > 0 ? "BUY SIGNAL" : "SELL SIGNAL")
                      : "watching...";
   color  exec_clr  = gExecSignal ? clrLime : clrGray;

   DrawPanelRow("4B_P0", "--- 4-Brain EA ---", clrGold, 15);
   DrawPanelRow("4B_P1", "DIR : " + bias_txt,  bias_clr,  30);
   DrawPanelRow("4B_P2", "SETUP: " + setup_txt, setup_clr, 45);
   DrawPanelRow("4B_P3", "EXEC : " + exec_txt,  exec_clr,  60);
   DrawPanelRow("4B_P4",
      StringFormat("Risk: %.1f%% | R:R %.1fx", InpRiskPercent, InpRewardRisk),
      clrSilver, 75);
}

void B4_DebugMark(const string key, ENUM_TIMEFRAMES tf, int shift, double price, color clr, const string text)
{
   if(!InpDebugMarkers) return;
   datetime t = iTime(InpSymbol, tf, shift);
   if(t <= 0 || price <= 0.0) return;
   string name = StringFormat("4B_DBG_%s_%d_%d", key, (int)tf, (int)t);
   if(ObjectFind(0, name) < 0)
      ObjectCreate(0, name, OBJ_TEXT, 0, t, price);
   ObjectSetInteger(0, name, OBJPROP_TIME,       t);
   ObjectSetDouble (0, name, OBJPROP_PRICE,      price);
   ObjectSetString (0, name, OBJPROP_TEXT,       text);
   ObjectSetInteger(0, name, OBJPROP_COLOR,      clr);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE,   8);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
}

void B4_DebugGate(const string key, const string text, color clr)
{
   if(InpDebugJournal) PrintFormat("[GATE] %s", text);
   double pt = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   double hi = iHigh(InpSymbol, InpExecTF, 1);
   B4_DebugMark("GATE_" + key, InpExecTF, 1, hi + 40.0 * pt, clr, text);
}

void DeleteAllChartObjects()
{
   string prefixes[] = { "4B_DIR_", "4B_SETUP_", "4B_EXEC_", "4B_DBG_", "4B_P0", "4B_P1", "4B_P2", "4B_P3", "4B_P4" };
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
//| Verified indicator helpers — create handles AND draw them so the |
//| trader can SEE the indicator the strategy uses. Idempotent:      |
//| safe to call every bar (handles are cached + drawn once).        |
//+------------------------------------------------------------------+
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

// Real moving-average handle (uses iMA), drawn on the chart once.
//   method: MODE_EMA / MODE_SMA / MODE_SMMA / MODE_LWMA
int B4_MA(ENUM_TIMEFRAMES tf, int period, ENUM_MA_METHOD method)
{
   string key = StringFormat("MA|%d|%d|%d", (int)tf, period, (int)method);
   for(int _i = 0; _i < B4_indCount; _i++)
      if(B4_indKey[_i] == key || (B4_indTf[_i] == tf && B4_indPeriod[_i] == period && B4_indMethod[_i] == (int)method))
         return B4_indHandles[_i];
   int h = iMA(InpSymbol, tf, period, 0, method, PRICE_CLOSE);
   if(h == INVALID_HANDLE) return INVALID_HANDLE;
   B4_RegisterHandle(key, h, 0);   // main chart (MTF handles render automatically)
   B4_indTf[B4_indCount - 1] = tf;
   B4_indPeriod[B4_indCount - 1] = period;
   B4_indMethod[B4_indCount - 1] = (int)method;
   return h;
}

// Value of any indicator buffer at a shift (1 = last closed bar).
double B4_Buf(int handle, int buffer, int shift)
{
   double _b[];
   if(handle == INVALID_HANDLE || CopyBuffer(handle, buffer, shift, 1, _b) != 1) return 0.0;
   return _b[0];
}

// Backward-compatible MA/default-buffer alias.
double B4_MAval(int handle, int shift)
{
   return B4_Buf(handle, 0, shift);
}

// Draw ANY already-created indicator handle on the chart, once.
//   e.g. int hRsi = iRSI(...); B4_Draw(hRsi, 1);   // 1 = separate sub-window
void B4_Draw(int handle, int subWindow)
{
   if(handle == INVALID_HANDLE) return;
   for(int _i = 0; _i < B4_indCount; _i++) if(B4_indHandles[_i] == handle) return;
   B4_RegisterHandle(StringFormat("HANDLE|%d", handle), handle, subWindow);
}

int B4_RSI(ENUM_TIMEFRAMES tf, int period, ENUM_APPLIED_PRICE price = PRICE_CLOSE)
{
   string key = StringFormat("RSI|%d|%d|%d", (int)tf, period, (int)price);
   for(int _i = 0; _i < B4_indCount; _i++)
      if(B4_indKey[_i] == key) return B4_indHandles[_i];
   int h = iRSI(InpSymbol, tf, period, price);
   if(h == INVALID_HANDLE) return INVALID_HANDLE;
   B4_RegisterHandle(key, h, 1);
   return h;
}

int B4_ATR(ENUM_TIMEFRAMES tf, int period)
{
   string key = StringFormat("ATR|%d|%d", (int)tf, period);
   for(int _i = 0; _i < B4_indCount; _i++)
      if(B4_indKey[_i] == key) return B4_indHandles[_i];
   int h = iATR(InpSymbol, tf, period);
   if(h == INVALID_HANDLE) return INVALID_HANDLE;
   B4_RegisterHandle(key, h, 1);
   return h;
}

int B4_MACD(ENUM_TIMEFRAMES tf, int fast, int slow, int signal, ENUM_APPLIED_PRICE price = PRICE_CLOSE)
{
   string key = StringFormat("MACD|%d|%d|%d|%d|%d", (int)tf, fast, slow, signal, (int)price);
   for(int _i = 0; _i < B4_indCount; _i++)
      if(B4_indKey[_i] == key) return B4_indHandles[_i];
   int h = iMACD(InpSymbol, tf, fast, slow, signal, price);
   if(h == INVALID_HANDLE) return INVALID_HANDLE;
   B4_RegisterHandle(key, h, 1);
   return h;
}

int B4_Bands(ENUM_TIMEFRAMES tf, int period, int shift, double deviation, ENUM_APPLIED_PRICE price = PRICE_CLOSE)
{
   string key = StringFormat("BANDS|%d|%d|%d|%.4f|%d", (int)tf, period, shift, deviation, (int)price);
   for(int _i = 0; _i < B4_indCount; _i++)
      if(B4_indKey[_i] == key) return B4_indHandles[_i];
   int h = iBands(InpSymbol, tf, period, shift, deviation, price);
   if(h == INVALID_HANDLE) return INVALID_HANDLE;
   B4_RegisterHandle(key, h, 0);
   return h;
}

int B4_Stochastic(ENUM_TIMEFRAMES tf, int kPeriod, int dPeriod, int slowing, ENUM_MA_METHOD method = MODE_SMA, ENUM_STO_PRICE priceField = STO_LOWHIGH)
{
   string key = StringFormat("STO|%d|%d|%d|%d|%d|%d", (int)tf, kPeriod, dPeriod, slowing, (int)method, (int)priceField);
   for(int _i = 0; _i < B4_indCount; _i++)
      if(B4_indKey[_i] == key) return B4_indHandles[_i];
   int h = iStochastic(InpSymbol, tf, kPeriod, dPeriod, slowing, method, priceField);
   if(h == INVALID_HANDLE) return INVALID_HANDLE;
   B4_RegisterHandle(key, h, 1);
   return h;
}

int B4_ADX(ENUM_TIMEFRAMES tf, int period)
{
   string key = StringFormat("ADX|%d|%d", (int)tf, period);
   for(int _i = 0; _i < B4_indCount; _i++)
      if(B4_indKey[_i] == key) return B4_indHandles[_i];
   int h = iADX(InpSymbol, tf, period);
   if(h == INVALID_HANDLE) return INVALID_HANDLE;
   B4_RegisterHandle(key, h, 1);
   return h;
}

int B4_Ichimoku(ENUM_TIMEFRAMES tf, int tenkan, int kijun, int senkouB)
{
   string key = StringFormat("ICH|%d|%d|%d|%d", (int)tf, tenkan, kijun, senkouB);
   for(int _i = 0; _i < B4_indCount; _i++)
      if(B4_indKey[_i] == key) return B4_indHandles[_i];
   int h = iIchimoku(InpSymbol, tf, tenkan, kijun, senkouB);
   if(h == INVALID_HANDLE) return INVALID_HANDLE;
   B4_RegisterHandle(key, h, 0);
   return h;
}

int B4_SAR(ENUM_TIMEFRAMES tf, double step = 0.02, double maximum = 0.2)
{
   string key = StringFormat("SAR|%d|%.4f|%.4f", (int)tf, step, maximum);
   for(int _i = 0; _i < B4_indCount; _i++)
      if(B4_indKey[_i] == key) return B4_indHandles[_i];
   int h = iSAR(InpSymbol, tf, step, maximum);
   if(h == INVALID_HANDLE) return INVALID_HANDLE;
   B4_RegisterHandle(key, h, 0);
   return h;
}

int B4_Fractals(ENUM_TIMEFRAMES tf)
{
   string key = StringFormat("FRACTALS|%d", (int)tf);
   for(int _i = 0; _i < B4_indCount; _i++)
      if(B4_indKey[_i] == key) return B4_indHandles[_i];
   int h = iFractals(InpSymbol, tf);
   if(h == INVALID_HANDLE) return INVALID_HANDLE;
   B4_RegisterHandle(key, h, 0);
   return h;
}

//+------------------------------------------------------------------+
//| Inline State Machine instances (embedded, zero dependencies)    |
//+------------------------------------------------------------------+
${smCode}
${aiTickWrappers}
//+------------------------------------------------------------------+
//| Brain implementations${aiWiring ? " — AI-generated wiring" : " — template generators"}
//+------------------------------------------------------------------+
${aiModeLabel}
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
   // Initialise all state machine instances
   ${aiSmResets}
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
      if(!gExecSignal) { B4_DebugGate("NO_EXEC", "BLOCKED: no exec signal", clrSilver); return; }
      if(!SpreadOk())  { B4_DebugGate("SPREAD", "BLOCKED: spread too wide", clrTomato); return; }
      if(CountPositions() >= InpMaxTrades) { PrintFormat("[GATE] BLOCKED: max trades %d", InpMaxTrades); B4_DebugGate("MAX_TRADES", "BLOCKED: max trades", clrTomato); return; }

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
         if(InpMaxStopPts > 0 && dist > InpMaxStopPts) { PrintFormat("[EXEC] BUY skipped: SL %.0f pts > max %d pts", dist, InpMaxStopPts); return; }
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
         if(InpMaxStopPts > 0 && dist > InpMaxStopPts) { PrintFormat("[EXEC] SELL skipped: SL %.0f pts > max %d pts", dist, InpMaxStopPts); return; }
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
