/**
 * Strategy Flow module taxonomy — groups modules for the builder UI.
 *
 * Roles stay compiler phases (direction → setup → confirmation → entry).
 * Taxonomy describes what the module *is*, not where it sits in the gate.
 */

import type { BrainModuleType } from "@/types/blueprint";
import { ALL_BRAIN_MODULES, type BrainModuleDef } from "@/lib/brain-modules";
import { isFlowVerifiedModule } from "@/generators/gen-flow-ea";

export type ModuleTaxonomy =
  | "structure"
  | "entry_zone"
  | "level"
  | "confirmation"
  | "bias_filter"
  | "other";

export interface ModuleTaxonomyGroup {
  id: ModuleTaxonomy;
  label: string;
  hint: string;
  typicalRoles: string;
}

export const MODULE_TAXONOMY_GROUPS: ModuleTaxonomyGroup[] = [
  {
    id: "structure",
    label: "Price structure",
    hint: "Bias and market structure — rarely the final entry alone.",
    typicalRoles: "Direction",
  },
  {
    id: "entry_zone",
    label: "Entry zones",
    hint: "OB, FVG, IFVG, Classic/Gap S/R, rejection, miss — create → retest → confirm.",
    typicalRoles: "Setup → Confirmation / Entry",
  },
  {
    id: "level",
    label: "Levels",
    hint: "Reserved — reactive S/R modules live under Entry zones.",
    typicalRoles: "Setup / Filter",
  },
  {
    id: "confirmation",
    label: "Confirmation",
    hint: "Candle patterns after a zone retest (rejection, engulfing, pin).",
    typicalRoles: "Confirmation / Entry",
  },
  {
    id: "bias_filter",
    label: "Bias & filters",
    hint: "Trend alignment and session-style filters.",
    typicalRoles: "Direction / Filter",
  },
  {
    id: "other",
    label: "Other",
    hint: "Breakout, miss, and modules without flow support yet.",
    typicalRoles: "Varies",
  },
];

/** Primary taxonomy per builder module id. */
export const MODULE_TAXONOMY: Record<BrainModuleType, ModuleTaxonomy> = {
  choch: "structure",
  bos: "structure",
  bos_choch: "structure",
  swing_structure: "structure",
  liqsweep: "structure",
  fvg: "entry_zone",
  fvg_inversion: "entry_zone",
  order_block: "entry_zone",
  ob_fvg: "entry_zone",
  unicorn: "entry_zone",
  snr: "entry_zone",
  gap_snr: "entry_zone",
  rejection: "entry_zone",
  miss: "entry_zone",
  bb: "bias_filter",
  breakout: "other",
  rsi_hd: "bias_filter",
  engulfing: "confirmation",
  seg: "confirmation",
  pin_bar: "confirmation",
  ema: "bias_filter",
  rbr_dbd: "entry_zone",
  mef: "entry_zone",
  qm_mef: "entry_zone",
  snrc2: "entry_zone",
  zone_liq: "entry_zone",
  breaker_block: "entry_zone",
  rss_srr: "entry_zone",
};

export function taxonomyForModule(moduleId: string): ModuleTaxonomy {
  return MODULE_TAXONOMY[moduleId as BrainModuleType] ?? "other";
}

export interface GroupedFlowModules {
  group: ModuleTaxonomyGroup;
  modules: BrainModuleDef[];
}

/** Flow-verified modules grouped for the Strategy Flow builder picker. */
export function flowModulesByTaxonomy(): GroupedFlowModules[] {
  const buckets = new Map<ModuleTaxonomy, BrainModuleDef[]>();
  for (const group of MODULE_TAXONOMY_GROUPS) {
    buckets.set(group.id, []);
  }
  for (const mod of ALL_BRAIN_MODULES) {
    if (!isFlowVerifiedModule(mod.id)) continue;
    const tax = taxonomyForModule(mod.id);
    buckets.get(tax)?.push(mod);
  }
  return MODULE_TAXONOMY_GROUPS.map((group) => ({
    group,
    modules: buckets.get(group.id) ?? [],
  })).filter((g) => g.modules.length > 0);
}
