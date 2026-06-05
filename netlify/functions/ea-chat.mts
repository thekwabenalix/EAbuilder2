import Anthropic from "@anthropic-ai/sdk";
import { buildCompactModuleContractContext } from "../../src/lib/module-contracts.js";
import { buildCompactModuleLibraryContext } from "../../src/lib/module-library.js";
import { buildModuleRepairPlan, MODULE_ADMISSION } from "../../src/lib/module-admission.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `You are an expert MQL5 developer and forex trading strategy specialist.

You have access to the user's strategy prompt, strategy blueprint JSON, generated Expert Advisor code,
platform module registry, module contracts, compile/tester logs, backtest summary, and screenshots
when attached.
Your role is to help the user understand, debug, improve, and iterate on their EA.

You are the in-app EA Builder copilot. Think in the platform's architecture:
Trader prompt -> AI interpretation -> 4-Brain blueprint -> verified module contracts/state machines
-> self-contained MQL5 EA -> compile -> MT5 backtest -> diagnosis.

When diagnosing, FIRST decide which layer is responsible:
- PROMPT / INTERPRETATION: the blueprint does not match the trader's words.
- BLUEPRINT / WIRING: the 4-Brain roles, modules, params, or sequence are wrong.
- MODULE CONTRACT: the selected module cannot express the requested behaviour yet.
- GENERATOR / STATE MACHINE: verified block behaviour needs a platform update.
- MQL5 / COMPILE: generated code failed to compile.
- MT5 RUNNER / TESTER: local runner, MT5 terminal, tester config, symbol, spread, date, or data issue.
- TRADING LOGIC / RISK: spread, max trades, max stop, SL/TP, BE, or risk filter blocked the trade.

If the user's message starts with "Diagnosis mode:", follow this output shape:
1. Verdict - one sentence naming the most likely failing layer.
2. Evidence - 2 to 5 concrete facts from prompt/blueprint/code/log/screenshot.
3. Brain/Module Impact - explain Direction, Setup, Execution, and Management only where relevant.
4. Next Action - one safe platform action, such as regenerate with AI, regen template, re-run interview,
   compile, run report backtest, attach screenshot, download tester log, or developer/module update.
Do not ramble. Do not invent screenshot details. If evidence is missing, say exactly what is missing.

When your safest next action matches one of the app actions below, add exactly one marker on its own
final line. The UI will turn it into a button. Do not use action markers for destructive,
unsupported, or vague actions.
- [ACTION:regen_template] for deterministic 4-Brain/template regeneration.
- [ACTION:open_brains] to inspect or adjust the 4-Brain mapping/module params.
- [ACTION:open_code] to inspect generated MQL5.
- [ACTION:open_backtest] to compile, run report backtest, or download tester logs.
- [ACTION:open_export] to download/export generated EA artifacts.
- [ACTION:open_validation] to inspect rules-based validation.
- [ACTION:download_evidence] to download a complete diagnostic evidence pack for support/debugging.
- [ACTION:rerun_interview] when the trader's words must be reinterpreted from scratch.
- [ACTION:ai_rebuild] when the 4-Brain wiring/SM configs should be regenerated from structured AI.
- [ACTION:open_modules] when the issue is missing/guarded/detector-only module capability.
- [ACTION:download_tester_log] when the next useful evidence is the MT5 tester log.

If the user's message starts with "Repair flow:", follow this output shape:
1. Repair Path - choose exactly one: re-run interview, adjust Brains, AI rebuild, regen template,
   compile/backtest retry, download tester log, inspect modules, or developer/module update.
2. Why - 2 to 4 evidence bullets from prompt/blueprint/contracts/logs/diagnostics.
3. Do Now - one concrete app action the trader can take immediately.
4. Verify After - one concrete compile/backtest/screenshot/log check.
End with exactly one [ACTION:...] marker when a listed app action applies.

Prefer safe platform actions over raw code rewrites:
- For 4-Brain/template EAs, recommend Build with AI, Regen from Template, re-run interview, compile,
  run backtest, download tester log, or inspect module contract.
- Only use [FIX_READY] for small bounded edits to non-template AI-written brain wiring.
- Never invent a module capability. If a module is template-only/detector-only/not verified, say so
  and suggest verified alternatives from the platform context.

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
- Explain whether selected modules are verified, template-only, detector-only, or blocked for AI wiring
- Explain which 4-Brain layer failed and which safe app action should be tried next

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
IMAGE HONESTY — ABSOLUTE RULE
══════════════════════════════════════════════
Use the IMAGE STATUS line in the latest user message as the source of truth.
If it says attached_and_parsed, an image is attached and you must not say "I don't
see an attached image". Describe only what you genuinely see.
If it says attached_but_unparsed, the user tried to attach an image but the app
could not parse it; ask them to reattach/paste it and diagnose only from text/logs.
If it says none, say plainly "I don't see an attached image" before asking for one.
Never invent, assume, or guess chart contents, timeframe, arrows, panel text, or candle positions.

