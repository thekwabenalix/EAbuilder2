/**
 * Deterministic 4-Brain wiring from a FourBrainConfig.
 *
 * Used by template mode so every trader blueprint compiles through the same
 * verified inline state machines as AI mode — not ad-hoc heuristics.
 */

import type { AiBrainWiring } from "@/lib/api-client";
import type { BrainConfig, BrainModuleType, FourBrainConfig } from "@/types/blueprint";
import type { BuiltinFilterRef } from "@/lib/builtin-filter-contracts";
import { SM_MODULE_META } from "./sm-embed-registry";

export { SM_MODULE_META } from "./sm-embed-registry";

/** Modules that still use legacy heuristic brain generators (no verified SM). */
const LEGACY_HEURISTIC_MODULES = new Set<BrainModuleType>(["pin_bar", "bb", "swing_structure"]);

function period(tf: string): string {
  const u = tf.toUpperCase();
  return u === "MN" ? "PERIOD_MN1" : `PERIOD_${u}`;
}

function tfLabel(tf: string): string {
  return tf.toUpperCase();
}

function isEmaCtcParams(params: Record<string, unknown> | undefined): boolean {
  return (
    params?.sequenceMode === "cross_test_close" ||
    params?.entryEvent === "close_confirmation" ||
    (params?.requireCross === true && typeof params?.retestTarget === "string")
  );
}

function isIfvgFormation(params: Record<string, unknown> | undefined): boolean {
  const ev = params?.entryEvent;
  return ev === "formation" || ev === "just_inverted" || ev === "inversion";
}

function numParam(params: Record<string, unknown> | undefined, key: string, def: number): number {
  const v = params?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : def;
}

function brainParams(brain: BrainConfig | undefined): Record<string, unknown> {
  return brain?.params && typeof brain.params === "object" ? brain.params : {};
}

export function configUsesLegacyHeuristics(config: FourBrainConfig): boolean {
  const mods = [
    ...(config.direction?.modules ?? []),
    ...(config.setup?.modules ?? []),
    ...(config.execution?.modules ?? []),
  ];
  return mods.some((m) => LEGACY_HEURISTIC_MODULES.has(m));
}

function smConfigEntry(
  module: string,
  tf: string,
  params: Record<string, unknown>,
): NonNullable<AiBrainWiring["sm_configs"]>[string] {
  const meta = SM_MODULE_META[module];
  if (!meta) throw new Error(`No SM metadata for module "${module}"`);
  return {
    type: meta.type,
    id: tfLabel(tf),
    TF: period(tf),
    tf: tfLabel(tf),
    params,
  };
}

function collectSmConfigs(config: FourBrainConfig): AiBrainWiring["sm_configs"] {
  const smConfigs: AiBrainWiring["sm_configs"] = {};
  const brains: Array<BrainConfig | undefined> = [config.direction, config.setup, config.execution];

  for (const brain of brains) {
    if (!brain?.modules?.length || !brain.timeframe) continue;
    const params = brainParams(brain);
    const tf = brain.timeframe;
    for (const mod of brain.modules) {
      if (mod === "ema") {
        if (!isEmaCtcParams(params)) continue;
        const key = `ema_${tfLabel(tf)}`;
        smConfigs[key] = {
          type: "ema",
          id: tfLabel(tf),
          TF: period(tf),
          tf: tfLabel(tf),
          params,
        };
        continue;
      }
      const meta = SM_MODULE_META[mod];
      if (!meta) continue;
      const key = `${meta.type}_${tfLabel(tf)}`;
      if (!smConfigs[key]) {
        smConfigs[key] = smConfigEntry(mod, tf, params);
      }
    }
  }

  return smConfigs;
}

