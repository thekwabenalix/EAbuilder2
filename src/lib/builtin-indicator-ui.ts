/**
 * Built-in indicator picker - maps trader-friendly choices to compile-time wiring.
 *
 * Trend / oscillator categories → verified filterRefs or brain modules (never raw iX() guesses).
 * Native MT5 builtins (via=builtin) compile as generic buffer confluence filters.
 */

import type { BrainModuleType } from "@/types/blueprint";
import { BUILTIN_FILTER_CONTRACTS, type BuiltinFilterRef } from "@/lib/builtin-filter-contracts";
import type { StrategyBlueprint } from "@/types/blueprint";
import type { BuiltinIndicatorRef } from "@/lib/indicator-boundary";
import { explainBuiltinIndicator } from "@/lib/indicator-boundary";
import { INDICATOR_REGISTRY } from "@/lib/indicator-registry";
import { createMt5BufferFilterRef, MT5_BUFFER_FILTER_ID } from "@/lib/mt5-buffer-filter";

export type IndicatorPickerCategory =
  | "trend"
  | "oscillator"
  | "volume"
  | "bill_williams"
  | "custom_included";

export type IndicatorWiringKind = "filter" | "brain_module" | "catalog";

export interface IndicatorPickerCategoryDef {
  id: IndicatorPickerCategory;
  label: string;
  hint: string;
}

export const INDICATOR_PICKER_CATEGORIES: IndicatorPickerCategoryDef[] = [
  {
    id: "trend",
    label: "Trend",
    hint: "MA, Bollinger, Envelopes, Ichimoku, SAR, ADX…",
  },
  {
    id: "oscillator",
    label: "Oscillator",
    hint: "RSI, MACD, Stochastic, CCI, Momentum…",
  },
  {
    id: "volume",
    label: "Volume",
    hint: "Volumes, MFI, OBV, Accumulation/Distribution",
  },
  {
    id: "bill_williams",
    label: "Bill Williams",
    hint: "AO, AC, Alligator, Fractals, Gator…",
  },
  {
    id: "custom_included",
    label: "MT5 Examples",
    hint: "Indicators in MetaTrader Examples (reference until iCustom wired)",
  },
];

export interface IndicatorPickerOption {
  id: string;
  name: string;
  category: IndicatorPickerCategory;
  wiring: IndicatorWiringKind;
  /** Short badge in UI */
  wiringLabel: string;
  description: string;
  filterContractId?: keyof typeof BUILTIN_FILTER_CONTRACTS;
  brainModule?: BrainModuleType;
  catalogIndicatorId?: string;
  defaultFilterParams?: Record<string, unknown>;
}

/** Hand-tuned options (richer semantics than the generic buffer gate). */
const VERIFIED_INDICATOR_PICKER_OPTIONS: IndicatorPickerOption[] = [
  {
    id: "ema_module",
    name: "EMA / Moving Average",
    category: "trend",
    wiring: "brain_module",
    wiringLabel: "Brain module",
    brainModule: "ema",
    description: "Verified EMA state machine - bias, cross, retest, confirm.",
  },
  {
    id: "bb_module",
    name: "Bollinger Bands",
    category: "trend",
    wiring: "brain_module",
    wiringLabel: "Brain module",
    brainModule: "bb",
    description: "Bollinger module (Simple 4-Brain template path).",
  },
  {
    id: "rsi_filter",
    name: "RSI level",
    category: "oscillator",
    wiring: "filter",
    wiringLabel: "Confluence filter",
    filterContractId: "rsi_level_filter",
    catalogIndicatorId: "rsi",
    defaultFilterParams: { period: 14, level: 50, operator: "directional" },
    description: "Gates trades when RSI is above/below a level (uses native iRSI).",
  },
  {
    id: "macd_filter",
    name: "MACD histogram",
    category: "oscillator",
    wiring: "filter",
    wiringLabel: "Confluence filter",
    filterContractId: "macd_histogram_filter",
    catalogIndicatorId: "macd",
    defaultFilterParams: {
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      operator: "directional",
    },
    description: "Gates trades when MACD histogram is above/below zero.",
  },
  {
    id: "rsi_hd_module",
    name: "RSI hidden divergence",
    category: "oscillator",
    wiring: "brain_module",
    wiringLabel: "Brain module",
    brainModule: "rsi_hd",
    description: "Verified RSI hidden divergence state machine.",
  },
  {
    id: "tdi_module",
    name: "Traders Dynamic Index",
    category: "oscillator",
    wiring: "brain_module",
    wiringLabel: "Brain module",
    brainModule: "tdi",
    description: "Verified TDI composite (RSI Price/Signal/MBL + bands on RSI).",
  },
  {
    id: "atr_filter",
    name: "ATR volatility",
    category: "volume",
    wiring: "filter",
    wiringLabel: "Confluence filter",
    filterContractId: "atr_volatility_filter",
    catalogIndicatorId: "atr",
    defaultFilterParams: { period: 14, minAtrPoints: 0, maxAtrPoints: 0, operator: "above" },
    description: "Skip entries when volatility is too low or too high.",
  },
];

