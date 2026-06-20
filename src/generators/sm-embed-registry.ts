/**
 * Phase 2 — single source of truth for verified inline state-machine embedding.
 *
 * Used by:
 *   - gen-ea.ts (blueprint + AI assembler)
 *   - gen-flow-ea.ts (strategy flow runtime)
 *   - gen-blueprint-wiring.ts (sm_configs collection)
 */

import type { BosSmMode } from "./gen-bos-sm";
import { genBosSM } from "./gen-bos-sm";
import { genBreakoutSM } from "./gen-breakout-sm";
import { genEmaSM } from "./gen-ema-sm";
import { normalizeEmaParams } from "@/lib/ema-params";
import { genEgSM } from "./gen-eg-sm";
import { genFvgSM } from "./gen-fvg-sm";
import { genGapSnrSM } from "./gen-gap-snr-sm";
import { genFvgInversionSM } from "./gen-ifvg-state-machine";
import { genLiqSweepSM } from "./gen-liqsweep-sm";
import { genMissSM } from "./gen-miss-sm";
import { genRssSrrSM } from "./gen-rss-srr-sm";
import { genBreakerSM } from "./gen-breaker-sm";
import { genSnrc2SM } from "./gen-snrc2-sm";
import { genMefSM } from "./gen-mef-sm";
import { genQmMefSM } from "./gen-qm-mef-sm";
import { genRbrDbdSM } from "./gen-rbr-dbd-sm";
import { genSwingStructureSM } from "./gen-swing-structure-sm";
import { lowerTfLabel } from "@/lib/mef-tf-ladder";
import { genZoneLiqSM } from "./gen-zone-liq-sm";
import { genObFvgSM } from "./gen-obfvg-sm";
import { genUnicornSM } from "./gen-unicorn-sm";
import { genPinSM } from "./gen-pin-sm";
import { genBollSm } from "./gen-boll-sm";
import { genObSM } from "./gen-ob-sm";
import { genRejectionSM } from "./gen-rejection-sm";
import { genRsiHdSM } from "./gen-rsi-hd-sm";
import { genSnrSM } from "./gen-snr-sm";
import { getModuleContract } from "@/lib/module-contracts";

export type SmFamily = "zone" | "bias_break" | "ema" | "bias_filter";
export type SmTickContext = "flow_bar" | "assembler_brain";

type Params = Record<string, unknown>;

export function pInt(p: Params | undefined, k: string, d: number): number {
  const v = p?.[k];
  return typeof v === "number" && isFinite(v) ? Math.trunc(v) : d;
}

export function periodConst(id: string): string {
  const u = id.toUpperCase();
  return u === "MN" ? "PERIOD_MN1" : `PERIOD_${u}`;
}

export function tfConst(tf: string): string {
  return periodConst((tf || "H1").toUpperCase());
}

/** Blueprint module id → sm_config metadata (prefix + config type). */
export const SM_MODULE_META: Record<string, { prefix: string; type: string; bosMode?: BosSmMode }> =
  {
    bos: { prefix: "BOSSM", type: "bos", bosMode: "bos" },
    choch: { prefix: "BOSSM", type: "choch", bosMode: "choch" },
    bos_choch: { prefix: "BOSSM", type: "bos_choch", bosMode: "both" },
    fvg: { prefix: "FVGSM", type: "fvg" },
    fvg_inversion: { prefix: "IFVGSM", type: "fvg_inversion" },
    order_block: { prefix: "OBSM", type: "ob" },
    ob_fvg: { prefix: "OBFVGSM", type: "ob_fvg" },
    unicorn: { prefix: "UNISMSM", type: "unicorn" },
    liqsweep: { prefix: "LSSM", type: "liqsweep" },
    snr: { prefix: "SNRSM", type: "snr" },
    gap_snr: { prefix: "GSNRSM", type: "gap_snr" },
    breakout: { prefix: "BRKSM", type: "breakout" },
    rejection: { prefix: "REJSM", type: "rejection" },
    miss: { prefix: "MISSSM", type: "miss" },
    zone_liq: { prefix: "ZLSM", type: "zone_liq" },
    snrc2: { prefix: "SNRC2SM", type: "snrc2" },
    breaker_block: { prefix: "BBSM", type: "breaker_block" },
    rss_srr: { prefix: "RSSSRRSM", type: "rss_srr" },
    mef: { prefix: "MEFSM", type: "mef" },
    qm_mef: { prefix: "QMMEFSM", type: "qm_mef" },
    rbr_dbd: { prefix: "RBRDBDSM", type: "rbr_dbd" },
    swing_structure: { prefix: "SWINGSM", type: "swing_structure" },
    rsi_hd: { prefix: "RSIHDSM", type: "rsi_hd" },
    engulfing: { prefix: "EGSM", type: "engulfing" },
    pin_bar: { prefix: "PINSM", type: "pin_bar" },
    bb: { prefix: "BOLLSM", type: "bb" },
    ema: { prefix: "EMASM", type: "ema" },
  };

