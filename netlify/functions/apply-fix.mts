// Applies the AI-described fix to the MQL5 code.
// Called after the user reads the fix summary in the chat and clicks "Apply Fix".
// The conversation history tells this model exactly what to change; it writes the full corrected file.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `You are an expert MQL5 developer applying code fixes described in a conversation.

Your job: read the conversation history, find the described changes, and apply ALL of them to the provided MQL5 code.

Output rules (CRITICAL):
- Return ONLY the raw .mq5 file content — no markdown, no code fences, no explanations
- Include EVERY line of the original file; only change what was described
- Never truncate — write the entire file from start to finish
- Start directly with //+------------------------------------------------------------------+

MQL5-only rules (enforce in the output):
- NEVER use bare Ask or Bid → SymbolInfoDouble(_Symbol, SYMBOL_ASK) / SYMBOL_BID
- NEVER use trade.SetMagicNumber() → trade.SetExpertMagicNumber((ulong)InpMagic)
- NEVER use MarketInfo(), OrderSend(), RefreshRates(), AccountBalance(), AccountEquity()
- Always use AccountInfoDouble(ACCOUNT_BALANCE/EQUITY), trade.Buy()/Sell()/PositionClose()`;

const PREFILL = "//+------------------------------------------------------------------+";

/** Keep only error/warning/result lines — strips verbose information: lines. */
function trimCompileLog(log: string): string {
  return log
    .split("\n")
    .filter((l) => {
      const lower = l.toLowerCase();
      return (
        lower.includes("error") ||
        lower.includes("warning") ||
        lower.includes("result:") ||
        lower.includes("compile job") ||
        lower.includes("metaeditor exit") ||
        (l.trim().length > 0 && !lower.includes(": information:"))
      );
    })
    .join("\n")
    .trim();
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
  const rawLog = typeof body.compileLog === "string" ? body.compileLog : null;
  const compileLog = rawLog ? trimCompileLog(rawLog) : null;
  const backtestSummary = body.backtestSummary ?? null;

  if (!messages?.length || !code) {
    return Response.json({ error: "messages and code are required" }, { status: 400, headers: CORS });
  }

  // Build the prompt: full context + conversation history (so the model knows what to fix)
  const conversationHistory = messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const userContent = [
    "=== STRATEGY BLUEPRINT ===",
    JSON.stringify(blueprint, null, 2),
    "",
    "=== MQL5 CODE TO FIX ===",
    code,
    compileLog ? `\n=== COMPILE ERRORS ===\n${compileLog}` : "",
    backtestSummary
      ? `\n=== BACKTEST SUMMARY ===\n${JSON.stringify(backtestSummary, null, 2)}`
      : "",
    "",
    "=== CONVERSATION (describes what to fix) ===",
    conversationHistory,
    "",
    "Apply ALL the described fixes and return the COMPLETE corrected .mq5 file:",
  ]
    .filter(Boolean)
    .join("\n");

  // Stream the fixed code so Netlify doesn't time out
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
          system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
          messages: [
            { role: "user", content: userContent },
            {
              role: "assistant",
              // Prefill forces raw code output — no prose or code fences possible
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
            // Don't stream chunks to the client — just generate silently and apply at the end
          }
        }

        const code = (PREFILL + generatedText).trim();
        send({ done: true, code });
      } catch (err) {
        console.error("apply-fix error:", err);
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
  path: "/api/apply-fix",
  timeout: 26,
};
