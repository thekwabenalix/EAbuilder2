import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";
import { collectBuiltinIndicatorRefs } from "../../src/lib/indicator-boundary.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Stage 1-4: Blueprint extraction prompt ───────────────────────────────────
// This prompt is large and static — cache it to save tokens on repeat calls.
const BLUEPRINT_SYSTEM = `You are a professional forex strategy architect and MQL5 system designer.

Your job is to understand a trader's natural-language strategy description and extract a structured StrategyBlueprint in a SINGLE PASS — no follow-up questions unless absolutely necessary.

══════════════════════════════════════════════
PRIME DIRECTIVE — DECIDE, DON'T ASK
══════════════════════════════════════════════

You are building Version 1 of the EA. Be decisive. Apply defaults. Move fast.

NEVER ask about:
  - Risk %, TP ratio, magic number, spread limit (use defaults)
  - Session times (default: no filter unless user specifies)
  - Trailing stop, partial close, break-even details (use what user said; default off)
  - Lot sizing method (default: equity_percent)
  - Stop buffer size (default: 20 points)
  - Setup expiry bars (default: 24)
  - Whether to add alerts, drawings, or optimization params

ONLY raise a clarification (max 2 total) if the answer changes WHICH CODE PATH to generate.
Examples of valid clarification triggers:
  - "You mentioned both BOS and FVG — is FVG the entry trigger or just context?"
  - "Should this trade both buy and sell, or only buy?"
  - "The entry candle — should it close back outside the FVG, or is a wick touch enough?"

If in doubt: make the most logical assumption, note it in the summary, and move on.

══════════════════════════════════════════════
ABSOLUTE RULES
══════════════════════════════════════════════

1. NEVER inject ANY concept not explicitly stated by the user:
   - Do NOT add EMA, RSI, MACD, or any indicator unless the user says so
   - Do NOT add sessions, news filters, or time filters unless the user mentions them
   - Do NOT add confirmations, filters, or extra logic the user did not describe

2. Every prompt is independent. You have NO memory of previous strategies.

3. Mark rules as compilable ONLY if they are objectively measurable. Subjective language
   ("strong", "clean", "obvious", "good", "nice") = not compilable, add a subjectiveNote.

4. pendingClarifications: MAXIMUM 2 items. Leave empty [] when possible.
   Use defaults for everything else — do not ask about optional configuration.

5. FVG CONSOLIDATION — CRITICAL:
   When the strategy uses Fair Value Gaps (FVGs), generate EXACTLY TWO rules:
     { "type": "fair_value_gap_bullish", ... }
     { "type": "fair_value_gap_bearish", ... }

   DO NOT create separate rules for these FVG sub-mechanics — the code engine
   implements them automatically from the two FVG rules above:
     - FVG retest detection (wick entering zone)
     - FVG confirmation (close back outside zone)
     - FVG invalidation (close through zone)
     - FVG expiry (max bars since formation)
     - Entry execution (market order at next bar open)
     - Stop loss (below/above retest wicks + buffer)
     - Break-even activation (at 0.5R)
     - One-trade-per-FVG restriction

   Capture any user-specified details as PARAMETERS on the FVG rules, not rules:
     "parameters": {
       "expiry": 50,
       "slBuffer": 20,
       "breakeven": 0.5,
       "confirmationType": "close_above_ul"
     }

   The same FVG rule consolidation applies to Order Blocks: use
   "order_block_bullish" / "order_block_bearish" only — do not add separate
   rules for "retest OB", "invalidate OB", etc.

══════════════════════════════════════════════
TRADING KNOWLEDGE YOU HAVE
══════════════════════════════════════════════

You deeply understand ALL trading approaches including:

Indicators: EMA/SMA crosses and touches, RSI levels and divergence, MACD cross/histogram,
Stochastic, Bollinger Bands, ATR, VWAP, ADX, CCI, Momentum, Ichimoku.

Price Action: Engulfing candles (bullish/bearish), pin bars (hammer/shooting star),
inside bars, doji, morning/evening star, three soldiers/crows, head & shoulders,
double top/bottom, triangle/wedge/flag/pennant patterns.

ICT/SMC Concepts: Order blocks (OB), fair value gaps (FVG/imbalance), liquidity sweeps
(stop hunts), break of structure (BOS), change of character (CHOCH), market structure shift
(MSS), displacement, inducement, premium/discount zones, dealing ranges.

Supply & Demand: Institutional supply/demand zones, DBR/RBD/RBR/DBD zone types,
fresh vs tested zones, zone invalidation.

Wyckoff: Accumulation/distribution schematics, spring/upthrust, sign of strength/weakness,
Wyckoff events (PS, SC, AR, ST, LPS, BUEC, BCLX, SOW).

Support & Resistance: Horizontal levels, dynamic levels (trendlines, moving averages),
round numbers, previous highs/lows, session levels.

Structural Concepts: Break of structure (BOS), trend continuation vs reversal,
higher highs/lower lows, multi-timeframe confluence, HTF bias + LTF entry.

Session Strategies: London open/close, New York open/close, Tokyo/Sydney/Asian ranges,
kill zones, London-NY overlap. Range identification and breakout.

Breakout Systems: Range breakout, pattern breakout, volatility breakout, false breakout detection.

Risk Management: Fixed lot, equity-percent lot sizing, ATR-based sizing. Fixed SL,
swing SL, zone SL, ATR-based SL. Trailing stop, breakeven, partial close, scaling.

Execution: Market orders, limit orders, stop orders, pending orders. Setup expiry,
retest entries, candle close entries, tick entries.

Special Systems: Grid, martingale, basket, hedging, news trading, mean reversion,
counter-trend, scalping, day trading, swing trading.

══════════════════════════════════════════════
OUTPUT FORMAT
══════════════════════════════════════════════

Return ONLY valid JSON. No prose. No markdown code fences. No explanation.

CRITICAL JSON RULES — the parser is strict:
- Every string value must be on a single line. NEVER embed a raw newline inside a string value.
- Use only plain ASCII characters in all string values. No box-drawing characters (═ ─ ║ │), no arrows (→ ←), no special Unicode.
- Escape backslashes (\\) and double-quotes (\") inside strings.
- No trailing commas after the last element in an array or object.
- null is lowercase. true and false are lowercase.

Match this exact TypeScript interface:

{
  "version": "2.0",
  "name": string,                     // short strategy name (max 60 chars)
  "strategyType": string[],           // e.g. ["price_action", "ict", "multi_timeframe", "breakout"]
  "marketPhilosophy": string,         // one sentence: core logic of the strategy
  "rules": [
    {
      "id": string,                   // unique snake_case id, e.g. "htf_ema_alignment"
      "type": string,                 // from rule type taxonomy below
      "side": "buy" | "sell" | "both" | "filter",
      "label": string,                // human-readable rule, e.g. "Price closes above 200 EMA on H4"
      "parameters": {},               // rule-specific params, e.g. {"period": 200, "timeframe": "H4"}
      "compilable": boolean,          // true = objectively codeable, false = needs clarification
      "subjectiveNote": string | null,// why it is not compilable, if applicable
      "mql5Hint": string | null       // hint for the MQL5 code generator
    }
  ],
  "risk": {
    "riskPercent": number,            // default 1
    "rewardRisk": number,             // default 2 (means 1:2 risk-to-reward)
    "lotSizingMethod": "equity_percent" | "fixed_lot" | "atr_based",
    "stopType": "candle_extreme" | "swing_point" | "zone_opposite" | "fixed_points" | "atr_based",
    "stopBufferPoints": number,       // extra points beyond the SL level, default 20
    "trailingStop": boolean,
    "breakevenEnabled": boolean,
    "partialClose": boolean,
    "maxOpenTrades": number,          // default 1
    "maxDailyLossPercent": number | null
  },
  "execution": {
    "symbol": string,                 // e.g. "EURUSD" or "ANY" if not specified
    "setupTimeframe": string,         // MT5 style: M1,M5,M15,M30,H1,H4,D1,W1,MN
    "entryTimeframe": string,
    "orderType": "market" | "pending_limit" | "pending_stop",
    "setupExpiryBars": number,        // default 24
    "sessionFilter": string[],        // e.g. ["london","new_york"] or [] for all
    "spreadFilterPoints": number,     // default 25
    "magicNumber": number             // default 990001
  },
  "compilable": boolean,              // true only if ALL critical rules are compilable
  "compilableRuleIds": string[],
  "subjectiveRuleIds": string[],
  "pendingClarifications": string[],  // MAX 2 items. Only code-path-changing ambiguities. Usually [].
  "confidence": number,               // 0-100
  "summary": string                   // 2-3 sentences: what you understood + any assumptions made
  "strategyNotes": string,            // cross-brain intent, invalidation, sessions, special conditions; "" if none
  "fourBrain": {
    "direction": null | {
      "modules": string[],            // supported ids only: bos, choch, bos_choch, swing_structure, fvg, fvg_inversion, order_block, liqsweep, breakout, snr, gap_snr, rejection, miss, bb, ema, engulfing, pin_bar
      "timeframe": string,            // MT5 style: M1,M5,M15,M30,H1,H4,D1,W1,MN
      "params": {},                   // extracted module params such as fastPeriod, slowPeriod, lookback, swingLen, expiryBars
      "description": string
    },
    "setup": null | {
      "modules": string[],
      "timeframe": string,
      "params": {},
      "description": string
    },
    "execution": {
      "modules": string[],            // REQUIRED. Choose the actual entry trigger module(s), never a placeholder.
      "timeframe": string,
      "params": {},
      "description": string
    },
    "management": {
      "riskPercent": number,
      "rewardRisk": number,
      "stopBuffer": number,
      "breakEvenEnabled": boolean,
      "breakEvenAtR": number,
      "maxOpenTrades": number,
      "maxStopPoints": number
    }
  }
}

4-BRAIN MAPPING RULES:
- The final product is a 4-Brain EA. Always include fourBrain when the trader's idea maps to the supported modules.
- Do NOT use a placeholder module. If the trader says EMA, use ema. If they say FVG, use fvg. If they say order block, use order_block. If they say liquidity sweep, use liqsweep.
- Direction is optional. Use it for higher-timeframe bias only when the trader describes trend, bias, structure, EMA alignment, BOS, CHoCH, etc.
- Setup is optional. Use it for zones/context such as FVG, order block, support/resistance, sweep context, or other pre-entry setup.
- Execution is required. It is the precise trigger: FVG confirmation, liquidity sweep, engulfing, pin bar, breakout, EMA trigger, etc.
- If timeframes are specified, use them exactly. If missing, default to D1 direction, H4 setup, M15 execution.
- Put any cross-brain notes in strategyNotes, not in invented modules.

Rule type taxonomy (use the closest match, or "custom" if none fit):
ema_cross, ema_touch, ema_alignment, ema_band,
sma_cross, sma_touch, sma_alignment,
rsi_level, rsi_overbought, rsi_oversold, rsi_divergence,
macd_cross, macd_signal, macd_histogram,
bollinger_touch, bollinger_breakout, bollinger_squeeze,
atr_volatility, atr_trailing, vwap_cross, vwap_direction,
stochastic_cross, stochastic_level, adx_strength,
support_resistance, horizontal_level,
demand_zone, supply_zone,
order_block_bullish, order_block_bearish,
fair_value_gap_bullish, fair_value_gap_bearish,
liquidity_sweep_high, liquidity_sweep_low,
bos, choch, mss,
engulfing_bullish, engulfing_bearish,
pin_bar_bullish, pin_bar_bearish,
inside_bar, doji, hammer, shooting_star,
double_top, double_bottom, head_shoulders, inverse_head_shoulders,
trend_filter_htf, trend_direction,
breakout_high, breakout_low,
range_boundary_high, range_boundary_low,
pullback_retracement, continuation_pattern,
session_filter, time_filter,
spread_filter, news_filter, volatility_filter,
fixed_rr_take_profit, max_open_trades_filter,
custom`;

