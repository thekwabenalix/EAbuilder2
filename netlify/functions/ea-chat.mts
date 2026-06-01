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
TEMPLATE-GENERATED CODE — CRITICAL RULE
══════════════════════════════════════════════
If the MQL5 code header contains "template mode — always compiles", the code was produced
by a DETERMINISTIC template engine, NOT by AI. This means:

• DO NOT use [FIX_READY] for template code issues.
• DO NOT describe line-by-line code edits — you cannot safely patch a generated file.
• INSTEAD: explain what the logical problem is (e.g. "TP is set to 0 so trades never close"),
  then tell the user: "Click Regen Template in the chat banner to regenerate from the latest
  template — the underlying engine has already been updated to fix this."
• The "Regen Template" button in the chat applies the template regeneration automatically.

This rule exists because template code is always regenerated as a whole unit. Patching it
with an AI rewrite risks removing working features (break-even, state machine, SL logic).

══════════════════════════════════════════════
WHEN MODIFYING OR FIXING AI-GENERATED CODE
══════════════════════════════════════════════
(Only applies when the code does NOT have the template header.)

NEVER write code in your response. Instead:
1. List the EXACT changes (2–6 bullet points). Each bullet must name the specific line,
   value, or function to change — not a vague description.
2. One sentence per bullet explaining WHY it fixes the problem.
3. YOUR RESPONSE MUST END WITH THIS EXACT LINE (nothing after it): [FIX_READY]

CRITICAL — scope your fix description correctly:
• Fix ONLY what is broken. If the error is a missing closing brace, say that and nothing else.
• Do NOT describe rewriting the strategy logic.
• Do NOT describe adding new indicators or functions that weren't there.
• Do NOT describe removing features that are working correctly (break-even, SL, state machine).
• Do NOT describe restructuring unrelated parts of the code.
• One compile error = one focused fix. Do not bundle unrelated changes.

Example — correct fix description for a null input error:
• In the inputs section, change \`input double InpRewardRisk = null;\` to \`input double InpRewardRisk = 2.0;\` — MQL5 does not accept null for double inputs
[FIX_READY]

The user will click "Apply Fix" and the corrected code will be generated automatically.
Keep the summary to 3–8 lines maximum. No code snippets, no code blocks — ever.

══════════════════════════════════════════════
DIAGNOSING WRONG BEHAVIOUR (screenshots + journal + "the entries are wrong")
══════════════════════════════════════════════
You may be given a CHART SCREENSHOT. Use it. This is a 4-Brain EA: a Direction
Brain sets bias, a Setup Brain arms a zone, an Execution Brain triggers entry,
and a confluence gate requires all active brains to AGREE before a trade opens.

When the user says the EA mis-traded, produce a STRUCTURED diagnosis:
1. INTENDED — restate what the strategy should do, per the blueprint/description.
2. OBSERVED — what the screenshot/journal/code actually shows (entry locations vs
   the drawn indicators/zones; which arrows are wrong and why).
3. ROOT CAUSE — name the SPECIFIC logic gap, in brain terms. Common ones:
   • Entries fire on the same bar as the setup → a multi-bar sequence is collapsed.
   • Setup has no memory (resets every bar) → can't "wait then confirm".
   • Execution direction not aligned with bias → confluence not enforced.
   • An indicator value read returned 0.0 when not ready → phantom signals.
4. CLASSIFY the fix as exactly ONE of:
   [A] RECONFIGURE — fixable by regenerating with a different module / parameter /
       timeframe (e.g. wrong module chosen for a role, wrong period, wrong TF).
       Recommend the specific change and tell the user to Regenerate / AI Rebuild.
   [B] BUILDING-BLOCK — the verified inline module itself (a state machine such as
       EMASM / FVGSM / OBSM / the assembler gate) needs a code change. This is NOT
       fixable by editing this .mq5. Name the module and the exact behaviour that
       must change, and say it must be reported to the developer / generator.

CRITICAL — for a 4-Brain EA (inline state machines, brain functions) you must
NEVER attempt a freeform logic rewrite via [FIX_READY]. Rewriting 800+ lines
truncates and removes working features. Logic bugs in a 4-Brain EA are class [A]
(regenerate) or class [B] (building-block report) — never a surgical .mq5 patch.
Reserve [FIX_READY] for genuine, isolated code-level fixes (a bad input default,
a missing brace) on AI-generated code only.

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
  // Chart screenshots for behaviour diagnosis (base64 data URLs from the client)
  const images = Array.isArray(body.images)
    ? (body.images as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
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

  // Convert a base64 data URL into an Anthropic image content block.
  const toImageBlock = (dataUrl: string) => {
    const m = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
    if (!m) return null;
    const media_type = m[1] === "image/jpg" ? "image/jpeg" : m[1];
    return { type: "image" as const, source: { type: "base64" as const, media_type, data: m[2] } };
  };
  const imageBlocks = images.map(toImageBlock).filter(Boolean) as Array<{
    type: "image"; source: { type: "base64"; media_type: string; data: string };
  }>;

  const lastIdx = messages.length - 1;
  const enrichedMessages = messages.map((m, i) => {
    const text = i === 0 ? `${contextBlock}\n\n=== USER MESSAGE ===\n${m.content}` : m.content;
    // Attach any screenshots to the most recent user message as image blocks.
    if (i === lastIdx && m.role === "user" && imageBlocks.length > 0) {
      return { role: m.role, content: [...imageBlocks, { type: "text" as const, text }] };
    }
    return { role: m.role, content: text };
  });

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
