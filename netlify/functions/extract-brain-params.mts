/**
 * extract-brain-params
 * Focused Claude call that reads a plain-English brain description and
 * returns concrete numerical/boolean parameters for that brain's module.
 *
 * Input:  { role, module, timeframe, description }
 * Output: { params: Record<string, unknown>, summary: string }
 */
import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Param schemas per module ─────────────────────────────────────────────────
// Tells Claude exactly which keys to output so it never invents extra ones.

const MODULE_PARAMS: Record<string, string> = {
  choch: `{
  "lookback":   number,   // bars to scan for swing high/low (default 20, range 5-200)
  "swingLeft":  number,   // left-side bars to confirm a pivot (default 5, range 1-20)
  "swingRight": number    // right-side bars to confirm a pivot (default 5, range 1-20)
}`,
  bos: `{
  "lookback":   number,
  "swingLeft":  number,
  "swingRight": number
}`,
  ema: `{
  "fastPeriod": number,   // fast EMA period (default 9)
  "slowPeriod": number    // slow EMA period (default 21)
}`,
  order_block: `{
  "atrPeriod":  number,   // ATR period for displacement filter (default 14)
  "dispMult":   number,   // body must be >= dispMult * ATR (default 1.5)
  "scanBack":   number,   // bars before displacement to search for OB candle (default 5)
  "expiry":     number    // bars until zone expires, 0=never (default 100)
}`,
  fvg: `{
  "expiry":     number    // bars until FVG expires, 0=never (default 50)
}`,
  liqsweep: `{
  "lookback":   number,   // bars to scan for swing levels (default 20)
  "expiry":     number    // max wait bars for close-back (default 10)
}`,
  snr: `{
  "lookback":   number,
  "expiry":     number
}`,
  engulfing: `{
  "minBodyRatio": number  // minimum body as fraction of candle range (default 0.6)
}`,
  pin_bar: `{
  "minWickRatio": number  // minimum wick as fraction of candle range (default 0.6)
}`,
};

function buildSystem(role: string, modules: string[]): string {
  const primaryModule = modules[0] ?? "fvg";
  const schema = MODULE_PARAMS[primaryModule] ?? `{ "lookback": number }`;
  const modulesDesc = modules.length === 1
    ? `the "${modules[0]}" module`
    : `the modules: ${modules.map(m => `"${m}"`).join(", ")}`;

  return `You are a parameter extractor for a forex EA builder.

The user is configuring the ${role.toUpperCase()} BRAIN using ${modulesDesc}.
They will describe how they want it to behave in plain English.
Your job is to extract ONLY the concrete numerical or boolean parameters and return them as JSON.

When multiple modules are selected, extract parameters that apply to their shared logic.

RULES:
- Return ONLY valid JSON matching the schema below — no prose, no markdown fences.
- Only include keys explicitly mentioned or clearly implied by the description.
- If a value is not mentioned, omit that key entirely (use defaults at runtime).
- Never invent parameters not in the schema.
- The "summary" field must be a single sentence describing what you understood.

SCHEMA for "${module}":
${schema}

Add a "summary" string field to the output: one sentence confirming what was extracted.

EXAMPLE output for "use 5-bar pivots and look back 30 bars":
{
  "lookback": 30,
  "swingLeft": 5,
  "swingRight": 5,
  "summary": "CHoCH detection with 5-bar pivot confirmation and 30-bar structure lookback."
}`;
}

function cleanJson(raw: string): string {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  text = text.replace(/[""]/g, '"').replace(/['']/g, "'");
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  text = text.replace(/,(\s*[}\]])/g, "$1");
  return text.trim();
}

export default async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
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
  try { body = await req.json(); }
  catch { return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS }); }

  const role        = typeof body.role        === "string" ? body.role.trim()        : "";
  const modules     = Array.isArray(body.modules) && body.modules.every((m: unknown) => typeof m === "string")
    ? body.modules.map((m: string) => m.trim())
    : [];
  const timeframe   = typeof body.timeframe   === "string" ? body.timeframe.trim()   : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";

  if (!role || modules.length === 0 || !timeframe || !description) {
    return Response.json(
      { error: "role, modules (array), timeframe, and description are required" },
      { status: 400, headers: CORS },
    );
  }

  if (description.length < 5) {
    return Response.json(
      { error: "Description too short — add more detail" },
      { status: 400, headers: CORS },
    );
  }

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: buildSystem(role, modules),
      messages: [
        {
          role: "user",
          content: `${role} brain (${modules.join(" + ")} @ ${timeframe}) — extract params from:\n"${description}"`,
        },
        {
          role: "assistant",
          content: "{",   // prefill forces JSON-only output
        },
      ],
    });

    const block = response.content[0];
    if (block.type !== "text") throw new Error("Unexpected Claude response type");

    const raw  = "{" + block.text;
    const text = cleanJson(raw);

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = JSON.parse(jsonrepair(text)) as Record<string, unknown>;
    }

    const summary = typeof parsed.summary === "string" ? parsed.summary : "";
    const { summary: _s, ...params } = parsed;   // separate summary from params
    void _s;

    return Response.json(
      { params, summary },
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("extract-brain-params error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return Response.json({ error: message }, { status: 500, headers: CORS });
  }
};

export const config = {
  path: "/api/extract-brain-params",
  timeout: 15,
};
