// Regenerates MQL5 code from an existing StrategyBlueprint.
// Called when a user edits their blueprint and wants updated code.
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

Output format:
Return ONLY the raw .mq5 file content.
No markdown. No code fences. No prose. No explanation before or after.
Start directly with the header comment //+---...`;

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

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
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
        {
          role: "assistant",
          // Prefill forces Claude to start with the MQL5 header — no prose or code fences possible
          content: "//+------------------------------------------------------------------+",
        },
      ],
    });

    const block = response.content[0];
    if (block.type !== "text") throw new Error("Unexpected response type from Claude");

    // Prepend the prefilled header line back
    const code =
      "//+------------------------------------------------------------------+" + block.text;

    return Response.json(
      { code: code.trim() },
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("generate-code error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return Response.json({ error: message }, { status: 500, headers: CORS });
  }
};

export const config = {
  path: "/api/generate-code",
  timeout: 26,
};