/** Map SM function-name prefix back to generator type (reconcile guard). */
export const SM_PREFIX_TYPE: Record<string, string> = {
  IFVGSM: "fvg_inversion",
  FVGSM: "fvg",
  OBSM: "ob",
  EGSM: "engulfing",
  BOSSM: "bos",
  LSSM: "liqsweep",
  SNRSM: "snr",
  GSNRSM: "gap_snr",
  BRKSM: "breakout",
  REJSM: "rejection",
  MISSSM: "miss",
  ZLSM: "zone_liq",
  SNRC2SM: "snrc2",
  BBSM: "breaker_block",
  RSSSRRSM: "rss_srr",
  MEFSM: "mef",
  QMMEFSM: "qm_mef",
  RBRDBDSM: "rbr_dbd",
  SWINGSM: "swing_structure",
  RSIHDSM: "rsi_hd",
  OBFVGSM: "ob_fvg",
  UNISMSM: "unicorn",
  EMASM: "ema",
  PINSM: "pin_bar",
  BOLLSM: "bb",
};

export interface SmFlowProfile {
  prefix: string;
  family: SmFamily;
  /** Zone modules: HasActiveBull/Bear exists (setup via active zone). */
  hasActive?: boolean;
}

const FLOW_PROFILES: Record<string, SmFlowProfile> = {
  ema: { prefix: "EMASM", family: "ema" },
  bos: { prefix: "BOSSM", family: "bias_break" },
  choch: { prefix: "BOSSM", family: "bias_break" },
  bos_choch: { prefix: "BOSSM", family: "bias_break" },
  fvg: { prefix: "FVGSM", family: "zone", hasActive: true },
  fvg_inversion: { prefix: "IFVGSM", family: "zone", hasActive: true },
  order_block: { prefix: "OBSM", family: "zone", hasActive: true },
  ob_fvg: { prefix: "OBFVGSM", family: "zone", hasActive: true },
  unicorn: { prefix: "UNISMSM", family: "zone", hasActive: true },
  engulfing: { prefix: "EGSM", family: "zone", hasActive: true },
  pin_bar: { prefix: "PINSM", family: "zone", hasActive: true },
  bb: { prefix: "BOLLSM", family: "bias_filter", hasActive: true },
  snr: { prefix: "SNRSM", family: "zone", hasActive: true },
  gap_snr: { prefix: "GSNRSM", family: "zone", hasActive: true },
  breakout: { prefix: "BRKSM", family: "zone", hasActive: true },
  rejection: { prefix: "REJSM", family: "zone", hasActive: true },
  miss: { prefix: "MISSSM", family: "zone", hasActive: true },
  zone_liq: { prefix: "ZLSM", family: "zone", hasActive: true },
  snrc2: { prefix: "SNRC2SM", family: "zone", hasActive: true },
  breaker_block: { prefix: "BBSM", family: "zone", hasActive: true },
  rss_srr: { prefix: "RSSSRRSM", family: "zone", hasActive: true },
  mef: { prefix: "MEFSM", family: "zone", hasActive: true },
  qm_mef: { prefix: "QMMEFSM", family: "zone", hasActive: true },
  rbr_dbd: { prefix: "RBRDBDSM", family: "zone", hasActive: true },
  swing_structure: { prefix: "SWINGSM", family: "bias_break" },
  rsi_hd: { prefix: "RSIHDSM", family: "zone", hasActive: true },
  liqsweep: { prefix: "LSSM", family: "zone", hasActive: false },
};