function directionModuleSignal(
  mod: BrainModuleType,
  tf: string,
  varName: string,
  params: Record<string, unknown>,
): string {
  const t = tfLabel(tf);
  if (mod === "bos" || mod === "choch" || mod === "bos_choch") {
    return `if(BOSSM_${t}_IsBull()) ${varName} = 1;
   else if(BOSSM_${t}_IsBear()) ${varName} = -1;`;
  }
  if (mod === "ema") {
    if (isEmaCtcParams(params)) {
      return `{
      int _b = EMASM_${t}_Bias();
      if(_b != 0) ${varName} = _b;
   }`;
    }
    const fast = numParam(params, "fastPeriod", 21);
    const slow = numParam(params, "slowPeriod", 50);
    return `{
      int _hF = B4_MA(PERIOD_${t}, ${fast}, MODE_EMA);
      int _hS = B4_MA(PERIOD_${t}, ${slow}, MODE_EMA);
      double _fast = B4_MAval(_hF, 1);
      double _slow = B4_MAval(_hS, 1);
      if(_fast > _slow) ${varName} = 1;
      else if(_fast < _slow) ${varName} = -1;
   }`;
  }
  if (mod === "engulfing") {
    return `if(EGSM_${t}_BullJustConfirmed()) ${varName} = 1;
   else if(EGSM_${t}_BearJustConfirmed()) ${varName} = -1;`;
  }
  const meta = SM_MODULE_META[mod];
  if (!meta) return `// ${mod}: no verified SM wiring`;
  const p = meta.prefix;
  return `if(${p}_${t}_HasActiveBull()) ${varName} = 1;
   else if(${p}_${t}_HasActiveBear()) ${varName} = -1;`;
}

function setupModuleBlock(
  mod: BrainModuleType,
  tf: string,
  params: Record<string, unknown>,
): string {
  const t = tfLabel(tf);
  if (mod === "order_block") {
    return `if((gBias == 0 || gBias == 1) && OBSM_${t}_HasActiveBull()) {
      gSetupActive = true; gSetupDir = 1; gSetupSLHint = OBSM_${t}_LatestBullLL();
   } else if((gBias == 0 || gBias == -1) && OBSM_${t}_HasActiveBear()) {
      gSetupActive = true; gSetupDir = -1; gSetupSLHint = OBSM_${t}_LatestBearUL();
   }`;
  }
  if (mod === "fvg_inversion") {
    return `if((gBias == 0 || gBias == 1) && IFVGSM_${t}_HasActiveBull()) {
      gSetupActive = true; gSetupDir = 1; gSetupSLHint = IFVGSM_${t}_LatestBullLL();
   } else if((gBias == 0 || gBias == -1) && IFVGSM_${t}_HasActiveBear()) {
      gSetupActive = true; gSetupDir = -1; gSetupSLHint = IFVGSM_${t}_LatestBearUL();
   }`;
  }
  if (mod === "rsi_hd" || mod === "ob_fvg") {
    const p = SM_MODULE_META[mod]!.prefix;
    return `if((gBias == 0 || gBias == 1) && ${p}_${t}_HasActiveBull()) {
      gSetupActive = true; gSetupDir = 1; gSetupSLHint = ${p}_${t}_ActiveBullSL();
   } else if((gBias == 0 || gBias == -1) && ${p}_${t}_HasActiveBear()) {
      gSetupActive = true; gSetupDir = -1; gSetupSLHint = ${p}_${t}_ActiveBearSL();
   }`;
  }
  if (mod === "liqsweep") {
    return `if((gBias == 0 || gBias == 1) && LSSM_${t}_BullJustConfirmed()) {
      gSetupActive = true; gSetupDir = 1; gSetupSLHint = LSSM_${t}_BullConfirmSL();
   } else if((gBias == 0 || gBias == -1) && LSSM_${t}_BearJustConfirmed()) {
      gSetupActive = true; gSetupDir = -1; gSetupSLHint = LSSM_${t}_BearConfirmSL();
   }`;
  }
  if (mod === "ema" && isEmaCtcParams(params)) {
    return `if(EMASM_${t}_SetupActive()) {
      int _d = EMASM_${t}_ActiveDir();
      if(_d != 0 && (gBias == 0 || gBias == _d)) {
         gSetupActive = true; gSetupDir = _d; gSetupSLHint = EMASM_${t}_ActiveSL();
      }
   }`;
  }
  const meta = SM_MODULE_META[mod];
  if (!meta) return `// ${mod}: setup wiring unavailable`;
  const p = meta.prefix;
  return `if((gBias == 0 || gBias == 1) && ${p}_${t}_HasActiveBull()) {
      gSetupActive = true; gSetupDir = 1; gSetupSLHint = ${p}_${t}_BullConfirmSL();
   } else if((gBias == 0 || gBias == -1) && ${p}_${t}_HasActiveBear()) {
      gSetupActive = true; gSetupDir = -1; gSetupSLHint = ${p}_${t}_BearConfirmSL();
   }`;
}

