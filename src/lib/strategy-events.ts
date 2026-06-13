import type { BrainModuleType, Timeframe } from "../types/blueprint";
import type { BrainRole } from "./module-contracts";

export type StrategyDirection = 1 | -1 | 0;

export type StrategyEventCategory =
  | "bias"
  | "setup"
  | "zone"
  | "zone_retest"
  | "confirmation"
  | "entry"
  | "invalidation"
  | "filter";

export type StrategyEventType =
  | "EMA_BIAS"
  | "EMA_CROSS"
  | "EMA_RETEST"
  | "EMA_CLOSE_CONFIRMED"
  | "FVG_CREATED"
  | "FVG_RETESTED"
  | "FVG_CONFIRMED"
  | "IFVG_FORMED"
  | "IFVG_RETESTED"
  | "IFVG_CONFIRMED"
  | "OB_CREATED"
  | "OB_RETESTED"
  | "OB_CONFIRMED"
  | "OB_FVG_CONFLUENCE"
  | "OB_FVG_CONFIRMED"
  | "BOS_BIAS"
  | "BOS_CONFIRMED"
  | "CHOCH_BIAS_FLIP"
  | "CHOCH_CONFIRMED"
  | "STRUCTURE_CONFIRMED"
  | "SWING_BIAS"
  | "SWING_LEVEL"
  | "LIQUIDITY_SWEEP"
  | "SNR_TOUCH"
  | "GAP_SNR_TOUCH"
  | "REJECTION_CONFIRMED"
  | "MISSED_LEVEL"
  | "ZONE_LIQ_ARMED"
  | "ZONE_LIQ_CONFIRMED"
  | "SNRC2_ACTIVE"
  | "SNRC2_CONFIRMED"
  | "BREAKOUT_CONFIRMED"
  | "RSI_HD_ACTIVE"
  | "RSI_HD_CONFIRMED"
  | "BB_TOUCH"
  | "BB_BREAKOUT"
  | "ENGULFING_ZONE_ACTIVE"
  | "ENGULFING_CONFIRMED"
  | "ENGULFING_FLIP"
  | "PIN_BAR_CONFIRMED";

export interface StrategyEventContract {
  id: StrategyEventType;
  label: string;
  category: StrategyEventCategory;
  roles: BrainRole[];
  description: string;
  carriesDirection: boolean;
  carriesPrice: boolean;
  carriesZone: boolean;
  carriesSlHint: boolean;
  terminal?: boolean;
}

export interface StrategyRuntimeEvent {
  eventId: string;
  type: StrategyEventType;
  moduleId: BrainModuleType | string;
  timeframe: Timeframe | string;
  direction: StrategyDirection;
  eventTime: string;
  barShift?: number;
  price?: number;
  zoneHigh?: number;
  zoneLow?: number;
  slHint?: number;
  sourceStepId?: string;
  metadata?: Record<string, unknown>;
}

export interface ModuleSemanticEventRef {
  moduleId: BrainModuleType | string;
  semanticEventId: string;
  eventType: StrategyEventType;
}