export function smPrefixForType(type: string): string {
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
    case "zone_liq":
      return "ZLSM";
    case "snrc2":
      return "SNRC2SM";
    case "breaker_block":
      return "BBSM";
    case "rss_srr":
      return "RSSSRRSM";
    case "mef":
      return "MEFSM";
    case "qm_mef":
      return "QMMEFSM";
    case "rbr_dbd":
      return "RBRDBDSM";
    case "swing_structure":
      return "SWINGSM";
    case "rsi_hd":
      return "RSIHDSM";
    case "ob_fvg":
      return "OBFVGSM";
    case "unicorn":
      return "UNISMSM";
    case "ema":
      return "EMASM";
    case "engulfing":
      return "EGSM";
    case "pin_bar":
      return "PINSM";
    case "bb":
      return "BOLLSM";
    case "bos":
    case "choch":
    case "bos_choch":
      return "BOSSM";
    default:
      return type.toUpperCase();
  }
}

function bosModeForType(type: string, override?: BosSmMode): BosSmMode {
  if (override) return override;
  if (type === "choch") return "choch";
  if (type === "bos_choch") return "both";
  return "bos";
}

/** Emit verified inline SM source for a config type + TF instance. */
export function emitStateMachine(
  type: string,
  id: string,
  TF: string,
  tf: string,
  params: Params = {},
  bosModeOverride?: BosSmMode,
): string {
  switch (type) {
    case "fvg":
      return genFvgSM(id, TF, tf, pInt(params, "expiryBars", 100));
    case "fvg_inversion":
      return genFvgInversionSM(id, TF, tf, pInt(params, "expiryBars", 100));
    case "ob":
      return genObSM(
        id,
        TF,
        tf,
        (params.dispMult as number) ?? 0.6,
        pInt(params, "scanBack", 5),
        pInt(params, "expiryBars", 100),
      );
    case "bos":
    case "choch":
    case "bos_choch":
      return genBosSM(
        id,
        TF,
        tf,
        bosModeForType(type, bosModeOverride),
        pInt(params, "swingLen", 5),
        pInt(params, "lookback", 20),
      );
    case "liqsweep":
      return genLiqSweepSM(id, TF, tf, pInt(params, "swingLen", 3), pInt(params, "lookback", 20));
    case "snr":
      return genSnrSM(id, TF, tf, pInt(params, "lookback", 20), pInt(params, "expiryBars", 100));
    case "gap_snr":
      return genGapSnrSM(id, TF, tf, pInt(params, "lookback", 20), pInt(params, "expiryBars", 100));
    case "breakout":
      return genBreakoutSM(
        id,
        TF,
        tf,
        pInt(params, "lookback", 20),
        pInt(params, "expiryBars", 100),
      );
    case "rejection":
      return genRejectionSM(
        id,
        TF,
        tf,
        pInt(params, "lookback", 30),
        (params.minWickRatio as number) ?? 0.5,
        pInt(params, "expiryBars", 150),
      );
    case "miss":
      return genMissSM(
        id,
        TF,
        tf,
        pInt(params, "lookback", 40),
        pInt(params, "swingLen", 3),
        pInt(params, "nearPoints", 50),
        pInt(params, "expiryBars", 200),
      );
    case "rss_srr":
      return genRssSrrSM(
        id,
        TF,
        tf,
        pInt(params, "lookback", 500),
        pInt(params, "minBreaks", 2),
        pInt(params, "expiryBars", 150),
        params.ignoreDoji !== false,
      );
    case "mef": {
      const gapLabel = String(params.gapTf ?? lowerTfLabel(tf, 1));
      const baseLabel = String(params.baseTf ?? lowerTfLabel(tf, 2));
      return genMefSM(
        id,
        TF,
        tf,
        tfConst(gapLabel),
        tfConst(baseLabel),
        pInt(params, "lookback", 300),
        pInt(params, "expiryBars", 150),
        typeof params.impulseRatio === "number" ? params.impulseRatio : 0.5,
        typeof params.baseMaxRatio === "number" ? params.baseMaxRatio : 0.5,
        pInt(params, "maxBaseCandles", 6),
        typeof params.legBaseMult === "number" ? params.legBaseMult : 1.3,
      );
    }
    case "qm_mef": {
      const qmLabel = String(params.qmTf ?? lowerTfLabel(tf, 3));
      const confLabel = String(params.confTf ?? lowerTfLabel(tf, 4));
      return genQmMefSM(
        id,
        TF,
        tf,
        tfConst(qmLabel),
        tfConst(confLabel),
        pInt(params, "lookback", 300),
        pInt(params, "expiryBars", 150),
        typeof params.impulseRatio === "number" ? params.impulseRatio : 0.5,
        typeof params.baseMaxRatio === "number" ? params.baseMaxRatio : 0.5,
        pInt(params, "maxBaseCandles", 6),
        typeof params.legBaseMult === "number" ? params.legBaseMult : 1.3,
        typeof params.confTolFrac === "number" ? params.confTolFrac : 0.3,
      );
    }
    case "rbr_dbd":
      return genRbrDbdSM(
        id,
        TF,
        tf,
        pInt(params, "lookback", 400),
        pInt(params, "expiryBars", 200),
        typeof params.impulseRatio === "number" ? params.impulseRatio : 0.5,
        typeof params.baseMaxRatio === "number" ? params.baseMaxRatio : 0.5,
        pInt(params, "maxBaseCandles", 6),
        typeof params.legBaseMult === "number" ? params.legBaseMult : 1.3,
      );
    case "swing_structure":
      return genSwingStructureSM(
        id,
        TF,
        tf,
        pInt(params, "lookback", 500),
        pInt(params, "swingLeft", pInt(params, "swingLen", 3)),
        pInt(params, "swingRight", pInt(params, "swingLen", 3)),
      );
    case "breaker_block":
      return genBreakerSM(
        id,
        TF,
        tf,
        pInt(params, "lookback", 500),
        pInt(params, "atrPeriod", 14),
        typeof params.dispMult === "number" ? params.dispMult : 1.5,
        pInt(params, "obLookback", pInt(params, "scanBack", 5)),
        pInt(params, "expiryBars", 100),
      );
    case "snrc2":
      return genSnrc2SM(
        id,
        TF,
        tf,
        pInt(params, "lookback", 400),
        pInt(params, "swingStrength", 2),
        tfConst(String(params.htfTf ?? "H4")),
        pInt(params, "htfLookback", 4),
        pInt(params, "expiryBars", 250),
      );
    case "zone_liq":
      return genZoneLiqSM(
        id,
        TF,
        tf,
        pInt(params, "lookback", 200),
        pInt(params, "expiryBars", 200),
        pInt(params, "minLiqBars", 1),
        typeof params.nearATR === "number" ? params.nearATR : 0.2,
        pInt(params, "atrPeriod", 14),
        pInt(params, "nearPoints", 0),
        typeof params.dispMult === "number" ? params.dispMult : 1.5,
        pInt(params, "obScanBack", 5),
        pInt(params, "slBufferPts", 20),
        params.useFVG !== false,
        params.useOB !== false,
        params.useBB !== false,
      );
    case "rsi_hd":
      return genRsiHdSM(
        id,
        TF,
        tf,
        pInt(params, "rsiPeriod", 14),
        pInt(params, "pivotLeft", 3),
        pInt(params, "pivotRight", 3),
        pInt(params, "minBars", 5),
        pInt(params, "maxBars", 50),
        pInt(params, "expiryBars", 60),
      );
    case "ob_fvg":
      return genObFvgSM(id, TF, tf, pInt(params, "expiryBars", 250));
    case "unicorn":
      return genUnicornSM(
        id,
        TF,
        tf,
        pInt(params, "lookback", 500),
        typeof params.dispMult === "number" ? params.dispMult : 1.5,
        pInt(params, "dispAtrPeriod", 14),
        pInt(params, "obScanBack", 5),
        pInt(params, "pairWindow", 15),
        pInt(params, "obExpiry", 300),
        pInt(params, "uniExpiry", 250),
        params.drawZones === true,
      );
    case "ema": {
      const ema = normalizeEmaParams(params);
      return genEmaSM(
        id,
        TF,
        tf,
        ema.fast,
        ema.slow,
        ema.retestPoints,
        ema.requireCross,
        ema.repeatAfterConfirmation,
        ema.periods,
      );
    }
    case "engulfing":
      return genEgSM(id, TF, tf, pInt(params, "scanBack", 3), pInt(params, "expiryBars", 100));
    case "pin_bar":
      return genPinSM(
        id,
        TF,
        tf,
        typeof params.wickRatio === "number" ? params.wickRatio : 0.6,
        typeof params.bodyMaxRatio === "number" ? params.bodyMaxRatio : 0.35,
      );
    case "bb":
      return genBollSm(
        id,
        TF,
        tf,
        pInt(params, "period", 20),
        typeof params.deviation === "number"
          ? params.deviation
          : typeof params.stdDev === "number"
            ? params.stdDev
            : 2.0,
        (params.mode === "breakout" || params.mode === "midline"
          ? params.mode
          : "touch") as "touch" | "breakout" | "midline",
      );
    default:
      return `// Unknown SM type: ${type} (id=${id})`;
  }
}