function executionModuleBlock(
  mod: BrainModuleType,
  tf: string,
  params: Record<string, unknown>,
): string {
  const t = tfLabel(tf);
  if (mod === "ema") {
    if (isEmaCtcParams(params)) {
      return `if(!gExecSignal && EMASM_${t}_JustConfirmed()) {
      int _dir = EMASM_${t}_ConfirmDir();
      if(_dir != 0 && (gBias == 0 || gBias == _dir) && (gSetupDir == 0 || gSetupDir == _dir)) {
         gExecSignal = true; gExecDir = _dir; gExecSL = EMASM_${t}_ConfirmSL();
      }
   }`;
    }
    const fast = numParam(params, "fastPeriod", 21);
    const slow = numParam(params, "slowPeriod", 50);
    return `if(!gExecSignal) {
      int _hF = B4_MA(PERIOD_${t}, ${fast}, MODE_EMA);
      int _hS = B4_MA(PERIOD_${t}, ${slow}, MODE_EMA);
      double _f1 = B4_MAval(_hF, 1), _f2 = B4_MAval(_hF, 2);
      double _s1 = B4_MAval(_hS, 1), _s2 = B4_MAval(_hS, 2);
      double _l1 = iLow(InpSymbol, PERIOD_${t}, 1);
      double _h1 = iHigh(InpSymbol, PERIOD_${t}, 1);
      if(_f2 <= _s2 && _f1 > _s1 && (gBias == 0 || gBias == 1) && (gSetupDir == 0 || gSetupDir == 1)) {
         gExecSignal = true; gExecDir = 1; gExecSL = _l1;
      } else if(_f2 >= _s2 && _f1 < _s1 && (gBias == 0 || gBias == -1) && (gSetupDir == 0 || gSetupDir == -1)) {
         gExecSignal = true; gExecDir = -1; gExecSL = _h1;
      }
   }`;
  }

  const meta = SM_MODULE_META[mod];
  if (!meta) return `// ${mod}: execution wiring unavailable`;

  const p = meta.prefix;
  let bullEvent = "BullJustConfirmed";
  let bearEvent = "BearJustConfirmed";
  let bullSl = `${p}_${t}_BullConfirmSL()`;
  let bearSl = `${p}_${t}_BearConfirmSL()`;

  if (mod === "fvg_inversion" && isIfvgFormation(params)) {
    bullEvent = "BullJustInverted";
    bearEvent = "BearJustInverted";
    bullSl = `${p}_${t}_BullInversionSL()`;
    bearSl = `${p}_${t}_BearInversionSL()`;
  }

  if (mod === "order_block") {
    bullSl = `${p}_${t}_LatestBullLL()`;
    bearSl = `${p}_${t}_LatestBearUL()`;
  }

  return `if(!gExecSignal) {
      if((gBias == 0 || gBias == 1) && (gSetupDir == 0 || gSetupDir == 1) && ${p}_${t}_${bullEvent}()) {
         gExecSignal = true; gExecDir = 1; gExecSL = ${bullSl};
      } else if((gBias == 0 || gBias == -1) && (gSetupDir == 0 || gSetupDir == -1) && ${p}_${t}_${bearEvent}()) {
         gExecSignal = true; gExecDir = -1; gExecSL = ${bearSl};
      }
   }`;
}

function buildDirectionBrain(brain: BrainConfig | undefined): string {
  if (!brain?.modules?.length) {
    return `void Direction_Brain_Execute() {}`;
  }
  const tf = brain.timeframe ?? "D1";
  const params = brainParams(brain);
  const modules = brain.modules;

  if (modules.length === 1) {
    const mod = modules[0];
    return `void Direction_Brain_Execute()
{
   int _sig = 0;
   ${directionModuleSignal(mod, tf, "_sig", params)}
   if(_sig != 0 && gBias != _sig) {
      PrintFormat("[DIR/${tfLabel(tf)}] ${mod.toUpperCase()} %s", _sig > 0 ? "BULL" : "BEAR");
      gBias = _sig;
   }
}`;
  }

  const decls = modules.map((m, i) => `   int _sig${i} = 0;  // ${m}`).join("\n");
  const detections = modules
    .map((m, i) => directionModuleSignal(m, tf, `_sig${i}`, params))
    .join("\n");
  const vars = modules.map((_, i) => `_sig${i}`);
  const nonZero = vars.map((v) => `${v} != 0`).join(" && ");
  const agree = vars
    .slice(1)
    .map((v) => `${v} == _sig0`)
    .join(" && ");

  return `void Direction_Brain_Execute()
{
${decls}
${detections}
   bool _allNonZero = (${nonZero});
   bool _allAgree   = _allNonZero && (${modules.length > 1 ? agree : "true"});
   if(_allAgree) {
      int _combined = _sig0;
      if(gBias != _combined) {
         PrintFormat("[DIR/${tfLabel(tf)}] direction confirmed %s", _combined > 0 ? "BULL" : "BEAR");
         gBias = _combined;
      }
   }
}`;
}

