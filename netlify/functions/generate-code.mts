// Regenerates MQL5 code from an existing StrategyBlueprint.
// Streams the response via SSE to avoid Netlify's 26-second function timeout.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

══════════════════════════════════════════════
CRITICAL: MQL5-ONLY SYNTAX — NEVER USE MQL4
══════════════════════════════════════════════
These cause compile errors if violated:

PRICES — never use bare MQL4 globals:
  ❌ Ask, Bid
  ✅ SymbolInfoDouble(_Symbol, SYMBOL_ASK), SymbolInfoDouble(_Symbol, SYMBOL_BID)

CTRADE MAGIC NUMBER:
  ❌ trade.SetMagicNumber(InpMagic)
  ✅ trade.SetExpertMagicNumber((ulong)InpMagic)

SYMBOL INFO — all use ENUM_SYMBOL_INFO_DOUBLE:
  ✅ SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN)
  ✅ SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX)
  ✅ SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP)
  ❌ MarketInfo() — MQL4 only, does not exist in MQL5

ACCOUNT INFO:
  ✅ AccountInfoDouble(ACCOUNT_BALANCE), AccountInfoDouble(ACCOUNT_EQUITY)
  ❌ AccountBalance(), AccountEquity() — MQL4 only

ORDER MANAGEMENT:
  ✅ trade.Buy(), trade.Sell(), trade.PositionClose()
  ❌ OrderSend(), RefreshRates() — MQL4 only

Output format:
Return ONLY the raw .mq5 file content.
No markdown. No code fences. No prose. No explanation before or after.
Start directly with the header comment //+---...`;

/** The prefill prefix — forces Claude to continue the file body, no prose or code fences possible. */
const PREFILL = "//+------------------------------------------------------------------+";

export default async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
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

  const blueprint = body?.blueprint;
  if (!blueprint || typeof blueprint !== "object") {
    return Response.json({ error: "Missing or invalid blueprint" }, { status: 400, headers: CORS });
  }

  // Stream the response so Netlify doesn't time out on long code outputs.
  const readable = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        let generatedText = "";

        const stream = await client.messages.stream({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 8192,
          system: [{ type: "text", text: MQL5_SYSTEM, cache_control: { type: "ephemeral" } }],
          messages: [
            {
              role: "user",
              content: `Generate the complete MQL5 Expert Advisor for this StrategyBlueprint:\n\n${JSON.stringify(blueprint, null, 2)}`,
            },
            {
              role: "assistant",
              // Prefill forces Claude to start with the MQL5 header — no prose or code fences possible.
              // The streamed deltas are the continuation; we prepend PREFILL at the end.
              content: PREFILL,
            },
          ],
        });

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            generatedText += event.delta.text;
            send({ text: event.delta.text });
          }
        }

        // Signal completion — client already accumulated all text chunks.
        // Never send code in the done event: a 30KB JSON payload can get split
        // across TCP chunks, causing a parse failure on the client.
        send({ done: true });
      } catch (err) {
        console.error("generate-code error:", err);
        send({ error: err instanceof Error ? err.message : "Stream error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      ...CORS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
};

export const config = {
  path: "/api/generate-code",
  timeout: 26,
};