const VERIFIED_CATALOG_IDS = new Set(
  VERIFIED_INDICATOR_PICKER_OPTIONS.map((option) => option.catalogIndicatorId).filter(Boolean),
);
const VERIFIED_BRAIN_BY_CATALOG: Record<string, true> = {
  ma: true,
  bands: true,
};

/** Every native MT5 iX() from the registry — compiles as a buffer confluence filter. */
const MT5_BUILTIN_FILTER_OPTIONS: IndicatorPickerOption[] = INDICATOR_REGISTRY.filter(
  (indicator) =>
    indicator.via === "builtin" &&
    !VERIFIED_CATALOG_IDS.has(indicator.id) &&
    !VERIFIED_BRAIN_BY_CATALOG[indicator.id],
).map((indicator) => ({
  id: `mt5_${indicator.id}`,
  name: indicator.name,
  category: indicator.category,
  wiring: "filter" as const,
  wiringLabel: "MT5 built-in",
  filterContractId: MT5_BUFFER_FILTER_ID,
  catalogIndicatorId: indicator.id,
  description: `${indicator.mql5} — compiles as a confluence gate (buffer vs level/price). ${indicator.description}`,
}));

/** Examples folder — reference until dedicated iCustom wiring lands. */
const REGISTRY_CATALOG_OPTIONS: IndicatorPickerOption[] = INDICATOR_REGISTRY.filter(
  (indicator) => indicator.via === "icustom",
).map((indicator) => ({
  id: `catalog_${indicator.id}`,
  name: indicator.name,
  category: indicator.category,
  wiring: "catalog" as const,
  wiringLabel: "MT5 example",
  catalogIndicatorId: indicator.id,
  description: `${indicator.mql5} — saved as reference (Examples folder). Prefer native builtins for live EAs.`,
}));

export const INDICATOR_PICKER_OPTIONS: IndicatorPickerOption[] = [
  ...VERIFIED_INDICATOR_PICKER_OPTIONS,
  ...MT5_BUILTIN_FILTER_OPTIONS,
  ...REGISTRY_CATALOG_OPTIONS,
];

export function pickerOptionsForCategory(
  category: IndicatorPickerCategory,
): IndicatorPickerOption[] {
  return INDICATOR_PICKER_OPTIONS.filter((o) => o.category === category);
}

export function defaultAppliesToForBrain(
  brainRole: "direction" | "setup" | "execution",
): "setup" | "execution" {
  return brainRole === "setup" ? "setup" : "execution";
}

export function createFilterRefFromPicker(
  option: IndicatorPickerOption,
  timeframe: string,
  appliesTo: "setup" | "execution",
): BuiltinFilterRef | null {
  if (option.wiring !== "filter" || !option.filterContractId) return null;

  if (option.filterContractId === MT5_BUFFER_FILTER_ID && option.catalogIndicatorId) {
    const fromRegistry = INDICATOR_REGISTRY.find((i) => i.id === option.catalogIndicatorId);
    if (fromRegistry) return createMt5BufferFilterRef(fromRegistry, timeframe, appliesTo);
    return null;
  }

  const contract = BUILTIN_FILTER_CONTRACTS[option.filterContractId];
  if (!contract) return null;
  return {
    id: contract.id,
    label: contract.label,
    indicatorId: contract.indicatorId,
    role: "filter",
    appliesTo,
    timeframe,
    params: { ...option.defaultFilterParams },
    status: "builtin_filter",
    note: contract.notes,
  };
}

export function createCatalogRefFromPicker(
  option: IndicatorPickerOption,
): BuiltinIndicatorRef | null {
  if (!option.catalogIndicatorId) return null;
  return explainBuiltinIndicator(option.catalogIndicatorId) ?? null;
}

export function mergeFilterRef(
  existing: StrategyBlueprint["filterRefs"],
  next: BuiltinFilterRef,
): NonNullable<StrategyBlueprint["filterRefs"]> {
  const list = [...(existing ?? [])];
  const idx = list.findIndex(
    (f) =>
      f.id === next.id &&
      f.appliesTo === next.appliesTo &&
      f.indicatorId === next.indicatorId &&
      String(f.params?.registryId ?? "") === String(next.params?.registryId ?? ""),
  );
  if (idx >= 0) list[idx] = next;
  else list.push(next);
  return list;
}

export function mergeIndicatorRef(
  existing: StrategyBlueprint["indicatorRefs"],
  next: BuiltinIndicatorRef,
): NonNullable<StrategyBlueprint["indicatorRefs"]> {
  const list = [...(existing ?? [])];
  if (!list.some((r) => r.id === next.id)) list.push(next);
  return list;
}
