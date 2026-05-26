import Anthropic from "@anthropic-ai/sdk";

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

// ─── Stage 5: MQL5 code generation prompt ─────────────────────────────────────
const MQL5_SYSTEM = `You are a senior MQL5 developer with 15+ years of MetaTrader 5 Expert Advisor development.

Given a StrategyBlueprint JSON, generate a COMPLETE, COMPILABLE MQL5 Expert Advisor (.mq5 file).

══════════════════════════════════════════════
CODE REQUIREMENTS
══════════════════════════════════════════════

Structure (in order):
1. Header comment block (strategy name, description, disclaimer)
2. #property strict / version / copyright
3. #include <Trade/Trade.mqh>  → CTrade trade;
4. Input parameters (all tunable values as input variables, grouped and commented)
5. Global variables (handles, state tracking)
6. OnInit() — create all indicator handles, validate parameters, return INIT_FAILED on error
7. OnDeinit() — release all indicator handles
8. Helper functions (one per logical concept)
9. OnTick() — run logic once per closed bar using iTime() comparison
10. TryEntry() / TryBuy() / TrySell() — entry logic, one open position check, spread check
11. CalcLot() — equity-percent risk sizing

Strict rules:
- ONLY implement what is in blueprint.rules. Never add extra logic.
- For each rule where compilable=false: add a clear TODO comment block explaining
  what the trader must implement manually.
- All indicator handles: check for INVALID_HANDLE in OnInit, return INIT_FAILED.
- CopyBuffer() return value must be checked before use.
- Use InpMagic to tag all trades.
- Prevent duplicate entries: HasOpenPosition() checks symbol + magic.
- Spread guard: skip entry if spread > InpMaxSpreadPoints.
- Lot sizing: use account equity * riskPercent / stopDistance, clamped to min/max/step.
- Run OnTick logic at most once per new bar (bar-open execution).
- All inputs must have a sensible comment/label.

Output format:
Return ONLY the raw .mq5 file content.
No markdown. No code fences. No prose. No explanation before or after.
Start directly with the header comment //+---...`;

async function extractBlueprint(prompt: string): Promise<Record<string, unknown>> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
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
        content: `Extract a StrategyBlueprint JSON from this forex strategy description. Return ONLY valid JSON.\n\n${prompt}`,
      },
    ],
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from Claude blueprint stage");

  let text = block.text.trim();
  // Strip markdown code fences if Claude adds them despite instruction
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  // Strip leading/trailing whitespace again
  text = text.trim();

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Try to extract JSON from the response if there's surrounding text
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as Record<string, unknown>;
    throw new Error(`Blueprint extraction returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

async function generateMql5(blueprint: Record<string, unknown>): Promise<string> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: [
      {
        type: "text",
        text: MQL5_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Generate the complete MQL5 Expert Advisor for this StrategyBlueprint:\n\n${JSON.stringify(blueprint, null, 2)}`,
      },
    ],
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from Claude code stage");

  let code = block.text.trim();
  // Strip markdown fences if present
  if (code.startsWith("```")) {
    code = code.replace(/^```(?:mql5|cpp|c\+\+)?\s*/i, "").replace(/\s*```$/, "");
  }
  return code.trim();
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
    // Stage 1-4: Extract strategy blueprint
    const blueprint = await extractBlueprint(prompt);

    // Stage 5: Generate MQL5 code from blueprint
    const generatedCode = await generateMql5(blueprint);

    return Response.json(
      { blueprint, generatedCode, source: "ai" },
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
};