/** Convenience: embed by blueprint module id + timeframe label. */
export function emitStateMachineForModule(
  moduleId: string,
  timeframe: string,
  params: Params = {},
): string {
  const meta = SM_MODULE_META[moduleId];
  if (!meta) return `// Unknown module SM: ${moduleId}`;
  const id = timeframe.toUpperCase();
  const TF = periodConst(id);
  return emitStateMachine(meta.type, id, TF, id, params, meta.bosMode);
}

/** Tick argument for PREFIX_TF_Tick(...) — context differs between flow bar loop and assembler brains. */
export function tickArgForSm(
  type: string,
  params: Params = {},
  context: SmTickContext = "assembler_brain",
): string {
  if (context === "flow_bar") {
    switch (type) {
      case "ema":
        return "0";
      case "fvg_inversion":
        return "1";
      case "bos":
      case "choch":
      case "bos_choch":
      case "liqsweep":
        return String(pInt(params, "lookback", 20));
      case "fvg":
        return String(pInt(params, "fvgLookback", 50));
      case "unicorn":
        return String(pInt(params, "lookback", 500));
      default:
        return String(pInt(params, "lookback", 50));
    }
  }

  const contract = getModuleContract(type === "ob" ? "order_block" : type);
  if (contract?.tickArgPolicy === "just_closed_bar") return "1";
  if (contract?.tickArgPolicy === "external_bias") return "gBias";
  if (contract?.tickArgPolicy === "none") return "";

  switch (type) {
    case "fvg_inversion":
      return "1";
    case "ema":
      return "gBias";
    case "ob":
      return String(pInt(params, "lookback", pInt(params, "scanBack", 20)));
    case "rsi_hd":
      return String(pInt(params, "lookback", pInt(params, "maxBars", 50)));
    case "ob_fvg":
      return String(pInt(params, "lookback", 50));
    case "unicorn":
      return String(pInt(params, "lookback", 500));
    case "engulfing":
      return String(pInt(params, "scanBack", pInt(params, "lookback", 3)));
    case "pin_bar":
      return "1";
    case "bb":
      return "1";
    default:
      return String(pInt(params, "lookback", 20));
  }
}

