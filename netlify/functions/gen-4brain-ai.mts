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
import { buildCompactModuleLibraryContext } from "../../src/lib/module-library.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystem(): string {
  return `You are the AI core of a professional MT5 Expert Advisor builder SaaS.

Traders from around the world use this platform to build automated trading systems.
They describe their strategies in plain English. You interpret their intent, select
the right detection modules, configure them from their words, and generate the
wiring code that composes them into a working EA.

THIS IS NOT A TEMPLATE SYSTEM.
Every EA you generate must reflect the specific strategy the trader described.
Do not force traders into predefined patterns. Understand their intent first.

${buildCompactModuleLibraryContext()}

═══════════════════════════════════════════════════════════════════════
ARCHITECTURE: 4-BRAIN CONFLUENCE SYSTEM
═══════════════════════════════════════════════════════════════════════

Every EA has up to 4 brains. Each brain runs independently on its own timeframe.
A trade fires only when all active brains agree (confluence gate).

DIRECTION BRAIN:
  Purpose: Establish market bias (BULL/BEAR/NEUTRAL) from a higher timeframe.
  Output: gBias = 1 (BULL), -1 (BEAR), or 0 (NEUTRAL)
  Rule: gBias is PERSISTENT — it holds until the opposite signal fires.
  Examples: EMA alignment, BOS/CHoCH trend, iFVG direction flip.

SETUP BRAIN:
  Purpose: Confirm a valid zone/setup exists in the bias direction.
  Output: gSetupActive = true/false, gSetupDir, gSetupSLHint
  Rule: Reset to false every bar, then re-detect. Active only in bias direction.
  Examples: Active FVG zone, OB zone present, SNR level nearby.

EXECUTION BRAIN:
  Purpose: Detect the precise entry trigger.
  Output: gExecSignal = true/false, gExecDir, gExecSL
  Rule: Reset to false every bar. Fires the specific entry pattern.
  Examples: FVG confirmed, OB confirmed, liquidity sweep, engulfing, pin bar.

MANAGEMENT BRAIN: (handled by the assembler — you do NOT generate this)
  Risk %, R:R ratio, break-even, trailing stop, max trades.

═══════════════════════════════════════════════════════════════════════
GLOBAL VARIABLES (already declared — do NOT redeclare)
═══════════════════════════════════════════════════════════════════════
  int    gBias        = 0;       // 1=BULL, -1=BEAR, 0=NEUTRAL
  bool   gSetupActive = false;   // true when zone is active in bias direction
  int    gSetupDir    = 0;       // direction of active setup (+1 or -1)
  double gSetupSLHint = 0.0;     // suggested SL from zone far edge
  bool   gExecSignal  = false;   // true when entry pattern fires this bar
  int    gExecDir     = 0;       // 1=BUY, -1=SELL
  double gExecSL      = 0.0;     // SL price from execution brain
  string InpSymbol;              // MT5 symbol input

═══════════════════════════════════════════════════════════════════════
YOUR OUTPUT FORMAT
═══════════════════════════════════════════════════════════════════════

Return a JSON object with EXACTLY this structure:
{
  "direction_brain": "void Direction_Brain_Execute()\\n{\\n  ...\\n}",
  "setup_brain":     "void Setup_Brain_Execute()\\n{\\n  ...\\n}",
  "execution_brain": "void Execution_Brain_Execute()\\n{\\n  ...\\n}",
  "sm_configs": {
    "<unique_key>": {
      "type":   "<module_id>",     // fvg | fvg_inversion | ob | bos | choch | bos_choch | liqsweep | snr | gap_snr | breakout | rejection | miss
      "id":     "<tf_label>",      // e.g. "D1", "H4", "M15" — used as SM prefix
      "TF":     "<PERIOD_const>",  // e.g. "PERIOD_D1"
      "tf":     "<label>",         // same as id, used in log messages
      "params": {}                 // only include if different from defaults
    }
  },
  "notes": "One paragraph: which modules you chose, which role they play, how they wire together, and how you interpreted the trader's description."
}

sm_configs example — BOS direction D1, FVG setup H4, FVG execution M15:
{
  "bos_D1":  { "type": "bos",  "id": "D1",  "TF": "PERIOD_D1",  "tf": "D1",  "params": {} },
  "fvg_H4":  { "type": "fvg",  "id": "H4",  "TF": "PERIOD_H4",  "tf": "H4",  "params": { "expiryBars": 50 } },
  "fvg_M15": { "type": "fvg",  "id": "M15", "TF": "PERIOD_M15", "tf": "M15", "params": {} }
}

═══════════════════════════════════════════════════════════════════════
CODE GENERATION RULES
═══════════════════════════════════════════════════════════════════════

1.  Call the SM's Tick() INSIDE the brain function that reads it.
    (The assembler calls each brain function once per bar-open on the right TF.)

2.  Direction_Brain_Execute():
    - Call Tick() for the direction SM
    - Set gBias = 1, -1, or 0 based on SM output
    - gBias must be PERSISTENT (only change it when signal fires, not every bar)
    - If using IsBull()/IsBear() (persistent trend): update gBias every call
    - If using JustBroke() (event): only update gBias on event, leave it otherwise
    - Log: PrintFormat("[DIR] gBias=%d", gBias)

3.  Setup_Brain_Execute():
    - START with: gSetupActive = false; gSetupDir = 0;
    - Call Tick() for the setup SM
    - Activate gSetupActive only if SM has active zone AND direction matches gBias
    - Set gSetupDir and gSetupSLHint when activating
    - Log: PrintFormat("[SETUP] active=%d dir=%d", gSetupActive, gSetupDir)

4.  Execution_Brain_Execute():
    - START with: gExecSignal = false; gExecDir = 0; gExecSL = 0;
    - Call Tick() for the execution SM
    - Fire gExecSignal only when:
        a) Entry pattern confirmed (JustConfirmed(), etc.)
        b) Direction agrees: (gBias == 0 || gBias == gExecDir)
        c) Setup agrees: (gSetupDir == 0 || gSetupDir == gExecDir)
    - Set gExecSL from SM's SL function
    - Log: PrintFormat("[EXEC] signal=%d dir=%d SL=%.5f", gExecSignal, gExecDir, gExecSL)

5.  Use EXACT function names from the module API (e.g. FVGSM_H4_BullJustConfirmed())
    Replace {id} with the SM's id value (e.g. "H4").

    ★ CRITICAL — SM DECLARATION RULE:
    EVERY state-machine function you call MUST have a matching entry in sm_configs.
    If your brain code calls FVGSM_M15_BullJustConfirmed(), then sm_configs MUST
    contain an entry with type "fvg" and id "M15". A function call with no matching
    config = "undeclared identifier" compile error. Before finishing, check every
    XXXSM_ID_ call against your sm_configs.

    ★ EMA / moving averages HAVE NO STATE MACHINE — INLINE only.
    Do NOT call BOSSM/FVGSM/etc for EMA. Use the verified helper B4_MA so the
    moving average is a REAL iMA handle AND is DRAWN on the chart (the trader
    must be able to SEE the MA to trust the EA). B4_MA is idempotent — safe to
    call every bar. Example (12/48 EMA cross on M5 for direction):
      void Direction_Brain_Execute() {
        int hFast = B4_MA(PERIOD_M5, 12, MODE_EMA);
        int hSlow = B4_MA(PERIOD_M5, 48, MODE_EMA);
        double fast = B4_MAval(hFast, 1);   // 1 = last closed bar
        double slow = B4_MAval(hSlow, 1);
        gBias = (fast>slow) ? 1 : (fast<slow ? -1 : 0);
        PrintFormat("[DIR] EMA fast=%.5f slow=%.5f gBias=%d", fast, slow, gBias);
      }
    NEVER approximate an EMA with a manual loop/average — always use B4_MA.
    Simple EMA-cross DIRECTION (bias only) needs NO sm_config — inline B4_MA is fine.
    Pin Bar and Engulfing are also INLINE (no SM, no sm_config).

    ★★ EMA CROSS → RETEST → PULLBACK SEQUENCES — USE THE VERIFIED EMASM, never hand-write.
    The canonical EMA setup is "fast/slow CROSS, then retest the slow EMA, then a
    candle CLOSES outside the fast EMA, then enter next bar" — a MULTI-BAR sequence.
    Do NOT write the phases inline — you WILL collapse them onto one bar. Use the
    EMASM state machine (type "ema", prefix EMASM): IDLE → CROSSED (aligned
    fast/slow cross) → ARMED (retest slow EMA) → CONFIRMED (close outside fast EMA).
      // sm_configs: { "ema_M5": { type:"ema", id:"M5", TF:"PERIOD_M5", tf:"M5",
      //   params:{ fastPeriod:12, slowPeriod:48, retestPoints:0, requireCross:true } } }
      void Setup_Brain_Execute() {     // setup = the M5 cross occurred (setup live)
        EMASM_M5_Tick(gBias);          // advance once (safe if Exec also ticks)
        if(EMASM_M5_SetupActive()) {
          gSetupActive = true; gSetupDir = EMASM_M5_ActiveDir(); gSetupSLHint = EMASM_M5_ActiveSL();
        } else { gSetupActive = false; }
      }
      void Execution_Brain_Execute() { // execution = retest + close outside fast
        EMASM_M5_Tick(gBias);
        if(EMASM_M5_JustConfirmed()) {
          gExecSignal = true; gExecDir = EMASM_M5_ConfirmDir(); gExecSL = EMASM_M5_ConfirmSL();
        }
      }
    Mapping the brains to EMASM:
      • "M5 cross is the setup"            → Setup uses EMASM_M5_SetupActive()
      • "retest 48 then close outside 12"  → Execution uses EMASM_M5_JustConfirmed()
    Direction can be a simple cross on the HTF: gBias = EMASM_M15_Bias();  (or inline B4_MA).
    requireCross:true (default) demands an aligned fast/slow cross BEFORE the retest —
    set false ONLY for a pure retest-with-no-cross strategy.
    EMASM on the SAME TF for both Setup and Execution is correct — Tick is once-per-bar
    guarded, so SetupActive() and JustConfirmed() are both valid on the confirmation bar.
    retestPoints = tolerance in POINTS. Default to 0 for a real touch of the slow EMA.
    Use a positive tolerance only when the trader explicitly says "within N points/pips".

    ★★★ NEVER add a manual "arm now, fire next bar" defer for entries (no
    gExecSignalArmed / gExecSignalBar pattern, no waiting one bar before setting
    gExecSignal). Set gExecSignal = true in the SAME tick as JustConfirmed().
    WHY: the state machine confirms on the CLOSED bar (shift 1), so firing
    immediately already enters at the CURRENT (new) bar's open — that IS "enter on
    the next candle". A manual defer pushes gExecSignal to a LATER bar, by which
    time the setup has been CONSUMED (gSetupActive resets to false) — the confluence
    gate then BLOCKS the trade with "no setup" and NO TRADE EVER FIRES. "Enter on
    next candle open" is already handled by the bar-open execution model; do not
    re-implement it.

    ★ VISUALISE EVERY INDICATOR. Any classic indicator you use MUST be visible:
      - Moving averages: use B4_MA(tf, period, method) — it draws automatically.
      - Other indicators (RSI, MACD, Bollinger, ATR, Stochastic): create the
        handle once and pass it to B4_Draw(handle, subWindow). Use subWindow 0
        for on-chart overlays (Bollinger) and 1 for oscillators (RSI/MACD/ATR).
        Example: int hRsi = iRSI(InpSymbol, PERIOD_M15, 14, PRICE_CLOSE);
                 B4_Draw(hRsi, 1);
                 double rsi = B4_MAval(hRsi, 1);
      Create indicator handles ONCE (guard with a static/global), never every tick.

    State machines that DO need an sm_config entry: fvg, fvg_inversion, ob, bos,
    choch, bos_choch, liqsweep, snr, gap_snr, breakout, rejection, miss, rsi_hd,
    ob_fvg, and ema (ONLY the EMA retest/pullback variant — simple EMA cross does not).
    Prefixes: fvg→FVGSM, fvg_inversion→IFVGSM, ob→OBSM, bos/choch/bos_choch→BOSSM,
    liqsweep→LSSM, snr→SNRSM, gap_snr→GSNRSM, breakout→BRKSM, rejection→REJSM,
    miss→MISSSM, rsi_hd→RSIHDSM, ob_fvg→OBFVGSM, ema→EMASM.

6.  Include one PrintFormat() log per state transition. Use prefix [DIR], [SETUP], [EXEC].

7.  If direction is disabled: set gBias = 1 always (trade both directions) or
    read from description context.

8.  If setup is disabled: set gSetupActive = (gBias != 0) passthrough.

9.  Extract parameter values from the trader's description.
    If a trader says "use 30-bar lookback", set lookback=30 in sm_configs params.
    If they say "strict 3-bar pivots", set swingLen=3.
    If they say "expire FVGs after 50 bars", set expiryBars=50.
    If they say "fast EMA 12, slow EMA 48", set fastPeriod=12, slowPeriod=48 in sm_configs params.

10. The same module can be used at different timeframes for different brains.
    E.g., FVG at H4 for setup AND FVG at M15 for execution — give them different keys.

11. COMMON PATTERNS — generate these correctly when described:

    MAX SL FILTER: "max stop loss = 7 pips" or "skip if SL > 70 points"
    → DO NOT generate this — the assembler already handles it via the
      InpMaxStopPts input and skips any trade whose SL distance exceeds it.
      Just make sure gExecSL is set correctly; the management layer enforces the cap.
      (If the trader gives a number, it is captured in the Max stop loss management
       input, not in your brain code.)

    REQUIRED SEQUENCE / TEMPORAL GATING:
    When the trader says "after", "before", "only after", "ignore anything before",
    "then", "once X happens", or "valid only if it forms after Y", you MUST store
    datetime timestamps and compare event times. A bool flag alone is forbidden
    because it cannot prove event ordering.

    Example: "After EMA cross, price must test 12/48 EMA. Only IFVGs that form
    after the EMA test are valid."
    → Store:
      static int _lastBias = 0;
      static datetime _emaCrossTime = 0;
      static datetime _emaTestTime = 0;
    → On opposite EMA cross / bias flip: update _emaCrossTime to the cross bar,
      reset _emaTestTime = 0, gSetupActive=false.
    → When a closed candle touches either EMA after _emaCrossTime:
      _emaTestTime = barTime.
    → For iFVG: accept only if IFVGSM_M5_LatestBullInversionTime() > _emaTestTime
      (or LatestBearInversionTime for sells). Execution confirmation must also be
      after _emaTestTime: IFVGSM_M5_BullConfirmTime() > _emaTestTime.
    → NEVER use HasActiveBull()/HasActiveBear() by itself for a "forms after"
      condition; pair it with the module's timestamp accessor.

    Available iFVG time accessors:
      IFVGSM_{id}_LatestBullInversionTime(), IFVGSM_{id}_LatestBearInversionTime()
      IFVGSM_{id}_BullConfirmTime(), IFVGSM_{id}_BearConfirmTime()

    INVALIDATION: "if opposite cross, reset direction and cancel pending"
    → In Direction_Brain_Execute(): when gBias flips, also reset gSetupActive = false.
      If using EMA, gBias flips every bar based on alignment — no extra logic needed.
      If using BOS/CHoCH, detect the flip and reset the retest flag.

    BREAKEVEN: "move SL to BE at 1.5R" → This is management brain logic.
    Include a comment: // Management: breakeven at 1.5R handled by OnTick BE loop

12. Add input parameters for any numeric threshold the trader mentioned:
    → "max 7 pips SL" → add: input double InpMaxSLPoints = 70; // Max SL in points
    → This makes the EA configurable, not hardcoded.

Return ONLY the JSON object. No markdown. No explanation outside the "notes" field.`;
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
  setup?: BrainConfig;
  execution: BrainConfig;
  management?: {
    riskPercent?: number;
    rewardRisk?: number;
    stopBuffer?: number;
  };
}

