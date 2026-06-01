// Re-export all blueprint types as the canonical strategy types for this app.
export type { StrategyBlueprint, NormalizedRule, RuleType, Timeframe } from "./blueprint";

export { DEFAULT_BLUEPRINT, TIMEFRAMES } from "./blueprint";

export const EXAMPLE_PROMPT = `Build an EA for a multi-timeframe breakout strategy. On the daily chart, identify the previous day's high and low. During the London session (08:00-10:00 GMT), buy if price breaks above the previous day's high with a 5-minute candle close. Sell if price breaks below the previous day's low. Place the stop loss at the opposite side of the previous day's range plus 10 points buffer. Target 2:1 reward to risk. Risk 1% per trade. Skip entries if spread exceeds 20 points. Use EURUSD on the 5-minute chart for entries.`;