export function getSmFlowProfile(moduleId: string): SmFlowProfile | undefined {
  return FLOW_PROFILES[moduleId];
}

function isEntryRole(role: string): boolean {
  return role === "entry" || role === "confirmation";
}

/** Can the flow engine handle this module in this role? */
export function flowSupportsModuleRole(module: string, role: string): boolean {
  const prof = getSmFlowProfile(module);
  if (!prof) return false;
  if (role === "direction")
    return prof.family === "ema" || prof.family === "bias_break" || prof.family === "bias_filter";
  if (role === "setup" || role === "filter" || isEntryRole(role)) return true;
  return false;
}

/** Modules without verified inline SMs — simple 4-Brain only (legacy heuristic path). */
export const LEGACY_HEURISTIC_MODULE_IDS = new Set<string>([]);

export function isFlowVerifiedModule(moduleId: string): boolean {
  if (LEGACY_HEURISTIC_MODULE_IDS.has(moduleId)) return false;
  return Boolean(getSmFlowProfile(moduleId));
}

/** Regex alternation of known SM prefixes (IFVGSM before FVGSM). */
export const SM_PREFIX_REGEX =
  "RSIHDSM|OBFVGSM|UNISMSM|EMASM|IFVGSM|FVGSM|EGSM|PINSM|BOLLSM|OBSM|BOSSM|LSSM|GSNRSM|SNRSM|BRKSM|REJSM|MISSSM|ZLSM|SNRC2SM|BBSM|RSSSRRSM|MEFSM|QMMEFSM|RBRDBDSM|SWINGSM";
