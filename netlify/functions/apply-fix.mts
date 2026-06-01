// Applies the AI-described fix to the MQL5 code via SURGICAL SEARCH/REPLACE.
//
// The model outputs ONLY the small changed snippets (not the whole file), and the
// server applies them deterministically to the original code. The full file is
// never regenerated, so it CANNOT truncate — which is what broke large EAs when
// this function re-emitted all 800 lines (it ran out of tokens / time mid-file).
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `You are an expert MQL5 developer making SURGICAL fixes to an EA.

You output ONLY small edit blocks — NEVER the whole file.

OUTPUT FORMAT — output one or more edit blocks, each EXACTLY like this and nothing else:
<<<<<<< SEARCH
(verbatim lines copied character-for-character from the code, with exact indentation)
=======
(the replacement lines)
>>>>>>> REPLACE

RULES:
1. The SEARCH text MUST be copied EXACTLY from the provided code — same characters,
   same indentation, same spacing. It must appear EXACTLY ONCE in the file. Include
   a few surrounding lines of context if needed to make it unique.
2. Make the SMALLEST edits that implement ONLY the fix described in the conversation.
   Usually 1-3 blocks. Change nothing else.
3. Do NOT output the whole file. Do NOT output explanations, markdown, or code fences.
   Output ONLY the <<<<<<< SEARCH / ======= / >>>>>>> REPLACE blocks.
4. Do NOT remove working features (break-even, state machine calls, SL logic). Do NOT
   reference functions that are not present in the code.
5. Preserve every other line of the file unchanged (the server keeps them verbatim).

MQL5 syntax corrections (apply only if the fix targets them):
  Ask/Bid → SymbolInfoDouble(_Symbol, SYMBOL_ASK/BID)
  trade.SetMagicNumber() → trade.SetExpertMagicNumber((ulong)InpMagic)
  AccountBalance()/AccountEquity() → AccountInfoDouble(ACCOUNT_BALANCE/EQUITY)
  MarketInfo() → SymbolInfoDouble/Integer(_Symbol, ...)
  null in numeric inputs → a valid default (0, 0.0, 2.0, ...)`;

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

interface Edit {
  search: string;
  replace: string;
}

/** Parse SEARCH/REPLACE blocks from the model output. */
function parseEdits(text: string): Edit[] {
  const re = /<<<<<<<\s*SEARCH\s*\n([\s\S]*?)\n=======\s*\n([\s\S]*?)\n>>>>>>>\s*REPLACE/g;
  const edits: Edit[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) edits.push({ search: m[1], replace: m[2] });
  return edits;
}

const stripTrailingWs = (s: string) =>
  s
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n");
const balanced = (s: string) =>
  (s.match(/\{/g)?.length ?? 0) === (s.match(/\}/g)?.length ?? 0) &&
  (s.match(/\(/g)?.length ?? 0) === (s.match(/\)/g)?.length ?? 0);

/** Apply edits to the original code. Returns the patched code or a list of failures. */
function applyEdits(original: string, edits: Edit[]): { code: string; failures: string[] } {
  let out = original.replace(/\r\n/g, "\n");
  const failures: string[] = [];
  for (const e of edits) {
    const search = e.search.replace(/\r\n/g, "\n");
    const replace = e.replace.replace(/\r\n/g, "\n");
    if (out.includes(search)) {
      out = out.replace(search, replace); // exact match (first occurrence)
      continue;
    }
    // Fallback: tolerate trailing-whitespace differences.
    const nOut = stripTrailingWs(out);
    const nSearch = stripTrailingWs(search);
    const idx = nOut.indexOf(nSearch);
    if (idx >= 0) {
      // Replace in the trailing-ws-normalised file (acceptable for .mq5).
      out = nOut.slice(0, idx) + stripTrailingWs(replace) + nOut.slice(idx + nSearch.length);
      continue;
    }
    failures.push(search.split("\n").slice(0, 3).join("\n").slice(0, 160));
  }
  return { code: out, failures };
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
    return Response.json(
      { error: "messages and code are required" },
      { status: 400, headers: CORS },
    );
  }

  const conversationHistory = messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const userContent = [
    "=== STRATEGY BLUEPRINT ===",
    JSON.stringify(blueprint, null, 2),
    "",
    "=== MQL5 CODE (apply edits against THIS exact text) ===",
    code.replace(/\r\n/g, "\n"),
    compileLog ? `\n=== COMPILE ERRORS ===\n${compileLog}` : "",
    backtestSummary
      ? `\n=== BACKTEST SUMMARY ===\n${JSON.stringify(backtestSummary, null, 2)}`
      : "",
    "",
    "=== CONVERSATION (describes what to fix) ===",
    conversationHistory,
    "",
    "Output ONLY <<<<<<< SEARCH / ======= / >>>>>>> REPLACE blocks for the smallest",
    "edits that implement the described fix. Copy SEARCH text verbatim from the code above.",
  ]
    .filter(Boolean)
    .join("\n");

  const readable = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        // Small output (edits only) → fast, no truncation, well within the timeout.
        const resp = await client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 8000,
          system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: userContent }],
        });
        const out = resp.content.map((b) => (b.type === "text" ? b.text : "")).join("");

        const edits = parseEdits(out);
        if (edits.length === 0) {
          send({
            error:
              "The fix could not be expressed as edits. Try rephrasing, or use Build with AI to regenerate.",
          });
          send({ done: true });
          controller.close();
          return;
        }

        const { code: patched, failures } = applyEdits(code, edits);
        if (failures.length > 0) {
          send({
            error: `Could not locate ${failures.length} edit target(s) in the code (the snippet did not match). Try Build with AI to regenerate instead.`,
          });
          send({ done: true });
          controller.close();
          return;
        }
        if (!balanced(patched)) {
          send({
            error:
              "The edit would unbalance braces/parentheses — refusing to apply a broken file. Try Build with AI to regenerate.",
          });
          send({ done: true });
          controller.close();
          return;
        }

        // Stream the server-built patched file back in chunks (it is complete in memory,
        // so streaming it cannot truncate it).
        for (let i = 0; i < patched.length; i += 4000) send({ text: patched.slice(i, i + 4000) });
        send({ done: true, applied: edits.length });
      } catch (err) {
        console.error("apply-fix error:", err);
        send({ error: err instanceof Error ? err.message : "Stream error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
};

export const config = {
  path: "/api/apply-fix",
  timeout: 26,
};
