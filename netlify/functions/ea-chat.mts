import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `You are an expert MQL5 developer and forex trading strategy specialist.

You have full access to the user's strategy blueprint JSON and generated Expert Advisor code.
Your role is to help the user understand, debug, improve, and iterate on their EA.

══════════════════════════════════════════════
STRICT MQL5-ONLY RULES — NEVER USE MQL4 SYNTAX
══════════════════════════════════════════════
These are the most common errors. Enforce them every time you write or fix code:

PRICES:
- NEVER use bare Ask or Bid → always SymbolInfoDouble(_Symbol, SYMBOL_ASK) / SYMBOL_BID

CTRADE MAGIC NUMBER:
- NEVER use trade.SetMagicNumber() → use trade.SetExpertMagicNumber((ulong)InpMagic)

SYMBOL INFO:
- SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN/MAX/STEP) — correct enum is ENUM_SYMBOL_INFO_DOUBLE
- SymbolInfoDouble(_Symbol, SYMBOL_ASK) / SYMBOL_BID — also ENUM_SYMBOL_INFO_DOUBLE
- Never use MarketInfo() — that is MQL4 only

ORDER MANAGEMENT:
- Never use OrderSend() — use trade.Buy() / trade.Sell() / trade.PositionClose()
- Never use RefreshRates() — not available in MQL5

ACCOUNT INFO:
- AccountInfoDouble(ACCOUNT_BALANCE) — correct
- AccountInfoDouble(ACCOUNT_EQUITY) — correct
- Never use AccountBalance() or AccountEquity() (MQL4 functions)

══════════════════════════════════════════════
WHAT YOU CAN DO
══════════════════════════════════════════════
- Explain how specific parts of the strategy or code work
- Debug compile errors or unexpected backtest behavior
- Suggest targeted improvements to the MQL5 code
- Modify specific rules, conditions, or parameters when asked
- Interpret backtest results and explain what they mean

══════════════════════════════════════════════
WHEN MODIFYING CODE
══════════════════════════════════════════════
1. Briefly explain what you changed and why (2-4 sentences max)
2. Return the COMPLETE updated .mq5 file — never truncate:
\`\`\`mql5
// full updated file here — every single line
\`\`\`
3. The file must compile without errors in MetaEditor 5
4. Preserve all existing inputs, comments, and structure unless asked to change them
5. If the file is long, write it all — do not use "// ... rest of file unchanged ..."

Keep responses concise and actionable. When not modifying code, do not include code blocks.`;

export default async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS });

  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ error: "ANTHROPIC_API_KEY missing" }, { status: 500, headers: CORS });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400, headers: CORS });
  }

  const messages = body.messages as { role: "user" | "assistant"; content: string }[];
  const blueprint = body.blueprint;
  const code = typeof body.code === "string" ? body.code : "";
  const backtestSummary = body.backtestSummary ?? null;
  const compileLog = typeof body.compileLog === "string" ? body.compileLog : null;

  if (!messages?.length) {
    return Response.json({ error: "messages required" }, { status: 400, headers: CORS });
  }

  // Inject full context into the first user message
  const contextBlock = [
    "=== STRATEGY BLUEPRINT ===",
    JSON.stringify(blueprint, null, 2),
    "",
    "=== GENERATED MQL5 CODE ===",
    code || "(no code generated yet)",
    compileLog ? `\n=== LAST COMPILE LOG ===\n${compileLog}` : "",
    backtestSummary
      ? `\n=== LAST BACKTEST SUMMARY ===\n${JSON.stringify(backtestSummary, null, 2)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const enrichedMessages = messages.map((m, i) =>
    i === 0 ? { ...m, content: `${contextBlock}\n\n=== USER MESSAGE ===\n${m.content}` } : m,
  );

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8192,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: enrichedMessages,
    });

    const block = response.content[0];
    if (block.type !== "text") throw new Error("Unexpected response type");

    const reply = block.text;

    // Extract updated code if present
    const codeMatch = reply.match(/```(?:mql5|mq5|cpp)?\n([\s\S]+?)```/i);
    const updatedCode = codeMatch ? codeMatch[1].trim() : null;

    return Response.json({ reply, updatedCode }, { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("ea-chat error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500, headers: CORS },
    );
  }
};

export const config = {
  path: "/api/ea-chat",
  timeout: 26,
};
