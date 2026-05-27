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
WHEN MODIFYING OR FIXING CODE
══════════════════════════════════════════════
NEVER write code in your response. Instead:
1. List the EXACT changes (2–6 bullet points). Each bullet must name the specific line,
   value, or function to change — not a vague description.
2. One sentence per bullet explaining WHY it fixes the problem.
3. YOUR RESPONSE MUST END WITH THIS EXACT LINE (nothing after it): [FIX_READY]

CRITICAL — scope your fix description correctly:
• Fix ONLY what is broken. If the error is a missing closing brace, say that and nothing else.
• Do NOT describe rewriting the strategy logic.
• Do NOT describe adding new indicators or functions that weren't there.
• Do NOT describe restructuring unrelated parts of the code.
• One compile error = one focused fix. Do not bundle unrelated changes.

Example — correct fix description for a null input error:
• In the inputs section, change \`input double InpRewardRisk = null;\` to \`input double InpRewardRisk = 2.0;\` — MQL5 does not accept null for double inputs
[FIX_READY]

Example — correct fix description for missing event handler:
• Add \`int OnInit()\` with handle creation and return INIT_SUCCEEDED — MQL5 requires this event function
• Add \`void OnDeinit(const int reason)\` with IndicatorRelease calls — required to free handles
• Add \`void OnTick()\` with the bar-open pattern and trade logic — error 356 means this is missing
[FIX_READY]

The user will click "Apply Fix" and the corrected code will be generated automatically.
Keep the summary to 3–8 lines maximum. No code snippets, no code blocks — ever.

══════════════════════════════════════════════
WHEN EXPLAINING (not modifying code)
══════════════════════════════════════════════
Answer normally. Do NOT include [FIX_READY] or any code blocks.
Keep responses concise and actionable.`;

/** Keep only error/warning/result lines from a compile log — strips verbose "information:" lines. */
function trimCompileLog(log: string): string {
  const lines = log.split("\n");
  const keep = lines.filter((l) => {
    const lower = l.toLowerCase();
    return (
      lower.includes("error") ||
      lower.includes("warning") ||
      lower.includes("result:") ||
      lower.includes("compile job") ||
      lower.includes("metaeditor exit") ||
      (l.trim().length > 0 && !lower.includes(": information:"))
    );
  });
  return keep.join("\n").trim();
}

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
  const rawLog = typeof body.compileLog === "string" ? body.compileLog : null;
  const compileLog = rawLog ? trimCompileLog(rawLog) : null;

  if (!messages?.length) {
    return Response.json({ error: "messages required" }, { status: 400, headers: CORS });
  }

  // Inject full context into the first user message only
  const contextBlock = [
    "=== STRATEGY BLUEPRINT ===",
    JSON.stringify(blueprint, null, 2),
    "",
    "=== GENERATED MQL5 CODE ===",
    code || "(no code generated yet)",
    compileLog ? `\n=== LAST COMPILE ERRORS ===\n${compileLog}` : "",
    backtestSummary
      ? `\n=== LAST BACKTEST SUMMARY ===\n${JSON.stringify(backtestSummary, null, 2)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const enrichedMessages = messages.map((m, i) =>
    i === 0 ? { ...m, content: `${contextBlock}\n\n=== USER MESSAGE ===\n${m.content}` } : m,
  );

  // Stream the response so Netlify doesn't time out on long code outputs
  const readable = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();

      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        let fullText = "";

        const stream = await client.messages.stream({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 8192,
          system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
          messages: enrichedMessages,
        });

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            fullText += event.delta.text;
            send({ text: event.delta.text });
          }
        }

        // Signal whether the AI described a fix (client shows the Apply Fix button)
        const fixReady = fullText.includes("[FIX_READY]");
        send({ done: true, fixReady });
      } catch (err) {
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
  path: "/api/ea-chat",
  timeout: 26,
};