You can analyse a screenshot ONLY when an image is actually attached to the
latest message. If an image IS attached, describe what you genuinely see.
If NO image is attached, you MUST say plainly "I don't see an attached image"
and ask the user to attach/paste it. NEVER invent, assume, or guess the contents
of a chart — its timeframe, the number of trades/arrows, panel text, or candle
positions. Fabricating image contents is a CRITICAL failure. Do not claim to see
an image you were not given.

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
4. CLASSIFY where the bug lives, then ACT — prefer fixing the code directly:

   [FIX] BRAIN WIRING / LOGIC (you CAN fix this) — the bug is in the AI-written
       brain functions (Direction_Brain_Execute / Setup_Brain_Execute /
       Execution_Brain_Execute) or a small condition: e.g. a brain reads EMAs
       directly instead of calling the state machine; a wrong/missing condition;
       wrong direction variable; setup/exec not gated on the SM output. These are
       SMALL, BOUNDED edits to named functions. → Describe the EXACT change and end
       with [FIX_READY]. The user clicks "Apply fix" and the code is corrected.

   [REGEN] EMBEDDED STATE-MACHINE CAPABILITY — the fix needs a verified inline SM
       (EMASM / FVGSM / OBSM / the gate) to BEHAVE differently (a missing phase,
       no cross state, no memory). Do NOT rewrite the embedded SM inline (it is
       large and rewriting risks truncating the 800-line file). Instead tell the
       user: "Click 'Build with AI' to regenerate — the generator's building
       blocks are updated frequently and may already include this." You are
       looking at THIS EA's code, not the generator, so NEVER say regenerating is
       pointless.

   [DEV] LAST RESORT — only if a surgical [FIX] is not possible AND regenerating
       did not help: name the building block + the exact behaviour that must
       change so a developer can update the generator.

   RULE: if the fix is a bounded edit to the brain functions, FIX IT ([FIX_READY]).
   Only fall back to [REGEN]/[DEV] when the change is a large state-machine
   restructure. NEVER rewrite the whole EA from scratch or output the full file
   speculatively — the Apply-fix step is surgical and preserves every other line.

   BEFORE proposing a [FIX_READY] that CALLS an SM function (e.g.
   EMASM_M5_SetupActive(), FVGSM_H4_BullJustConfirmed()), VERIFY that exact
   function / state machine is actually present in the code shown to you. If it is
   NOT embedded, you cannot call it — that is [REGEN] (regenerate to embed the SM),
   not a patch. Only reference functions that already exist in this EA.

