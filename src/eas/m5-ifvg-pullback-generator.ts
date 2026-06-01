/**
 * M5 IFVG Pullback EA Generator
 *
 * Returns the self-contained MQL5 source code for the M5 IFVG Pullback strategy.
 * The source is embedded here so the web app can:
 *   - Display and download it without a server round-trip
 *   - Submit it directly to the MT5 Local Runner for backtesting
 */

export const M5_IFVG_PULLBACK_FILENAME = "M5_IFVG_Pullback.mq5";
export const M5_IFVG_PULLBACK_NAME = "M5 iFVG Pullback";

// Re-export raw source imported by Vite so tests/bundles can consume it
// The actual file content lives in M5_IFVG_Pullback.mq5 (same folder)
// and is bundled at build time via the ?raw import in the page component.
// This module re-exports metadata only; the page handles the import.
export const M5_IFVG_PULLBACK_META = {
  filename: M5_IFVG_PULLBACK_FILENAME,
  name: M5_IFVG_PULLBACK_NAME,
  timeframe: "M5",
  defaultSymbol: "EURUSD",
  description:
    "EMA 12/48 trend filter + M5 swing high/low detection + iFVG inversion entry. " +
    "Enters on the bar AFTER an iFVG is born. SL at swing extreme + 20pt buffer. TP 2R. BE at 1R.",
  rules: [
    "BUY:  EMA12 > EMA48 → swing low forms (3L+3R) → bearish FVG born AFTER swing → close > FVG UL → BUY next bar",
    "SELL: EMA12 < EMA48 → swing high forms (3L+3R) → bullish FVG born AFTER swing → close < FVG LL → SELL next bar",
    "SL: swing low – 20pts (buy) | swing high + 20pts (sell)",
    "TP: entry ± (SL distance × 2.0)",
    "BE: move SL to entry when profit ≥ 1R",
    "Max 1 open trade | Max spread 25pts | Risk 1%",
    "Only trades iFVGs born AFTER the most recent qualifying swing",
  ],
  output: [
    "Chart: blue ▲ / red ▼ at every confirmed swing high/low",
    "Chart: dotted H-line at swing price level",
    "Chart: iFVG zone rectangle (green = bull iFVG, orchid = bear iFVG)",
    "Chart: buy/sell arrow at entry bar",
    "Journal: [SWING] [FVG] [IFVG] [ENTRY] [BE] [SKIP]",
  ],
};