export const STRATEGY_EVENT_CONTRACTS: Record<StrategyEventType, StrategyEventContract> = {
  EMA_BIAS: {
    id: "EMA_BIAS",
    label: "EMA Bias",
    category: "bias",
    roles: ["direction"],
    description: "Fast/slow EMA alignment sets directional bias.",
    carriesDirection: true,
    carriesPrice: false,
    carriesZone: false,
    carriesSlHint: false,
  },
  EMA_CROSS: {
    id: "EMA_CROSS",
    label: "EMA Cross",
    category: "bias",
    roles: ["direction", "setup"],
    description: "Fast EMA crosses the slow EMA.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: false,
    carriesSlHint: false,
  },
  EMA_RETEST: {
    id: "EMA_RETEST",
    label: "EMA Retest",
    category: "zone_retest",
    roles: ["setup"],
    description: "Price retests the configured EMA after a cross.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: false,
    carriesSlHint: true,
  },
  EMA_CLOSE_CONFIRMED: {
    id: "EMA_CLOSE_CONFIRMED",
    label: "EMA Close Confirmation",
    category: "entry",
    roles: ["execution"],
    description: "After EMA retest, price closes back beyond the fast EMA.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: false,
    carriesSlHint: true,
  },
  FVG_CREATED: {
    id: "FVG_CREATED",
    label: "FVG Created",
    category: "zone",
    roles: ["direction", "setup"],
    description: "A fair value gap zone exists.",
    carriesDirection: true,
    carriesPrice: false,
    carriesZone: true,
    carriesSlHint: true,
  },
  FVG_RETESTED: {
    id: "FVG_RETESTED",
    label: "FVG Retested",
    category: "zone_retest",
    roles: ["setup", "execution"],
    description: "Price has returned into a fair value gap zone.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: true,
    carriesSlHint: true,
  },
  FVG_CONFIRMED: {
    id: "FVG_CONFIRMED",
    label: "FVG Rejection (wick touch, close holds)",
    category: "entry",
    roles: ["execution"],
    description: "FVG lifecycle confirmation has fired.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: true,
    carriesSlHint: true,
  },
  IFVG_FORMED: {
    id: "IFVG_FORMED",
    label: "IFVG Formed",
    category: "entry",
    roles: ["direction", "setup", "execution"],
    description: "An old FVG inverted by closing through its boundary.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: true,
    carriesSlHint: true,
  },
  IFVG_RETESTED: {
    id: "IFVG_RETESTED",
    label: "IFVG Retested",
    category: "zone_retest",
    roles: ["setup", "execution"],
    description: "Price returned to an inversion FVG zone.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: true,
    carriesSlHint: true,
  },
  IFVG_CONFIRMED: {
    id: "IFVG_CONFIRMED",
    label: "IFVG Rejection (wick touch, close holds)",
    category: "entry",
    roles: ["execution"],
    description: "Inversion FVG retest confirmation fired.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: true,
    carriesSlHint: true,
  },
  OB_CREATED: {
    id: "OB_CREATED",
    label: "Order Block Created",
    category: "zone",
    roles: ["direction", "setup"],
    description: "An order block zone exists.",
    carriesDirection: true,
    carriesPrice: false,
    carriesZone: true,
    carriesSlHint: true,
  },
  OB_RETESTED: {
    id: "OB_RETESTED",
    label: "Order Block Retested",
    category: "zone_retest",
    roles: ["setup", "execution"],
    description: "Price mitigated or retested an order block.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: true,
    carriesSlHint: true,
  },
  OB_CONFIRMED: {
    id: "OB_CONFIRMED",
    label: "OB Rejection (wick touch, close holds)",
    category: "entry",
    roles: ["execution"],
    description: "Order block lifecycle confirmation fired.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: true,
    carriesSlHint: true,
  },
  OB_FVG_CONFLUENCE: {
    id: "OB_FVG_CONFLUENCE",
    label: "OB + FVG Confluence",
    category: "zone",
    roles: ["direction", "setup"],
    description: "Order block and FVG confluence zone exists.",
    carriesDirection: true,
    carriesPrice: false,
    carriesZone: true,
    carriesSlHint: true,
  },
  OB_FVG_CONFIRMED: {
    id: "OB_FVG_CONFIRMED",
    label: "OB + FVG Confirmed",
    category: "entry",
    roles: ["execution"],
    description: "OB + FVG confluence entry confirmed.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: true,
    carriesSlHint: true,
  },
  BOS_BIAS: {
    id: "BOS_BIAS",
    label: "BOS Bias",
    category: "bias",
    roles: ["direction"],
    description: "Latest BOS sets persistent market direction.",
    carriesDirection: true,
    carriesPrice: false,
    carriesZone: false,
    carriesSlHint: false,
  },
  BOS_CONFIRMED: {
    id: "BOS_CONFIRMED",
    label: "BOS Confirmed",
    category: "entry",
    roles: ["setup", "execution"],
    description: "Price closed beyond a confirmed swing level.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: false,
    carriesSlHint: true,
  },
  CHOCH_BIAS_FLIP: {
    id: "CHOCH_BIAS_FLIP",
    label: "CHoCH Bias Flip",
    category: "bias",
    roles: ["direction"],
    description: "Change of character flips directional bias.",
    carriesDirection: true,
    carriesPrice: false,
    carriesZone: false,
    carriesSlHint: false,
  },
  CHOCH_CONFIRMED: {
    id: "CHOCH_CONFIRMED",
    label: "CHoCH Confirmed",
    category: "entry",
    roles: ["setup", "execution"],
    description: "Change-of-character break event fired.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: false,
    carriesSlHint: true,
  },
  STRUCTURE_CONFIRMED: {
    id: "STRUCTURE_CONFIRMED",
    label: "Structure Confirmed",
    category: "entry",
    roles: ["direction", "setup", "execution"],
    description: "Combined BOS/CHoCH structure event fired.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: false,
    carriesSlHint: true,
  },
  SWING_BIAS: {
    id: "SWING_BIAS",
    label: "Swing Bias",
    category: "bias",
    roles: ["direction"],
    description: "Directional bias inferred from swing sequence.",
    carriesDirection: true,
    carriesPrice: false,
    carriesZone: false,
    carriesSlHint: false,
  },
  SWING_LEVEL: {
    id: "SWING_LEVEL",
    label: "Swing Level",
    category: "zone",
    roles: ["setup"],
    description: "Recent swing level or range is used as setup reference.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: false,
    carriesSlHint: true,
  },
  LIQUIDITY_SWEEP: {
    id: "LIQUIDITY_SWEEP",
    label: "Liquidity Sweep",
    category: "entry",
    roles: ["setup", "execution"],
    description: "Price sweeps liquidity and closes back through the swept level.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: false,
    carriesSlHint: true,
  },
  SNR_TOUCH: {
    id: "SNR_TOUCH",
    label: "S/R Touch",
    category: "zone_retest",
    roles: ["setup", "execution"],
    description: "Price touches a support/resistance zone.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: true,
    carriesSlHint: true,
  },
  GAP_SNR_TOUCH: {
    id: "GAP_SNR_TOUCH",
    label: "Gap S/R Touch",
    category: "zone_retest",
    roles: ["setup", "execution"],
    description: "Price touches support/resistance derived from gap edges.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: true,
    carriesSlHint: true,
  },
  REJECTION_CONFIRMED: {
    id: "REJECTION_CONFIRMED",
    label: "Rejection Confirmed",
    category: "entry",
    roles: ["execution"],
    description: "A rejection candle confirms off a reference level.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: false,
    carriesSlHint: true,
  },
  MISSED_LEVEL: {
    id: "MISSED_LEVEL",
    label: "Missed Level",
    category: "zone",
    roles: ["setup", "execution"],
    description: "Price came near a reference level without touching it.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: false,
    carriesSlHint: true,
  },
  ZONE_LIQ_ARMED: {
    id: "ZONE_LIQ_ARMED",
    label: "Liquidity Buildup Armed",
    category: "zone",
    roles: ["setup"],
    description: "OB/BB/FVG zone has liquidity built — wick approached the edge without entering.",
    carriesDirection: true,
    carriesPrice: false,
    carriesZone: true,
    carriesSlHint: true,
  },
  ZONE_LIQ_CONFIRMED: {
    id: "ZONE_LIQ_CONFIRMED",
    label: "Liquidity Buildup Confirmed",
    category: "entry",
    roles: ["setup", "execution"],
    description: "New liquidity buildup on this bar — closest wick within proximity of the zone edge.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: true,
    carriesSlHint: true,
  },
  SNRC2_ACTIVE: {
    id: "SNRC2_ACTIVE",
    label: "SNRC2 Active",
    category: "zone",
    roles: ["setup"],
    description: "SNRC2 continuation pattern is live — entry level active until tapped or invalidated.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: false,
    carriesSlHint: true,
  },
  SNRC2_CONFIRMED: {
    id: "SNRC2_CONFIRMED",
    label: "SNRC2 Confirmed",
    category: "entry",
    roles: ["setup", "execution"],
    description: "SNRC2 continuation pattern confirmed this bar (L3/R3 pivot with HTF engulfing filter).",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: false,
    carriesSlHint: true,
  },
  BREAKOUT_CONFIRMED: {
    id: "BREAKOUT_CONFIRMED",
    label: "Breakout Confirmed",
    category: "entry",
    roles: ["direction", "setup", "execution"],
    description: "Price confirms a breakout beyond a reference level.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: false,
    carriesSlHint: true,
  },
  RSI_HD_ACTIVE: {
    id: "RSI_HD_ACTIVE",
    label: "RSI Hidden Divergence Active",
    category: "setup",
    roles: ["setup"],
    description: "Hidden divergence exists and waits for price confirmation.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: false,
    carriesSlHint: true,
  },
  RSI_HD_CONFIRMED: {
    id: "RSI_HD_CONFIRMED",
    label: "RSI Hidden Divergence Confirmed",
    category: "entry",
    roles: ["setup", "execution"],
    description: "Hidden divergence confirms beyond the intervening swing level.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: false,
    carriesSlHint: true,
  },
  BB_TOUCH: {
    id: "BB_TOUCH",
    label: "Bollinger Band Touch",
    category: "zone_retest",
    roles: ["setup", "execution"],
    description: "Price touches a Bollinger Band reference.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: false,
    carriesSlHint: true,
  },
  BB_BREAKOUT: {
    id: "BB_BREAKOUT",
    label: "Bollinger Band Breakout",
    category: "entry",
    roles: ["direction", "setup", "execution"],
    description: "Price breaks through a Bollinger Band reference.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: false,
    carriesSlHint: true,
  },
  ENGULFING_ZONE_ACTIVE: {
    id: "ENGULFING_ZONE_ACTIVE",
    label: "Engulfing Zone Active",
    category: "zone",
    roles: ["direction", "setup"],
    description: "An engulfing or extreme-failure zone exists.",
    carriesDirection: true,
    carriesPrice: false,
    carriesZone: true,
    carriesSlHint: true,
  },
  ENGULFING_CONFIRMED: {
    id: "ENGULFING_CONFIRMED",
    label: "Engulfing Confirmed",
    category: "entry",
    roles: ["setup", "execution"],
    description: "Engulfing state machine confirms an entry.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: true,
    carriesSlHint: true,
  },
  ENGULFING_FLIP: {
    id: "ENGULFING_FLIP",
    label: "Extreme Failure Formed",
    category: "entry",
    roles: ["direction", "setup", "execution"],
    description: "An engulfing zone flips into an extreme-failure entry.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: true,
    carriesSlHint: true,
  },
  PIN_BAR_CONFIRMED: {
    id: "PIN_BAR_CONFIRMED",
    label: "Pin Bar Confirmed",
    category: "entry",
    roles: ["execution"],
    description: "A pin-bar candle confirms in the intended direction.",
    carriesDirection: true,
    carriesPrice: true,
    carriesZone: false,
    carriesSlHint: true,
  },
};

