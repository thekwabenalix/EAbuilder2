/**
 * Strategy family gate — groups modules by trading school before 4-Brain wiring.
 *
 * Families filter the builder module pickers and warn on cross-family mixes
 * (e.g. Unicorn pocket + SNR Rejection off unrelated levels).
 */
import type { BrainModuleType } from "@/types/blueprint";
import { ALL_BRAIN_MODULES, MODULE_BY_ID, type BrainModuleDef } from "@/lib/brain-modules";
import { ZONE_SCOPED_SETUP_MODULES } from "@/lib/zone-scoped-rejection-repair";

export type StrategyFamily = "smc_ict" | "snr_snd" | "indicators" | "hybrid";

export interface StrategyFamilyMeta {
  id: StrategyFamily;
  label: string;
  shortLabel: string;
  description: string;
  examples: string;
}

export const STRATEGY_FAMILIES: StrategyFamilyMeta[] = [
  {
    id: "smc_ict",
    label: "SMC / ICT",
    shortLabel: "SMC",
    description: "Structure, order blocks, FVG/IFVG, liquidity sweeps, breaker & unicorn zones.",
    examples: "BOS → OB → FVG retest · Unicorn pocket · Liquidity sweep",
  },
  {
    id: "snr_snd",
    label: "S/R & Supply–Demand",
    shortLabel: "SnD",
    description: "Classic & gap S/R, RBR/DBD, MEF, SNR rejection off horizontal levels.",
    examples: "Gap S/R → SNR Rejection · RBR demand · MEF confluence",
  },
  {
    id: "indicators",
    label: "Indicators",
    shortLabel: "Ind",
    description: "EMA, Bollinger, RSI divergence — rule-based bias and triggers.",
    examples: "EMA cross bias · BB touch · RSI hidden divergence",
  },
  {
    id: "hybrid",
    label: "Hybrid",
    shortLabel: "Mix",
    description: "All modules — combine schools when you know the wiring (cross-family warnings still apply).",
    examples: "HTF EMA filter + OB setup · Any custom chain",
  },
];

/** Which families may pick each module (hybrid is implicit for all). */
export const MODULE_STRATEGY_FAMILIES: Record<BrainModuleType, StrategyFamily[]> = {
  choch: ["smc_ict"],
  bos: ["smc_ict"],
  bos_choch: ["smc_ict"],
  swing_structure: ["smc_ict"],
  fvg: ["smc_ict"],
  fvg_inversion: ["smc_ict"],
  order_block: ["smc_ict"],
  ob_fvg: ["smc_ict"],
  unicorn: ["smc_ict"],
  breaker_block: ["smc_ict"],
  liqsweep: ["smc_ict"],
  zone_liq: ["smc_ict"],
  snr: ["snr_snd"],
  gap_snr: ["snr_snd"],
  rejection: ["snr_snd"],
  miss: ["snr_snd"],
  rbr_dbd: ["snr_snd"],
  mef: ["snr_snd"],
  qm_mef: ["snr_snd"],
  snrc2: ["snr_snd"],
  rss_srr: ["snr_snd"],
  breakout: ["snr_snd"],
  ema: ["indicators"],
  bb: ["indicators"],
  rsi_hd: ["indicators"],
  engulfing: ["smc_ict", "snr_snd", "indicators"],
  pin_bar: ["smc_ict", "snr_snd", "indicators"],
  seg: ["smc_ict"],
};

export function familyLabel(family: StrategyFamily): string {
  return STRATEGY_FAMILIES.find((f) => f.id === family)?.label ?? family;
}

export function familyMeta(family: StrategyFamily): StrategyFamilyMeta {
  return STRATEGY_FAMILIES.find((f) => f.id === family) ?? STRATEGY_FAMILIES[0];
}

export function moduleAllowedInFamily(
  moduleId: BrainModuleType | string,
  family: StrategyFamily,
): boolean {
  if (family === "hybrid") return true;
  const families = MODULE_STRATEGY_FAMILIES[moduleId as BrainModuleType];
  if (!families) return false;
  return families.includes(family);
}

export function modulesForFamily(family: StrategyFamily): BrainModuleDef[] {
  if (family === "hybrid") return ALL_BRAIN_MODULES;
  return ALL_BRAIN_MODULES.filter((m) => moduleAllowedInFamily(m.id, family));
}