══════════════════════════════════════════════
WHEN EXPLAINING (not modifying code)
══════════════════════════════════════════════
Answer normally. Do NOT include [FIX_READY] or any code blocks.
Keep responses concise and actionable.`;

type ChatMessage = { role: "user" | "assistant"; content: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function brainModules(blueprint: unknown): string[] {
  const fb = asRecord(asRecord(blueprint).fourBrain);
  const roles = ["direction", "setup", "execution"] as const;
  const modules: string[] = [];
  for (const role of roles) {
    const brain = asRecord(fb[role]);
    const raw = brain.modules;
    if (Array.isArray(raw)) {
      for (const item of raw) if (typeof item === "string") modules.push(item.toLowerCase());
    }
  }
  return [...new Set(modules)];
}

function compactAdmissionContext(moduleIds: string[]): string {
  const selected = moduleIds.length ? moduleIds : Object.keys(MODULE_ADMISSION);
  const lines = [
    "MODULE ADMISSION STATUS - use this to decide whether AI wiring is safe.",
    "verified_state_machine = safe for AI 4-Brain wiring. template_only = deterministic template only. detector_only/not_verified = cannot reliably trade yet.",
    "",
  ];
  for (const id of selected) {
    const admission = MODULE_ADMISSION[id] ?? MODULE_ADMISSION[id.replace(/^ob$/, "order_block")];
    if (!admission) {
      lines.push(`[${id}] Unknown - no admission record. Treat as blocked until implemented.`);
      continue;
    }
    lines.push(
      `[${admission.id}] ${admission.label}: ${admission.status}; aiVocabulary=${admission.aiVocabulary}; ${admission.notes}`,
    );
  }
  const repair = buildModuleRepairPlan(moduleIds);
  lines.push("");
  lines.push(`Repair plan: ${repair.summary}`);
  if (repair.blocked.length) {
    for (const item of repair.blocked) {
      const suggestions = item.suggestedModules.map((mod) => mod.label).join(", ") || "none";
      lines.push(
        `- ${item.label}: ${item.recommendation} Suggested verified modules: ${suggestions}.`,
      );
    }
  }
  return lines.join("\n");
}

function platformContext(blueprint: unknown): string {
  const selectedModules = brainModules(blueprint);
  return [
    "=== EA BUILDER PLATFORM CONTEXT ===",
    compactAdmissionContext(selectedModules),
    "",
    "=== VERIFIED MODULE CONTRACTS ===",
    buildCompactModuleContractContext(),
    "",
    "=== MODULE VOCABULARY SUMMARY ===",
    buildCompactModuleLibraryContext(),
  ].join("\n");
}

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

  const messages = body.messages as ChatMessage[];
  const blueprint = body.blueprint;
  const code = typeof body.code === "string" ? body.code : "";
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  // Chart screenshots for behaviour diagnosis (base64 data URLs from the client)
  const images = Array.isArray(body.images)
    ? (body.images as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  const backtestSummary = body.backtestSummary ?? null;
  const diagnosticContext = body.diagnosticContext ?? null;
  const testerLog = typeof body.testerLog === "string" ? body.testerLog : null;
  const rawLog = typeof body.compileLog === "string" ? body.compileLog : null;
  const compileLog = rawLog ? trimCompileLog(rawLog) : null;

  if (!messages?.length) {
    return Response.json({ error: "messages required" }, { status: 400, headers: CORS });
  }

  // Inject full context into the first user message only
  const contextBlock = [
    platformContext(blueprint),
    "",
    "=== ORIGINAL STRATEGY PROMPT ===",
    prompt || "(no original prompt supplied)",
    "",
    "=== STRATEGY BLUEPRINT ===",
    JSON.stringify(blueprint, null, 2),
    "",
    "=== BLUEPRINT AUDIT / AI WIRING DIAGNOSTICS ===",
    JSON.stringify(
      {
        blueprintAudit: asRecord(blueprint).blueprintAudit ?? null,
        intentContract: asRecord(blueprint).intentContract ?? null,
        aiWiringDiagnostics: asRecord(blueprint).aiWiringDiagnostics ?? null,
        indicatorRefs: asRecord(blueprint).indicatorRefs ?? null,
        filterRefs: asRecord(blueprint).filterRefs ?? null,
      },
      null,
      2,
    ),
    "",
    "=== GENERATED MQL5 CODE ===",
    code || "(no code generated yet)",
    compileLog ? `\n=== LAST COMPILE ERRORS ===\n${compileLog}` : "",
    testerLog ? `\n=== LAST TESTER / BACKTEST LOG ===\n${testerLog}` : "",
    backtestSummary
      ? `\n=== LAST BACKTEST SUMMARY ===\n${JSON.stringify(backtestSummary, null, 2)}`
      : "",
    diagnosticContext
      ? `\n=== PLATFORM / RUNNER DIAGNOSTIC CONTEXT ===\n${JSON.stringify(diagnosticContext, null, 2)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Convert a base64 data URL into an Anthropic image content block.
  const toImageBlock = (dataUrl: string) => {
    const m = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(
      dataUrl.trim(),
    );
    if (!m) return null;
    const media_type = m[1] === "image/jpg" ? "image/jpeg" : m[1];
    return { type: "image" as const, source: { type: "base64" as const, media_type, data: m[2] } };
  };
  const imageBlocks = images.map(toImageBlock).filter(Boolean) as Array<{
    type: "image";
    source: { type: "base64"; media_type: string; data: string };
  }>;
  const imageStatus =
    images.length === 0
      ? "none"
      : imageBlocks.length > 0
        ? "attached_and_parsed"
        : "attached_but_unparsed";

  const lastIdx = messages.length - 1;
  const enrichedMessages = messages.map((m, i) => {
    let text = i === 0 ? `${contextBlock}\n\n=== USER MESSAGE ===\n${m.content}` : m.content;
    if (i === lastIdx && m.role === "user") {
      text = `IMAGE STATUS: ${imageStatus} (${images.length} received, ${imageBlocks.length} parsed)\n${text}`;
    }
    // Attach any screenshots to the most recent user message as image blocks.
    if (i === lastIdx && m.role === "user" && imageBlocks.length > 0) {
      text = `[${imageBlocks.length} screenshot(s) attached above — analyse them]\n${text}`;
      return { role: m.role, content: [...imageBlocks, { type: "text" as const, text }] };
    }
    return { role: m.role, content: text };
  });

  // Visible in the Netlify function log — confirms whether images arrived + parsed.
  console.log(`[ea-chat] images received=${images.length} parsed=${imageBlocks.length}`);

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
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            fullText += event.delta.text;
            send({ text: event.delta.text });
          }
        }

        // Signal whether the AI described a fix (client shows the Apply Fix button)
        const fixReady = fullText.includes("[FIX_READY]");
        send({ done: true, fixReady });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Stream error";
        send({
          error: /modelId\.replace is not a function/i.test(message)
            ? "AI provider/model configuration failed before the assistant could respond. This is a platform AI routing issue, not your strategy rules. Try again once; if it repeats, download the Evidence Pack and check the AI function logs."
            : message,
        });
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
