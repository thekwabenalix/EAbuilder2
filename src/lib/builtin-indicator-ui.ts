/**
 * Built-in indicator picker — maps trader-friendly choices to compile-time wiring.
 *
 * Trend / oscillator categories → verified filterRefs or brain modules (never raw iX() guesses).
 */

import type { BrainModuleType } from "@/types/blueprint";
import { BUILTIN_FILTER_CONTRACTS, type BuiltinFilterRef } from "@/lib/builtin-filter-contracts";
import type { StrategyBlueprint } from "@/types/blueprint";
import type { BuiltinIndicatorRef } from "@/lib/indicator-boundary";
import { explainBuiltinIndicator } from "@/lib/indicator-boundary";

export type IndicatorPickerCategory = "trend" | "oscillator" | "volume" | "bill_williams";

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
    hint: "Moving averages, Bollinger Bands, envelopes",
  },
  {
    id: "oscillator",
    label: "Oscillator",
    hint: "RSI, MACD, momentum filters",
  },
  {
    id: "volume",
    label: "Volume",
    hint: "Volume-based filters (ATR volatility uses price range)",
  },
  {
    id: "bill_williams",
    label: "Bill Williams",
    hint: "Coming soon — catalog reference only for now",
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

/** Indicators the compiler can actually wire today. */
export const INDICATOR_PICKER_OPTIONS: IndicatorPickerOption[] = [
  {
    id: "ema_module",
    name: "EMA / Moving Average",
    category: "trend",
    wiring: "brain_module",
    wiringLabel: "Brain module",
    brainModule: "ema",
    description: "Verified EMA state machine — bias, cross, retest, confirm.",
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
  {
    id: "stochastic_catalog",
    name: "Stochastic",
    category: "oscillator",
    wiring: "catalog",
    wiringLabel: "Reference only",
    catalogIndicatorId: "stochastic",
    description:
      "Recognized in your blueprint — full wiring not available yet. Use RSI/MACD filters or describe in notes.",
  },
  {
    id: "ichimoku_catalog",
    name: "Ichimoku",
    category: "trend",
    wiring: "catalog",
    wiringLabel: "Reference only",
    catalogIndicatorId: "ichimoku",
    description: "Catalog reference only — not compiled into EAs yet.",
  },
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
  const contract = BUILTIN_FILTER_CONTRACTS[option.filterContractId];
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
  const idx = list.findIndex((f) => f.id === next.id && f.appliesTo === next.appliesTo);
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
