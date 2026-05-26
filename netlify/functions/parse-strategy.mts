import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Stage 1-4: Blueprint extraction prompt ───────────────────────────────────
// This prompt is large and static — cache it to save tokens on repeat calls.
const BLUEPRINT_SYSTEM = `You are a professional forex strategy architect and MQL5 system designer.

Your job is to understand a trader's natural-language strategy description and extract a structured StrategyBlueprint.

══════════════════════════════════════════════
ABSOLUTE RULES — NEVER BREAK THESE
══════════════════════════════════════════════

1. NEVER inject ANY concept not explicitly stated by the user:
   - Do NOT add EMA, RSI, MACD, Bollinger Bands, or any indicator unless the user says so
   - Do NOT add sessions, news filters, or time filters unless the user mentions them
   - Do NOT add SMC, ICT, divergence, or any methodology the user did not describe
   - Do NOT add confirmations, filters, or extra logic that the user did not describe

2. Every prompt is independent. You have NO memory of previous strategies.

3. Mark rules as compilable ONLY if they are objectively measurable. Subjective language
   ("strong", "clean", "obvious", "good", "nice") = not compilable, needs clarification.

4. If information is missing (e.g. no risk % mentioned), use sensible defaults and
   add them to pendingClarifications.

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
  "pendingClarifications": string[],  // questions to ask the user
  "confidence": number,               // 0-100
  "summary": string                   // 2-3 sentences: what you understood
}

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
custom`;

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
    const blueprint = await extractBlueprint(prompt);
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