/** Brain / flow picker list — hides SNR Rejection for SMC and when a zone setup is selected. */
export function pickerModulesForBrain(
  family: StrategyFamily | null | undefined,
  role: "direction" | "setup" | "execution",
  setupModules?: BrainModuleType[],
): BrainModuleDef[] {
  const base = family ? modulesForFamily(family) : ALL_BRAIN_MODULES;
  if (role !== "execution") return base;
  const hideSnr =
    family === "smc_ict" ||
    (setupModules?.some((m) => ZONE_SCOPED_SETUP_MODULES.has(m)) ?? false);
  if (!hideSnr) return base;
  return base.filter((m) => m.id !== "rejection");
}

/** Single-family modules only (excludes engulfing/pin_bar shared across schools). */
export function exclusiveModuleFamily(moduleId: BrainModuleType): StrategyFamily | null {
  const families = MODULE_STRATEGY_FAMILIES[moduleId]?.filter((f) => f !== "hybrid") ?? [];
  if (families.length === 1) return families[0];
  return null;
}

export function inferStrategyFamilyFromModules(
  moduleIds: Array<BrainModuleType | string | undefined>,
): StrategyFamily {
  const ids = [
    ...new Set(
      moduleIds.filter((id): id is BrainModuleType => Boolean(id)) as BrainModuleType[],
    ),
  ];
  if (ids.length === 0) return "hybrid";

  const exclusive = new Set<StrategyFamily>();
  for (const id of ids) {
    const only = exclusiveModuleFamily(id);
    if (only) exclusive.add(only);
  }
  if (exclusive.size === 1) return [...exclusive][0];
  if (exclusive.size > 1) return "hybrid";
  return "smc_ict";
}

export function crossFamilyWarnings(
  moduleIds: Array<BrainModuleType | string | undefined>,
  selectedFamily: StrategyFamily,
): string[] {
  const ids = [
    ...new Set(
      moduleIds.filter((id): id is BrainModuleType => Boolean(id)) as BrainModuleType[],
    ),
  ];
  const warnings: string[] = [];

  if (selectedFamily !== "hybrid") {
    for (const id of ids) {
      if (!moduleAllowedInFamily(id, selectedFamily)) {
        const label = MODULE_BY_ID[id]?.label ?? id;
        warnings.push(
          `${label} belongs to a different strategy family — switch to Hybrid or remove it.`,
        );
      }
    }
    return warnings;
  }

  const smcIds = ids.filter((id) => exclusiveModuleFamily(id) === "smc_ict");
  const snrIds = ids.filter((id) => exclusiveModuleFamily(id) === "snr_snd");
  if (smcIds.length > 0 && snrIds.length > 0) {
    const smcNames = smcIds.map((id) => MODULE_BY_ID[id]?.label ?? id).join(", ");
    const snrNames = snrIds.map((id) => MODULE_BY_ID[id]?.label ?? id).join(", ");
    warnings.push(
      `Mixing SMC/ICT (${smcNames}) with S/R & SnD (${snrNames}) — zone-scoped rejection is not wired yet; steps may not share the same level.`,
    );
  }

  const hasUnicorn = ids.includes("unicorn");
  const hasSnrRejection = ids.includes("rejection");
  if (hasUnicorn && hasSnrRejection) {
    warnings.push(
      "Unicorn + SNR Rejection module id: the compiler remaps this to SMC Zone Rejection on the pocket (not horizontal SNR). Prefer Advanced Flow with UNICORN_CONFIRMED → next bar.",
    );
  }

  return warnings;
}

export function filterModulesForFamily(
  moduleIds: BrainModuleType[],
  family: StrategyFamily,
): BrainModuleType[] {
  if (family === "hybrid") return moduleIds;
  return moduleIds.filter((id) => moduleAllowedInFamily(id, family));
}

/** Ensures every BrainModuleType is mapped — call from verify scripts. */
export function assertCompleteModuleFamilyMap(): void {
  for (const mod of ALL_BRAIN_MODULES) {
    if (!MODULE_STRATEGY_FAMILIES[mod.id]?.length) {
      throw new Error(`MODULE_STRATEGY_FAMILIES missing entry for ${mod.id}`);
    }
  }
}
