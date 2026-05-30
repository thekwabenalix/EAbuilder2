/**
 * gen-4brain-ai — AI-powered 4-Brain EA generator
 *
 * Claude interprets the user's brain config + description using the full
 * module library as context, then generates the wiring MQL5 code that:
 *   - calls the correct state machine Tick() function each brain
 *   - reads the right query functions for each role
 *   - sets gBias / gSetupActive / gExecSignal / gExecSL correctly
 *
 * The caller (gen-ea.ts) then embeds the required state machine code
 * alongside the wiring to produce a self-contained EA.
 */

import Anthropic from "@anthropic-ai/sdk";
import { buildModuleLibraryContext } from "../../src/lib/module-library.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystem(): string {
  return `You are an expert MQL5 EA architect for a 4-Brain trading system.

You generate the WIRING CODE that connects inline state machines to the 4-Brain confluence gate.
You do NOT generate the state machine code itself — that is injected separately.
You do NOT generate OnInit, OnTick, trade execution, risk management, or inputs.

${buildModuleLibraryContext()}

=== 4-BRAIN GLOBAL VARIABLES (already declared — do not redeclare) ===
  int    gBias        = 0;      // 1=BULL, -1=BEAR, 0=NEUTRAL
  bool   gSetupActive = false;  // true when zone/setup is active in bias direction
  int    gSetupDir    = 0;      // direction of active setup
  double gSetupSLHint = 0.0;    // SL hint from zone far edge
  bool   gExecSignal  = false;  // true when entry pattern fires
  int    gExecDir     = 0;      // 1=BUY, -1=SELL
  double gExecSL      = 0.0;    // SL price for execution brain signal
  string InpSymbol;             // trading symbol input

=== YOUR OUTPUT ===
Return a JSON object with this exact structure:
{
  "direction_brain": "<MQL5 code for void Direction_Brain_Execute()>",
  "setup_brain":     "<MQL5 code for void Setup_Brain_Execute()>",
  "execution_brain": "<MQL5 code for void Execution_Brain_Execute()>",
  "required_sms":    ["list", "of", "state_machine_ids_needed"],
  "sm_configs":      {
    "<sm_id>": { "id": "<label>", "TF": "<PERIOD_XX>", "tf": "<label>", "params": {} }
  },
  "notes": "<brief explanation of your design decisions>"
}

REQUIRED_SMS format:
  "fvg"           → genFvgSM    → FVGSM_{id}_* functions
  "fvg_inversion" → genFvgInversionSM → IFVGSM_{id}_* functions
  "ob"            → genObSM     → OBSM_{id}_* functions
  "bos"           → genBosSM (mode="bos") → BOSSM_{id}_* functions
  "choch"         → genBosSM (mode="choch") → BOSSM_{id}_* functions
  "bos_choch"     → genBosSM (mode="both") → BOSSM_{id}_* functions
  "liqsweep"      → genLiqSweepSM → LSSM_{id}_* functions

sm_configs maps each required SM to its configuration so the assembler
can call the right generator. Example:
  "sm_configs": {
    "bos_D1": { "type": "bos", "id": "D1", "TF": "PERIOD_D1", "tf": "D1", "params": {} },
    "fvg_H4": { "type": "fvg", "id": "H4", "TF": "PERIOD_H4", "tf": "H4", "params": { "expiryBars": 50 } }
  }

RULES FOR GENERATED BRAIN FUNCTIONS:
1. Direction_Brain_Execute(): must end by setting gBias to 1, -1, or 0
2. Setup_Brain_Execute(): must reset gSetupActive=false at start, then re-detect
3. Execution_Brain_Execute(): must reset gExecSignal=false at start, then check entry conditions
4. Each function calls Tick() for the SMs it reads, then calls query functions
5. Use the EXACT function names from the module library (FVGSM_H4_BullJustConfirmed() etc.)
6. Include PrintFormat() logging for every state change
7. Align direction/setup with bias — only activate setup if direction agrees
8. Execution only fires when gBias matches gExecDir

Return ONLY the JSON object. No prose. No markdown fences.`;
}

// ─── Request / response types ─────────────────────────────────────────────────

interface BrainConfig {
  modules: string[];
  timeframe: string;
  description?: string;
  params?: Record<string, unknown>;
}

interface FourBrainConfig {
  direction?: BrainConfig;
  setup?:     BrainConfig;
  execution:  BrainConfig;
  management?: {
    riskPercent?: number;
    rewardRisk?: number;
    stopBuffer?: number;
  };
}

interface GenRequest {
  config: FourBrainConfig;
  eaName: string;
  /** Optional free-form description of the overall strategy */
  description?: string;
}

export default async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS });

  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500, headers: CORS });

  let body: GenRequest;
  try { body = await req.json(); }
  catch { return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS }); }

  const { config, eaName, description } = body;
  if (!config?.execution)
    return Response.json({ error: "execution brain config is required" }, { status: 400, headers: CORS });

  // Build the user message describing what to generate
  const dirDesc  = config.direction
    ? `DIRECTION BRAIN — modules: [${config.direction.modules.join(", ")}] @ ${config.direction.timeframe}${config.direction.description ? `\nTrader notes: "${config.direction.description}"` : ""}`
    : "DIRECTION BRAIN — disabled (no bias filter)";

  const setupDesc = config.setup
    ? `SETUP BRAIN — modules: [${config.setup.modules.join(", ")}] @ ${config.setup.timeframe}${config.setup.description ? `\nTrader notes: "${config.setup.description}"` : ""}`
    : "SETUP BRAIN — disabled (no zone filter)";

  const execDesc = `EXECUTION BRAIN — modules: [${config.execution.modules.join(", ")}] @ ${config.execution.timeframe}${config.execution.description ? `\nTrader notes: "${config.execution.description}"` : ""}`;

  const userMessage = `Generate the 4-Brain wiring code for this EA: "${eaName}"
${description ? `\nOverall strategy intent: ${description}\n` : ""}
${dirDesc}

${setupDesc}

${execDesc}

Generate the three brain functions that correctly wire together the appropriate
inline state machines from the module library. Think about which modules best
match the trader's intent, then generate clean, correct MQL5 wiring code.`;

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 4096,
      system: [
        {
          type: "text",
          text: buildSystem(),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        { role: "user",      content: userMessage },
        { role: "assistant", content: "{" },   // prefill to force JSON
      ],
    });

    const block = response.content[0];
    if (block.type !== "text")
      throw new Error("Unexpected Claude response type");

    const raw = "{" + block.text;

    // Clean and parse
    let text = raw.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
    if (text.startsWith("```")) text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Try to extract JSON if Claude leaked prose
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Claude did not return valid JSON");
      parsed = JSON.parse(match[0]);
    }

    return Response.json(parsed, { headers: { ...CORS, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("gen-4brain-ai error:", err);
    const msg = err instanceof Error ? err.message : "Internal server error";
    return Response.json({ error: msg }, { status: 500, headers: CORS });
  }
};

export const config = {
  path: "/api/gen-4brain-ai",
  timeout: 60,
};