function buildSetupBrain(brain: BrainConfig | undefined): string {
  if (!brain?.modules?.length) {
    return `void Setup_Brain_Execute()
{
   gSetupActive = (gBias != 0);
   gSetupDir    = gBias;
   gSetupSLHint = 0.0;
}`;
  }

  const tf = brain.timeframe ?? "H4";
  const blocks = brain.modules.map((mod) => {
    if (mod === "ema" && !isEmaCtcParams(brainParams(brain))) {
      const fast = numParam(brainParams(brain), "fastPeriod", 21);
      const slow = numParam(brainParams(brain), "slowPeriod", 50);
      const t = tfLabel(tf);
      return `if(!gSetupActive) {
      int _hF = B4_MA(PERIOD_${t}, ${fast}, MODE_EMA);
      int _hS = B4_MA(PERIOD_${t}, ${slow}, MODE_EMA);
      double _ask = SymbolInfoDouble(InpSymbol, SYMBOL_ASK);
      double _bid = SymbolInfoDouble(InpSymbol, SYMBOL_BID);
      double _fast = B4_MAval(_hF, 1);
      double _slow = B4_MAval(_hS, 1);
      if(_ask > _fast && _fast > _slow && (gBias == 0 || gBias == 1)) {
         gSetupActive = true; gSetupDir = 1; gSetupSLHint = _slow;
      } else if(_bid < _fast && _fast < _slow && (gBias == 0 || gBias == -1)) {
         gSetupActive = true; gSetupDir = -1; gSetupSLHint = _slow;
      }
   }`;
    }
    return `if(!gSetupActive) {\n      ${setupModuleBlock(mod, tf, brainParams(brain))}\n   }`;
  });

  return `void Setup_Brain_Execute()
{
   gSetupActive = false;
   gSetupDir    = 0;
   gSetupSLHint = 0.0;
${blocks.join("\n")}
}`;
}

function buildExecutionBrain(brain: BrainConfig): string {
  const tf = brain.timeframe ?? "H1";
  const params = brainParams(brain);
  const blocks = brain.modules.map((mod) => executionModuleBlock(mod, tf, params));

  return `void Execution_Brain_Execute()
{
   gExecSignal = false;
   gExecDir    = 0;
   gExecSL     = 0.0;
${blocks.join("\n")}
}`;
}

/**
 * Build verified SM wiring from a FourBrainConfig (template / offline path).
 */
export function buildBlueprintWiring(
  config: FourBrainConfig,
  _filterRefs?: BuiltinFilterRef[],
): AiBrainWiring {
  const smConfigs = collectSmConfigs(config);
  const requiredSms = Object.values(smConfigs).map(
    (cfg) => `${smPrefixFromType(cfg.type)}_${cfg.id}`,
  );

  return {
    direction_brain: buildDirectionBrain(config.direction),
    setup_brain: buildSetupBrain(config.setup),
    execution_brain: buildExecutionBrain(config.execution),
    required_sms: [...new Set(requiredSms)],
    sm_configs: smConfigs,
    notes:
      "Deterministic blueprint wiring — verified inline state machines embedded by gen-ea.ts assembler.",
    semantics: {
      version: 1,
      source: "deterministic_adapter",
      timeframe: config.execution.timeframe,
      modules: [
        ...(config.direction?.modules ?? []),
        ...(config.setup?.modules ?? []),
        ...config.execution.modules,
      ],
      assumptions: [],
    },
    validation: { status: "pass", errors: [], warnings: [] },
  };
}

function smPrefixFromType(type: string): string {
  switch (type) {
    case "fvg_inversion":
      return "IFVGSM";
    case "fvg":
      return "FVGSM";
    case "ob":
      return "OBSM";
    case "liqsweep":
      return "LSSM";
    case "snr":
      return "SNRSM";
    case "gap_snr":
      return "GSNRSM";
    case "breakout":
      return "BRKSM";
    case "rejection":
      return "REJSM";
    case "miss":
      return "MISSSM";
    case "rsi_hd":
      return "RSIHDSM";
    case "ob_fvg":
      return "OBFVGSM";
    case "ema":
      return "EMASM";
    case "engulfing":
      return "EGSM";
    case "bos":
    case "choch":
    case "bos_choch":
      return "BOSSM";
    default:
      return type.toUpperCase();
  }
}