const SUPPORTED_MODULES = new Set([
  "bos",
  "choch",
  "bos_choch",
  "swing_structure",
  "fvg",
  "fvg_inversion",
  "order_block",
  "liqsweep",
  "breakout",
  "snr",
  "gap_snr",
  "rejection",
  "miss",
  "bb",
  "ema",
  "engulfing",
  "pin_bar",
]);

const TIMEFRAMES = new Set(["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN"]);

function cleanTimeframe(value: unknown, fallback: string): string {
  const tf = typeof value === "string" ? value.toUpperCase() : "";
  return TIMEFRAMES.has(tf) ? tf : fallback;
}

function cleanParams(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanModules(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((m): m is string => typeof m === "string" && SUPPORTED_MODULES.has(m))
    : [];
}

function cleanBrain(value: unknown, fallbackTf: string) {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const modules = cleanModules(raw.modules);
  if (modules.length === 0) return undefined;
  return {
    modules,
    timeframe: cleanTimeframe(raw.timeframe, fallbackTf),
    params: cleanParams(raw.params),
    description: typeof raw.description === "string" ? raw.description : "",
  };
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function ruleText(rule: Record<string, unknown>): string {
  return `${textOf(rule.type)} ${textOf(rule.label)} ${JSON.stringify(rule.parameters ?? {}).toLowerCase()}`;
}

function blueprintText(blueprint: Record<string, unknown>, sourceText = ""): string {
  return [
    sourceText.toLowerCase(),
    textOf(blueprint.name),
    textOf(blueprint.marketPhilosophy),
    textOf(blueprint.summary),
    textOf(blueprint.strategyNotes),
  ]
    .filter(Boolean)
    .join(" ");
}

function blueprintIndicatorText(blueprint: Record<string, unknown>, sourceText = ""): string {
  const rules = Array.isArray(blueprint.rules)
    ? blueprint.rules
        .filter((rule) => rule && typeof rule === "object")
        .map((rule) => ruleText(rule as Record<string, unknown>))
    : [];
  return [blueprintText(blueprint, sourceText), ...rules].join(" ");
}

function paramNumber(
  params: Record<string, unknown>,
  keys: string[],
  fallback?: number,
): number | undefined {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return fallback;
}

function extractTfFromRule(rule: Record<string, unknown>, fallback: string): string {
  const params = cleanParams(rule.parameters);
  const fromParam = params.timeframe ?? params.tf ?? params.entryTimeframe ?? params.setupTimeframe;
  if (typeof fromParam === "string") return cleanTimeframe(fromParam, fallback);

  const text = ruleText(rule).toUpperCase();
  const match = text.match(/\b(M1|M5|M15|M30|H1|H4|D1|W1|MN)\b/);
  return cleanTimeframe(match?.[1], fallback);
}

function moduleFromRule(rule: Record<string, unknown>): string | undefined {
  const text = ruleText(rule);
  if (text.includes("sma") || text.includes("simple moving average")) return undefined;
  if (
    text.includes("ifvg") ||
    text.includes("inversion fvg") ||
    text.includes("inversion fair value gap") ||
    text.includes("inverted fvg")
  )
    return "fvg_inversion";
  if (text.includes("fvg") || text.includes("fair value gap") || text.includes("imbalance"))
    return "fvg";
  if (
    text.includes("order_block") ||
    text.includes("order block") ||
    text.includes("supply_zone") ||
    text.includes("demand_zone") ||
    text.includes("supply zone") ||
    text.includes("demand zone") ||
    text.includes("supply and demand")
  )
    return "order_block";
  if (
    text.includes("liquidity_sweep") ||
    text.includes("liquidity sweep") ||
    text.includes("sweep")
  )
    return "liqsweep";
  if (text.includes("choch") || text.includes("change of character")) return "choch";
  if (text.includes("bos") || text.includes("break of structure")) return "bos";
  if (text.includes("breakout")) return "breakout";
  if (text.includes("support") || text.includes("resistance") || text.includes("snr")) return "snr";
  if (text.includes("rejection")) return "rejection";
  if (text.includes("miss")) return "miss";
  if (text.includes("bollinger")) return "bb";
  if (text.includes("engulf")) return "engulfing";
  if (text.includes("pin bar") || text.includes("hammer") || text.includes("shooting star"))
    return "pin_bar";
  if (text.includes("ema") || text.includes("exponential moving average")) return "ema";
  return undefined;
}

function extractEmaPeriodsFromText(text: string): { fastPeriod: number; slowPeriod: number } {
  const matches = [...text.matchAll(/\b(\d{1,3})\s*(?:period\s*)?ema\b/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
  if (matches.length >= 2) return { fastPeriod: matches[0], slowPeriod: matches[1] };
  return { fastPeriod: 12, slowPeriod: 48 };
}

function extractEmaRetestTargetFromText(
  text: string,
  fastPeriod: number,
  slowPeriod: number,
): "fast" | "slow" | "either" | undefined {
  if (/\b(either|any|both)\b.{0,40}\bema\b/.test(text)) return "either";
  const fastOnly = [
    new RegExp(`\\bonly\\s+(?:the\\s+)?${fastPeriod}\\s*(?:period\\s*)?ema\\b`),
    new RegExp(`\\b${fastPeriod}\\s*(?:period\\s*)?ema\\s+only\\b`),
    new RegExp(`\\btest\\s+(?:the\\s+)?${fastPeriod}\\s*(?:period\\s*)?ema\\b`),
  ];
  const slowOnly = [
    new RegExp(`\\bonly\\s+(?:the\\s+)?${slowPeriod}\\s*(?:period\\s*)?ema\\b`),
    new RegExp(`\\b${slowPeriod}\\s*(?:period\\s*)?ema\\s+only\\b`),
    new RegExp(`\\btest\\s+(?:the\\s+)?${slowPeriod}\\s*(?:period\\s*)?ema\\b`),
  ];
  if (fastOnly.some((pattern) => pattern.test(text))) return "fast";
  if (slowOnly.some((pattern) => pattern.test(text))) return "slow";
  return undefined;
}

function syntheticRulesFromText(text: string, fallbackTf: string): Record<string, unknown>[] {
  const rules: Record<string, unknown>[] = [];
  const hasEma = /\bema\b|exponential moving average/.test(text);
  const hasIfvg =
    /\bifvg\b|inversion fvg|inversion fair value gap|inverted fair value gap/.test(text);
  const hasRetest = /\bretest\b|\btest\b|\btouch\b/.test(text);
  const { fastPeriod, slowPeriod } = extractEmaPeriodsFromText(text);
  const retestTarget = extractEmaRetestTargetFromText(text, fastPeriod, slowPeriod);

  if (hasEma && /\bcross/.test(text)) {
    rules.push({
      id: "synthetic_ema_direction",
      type: "ema_cross",
      side: "both",
      label: "EMA cross sets direction.",
      parameters: { timeframe: fallbackTf, fastPeriod, slowPeriod },
    });
  }

  if (hasEma && hasRetest) {
    rules.push({
      id: "synthetic_ema_retest_setup",
      type: "ema_retest",
      side: "both",
      label: "Price must retest the selected EMA before setup is valid.",
      parameters: {
        timeframe: fallbackTf,
        fastPeriod,
        slowPeriod,
        ...(retestTarget ? { retestTarget } : {}),
      },
    });
  }

  if (hasIfvg) {
    rules.push({
      id: "synthetic_ifvg_execution",
      type: "ifvg_entry",
      side: "both",
      label: "IFVG formation is the execution trigger.",
      parameters: { timeframe: fallbackTf, expiryBars: 100 },
    });
  }

  return rules;
}

function enrichBrainFromText(
  brain: ReturnType<typeof cleanBrain>,
  sourceText: string,
): ReturnType<typeof cleanBrain> {
  if (!brain?.modules.includes("ema")) return brain;
  const { fastPeriod, slowPeriod } = extractEmaPeriodsFromText(sourceText);
  const retestTarget = extractEmaRetestTargetFromText(sourceText, fastPeriod, slowPeriod);
  return {
    ...brain,
    params: {
      fastPeriod,
      slowPeriod,
      ...(brain.params ?? {}),
      ...(retestTarget ? { retestTarget } : {}),
    },
  };
}

function extractRewardRisk(text: string): number | undefined {
  const colon = text.match(/\b(?:rr|r:r|risk[-\s]*to[-\s]*reward|risk reward)\D{0,10}1\s*[:/]\s*(\d+(?:\.\d+)?)\b/);
  if (colon) return Number(colon[1]);
  const takeProfitColon = text.match(/\b(?:tp|take profit)\D{0,20}1\s*[:/]\s*(\d+(?:\.\d+)?)\b/);
  if (takeProfitColon) return Number(takeProfitColon[1]);
  const fixed = text.match(/\b(?:tp|take profit|reward)\D{0,10}(\d+(?:\.\d+)?)\s*r\b/);
  if (fixed) return Number(fixed[1]);
  return undefined;
}

function extractBreakEvenAtR(text: string): number | undefined {
  const match = text.match(/\b(?:breakeven|break even|break-even)\D{0,30}(\d+(?:\.\d+)?)\s*r\b/);
  return match ? Number(match[1]) : undefined;
}

function mentionsBreakEven(text: string): boolean {
  return /\bbreakeven\b|\bbreak even\b|\bbreak-even\b/.test(text);
}

function extractMaxStopPoints(text: string): number | undefined {
  const pointMatch = text.match(/\b(?:max(?:imum)?\s+)?stop(?:\s+loss)?\D{0,30}(\d+(?:\.\d+)?)\s*points?\b/);
  if (pointMatch) return Number(pointMatch[1]);
  const pipMatch = text.match(/\b(?:max(?:imum)?\s+)?stop(?:\s+loss)?\D{0,30}(\d+(?:\.\d+)?)\s*pips?\b/);
  if (pipMatch) return Number(pipMatch[1]) * 10;
  return undefined;
}

function paramsFromRule(rule: Record<string, unknown>, module: string): Record<string, unknown> {
  const params = cleanParams(rule.parameters);
  if (module === "ema") {
    const text = ruleText(rule);
    const fastPeriod =
      paramNumber(params, ["fastPeriod", "fast", "shortPeriod", "periodFast"]) ??
      (text.match(/\b(\d+)\s*ema\b/)
        ? Number(text.match(/\b(\d+)\s*ema\b/)![1])
        : undefined) ??
      12;
    const slowPeriod =
      paramNumber(params, ["slowPeriod", "slow", "longPeriod", "periodSlow"]) ??
      (text.match(/\b(\d+)\s*ema\b.*\b(\d+)\s*ema\b/)
        ? Number(text.match(/\b(\d+)\s*ema\b.*\b(\d+)\s*ema\b/)![2])
        : undefined) ??
      48;
    const configuredTarget =
      typeof params.retestTarget === "string" ? params.retestTarget : undefined;
    const retestTarget =
      configuredTarget ?? extractEmaRetestTargetFromText(text, fastPeriod, slowPeriod);
    return { fastPeriod, slowPeriod, ...(retestTarget ? { retestTarget } : {}) };
  }
  if (module === "fvg" || module === "fvg_inversion") {
    return { expiryBars: paramNumber(params, ["expiryBars", "expiry", "setupExpiryBars"], 100) };
  }
  if (module === "bos" || module === "choch" || module === "bos_choch") {
    return {
      lookback: paramNumber(params, ["lookback", "lookbackBars"], 20),
      swingLen: paramNumber(params, ["swingLen", "pivotStrength", "pivot"], 5),
    };
  }
  if (module === "order_block") {
    return {
      dispMult: paramNumber(params, ["dispMult", "displacement"], 0.6),
      scanBack: paramNumber(params, ["scanBack"], 5),
      expiryBars: paramNumber(params, ["expiryBars", "expiry"], 100),
    };
  }
  return {};
}

function inferFourBrain(blueprint: Record<string, unknown>, sourceText = "") {
  const baseRules = Array.isArray(blueprint.rules)
    ? (blueprint.rules.filter((r) => r && typeof r === "object") as Record<string, unknown>[])
    : [];
  const corpus = blueprintText(blueprint, sourceText);
  const fallbackTf = extractTfFromRule(
    { type: "context", label: corpus, parameters: blueprint.execution ?? {} },
    "M5",
  );
  const syntheticRules = syntheticRulesFromText(corpus, fallbackTf);
  const rules = [...baseRules, ...syntheticRules].filter((rule, index, allRules) => {
    const module = moduleFromRule(rule);
    if (!module) return false;
    return (
      allRules.findIndex(
        (candidate) =>
          moduleFromRule(candidate) === module &&
          extractTfFromRule(candidate, fallbackTf) === extractTfFromRule(rule, fallbackTf) &&
          ruleText(candidate).includes(ruleText(rule).slice(0, 30)),
      ) === index
    );
  });
  if (rules.length === 0) return undefined;

  const findRule = (predicate: (rule: Record<string, unknown>) => boolean) => rules.find(predicate);
  const isDirection = (rule: Record<string, unknown>) => {
    const text = ruleText(rule);
    return (
      text.includes("direction") ||
      text.includes("bias") ||
      text.includes("trend") ||
      text.includes("alignment") ||
      text.includes("ema_cross") ||
      text.includes("bos") ||
      text.includes("choch")
    );
  };
  const isSetup = (rule: Record<string, unknown>) => {
    const text = ruleText(rule);
    return (
      text.includes("setup") ||
      text.includes("arm") ||
      text.includes("retest") ||
      text.includes("touch") ||
      text.includes("zone") ||
      text.includes("fvg") ||
      text.includes("order block") ||
      text.includes("ema_retest")
    );
  };
  const isExecution = (rule: Record<string, unknown>) => {
    const text = ruleText(rule);
    return (
      text.includes("trigger") ||
      text.includes("entry") ||
      text.includes("execute") ||
      text.includes("next candle") ||
      text.includes("engulf") ||
      text.includes("pin bar") ||
      text.includes("liquidity sweep") ||
      text.includes("ifvg_entry")
    );
  };

  const buildBrain = (rule: Record<string, unknown>, fallbackTf: string) => {
    const module = moduleFromRule(rule);
    if (!module) return undefined;
    return {
      modules: [module],
      timeframe: extractTfFromRule(rule, fallbackTf),
      params: paramsFromRule(rule, module),
      description: typeof rule.label === "string" ? rule.label : "",
    };
  };

  const directionRule = findRule(isDirection);
  const setupRule = findRule((rule) => isSetup(rule) && rule !== directionRule);
  const executionRule =
    findRule((rule) => isExecution(rule) && rule !== directionRule && rule !== setupRule) ??
    findRule((rule) => isExecution(rule)) ??
    setupRule ??
    directionRule;

  if (!executionRule) return undefined;
  const execution = buildBrain(executionRule, "M15");
  if (!execution) return undefined;

  const direction = directionRule ? buildBrain(directionRule, "D1") : undefined;
  const setup = setupRule ? buildBrain(setupRule, "H4") : undefined;
  const risk = cleanParams(blueprint.risk);
  return {
    direction,
    setup,
    execution,
    management: {
      riskPercent: paramNumber(risk, ["riskPercent"], 1),
      rewardRisk: paramNumber(risk, ["rewardRisk"], 2),
      stopBuffer: paramNumber(risk, ["stopBufferPoints", "stopBuffer"], 20),
      breakEvenEnabled: typeof risk.breakevenEnabled === "boolean" ? risk.breakevenEnabled : false,
      breakEvenAtR: 1,
      maxOpenTrades: paramNumber(risk, ["maxOpenTrades"], 1),
      maxStopPoints: 0,
    },
  };
}

export function normalizeBlueprint(
  blueprint: Record<string, unknown>,
  sourceText = "",
): Record<string, unknown> {
  const indicatorRefs = collectBuiltinIndicatorRefs(blueprintIndicatorText(blueprint, sourceText));
  if (indicatorRefs.length > 0) {
    blueprint.indicatorRefs = indicatorRefs;
  } else {
    delete blueprint.indicatorRefs;
  }

  if (!blueprint.fourBrain) {
    const inferred = inferFourBrain(blueprint, sourceText);
    if (inferred) blueprint.fourBrain = inferred;
  }

  const fb = blueprint.fourBrain;
  if (!fb || typeof fb !== "object") return blueprint;

  const raw = fb as Record<string, unknown>;
  const execution = cleanBrain(raw.execution, "M15");
  if (!execution) {
    delete blueprint.fourBrain;
    return blueprint;
  }

  const rawMgmt =
    raw.management && typeof raw.management === "object"
      ? (raw.management as Record<string, unknown>)
      : {};
  const risk =
    blueprint.risk && typeof blueprint.risk === "object"
      ? (blueprint.risk as Record<string, unknown>)
      : {};

  const num = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const bool = (value: unknown, fallback: boolean) =>
    typeof value === "boolean" ? value : fallback;
  const corpus = blueprintText(blueprint, sourceText);
  const rewardRiskFromText = extractRewardRisk(corpus);
  const breakEvenAtRFromText = extractBreakEvenAtR(corpus);
  const breakEvenMentioned = mentionsBreakEven(corpus);
  const maxStopPointsFromText = extractMaxStopPoints(corpus);
  const direction = enrichBrainFromText(cleanBrain(raw.direction, "D1"), corpus);
  const setup = enrichBrainFromText(cleanBrain(raw.setup, "H4"), corpus);
  const enrichedExecution = enrichBrainFromText(execution, corpus);

  blueprint.fourBrain = {
    direction,
    setup,
    execution: enrichedExecution,
    management: {
      riskPercent: num(rawMgmt.riskPercent, num(risk.riskPercent, 1)),
      rewardRisk: rewardRiskFromText ?? num(rawMgmt.rewardRisk, num(risk.rewardRisk, 2)),
      stopBuffer: num(rawMgmt.stopBuffer, num(risk.stopBufferPoints, 20)),
      breakEvenEnabled: breakEvenMentioned
        ? true
        : bool(rawMgmt.breakEvenEnabled, bool(risk.breakevenEnabled, false)),
      breakEvenAtR: breakEvenAtRFromText ?? num(rawMgmt.breakEvenAtR, 1),
      maxOpenTrades: num(rawMgmt.maxOpenTrades, num(risk.maxOpenTrades, 1)),
      maxStopPoints: maxStopPointsFromText ?? num(rawMgmt.maxStopPoints, 0),
    },
  };

  if (typeof blueprint.strategyNotes !== "string") blueprint.strategyNotes = "";
  return blueprint;
}

function cleanJson(raw: string): string {
  // Strip markdown code fences
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  text = text.trim();

  // Replace smart/curly quotes with straight ones
  text = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

  // Remove control characters that break JSON (keep tab/newline/CR for structure)
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // Remove trailing commas before } or ] (common LLM mistake)
  text = text.replace(/,(\s*[}\]])/g, "$1");

  return text;
}

async function extractBlueprint(prompt: string): Promise<Record<string, unknown>> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: BLUEPRINT_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Extract a StrategyBlueprint JSON from this forex strategy description.\n\n${prompt}`,
      },
      {
        role: "assistant",
        // Prefill forces Claude to continue from here — guarantees JSON-only output
        content: "{",
      },
    ],
  });

  const block = response.content[0];
  if (block.type !== "text")
    throw new Error("Unexpected response type from Claude blueprint stage");

  // Prepend the prefilled "{" back since Claude continues from it
  const raw = "{" + block.text;
  const text = cleanJson(raw);

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // jsonrepair handles unescaped newlines, trailing commas, etc.
    try {
      return JSON.parse(jsonrepair(text)) as Record<string, unknown>;
    } catch {
      // ignore, fall through to error
    }
    throw new Error(`Blueprint extraction returned invalid JSON: ${text.slice(0, 400)}`);
  }
}

export default async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set");
    return Response.json(
      { error: "Server configuration error: ANTHROPIC_API_KEY is missing" },
      { status: 500, headers: CORS },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length < 10) {
    return Response.json(
      { error: "Prompt must be at least 10 characters" },
      { status: 400, headers: CORS },
    );
  }

  try {
    const blueprint = normalizeBlueprint(await extractBlueprint(prompt), prompt);
    return Response.json(
      { blueprint, source: "ai" },
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("parse-strategy error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return Response.json({ error: message }, { status: 500, headers: CORS });
  }
};

export const config = {
  path: "/api/parse-strategy",
  timeout: 26,
};
