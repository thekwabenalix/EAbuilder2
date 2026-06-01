/**
 * Shared module definitions for the 4-Brain system.
 * Used by both the build page (/build) and the strategy edit page (/s/$id).
 */
import type { BrainModuleType } from "@/types/blueprint";

export interface BrainModuleDef {
  id: BrainModuleType;
  label: string;
  desc: string;
  symbol: string;
  color: string; // tailwind text-* class
  category: string;
}

export const ALL_BRAIN_MODULES: BrainModuleDef[] = [
  // Structure
  {
    id: "choch",
    label: "CHoCH",
    desc: "Change of Character — swing high/low reversal",
    symbol: "↺",
    color: "text-violet-400",
    category: "Structure",
  },
  {
    id: "bos",
    label: "BOS",
    desc: "Break of Structure — impulse continuation",
    symbol: "⟶",
    color: "text-blue-400",
    category: "Structure",
  },
  {
    id: "bos_choch",
    label: "BOS + CHoCH",
    desc: "Combined structure detection",
    symbol: "⇄",
    color: "text-indigo-400",
    category: "Structure",
  },
  {
    id: "swing_structure",
    label: "Swing Structure",
    desc: "Multi-timeframe swing points",
    symbol: "◇",
    color: "text-purple-400",
    category: "Structure",
  },
  // Gaps
  {
    id: "fvg",
    label: "Fair Value Gap",
    desc: "3-candle imbalance zone",
    symbol: "◫",
    color: "text-emerald-400",
    category: "Gap",
  },
  {
    id: "fvg_inversion",
    label: "FVG Inversion",
    desc: "Inverted gap/imbalance patterns",
    symbol: "◬",
    color: "text-teal-400",
    category: "Gap",
  },
  // Order Blocks
  {
    id: "order_block",
    label: "Order Block",
    desc: "Last opposing candle before displacement",
    symbol: "▣",
    color: "text-amber-400",
    category: "OrderBlock",
  },
  // S/R
  {
    id: "snr",
    label: "Classic S/R",
    desc: "Horizontal support and resistance levels",
    symbol: "─",
    color: "text-sky-400",
    category: "Level",
  },
  {
    id: "gap_snr",
    label: "Gap S/R",
    desc: "Support/resistance at gap edges",
    symbol: "⋮",
    color: "text-slate-400",
    category: "Level",
  },
  {
    id: "rejection",
    label: "Rejection",
    desc: "Wick rejects a level, close holds (Reactive SNR)",
    symbol: "↩",
    color: "text-sky-300",
    category: "Level",
  },
  {
    id: "miss",
    label: "Miss",
    desc: "Price turns near a level without touching it",
    symbol: "⊘",
    color: "text-slate-300",
    category: "Level",
  },
  // Volatility
  {
    id: "bb",
    label: "Bollinger Bands",
    desc: "Volatility envelope at 2 standard deviations",
    symbol: "≈",
    color: "text-orange-400",
    category: "Volatility",
  },
  // Momentum
  {
    id: "liqsweep",
    label: "Liquidity Sweep",
    desc: "Stop hunt and return to zone",
    symbol: "⚡",
    color: "text-yellow-400",
    category: "Momentum",
  },
  {
    id: "breakout",
    label: "Breakout",
    desc: "Price break beyond defined level",
    symbol: "▶",
    color: "text-green-400",
    category: "Momentum",
  },
  // Candle patterns
  {
    id: "engulfing",
    label: "Engulfing",
    desc: "Strong reversal candle pattern",
    symbol: "◑",
    color: "text-pink-400",
    category: "Candle",
  },
  {
    id: "pin_bar",
    label: "Pin Bar",
    desc: "Long wick rejection candle",
    symbol: "⌇",
    color: "text-rose-400",
    category: "Candle",
  },
  // Trend
  {
    id: "ema",
    label: "EMA",
    desc: "Fast/slow exponential moving average alignment",
    symbol: "~",
    color: "text-cyan-400",
    category: "Trend",
  },
];

export const MODULE_BY_ID = Object.fromEntries(ALL_BRAIN_MODULES.map((m) => [m.id, m])) as Record<
  BrainModuleType,
  BrainModuleDef
>;

export const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN"] as const;

/** Format a brain config as a short string, e.g. "H1 BOS + FVG" */
export function formatBrain(
  brain: { modules: BrainModuleType[]; timeframe: string } | undefined,
): string {
  if (!brain) return "—";
  const mods = brain.modules.map((m) => MODULE_BY_ID[m]?.label ?? m.toUpperCase()).join(" + ");
  return `${brain.timeframe} ${mods}`;
}

/** Format a full FourBrainConfig as a chain string for display */
export function formatBrainChain(cfg: {
  direction?: { modules: BrainModuleType[]; timeframe: string };
  setup?: { modules: BrainModuleType[]; timeframe: string };
  execution: { modules: BrainModuleType[]; timeframe: string };
}): string {
  const parts: string[] = [];
  if (cfg.direction) parts.push(formatBrain(cfg.direction));
  if (cfg.setup) parts.push(formatBrain(cfg.setup));
  parts.push(formatBrain(cfg.execution));
  return parts.join(" → ");
}
