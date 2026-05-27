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

const SYSTEM = `You are an expert MQL5 developer making SURGICAL fixes to an EA.

══════════════════════════════════════════════
PRIME DIRECTIVE — READ THIS FIRST
══════════════════════════════════════════════
You are a SURGEON, not a rewriter.
Your only job: apply the EXACT fixes described in the conversation to the provided code.

ABSOLUTE RULES — VIOLATING ANY OF THESE IS A CRITICAL FAILURE:
1. Copy every line of the original file verbatim EXCEPT the lines that must change.
2. Do NOT add new strategy logic (no new EMAs, indicators, patterns, or functions).
3. Do NOT remove any function, call site, or feature unless the conversation EXPLICITLY says to remove it.
   - If the conversation says "remove X" but X is a core feature (break-even, state machine, SL calc), IGNORE that instruction. Do not remove working features.
4. Do NOT restructure, reformat, reindent, or rename anything that was not mentioned.
5. Do NOT add functions not present in the original — unless the fix explicitly requires one.
6. Fix ONLY the error or change described. Stop immediately after applying that one fix.
7. Never convert single-line comments (//) into multiline strings or block comments.
8. Do NOT disable, comment out, or alter OnTick() logic unless the conversation explicitly and specifically targets OnTick.
9. FVG state machine: NEVER remove or reorder FVG_Update, FVG_ExecuteEntries, FVG_Detect, FVG_DrawZones, or FVG_ManageBreakEven calls.

OUTPUT FORMAT (CRITICAL):
- Return ONLY the raw .mq5 file content
- No markdown. No code fences. No explanations.
- Start with //+------------------------------------------------------------------+
- Never truncate — write the entire file from start to finish

══════════════════════════════════════════════
WHAT TO FIX
══════════════════════════════════════════════
Read the conversation history carefully. Find the specific lines/values described.
Apply ONLY those changes. Examples of correctly scoped fixes:

  "Replace null with 2.0 in InpRewardRisk input"
  → Only change that one line. Leave everything else alone.

  "Fix the unbalanced brace on line 153"
  → Add the missing closing brace. Do not touch other braces.

  "Replace Ask with SymbolInfoDouble(_Symbol, SYMBOL_ASK)"
  → Replace every bare Ask reference. Do not change other lines.

  "Add TP calculation before trade.Buy"
  → Add the tp variable and update the trade.Buy call. Nothing else changes.

══════════════════════════════════════════════
MQL5 SYNTAX CORRECTIONS (apply only if the fix targets these)
══════════════════════════════════════════════
  PRICES:   Ask/Bid → SymbolInfoDouble(_Symbol, SYMBOL_ASK/BID)
  MAGIC:    trade.SetMagicNumber() → trade.SetExpertMagicNumber((ulong)InpMagic)
  ACCOUNT:  AccountBalance()/AccountEquity() → AccountInfoDouble(ACCOUNT_BALANCE/EQUITY)
  SYMBOL:   MarketInfo() → SymbolInfoDouble/Integer(_Symbol, ...)
  ORDERS:   OrderSend() MQL4-style → trade.Buy()/trade.Sell()/trade.PositionClose()
  NULLS:    null in numeric inputs → replace with a valid default (0, 0.0, 2.0, etc.)
  STRINGS:  unterminated string literals → close the quote on the same line`;

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
    "Apply ONLY the specific changes described in the conversation above.",
    "Do NOT remove any working feature (break-even, state machine calls, SL logic, etc.).",
    "Do NOT restructure or reformat anything that was not mentioned.",
    "Return the COMPLETE corrected .mq5 file with MINIMAL diff from the original:",
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
          model: "claude-sonnet-4-6",
          max_tokens: 16000,
          system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
          messages: [
            {
              role: "user",
              content: userContent + "\n\nREMINDER: Output ONLY raw .mq5 file content. Start your response with //+------------------------------------------------------------------+ on the very first line. No markdown. No code fences. No explanation.",
            },
          ],
        });

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            generatedText += event.delta.text;
            // Stream each chunk so the client accumulates the full file incrementally.
            // Never put the whole code in the done event — a 30KB JSON payload can be
            // split across TCP chunks, causing a parse failure on the client.
            send({ text: event.delta.text });
          }
        }

        send({ done: true });
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