export const MODULE_SEMANTIC_EVENT_TYPES: Record<string, Record<string, StrategyEventType>> = {
  ema: {
    bias: "EMA_BIAS",
    cross: "EMA_CROSS",
    ema_retest: "EMA_RETEST",
    retest_confirmed: "EMA_CLOSE_CONFIRMED",
  },
  fvg_inversion: {
    formation: "IFVG_FORMED",
    retest: "IFVG_RETESTED",
    zone_rejection: "IFVG_CONFIRMED",
    confirmation: "IFVG_CONFIRMED",
    active_zone: "IFVG_FORMED",
  },
  fvg: {
    active_zone: "FVG_CREATED",
    retest: "FVG_RETESTED",
    zone_rejection: "FVG_CONFIRMED",
    confirmation: "FVG_CONFIRMED",
  },
  order_block: {
    active_zone: "OB_CREATED",
    retest: "OB_RETESTED",
    zone_rejection: "OB_CONFIRMED",
    mitigation: "OB_CONFIRMED",
  },
  ob_fvg: {
    confluence_zone: "OB_FVG_CONFLUENCE",
    entry: "OB_FVG_CONFIRMED",
  },
  bos: {
    bias: "BOS_BIAS",
    break: "BOS_CONFIRMED",
  },
  choch: {
    bias_flip: "CHOCH_BIAS_FLIP",
    break: "CHOCH_CONFIRMED",
  },
  bos_choch: {
    structure_event: "STRUCTURE_CONFIRMED",
  },
  swing_structure: {
    swing_bias: "SWING_BIAS",
    swing_level: "SWING_LEVEL",
  },
  liqsweep: {
    sweep: "LIQUIDITY_SWEEP",
  },
  snr: {
    level_touch: "SNR_TOUCH",
  },
  gap_snr: {
    gap_level_touch: "GAP_SNR_TOUCH",
  },
  rejection: {
    rejection: "REJECTION_CONFIRMED",
  },
  miss: {
    miss: "MISSED_LEVEL",
  },
  zone_liq: {
    zone_armed: "ZONE_LIQ_ARMED",
    zone_confirmed: "ZONE_LIQ_CONFIRMED",
  },
  snrc2: {
    pattern_active: "SNRC2_ACTIVE",
    pattern_confirmed: "SNRC2_CONFIRMED",
  },
  breakout: {
    breakout: "BREAKOUT_CONFIRMED",
  },
  rsi_hd: {
    hidden_divergence: "RSI_HD_CONFIRMED",
  },
  bb: {
    band_touch: "BB_TOUCH",
    band_breakout: "BB_BREAKOUT",
  },
  engulfing: {
    eg_zone_active: "ENGULFING_ZONE_ACTIVE",
    eg_confirmed: "ENGULFING_CONFIRMED",
    ef_formed: "ENGULFING_FLIP",
  },
  pin_bar: {
    pin_bar: "PIN_BAR_CONFIRMED",
  },
};

export function getStrategyEventContract(type: StrategyEventType): StrategyEventContract {
  return STRATEGY_EVENT_CONTRACTS[type];
}

export function resolveModuleSemanticEventType(
  moduleId: string,
  semanticEventId: string,
): StrategyEventType | undefined {
  return MODULE_SEMANTIC_EVENT_TYPES[moduleId]?.[semanticEventId];
}

export function moduleSemanticEventRefs(moduleId: string): ModuleSemanticEventRef[] {
  const events = MODULE_SEMANTIC_EVENT_TYPES[moduleId] ?? {};
  return Object.entries(events).map(([semanticEventId, eventType]) => ({
    moduleId,
    semanticEventId,
    eventType,
  }));
}

export function strategyEventSupportsRole(type: StrategyEventType, role: BrainRole): boolean {
  return STRATEGY_EVENT_CONTRACTS[type].roles.includes(role);
}

export function createStrategyRuntimeEvent(
  event: Omit<StrategyRuntimeEvent, "eventId"> & { eventId?: string },
): StrategyRuntimeEvent {
  return {
    eventId:
      event.eventId ??
      `${event.sourceStepId ?? event.moduleId}:${event.type}:${event.timeframe}:${event.eventTime}`,
    ...event,
  };
}