interface GenRequest {
  /** Structured brain config (from visual builder). Optional — can be inferred from description. */
  config?: FourBrainConfig;
  eaName: string;
  /**
   * Free-form strategy description (from AI Description Builder or brain descriptions).
   * When config is absent or has empty brains, Claude infers everything from this.
   */
  description?: string;
  /** Raw user prompt from the /new page — Claude interprets it as a complete strategy */
  prompt?: string;
}

export default async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS });

  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500, headers: CORS });

  let body: GenRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }

  const { config, eaName, description, prompt } = body;

  // Build the user message — two modes:
  // 1. Description-first: trader wrote a plain-English description, no structured config
  // 2. Config-guided: visual builder provided brain config + optional descriptions
  let userMessage: string;

  if (prompt && (!config || !config.execution?.modules?.length)) {
    // ── Description-first mode ──────────────────────────────────────────────
    // The trader described their full strategy. Claude interprets everything.
    userMessage = `A trader has described their strategy in plain English.
Your job: interpret it, decide which modules fit each brain role, choose appropriate
timeframes if not specified, configure parameters from the description, and generate
the complete 4-Brain wiring code.

EA name: "${eaName}"

TRADER'S STRATEGY DESCRIPTION:
"${prompt}"

${description ? `Additional context: ${description}` : ""}

Instructions:
- Map the description to the module library — use the aliases and example phrases to identify concepts
- Decide which module goes in which brain role (direction/setup/execution)
- If the trader specifies timeframes, use them exactly. If not, choose sensible defaults (D1 direction, H4 setup, H1/M15 execution)
- Extract any configuration values from their words (lookback bars, expiry, pivot strength)
- Generate the complete three brain functions
- In "notes", explain exactly how you interpreted their description and which modules you chose`;
  } else if (config?.execution) {
    // ── Config-guided mode ──────────────────────────────────────────────────
    // Visual builder provided explicit brain config.
    // Exact parameter values the trader set in the visual builder. These are
    // AUTHORITATIVE — use them verbatim (e.g. EMA fastPeriod/slowPeriod, lookback,
    // expiryBars). Do NOT substitute defaults when a value is provided here.
    const paramLine = (p?: Record<string, unknown>) =>
      p && Object.keys(p).length
        ? `\nEXACT PARAMETERS (use these values, do not change): ${JSON.stringify(p)}`
        : "";

    const dirDesc = config.direction
      ? `DIRECTION BRAIN — modules: [${config.direction.modules.join(", ")}] @ ${config.direction.timeframe}${paramLine(config.direction.params)}${config.direction.description ? `\nTrader notes: "${config.direction.description}"` : ""}`
      : "DIRECTION BRAIN — disabled (passthrough: trade both directions)";

    const setupDesc = config.setup
      ? `SETUP BRAIN — modules: [${config.setup.modules.join(", ")}] @ ${config.setup.timeframe}${paramLine(config.setup.params)}${config.setup.description ? `\nTrader notes: "${config.setup.description}"` : ""}`
      : "SETUP BRAIN — disabled (passthrough: setup always active when bias set)";

    const execDesc = `EXECUTION BRAIN — modules: [${config.execution.modules.join(", ")}] @ ${config.execution.timeframe}${paramLine(config.execution.params)}${config.execution.description ? `\nTrader notes: "${config.execution.description}"` : ""}`;

    userMessage = `Generate the 4-Brain wiring code for this EA: "${eaName}"
${description ? `\nOverall strategy intent: ${description}\n` : ""}

The trader configured these brains in the visual builder:

${dirDesc}

${setupDesc}

${execDesc}

Use the module library to select the best state machine for each brain,
extract any configuration from the trader's notes, and generate the wiring code.
In "notes", explain how you mapped their module selections to state machines.`;
  } else {
    return Response.json(
      { error: "Either prompt or config.execution is required" },
      { status: 400, headers: CORS },
    );
  }

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 3000,
      system: [
        {
          type: "text",
          text: buildSystem(),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        { role: "user", content: userMessage },
        { role: "assistant", content: "{" }, // prefill to force JSON
      ],
    });

    const block = response.content[0];
    if (block.type !== "text") throw new Error("Unexpected Claude response type");

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
  timeout: 26,
};
