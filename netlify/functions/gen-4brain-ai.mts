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
import { jsonrepair } from "jsonrepair";
import { buildCompactModuleLibraryContext } from "../../src/lib/module-library.js";
import {
  buildCompactModuleContractContext,
  getModuleContract,
  moduleContractAllowsSmFunction,
  moduleSupportsEvent,
  type BrainRole,
} from "../../src/lib/module-contracts.js";
import { buildModuleRepairPlan, getModuleAdmission } from "../../src/lib/module-admission.js";
import {
  type BuiltinFilterRef,
  buildCompactBuiltinFilterContractContext,
  collectBuiltinFilterRefs,
  getBuiltinFilterContract,
} from "../../src/lib/builtin-filter-contracts.js";
import {
  normalizeAiStrategyFlowInResponse,
  usesStrategyFlowOutput,
  validateAiStrategyFlowWiring,
} from "../../src/lib/ai-strategy-flow.js";
import {
  buildEmaCrossTestCloseWiring as buildBlessedEmaCtcWiring,
  buildEmaIfvgSemantics,
  buildEmaTestThenIfvgFormationWiring as buildBlessedEmaIfvgWiring,
  extractEmaPeriods,
  extractEmaRetestTarget,
  extractSingleTimeframe,
  isEmaCrossTestClose,
  isEmaTestThenIfvgFormation,
} from "../../src/lib/blessed-ema-adapters.js";

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

${buildCompactModuleContractContext()}

${buildCompactBuiltinFilterContractContext()}

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

Return a JSON object. PREFERRED output_mode is "strategy_flow" — structured steps
the compiler maps to the ordered event gate. Use "brain_bodies" ONLY when the
strategy cannot be expressed as verified module steps (e.g. custom EMA+IFVG timing).

PRIMARY — strategy_flow mode (preferred):
{
  "output_mode": "strategy_flow",
  "strategy_flow": {
    "version": 1,
    "steps": [
      {
        "id": "step_direction",
        "name": "H1 BOS bias",
        "role": "direction",
        "module": "bos",
        "timeframe": "H1",
        "event": "BOS_BIAS",
        "params": { "lookback": 20, "swingLen": 5 },
        "directionSource": { "mode": "own_event" }
      },
      {
        "id": "step_setup",
        "name": "H1 FVG zone",
        "role": "setup",
        "module": "fvg",
        "timeframe": "H1",
        "event": "FVG_CREATED",
        "params": { "expiryBars": 100 },
        "dependsOn": [{ "stepId": "step_direction", "relation": "after", "required": true }]
      },
      {
        "id": "step_entry",
        "name": "M5 BOS entry",
        "role": "entry",
        "module": "bos",
        "timeframe": "M5",
        "event": "BOS_CONFIRMED",
        "params": { "lookback": 20 },
        "dependsOn": [{ "stepId": "step_setup", "relation": "after", "required": true }],
        "directionSource": { "mode": "from_step", "stepId": "step_direction" }
      }
    ],
    "notes": "Brief explanation of step order and module choices."
  },
  "direction_brain": "",
  "setup_brain": "",
  "execution_brain": "",
  "semantics": { ... },
  "sm_configs": {},
  "required_sms": [],
  "notes": "One paragraph: which modules you chose, which role they play, how steps chain together, and how you interpreted the trader's description."
}

Step roles: direction | setup | entry (alias: execution — treated as entry).
Use ONLY verified module ids and contract-backed event names from the module library.
dependsOn enforces chronological order between steps.
Leave sm_configs and required_sms empty in strategy_flow mode — the compiler embeds
state machines from steps automatically.

LEGACY FALLBACK — brain_bodies mode (only when steps cannot express the strategy):
{
  "output_mode": "brain_bodies",
  "direction_brain": "void Direction_Brain_Execute()\\n{\\n  ...\\n}",
  "setup_brain":     "void Setup_Brain_Execute()\\n{\\n  ...\\n}",
  "execution_brain": "void Execution_Brain_Execute()\\n{\\n  ...\\n}",
  "semantics": {
    "version": 1,
    "source": "ai",
    "timeframe": "M5",
    "modules": ["ema", "fvg_inversion"],
    "direction": {
      "module": "ema",
      "event": "cross",
      "fastPeriod": 12,
      "slowPeriod": 48,
      "resetPolicy": "opposite_cross"
    },
    "setup": {
      "gate": "ema_retest",
      "target": "slow",
      "targetLabel": "slow EMA (48)",
      "mustOccurAfter": "direction_event"
    },
    "execution": {
      "module": "fvg_inversion",
      "entryEvent": "formation",
      "mustOccurAfter": "setup_gate"
    },
    "filters": [
      {
        "id": "rsi_level_filter",
        "role": "execution",
        "indicator": "rsi",
        "timeframe": "M5",
        "params": { "period": 14, "level": 50, "operator": "directional" }
      }
    ],
    "assumptions": []
  },
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

The "semantics" object is the contract the wiring must obey. It is not prose.
Fill it with the concrete rules you extracted before writing MQL wiring. If a
trader says "only 48 EMA", semantics.setup.target MUST be "slow"; do not widen
it to "either". If they say IFVG "forms", "becomes", or is "confirmed" by closing
through the old FVG boundary, semantics.execution.entryEvent MUST be "formation".
Use "retest" only when the trader explicitly asks to enter on a later IFVG retest.

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
      - Other built-ins (RSI, MACD, Bollinger, ATR, Stochastic, Ichimoku, Fractals)
        are referenceable primitives, not 4-Brain modules by themselves.
      - Do NOT put built-in indicator IDs such as rsi/macd/atr/stochastic into
        semantics.modules or sm_configs unless there is a verified module contract.
      - If a verified contract explicitly admits a built-in primitive, use the
        assembler helpers instead of raw indicator code: B4_Buf, B4_RSI, B4_ATR,
        B4_MACD, B4_Bands, B4_Stochastic, B4_ADX, B4_Ichimoku, B4_SAR,
        and B4_Fractals.
      - Built-in filters are not entry modules. For rsi_level_filter, list it in
        semantics.filters and gate the exact brain the trader described:
        role="setup" when it qualifies/validates a setup, role="execution" when
        it filters the entry trigger or trade signal. Examples below show
        execution; setup filters must use gSetupActive/gSetupDir instead.
        int hRsi = B4_RSI(PERIOD_M5, 14);
        double rsi = B4_Buf(hRsi, 0, 1);
        if(gExecSignal && gExecDir == 1 && rsi <= 50.0) gExecSignal = false;
        if(gExecSignal && gExecDir == -1 && rsi >= 50.0) gExecSignal = false;
      - For atr_volatility_filter, list it in semantics.filters and convert ATR
        to points before gating:
        int hAtr = B4_ATR(PERIOD_M5, 14);
        double atrPts = B4_Buf(hAtr, 0, 1) / SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
        if(gExecSignal && atrPts < 100.0) gExecSignal = false;
      - For macd_histogram_filter, list it in semantics.filters and gate an
        existing signal with MACD momentum:
        int hMacd = B4_MACD(PERIOD_M5, 12, 26, 9);
        double macdMain = B4_Buf(hMacd, 0, 1);
        double macdSignal = B4_Buf(hMacd, 1, 1);
        double macdHist = macdMain - macdSignal;
        if(gExecSignal && gExecDir == 1 && macdHist <= 0.0) gExecSignal = false;
        if(gExecSignal && gExecDir == -1 && macdHist >= 0.0) gExecSignal = false;
      - For RSI Hidden Divergence, use the verified rsi_hd state machine module.
      - For any other built-in-only idea, state the limitation in notes instead
        of inventing raw indicator MQL5.

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
    -> Extract the EMA retest target from the trader's words:
      - "only 48 EMA" / "48 EMA only" / "slow EMA only" => slow EMA only
      - "only 12 EMA" / "12 EMA only" / "fast EMA only" => fast EMA only
      - "either 12 or 48 EMA" / "any EMA" / "both EMAs" => either EMA
      Never widen a specific "only" target into "either EMA".
    → When a closed candle touches either EMA after _emaCrossTime:
      _emaTestTime = barTime.
      If the extracted target is fast-only or slow-only, the touch condition must use
      only that EMA; use an either-EMA OR condition only when the trader asked for either.
    → For iFVG: accept only if IFVGSM_M5_LatestBullInversionTime() > _emaTestTime
      (or LatestBearInversionTime for sells). Execution confirmation must also be
      after _emaTestTime: IFVGSM_M5_BullConfirmTime() > _emaTestTime.
    → NEVER use HasActiveBull()/HasActiveBear() by itself for a "forms after"
      condition; pair it with the module's timestamp accessor.

    Available iFVG time accessors:
      IFVGSM_{id}_LatestBullInversionTime(), IFVGSM_{id}_LatestBearInversionTime()
      IFVGSM_{id}_BullInversionTime(), IFVGSM_{id}_BearInversionTime()
      IFVGSM_{id}_BullConfirmTime(), IFVGSM_{id}_BearConfirmTime()
    Always call IFVGSM_{id}_Tick(1). The argument is the just-closed bar shift,
    not lookback. The IFVG state machine is guarded, so Setup and Execution can
    both call Tick(1) on the same bar without consuming the event.

    iFVG ENTRY SEMANTICS — distinguish FORMATION from RETEST:
    - If the trader says "bearish FVG closes above its upper boundary, becomes a
      bullish IFVG" and "enter after the bullish IFVG is confirmed/forms", the
      entry trigger is the INVERSION/FORMATION bar:
        IFVGSM_{id}_BullJustInverted() / BearJustInverted()
        SL: IFVGSM_{id}_BullInversionSL() / BearInversionSL()
        Time gate: IFVGSM_{id}_BullInversionTime() / BearInversionTime()
    - Use IFVGSM_{id}_BullJustConfirmed() / BearJustConfirmed() ONLY when the
      trader explicitly asks for an iFVG RETEST entry after the inversion zone
      is born. Do not substitute retest-confirmation for formation-confirmation.

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
  /** Verified built-in filter refs extracted during strategy intake. */
  filterRefs?: BuiltinFilterRef[];
  /** Internal escape hatch only. Normal SaaS generation must leave this false. */
  allowUnsafeModules?: boolean;
}

export interface AiBrainWiringResponse {
  output_mode?: "strategy_flow" | "brain_bodies";
  strategy_flow?: {
    version: 1;
    steps: Array<{
      id?: string;
      name?: string;
      role?: string;
      module?: string;
      timeframe?: string;
      event?: string;
      enabled?: boolean;
      params?: Record<string, unknown>;
      dependsOn?: Array<{
        stepId: string;
        relation?: "after" | "same_or_after" | "before" | string;
        required?: boolean;
        withinBars?: number;
      }>;
      directionSource?: {
        mode: "own_event" | "from_step" | "fixed" | "neutral";
        stepId?: string;
        direction?: 1 | -1 | 0;
      };
      notes?: string;
    }>;
    notes?: string;
  };
  direction_brain: string;
  setup_brain: string;
  execution_brain: string;
  semantics?: StrategySemantics;
  validation?: WiringValidation;
  repairAttempts?: number;
  repair?: ReturnType<typeof buildModuleRepairPlan>;
  required_sms: string[];
  sm_configs: Record<
    string,
    {
      type: string;
      id: string;
      TF: string;
      tf: string;
      params: Record<string, unknown>;
    }
  >;
  notes: string;
}

export interface StrategySemantics {
  version: 1;
  source: "ai" | "deterministic_adapter" | "local_extractor";
  timeframe: string;
  modules: string[];
  direction?: {
    module: string;
    event: string;
    fastPeriod?: number;
    slowPeriod?: number;
    resetPolicy?: string;
  };
  setup?: {
    gate: string;
    target?: EmaRetestTarget | string;
    targetLabel?: string;
    mustOccurAfter?: string;
  };
  execution?: {
    module: string;
    entryEvent: "formation" | "retest" | "confirmation" | "unknown" | string;
    mustOccurAfter?: string;
  };
  filters?: Array<{
    id: string;
    role: "setup" | "execution";
    indicator: string;
    timeframe: string;
    params: Record<string, unknown>;
  }>;
  assumptions: string[];
}

type ExecutionEntryEvent = NonNullable<StrategySemantics["execution"]>["entryEvent"];

export interface WiringValidation {
  status: "pass" | "warn" | "fail";
  errors: string[];
  warnings: string[];
}

function unsafeAiModuleReason(moduleId: string): string | null {
  const admission = getModuleAdmission(moduleId);
  if (!admission) return `module "${moduleId}" has no admission record`;
  if (admission.status !== "verified_state_machine") {
    return `${admission.label} is ${admission.status.replace(/_/g, " ")}; ${admission.notes}`;
  }
  return null;
}

function uniqueModules(modules: string[]): string[] {
  return [...new Set(modules.filter(Boolean).map((m) => m.toLowerCase()))];
}

function modulesFromConfig(config?: FourBrainConfig): string[] {
  return uniqueModules([
    ...(config?.direction?.modules ?? []),
    ...(config?.setup?.modules ?? []),
    ...(config?.execution?.modules ?? []),
  ]);
}

export function findUnsafeAiModules(modules: string[]): string[] {
  return uniqueModules(modules)
    .map((moduleId) => {
      const reason = unsafeAiModuleReason(moduleId);
      return reason ? `${moduleId}: ${reason}` : null;
    })
    .filter((reason): reason is string => Boolean(reason));
}

function periodConst(tf: string): string {
  const label = (tf || "M5").toUpperCase();
  return label === "MN" ? "PERIOD_MN1" : `PERIOD_${label}`;
}

export function inferLocalSemantics(text: string, config?: FourBrainConfig): StrategySemantics {
  const tf = extractSingleTimeframe(text, config);
  const { fast, slow } = extractEmaPeriods(text, config);
  const hasEma =
    /\bema\b/i.test(text) ||
    [
      ...(config?.direction?.modules ?? []),
      ...(config?.setup?.modules ?? []),
      ...(config?.execution?.modules ?? []),
    ].some((m) => m.toLowerCase() === "ema");
  const hasIfvg =
    /\bifvg\b/i.test(text) ||
    /inversion\s+fair\s+value\s+gap/i.test(text) ||
    [
      ...(config?.direction?.modules ?? []),
      ...(config?.setup?.modules ?? []),
      ...(config?.execution?.modules ?? []),
    ].some((m) => m.toLowerCase() === "fvg_inversion");

  if (hasEma && hasIfvg) {
    const retestTarget = extractEmaRetestTarget(text, fast, slow, config);
    return buildEmaIfvgSemantics(text, tf, fast, slow, retestTarget, "local_extractor");
  }

  const modules = [
    ...(config?.direction?.modules ?? []),
    ...(config?.setup?.modules ?? []),
    ...(config?.execution?.modules ?? []),
  ];

  return {
    version: 1,
    source: "local_extractor",
    timeframe: tf,
    modules: [...new Set(modules.map((m) => m.toLowerCase()))],
    direction: config?.direction
      ? {
          module: config.direction.modules[0] ?? "unknown",
          event: "module_signal",
        }
      : undefined,
    setup: config?.setup
      ? {
          gate: "module_signal",
          mustOccurAfter: config.direction ? "direction_event" : undefined,
        }
      : undefined,
    execution: {
      module: config?.execution?.modules?.[0] ?? "unknown",
      entryEvent: "unknown",
      mustOccurAfter: config?.setup
        ? "setup_gate"
        : config?.direction
          ? "direction_event"
          : undefined,
    },
    filters: collectBuiltinFilterRefs(text, tf).map((filter) => ({
      id: filter.id,
      role: filter.appliesTo ?? "execution",
      indicator: filter.indicatorId,
      timeframe: filter.timeframe,
      params: filter.params,
    })),
    assumptions: ["Claude did not return semantics; server attached a minimal local extraction."],
  };
}

type SemanticFilter = NonNullable<StrategySemantics["filters"]>[number];

function filtersFromRefs(refs: BuiltinFilterRef[] | undefined): SemanticFilter[] {
  return (refs ?? []).map((filter) => ({
    id: filter.id,
    role: filter.appliesTo ?? "execution",
    indicator: filter.indicatorId,
    timeframe: filter.timeframe,
    params: filter.params,
  }));
}

function mergeSemanticFilters(...groups: Array<SemanticFilter[] | undefined>): SemanticFilter[] {
  const seen = new Set<string>();
  const merged: SemanticFilter[] = [];
  for (const group of groups) {
    for (const filter of group ?? []) {
      const key = `${filter.id}|${filter.role}|${filter.indicator}|${filter.timeframe}|${JSON.stringify(filter.params ?? {})}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(filter);
    }
  }
  return merged;
}

function numParam(params: Record<string, unknown>, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function strParam(params: Record<string, unknown>, key: string, fallback: string): string {
  const value = params[key];
  return typeof value === "string" && value ? value : fallback;
}

function filterVarSuffix(filter: SemanticFilter): string {
  return `${filter.id}_${filter.timeframe}`.replace(/[^A-Za-z0-9_]/g, "_");
}

function mqlFilterSnippet(filter: SemanticFilter): string {
  const tf = periodConst(filter.timeframe || "M5");
  const params = filter.params ?? {};
  const suffix = filterVarSuffix(filter);
  const target = filter.role === "setup" ? "gSetupActive" : "gExecSignal";
  const direction = filter.role === "setup" ? "gSetupDir" : "gExecDir";
  const block = (condition: string, reason: string) => `
   if(${target} && !(${condition})) {
      PrintFormat("[FILTER] ${filter.id} blocked: ${reason}");
      ${target} = false;
   }`;

  if (filter.id === "rsi_level_filter") {
    const period = numParam(params, "period", 14);
    const level = numParam(params, "level", 50);
    const operator = strParam(params, "operator", "directional");
    const value = `rsi_${suffix}`;
    const condition =
      operator === "above"
        ? `${value} > ${level}`
        : operator === "below"
          ? `${value} < ${level}`
          : `(${direction} == 1 && ${value} > ${level}) || (${direction} == -1 && ${value} < ${level})`;
    return `
   // Verified built-in filter: RSI level
   int hRsi_${suffix} = B4_RSI(${tf}, ${period});
   double ${value} = B4_Buf(hRsi_${suffix}, 0, 1);
${block(condition, `RSI %.2f not ${operator} ${level}`, value)}`;
  }

  if (filter.id === "atr_volatility_filter") {
    const period = numParam(params, "period", 14);
    const minAtr = numParam(params, "minAtrPoints", 0);
    const maxAtr = numParam(params, "maxAtrPoints", 0);
    const operator = strParam(params, "operator", minAtr > 0 ? "above" : "below");
    const value = `atrPts_${suffix}`;
    const condition =
      operator === "below"
        ? `${maxAtr > 0 ? `${value} <= ${maxAtr}` : "true"}`
        : operator === "between"
          ? `(${minAtr <= 0 ? "true" : `${value} >= ${minAtr}`}) && (${maxAtr <= 0 ? "true" : `${value} <= ${maxAtr}`})`
          : `${minAtr > 0 ? `${value} >= ${minAtr}` : "true"}`;
    return `
   // Verified built-in filter: ATR volatility
   int hAtr_${suffix} = B4_ATR(${tf}, ${period});
   double ${value} = B4_Buf(hAtr_${suffix}, 0, 1) / SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
${block(condition, `ATR %.1f points outside ${operator} threshold`, value)}`;
  }

  if (filter.id === "macd_histogram_filter") {
    const fast = numParam(params, "fastPeriod", 12);
    const slow = numParam(params, "slowPeriod", 26);
    const signal = numParam(params, "signalPeriod", 9);
    const operator = strParam(params, "operator", "directional");
    const value = `macdHist_${suffix}`;
    const condition =
      operator === "above_zero"
        ? `${value} > 0.0`
        : operator === "below_zero"
          ? `${value} < 0.0`
          : `(${direction} == 1 && ${value} > 0.0) || (${direction} == -1 && ${value} < 0.0)`;
    return `
   // Verified built-in filter: MACD histogram
   int hMacd_${suffix} = B4_MACD(${tf}, ${fast}, ${slow}, ${signal});
   double macdMain_${suffix} = B4_Buf(hMacd_${suffix}, 0, 1);
   double macdSignal_${suffix} = B4_Buf(hMacd_${suffix}, 1, 1);
   double ${value} = macdMain_${suffix} - macdSignal_${suffix};
${block(condition, `MACD histogram %.5f failed ${operator}`, value)}`;
  }

  return "";
}

function injectBeforeFinalBrace(code: string, snippet: string): string {
  if (!snippet.trim()) return code;
  if (code.includes(snippet.trim().split("\n")[0].trim())) return code;
  const idx = code.lastIndexOf("}");
  if (idx < 0) return `${code}\n${snippet}`;
  return `${code.slice(0, idx)}${snippet}\n${code.slice(idx)}`;
}

function applyBuiltinFilters(
  response: AiBrainWiringResponse,
  fullText: string,
  requestFilterRefs?: BuiltinFilterRef[],
): AiBrainWiringResponse {
  const semantics = response.semantics ?? inferLocalSemantics(fullText);
  const textFilters = filtersFromRefs(collectBuiltinFilterRefs(fullText, semantics.timeframe));
  const requestFilters = filtersFromRefs(requestFilterRefs);
  const filters = mergeSemanticFilters(semantics.filters, requestFilters, textFilters);
  response.semantics = { ...semantics, filters };

  const setupSnippets = filters
    .filter((filter) => filter.role === "setup")
    .map(mqlFilterSnippet)
    .join("\n");
  const execSnippets = filters
    .filter((filter) => filter.role === "execution")
    .map(mqlFilterSnippet)
    .join("\n");

  response.setup_brain = injectBeforeFinalBrace(response.setup_brain, setupSnippets);
  response.execution_brain = injectBeforeFinalBrace(response.execution_brain, execSnippets);
  return response;
}

function parseAiJsonObject(rawText: string): Record<string, unknown> {
  let text = rawText.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  if (text.startsWith("```")) text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (firstErr) {
    try {
      return JSON.parse(jsonrepair(text)) as Record<string, unknown>;
    } catch {
      // Fall through to extracting the largest object from chatty model output.
    }
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Claude did not return valid JSON");
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      try {
        return JSON.parse(jsonrepair(match[0])) as Record<string, unknown>;
      } catch {
        const message = firstErr instanceof Error ? firstErr.message : "Unknown JSON parse error";
        throw new Error(`Claude returned malformed JSON that could not be repaired: ${message}`);
      }
    }
  }
}

function compactJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function buildAiWiringRepairPrompt(params: {
  originalRequest: string;
  invalidResponse: AiBrainWiringResponse;
  validation: WiringValidation;
}): string {
  const errors = params.validation.errors
    .map((error, index) => `${index + 1}. ${error}`)
    .join("\n");
  const warnings = params.validation.warnings.length
    ? params.validation.warnings.map((warning, index) => `${index + 1}. ${warning}`).join("\n")
    : "None";

  return `Repair the 4-Brain wiring JSON. Return ONLY the corrected JSON object.

The previous wiring failed deterministic validation. Do not explain outside the notes field.
Do not invent modules, state-machine functions, or raw MQL5 helpers. Use only the verified module contracts.
Keep the trader's strategy intent unchanged. Fix the wiring, semantics, and sm_configs so validation can pass.

VALIDATION ERRORS:
${errors || "None"}

VALIDATION WARNINGS:
${warnings}

ORIGINAL REQUEST:
${params.originalRequest}

INVALID JSON TO REPAIR:
${compactJson({
  direction_brain: params.invalidResponse.direction_brain,
  setup_brain: params.invalidResponse.setup_brain,
  execution_brain: params.invalidResponse.execution_brain,
  semantics: params.invalidResponse.semantics,
  required_sms: params.invalidResponse.required_sms,
  sm_configs: params.invalidResponse.sm_configs,
  notes: params.invalidResponse.notes,
})}

Repair checklist:
- If semantics declare a module/event for a brain, that brain must call a verified query function for that exact module/event.
- If execution.mustOccurAfter is "setup_gate", execution must reference gSetupActive or gSetupDir, except strict EMA→IFVG timestamp gates which must compare IFVG time against gEmaIfvgTestTime.
- Every XXXSM_ID_ function call must have a matching sm_configs entry.
- Use exact function names from the module contract registry.
- Preserve exact trader parameters and timeframe intent.`;
}

type SemanticBrainRole = Extract<BrainRole, "direction" | "setup" | "execution">;

function codeForSemanticRole(role: SemanticBrainRole, codes: Record<SemanticBrainRole, string>) {
  return codes[role] ?? "";
}

function defaultSemanticEvent(moduleId: string, role: SemanticBrainRole): string | undefined {
  const defaults: Record<string, Partial<Record<SemanticBrainRole, string>>> = {
    bos: { direction: "bias", setup: "break", execution: "break" },
    choch: { direction: "bias_flip", setup: "break", execution: "break" },
    bos_choch: {
      direction: "structure_event",
      setup: "structure_event",
      execution: "structure_event",
    },
    order_block: { direction: "active_zone", setup: "active_zone", execution: "mitigation" },
    ob_fvg: { direction: "confluence_zone", setup: "confluence_zone", execution: "entry" },
    fvg: { direction: "active_zone", setup: "active_zone", execution: "confirmation" },
    fvg_inversion: { direction: "active_zone", setup: "active_zone", execution: "confirmation" },
    liqsweep: { setup: "sweep", execution: "sweep" },
    snr: { setup: "level_touch", execution: "level_touch" },
    gap_snr: { setup: "gap_level_touch", execution: "gap_level_touch" },
    rejection: { execution: "rejection" },
    miss: { setup: "miss", execution: "miss" },
    breakout: { setup: "breakout", execution: "breakout" },
    rsi_hd: { setup: "hidden_divergence", execution: "hidden_divergence" },
    engulfing: { direction: "eg_zone_active", setup: "eg_zone_active", execution: "eg_confirmed" },
  };
  return defaults[moduleId]?.[role];
}

function normalizeSemanticEvent(
  moduleId: string,
  role: SemanticBrainRole,
  eventId: string | undefined,
): string | undefined {
  const event = String(eventId ?? "").toLowerCase();
  if (!event || event === "unknown" || event === "module_signal" || event === `${moduleId}_setup`) {
    return defaultSemanticEvent(moduleId, role);
  }
  return event;
}

function setupModuleFromSemantics(semantics: StrategySemantics): string | undefined {
  const setupGate = String(semantics.setup?.gate ?? "").toLowerCase();
  const modules = uniqueModules(semantics.modules ?? []);
  const setupCandidates = modules.filter((moduleId) =>
    getModuleContract(moduleId)?.supportedRoles.includes("setup"),
  );

  const explicit = setupCandidates.find((moduleId) =>
    getModuleContract(moduleId)?.semanticEvents.some(
      (event) => event.id === setupGate && event.roles.includes("setup"),
    ),
  );
  if (explicit) return explicit;

  const nonDirection = setupCandidates.filter(
    (moduleId) => moduleId !== semantics.direction?.module,
  );
  const nonExecution = nonDirection.filter((moduleId) => moduleId !== semantics.execution?.module);
  return nonExecution[0] ?? nonDirection[0] ?? setupCandidates[0];
}

function semanticModuleForRole(
  semantics: StrategySemantics,
  role: SemanticBrainRole,
): string | undefined {
  if (role === "direction") return semantics.direction?.module;
  if (role === "execution") return semantics.execution?.module;
  return setupModuleFromSemantics(semantics);
}

function semanticEventForRole(
  semantics: StrategySemantics,
  role: SemanticBrainRole,
  moduleId: string,
): string | undefined {
  if (role === "direction")
    return normalizeSemanticEvent(moduleId, role, semantics.direction?.event);
  if (role === "execution") {
    return normalizeSemanticEvent(moduleId, role, semantics.execution?.entryEvent);
  }
  return normalizeSemanticEvent(moduleId, role, semantics.setup?.gate);
}

function queryFunctionPattern(queryFunction: string): RegExp | null {
  if (queryFunction.startsWith("template:") || queryFunction.startsWith("not_verified:"))
    return null;
  const escaped = queryFunction
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace("\\{id\\}", "[A-Za-z0-9]+")
    .replace("\\(\\)", "\\s*\\(");
  return new RegExp(`\\b${escaped}`);
}

function brainUsesContractQuery(code: string, queryFunctions: string[]): boolean {
  return queryFunctions.some((query) => {
    const pattern = queryFunctionPattern(query);
    return pattern ? pattern.test(code) : false;
  });
}

function semanticEventQueryFunctions(
  moduleId: string,
  eventId: string,
  role: SemanticBrainRole,
): string[] {
  const contract = getModuleContract(moduleId);
  if (!contract) return [];
  return contract.semanticEvents
    .filter((event) => event.id === eventId && event.roles.includes(role))
    .flatMap((event) => event.queryFunctions);
}

function validateGenericSemanticRole(
  semantics: StrategySemantics,
  role: SemanticBrainRole,
  codes: Record<SemanticBrainRole, string>,
  errors: string[],
  warnings: string[],
) {
  const moduleId = semanticModuleForRole(semantics, role);
  if (!moduleId || moduleId === "unknown") return;

  const contract = getModuleContract(moduleId);
  if (!contract) return;

  if (!contract.supportedRoles.includes(role)) {
    errors.push(`Module "${moduleId}" is not supported for the ${role} brain role.`);
    return;
  }

  const eventId = semanticEventForRole(semantics, role, moduleId);
  if (!eventId || eventId === "ema_retest") return;
  if (moduleId === "ema") return;

  if (!moduleSupportsEvent(moduleId, eventId, role)) {
    errors.push(
      `Module contract registry does not support ${moduleId} ${role} event "${eventId}".`,
    );
    return;
  }

  const queryFunctions = semanticEventQueryFunctions(moduleId, eventId, role);
  if (!queryFunctions.length) {
    warnings.push(`No query functions are registered for ${moduleId} ${role} event "${eventId}".`);
    return;
  }

  const roleCode = codeForSemanticRole(role, codes);
  if (!brainUsesContractQuery(roleCode, queryFunctions)) {
    errors.push(
      `Semantics require ${moduleId} ${role} event "${eventId}", but ${role} wiring does not use a verified ${moduleId} query for that event.`,
    );
  }
}

export function validateWiringAgainstSemantics(response: AiBrainWiringResponse): WiringValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const dirCode = response.direction_brain ?? "";
  const setupCode = response.setup_brain ?? "";
  const execCode = response.execution_brain ?? "";
  const roleCodes: Record<SemanticBrainRole, string> = {
    direction: dirCode,
    setup: setupCode,
    execution: execCode,
  };
  const allCode = [dirCode, setupCode, execCode].join("\n");
  const semantics = response.semantics;

  if (!semantics) {
    errors.push("Missing strategy semantics contract.");
    return { status: "fail", errors, warnings };
  }

  const unsafeSemanticModules = findUnsafeAiModules(semantics.modules ?? []);
  if (unsafeSemanticModules.length > 0) {
    errors.push(
      `AI wiring uses module(s) that are not admitted for AI 4-Brain generation: ${unsafeSemanticModules.join(" | ")}`,
    );
  }

  for (const moduleId of semantics.modules ?? []) {
    if (!getModuleContract(moduleId)) {
      warnings.push(`No module contract is registered for "${moduleId}".`);
    }
  }

  validateGenericSemanticRole(semantics, "direction", roleCodes, errors, warnings);
  validateGenericSemanticRole(semantics, "setup", roleCodes, errors, warnings);
  validateGenericSemanticRole(semantics, "execution", roleCodes, errors, warnings);

  for (const filter of semantics.filters ?? []) {
    const contract = getBuiltinFilterContract(filter.id);
    if (!contract) {
      errors.push(`Built-in filter "${filter.id}" has no verified filter contract.`);
      continue;
    }
    if (!contract.roles.includes(filter.role)) {
      errors.push(`Built-in filter "${filter.id}" is not supported for ${filter.role} role.`);
    }
    if (filter.indicator !== contract.indicatorId) {
      errors.push(
        `Built-in filter "${filter.id}" must use indicator "${contract.indicatorId}", not "${filter.indicator}".`,
      );
    }
    if (filter.id === "rsi_level_filter") {
      const roleCode = filter.role === "setup" ? setupCode : execCode;
      if (!/\bB4_RSI\s*\(/.test(roleCode)) {
        errors.push("rsi_level_filter is declared but the filtered brain does not call B4_RSI().");
      }
      if (!/\bB4_Buf\s*\([^,]+,\s*0\s*,\s*1\s*\)/.test(roleCode)) {
        errors.push(
          "rsi_level_filter is declared but the filtered brain does not read RSI buffer 0 at shift 1 with B4_Buf().",
        );
      }
    }
    if (filter.id === "atr_volatility_filter") {
      const roleCode = filter.role === "setup" ? setupCode : execCode;
      if (!/\bB4_ATR\s*\(/.test(roleCode)) {
        errors.push(
          "atr_volatility_filter is declared but the filtered brain does not call B4_ATR().",
        );
      }
      if (!/\bB4_Buf\s*\([^,]+,\s*0\s*,\s*1\s*\)/.test(roleCode)) {
        errors.push(
          "atr_volatility_filter is declared but the filtered brain does not read ATR buffer 0 at shift 1 with B4_Buf().",
        );
      }
      if (!/\bSYMBOL_POINT\b|\bPoint\s*\(\s*\)/.test(roleCode)) {
        errors.push(
          "atr_volatility_filter is declared but the filtered brain does not convert ATR price distance to points.",
        );
      }
    }
    if (filter.id === "macd_histogram_filter") {
      const roleCode = filter.role === "setup" ? setupCode : execCode;
      if (!/\bB4_MACD\s*\(/.test(roleCode)) {
        errors.push(
          "macd_histogram_filter is declared but the filtered brain does not call B4_MACD().",
        );
      }
      if (!/\bB4_Buf\s*\(/.test(roleCode)) {
        errors.push(
          "macd_histogram_filter is declared but the filtered brain does not read MACD buffers with B4_Buf().",
        );
      }
      if (!/(macd\w*\s*[-+]\s*macd\w*|>\s*0\.0|<\s*0\.0|>=\s*0\.0|<=\s*0\.0)/i.test(roleCode)) {
        errors.push(
          "macd_histogram_filter is declared but the filtered brain does not apply a MACD zero-line or main/signal comparison.",
        );
      }
    }
  }

  const smCallRe =
    /\b(RSIHDSM|OBFVGSM|EMASM|IFVGSM|FVGSM|EGSM|OBSM|BOSSM|LSSM|GSNRSM|SNRSM|BRKSM|REJSM|MISSSM)_([A-Za-z0-9]+)_([A-Za-z0-9_]+)\s*\(/g;
  const badSmCalls = new Set<string>();
  let smMatch: RegExpExecArray | null;
  while ((smMatch = smCallRe.exec(allCode)) !== null) {
    const fullCall = `${smMatch[1]}_${smMatch[2]}_${smMatch[3]}(`;
    if (!moduleContractAllowsSmFunction(smMatch[1], fullCall)) badSmCalls.add(fullCall);
  }
  if (badSmCalls.size > 0) {
    errors.push(
      `AI wiring references unregistered state-machine function(s): ${[...badSmCalls].join(", ")}`,
    );
  }

  if (semantics.setup?.gate === "ema_retest") {
    if (!moduleSupportsEvent("ema", "ema_retest", "setup")) {
      errors.push("Module contract registry does not support EMA retest setup semantics.");
    }
    const usesVerifiedEmaSm =
      /\bEMASM_[A-Z0-9]+_SetupActive\s*\(/.test(setupCode) &&
      /\bEMASM_[A-Z0-9]+_JustConfirmed\s*\(/.test(execCode);
    if (usesVerifiedEmaSm) {
      return {
        status: errors.length ? "fail" : warnings.length ? "warn" : "pass",
        errors,
        warnings,
      };
    }
    const target = String(semantics.setup.target ?? "either").toLowerCase();
    const usesFast = /\btouchedFast\b/.test(setupCode);
    const usesSlow = /\btouchedSlow\b/.test(setupCode);
    const usesEither =
      /\btouchedFast\s*\|\|\s*touchedSlow\b|\btouchedSlow\s*\|\|\s*touchedFast\b/.test(setupCode);

    if (target === "fast") {
      if (!usesFast)
        errors.push(
          "Semantics require fast EMA retest, but setup wiring does not test touchedFast.",
        );
      if (usesEither || /&&\s*touchedSlow\b/.test(setupCode)) {
        errors.push("Semantics require fast EMA only, but setup wiring also allows the slow EMA.");
      }
    } else if (target === "slow") {
      if (!usesSlow)
        errors.push(
          "Semantics require slow EMA retest, but setup wiring does not test touchedSlow.",
        );
      if (usesEither || /&&\s*touchedFast\b/.test(setupCode)) {
        errors.push("Semantics require slow EMA only, but setup wiring also allows the fast EMA.");
      }
    } else if (target === "either") {
      if (!(usesEither || (usesFast && usesSlow))) {
        errors.push(
          "Semantics require either EMA retest, but setup wiring does not test both EMA touch states.",
        );
      }
    } else {
      warnings.push(`Unknown EMA retest target "${target}".`);
    }

    if (!/\bgEmaIfvgTestTime_[A-Z0-9]+\b/.test(setupCode + execCode)) {
      errors.push(
        "EMA retest semantics require a timestamp gate, but wiring does not reference gEmaIfvgTestTime.",
      );
    }
  }

  if (semantics.execution?.module === "fvg_inversion") {
    const entryEvent = String(semantics.execution.entryEvent ?? "unknown").toLowerCase();
    if (
      entryEvent !== "unknown" &&
      !moduleSupportsEvent("fvg_inversion", entryEvent, "execution")
    ) {
      errors.push(
        `Module contract registry does not support fvg_inversion execution event "${entryEvent}".`,
      );
    }
    const usesIfvgInversion =
      /(?:^|[^A-Za-z0-9_])(?:IFVGSM_[A-Z0-9]+_)?(?:Bull|Bear)JustInverted\s*\(/.test(execCode);
    const usesIfvgConfirmation =
      /(?:^|[^A-Za-z0-9_])(?:IFVGSM_[A-Z0-9]+_)?(?:Bull|Bear)JustConfirmed\s*\(/.test(execCode);
    if (entryEvent === "formation") {
      if (!usesIfvgInversion) {
        errors.push(
          "Semantics require IFVG formation entry, but execution wiring does not use JustInverted().",
        );
      }
      if (usesIfvgConfirmation) {
        errors.push(
          "Semantics require IFVG formation entry, but execution wiring uses IFVG retest confirmation.",
        );
      }
    } else if (entryEvent === "retest" || entryEvent === "confirmation") {
      if (!usesIfvgConfirmation) {
        warnings.push(
          "Semantics request IFVG retest/confirmation entry, but execution wiring does not use JustConfirmed().",
        );
      }
    }

    if (
      semantics.execution.mustOccurAfter === "setup_gate" &&
      !/>\s*gEmaIfvgTestTime_[A-Z0-9]+\b/.test(execCode)
    ) {
      errors.push(
        "Execution must occur after setup gate, but execution wiring does not compare IFVG time against EMA test time.",
      );
    }
  }

  if (
    semantics.execution?.module !== "fvg_inversion" &&
    semantics.execution?.mustOccurAfter === "setup_gate" &&
    !/\bgSetupActive\b|\bgSetupDir\b/.test(execCode)
  ) {
    errors.push(
      "Execution must occur after setup gate, but execution wiring does not reference gSetupActive or gSetupDir.",
    );
  }

  const status = errors.length ? "fail" : warnings.length ? "warn" : "pass";
  return { status, errors, warnings };
}

/** Route validation to strategy_flow schema or legacy brain-body semantics checks. */
export function validateAiWiringResponse(response: AiBrainWiringResponse): WiringValidation {
  if (usesStrategyFlowOutput(response)) {
    return validateAiStrategyFlowWiring(response);
  }
  return validateWiringAgainstSemantics(response);
}

export function normalizeAiResponse(
  parsed: Record<string, unknown>,
  fullText: string,
  config?: FourBrainConfig,
  filterRefs?: BuiltinFilterRef[],
): AiBrainWiringResponse {
  const response = parsed as unknown as AiBrainWiringResponse;
  if (!response.direction_brain) response.direction_brain = "";
  if (!response.setup_brain) response.setup_brain = "";
  if (!response.execution_brain) response.execution_brain = "";
  if (!response.sm_configs) response.sm_configs = {};
  if (!response.required_sms) response.required_sms = [];
  if (!response.notes) response.notes = "";
  normalizeAiStrategyFlowInResponse(response);
  if (!response.semantics || typeof response.semantics !== "object") {
    response.semantics = inferLocalSemantics(fullText, config);
  }
  applyBuiltinFilters(response, fullText, filterRefs);
  response.validation = validateAiWiringResponse(response);
  const repair = buildModuleRepairPlan(response.semantics.modules ?? []);
  if (repair.hasBlockedModules) response.repair = repair;
  return response;
}

export { isEmaCrossTestClose, isEmaTestThenIfvgFormation };

export function buildEmaTestThenIfvgFormationWiring(
  text: string,
  config?: FourBrainConfig,
): AiBrainWiringResponse {
  const response = buildBlessedEmaIfvgWiring(text, config) as AiBrainWiringResponse;
  applyBuiltinFilters(response, text);
  response.validation = validateWiringAgainstSemantics(response);
  return response;
}

export function buildEmaCrossTestCloseWiring(
  text: string,
  config?: FourBrainConfig,
): AiBrainWiringResponse {
  const response = buildBlessedEmaCtcWiring(text, config) as AiBrainWiringResponse;
  applyBuiltinFilters(response, text);
  response.validation = validateWiringAgainstSemantics(response);
  return response;
}

async function requestAiWiringJson(userMessage: string): Promise<Record<string, unknown>> {
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
      { role: "assistant", content: "{" },
    ],
  });

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected Claude response type");
  return parseAiJsonObject(`{${block.text}`);
}

export default async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS });

  let body: GenRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }

  const { config, eaName, description, prompt, filterRefs, allowUnsafeModules } = body;
  const fullText = [
    prompt,
    description,
    config?.direction?.description,
    config?.setup?.description,
    config?.execution?.description,
  ]
    .filter(Boolean)
    .join("\n");

  if (config && !allowUnsafeModules) {
    const configModules = modulesFromConfig(config);
    const unsafeModules = findUnsafeAiModules(configModules);
    if (unsafeModules.length > 0) {
      const repair = buildModuleRepairPlan(configModules);
      return Response.json(
        {
          error: `AI 4-Brain generation is blocked because this strategy uses module(s) that are not admitted for AI wiring: ${unsafeModules.join(" | ")}`,
          repair,
        },
        { status: 400, headers: CORS },
      );
    }
  }

  if (isEmaTestThenIfvgFormation(fullText, config)) {
    const response = buildEmaTestThenIfvgFormationWiring(fullText, config);
    applyBuiltinFilters(response, fullText, filterRefs);
    response.validation = validateWiringAgainstSemantics(response);
    return Response.json(response, {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  if (isEmaCrossTestClose(fullText, config)) {
    const response = buildEmaCrossTestCloseWiring(fullText, config);
    applyBuiltinFilters(response, fullText, filterRefs);
    response.validation = validateWiringAgainstSemantics(response);
    return Response.json(response, {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500, headers: CORS });

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
- Generate strategy_flow steps (preferred) or legacy brain functions if steps cannot express the strategy
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

    userMessage = `Generate strategy_flow steps (preferred) or legacy brain wiring for this EA: "${eaName}"
${description ? `\nOverall strategy intent: ${description}\n` : ""}

The trader configured these brains in the visual builder:

${dirDesc}

${setupDesc}

${execDesc}

Map each brain to one or more strategy_flow steps with correct dependsOn order.
Use the module library to select verified modules and contract-backed events.
Extract configuration from the trader's notes and EXACT PARAMETERS blocks.
In "notes", explain how you mapped their module selections to steps.`;
  } else {
    return Response.json(
      { error: "Either prompt or config.execution is required" },
      { status: 400, headers: CORS },
    );
  }

  try {
    const parsed = await requestAiWiringJson(userMessage);
    let normalized = normalizeAiResponse(parsed, fullText, config, filterRefs);
    normalized.repairAttempts = 0;

    if (normalized.validation?.status === "fail") {
      const repairPrompt = buildAiWiringRepairPrompt({
        originalRequest: userMessage,
        invalidResponse: normalized,
        validation: normalized.validation,
      });
      const repaired = normalizeAiResponse(
        await requestAiWiringJson(repairPrompt),
        fullText,
        config,
        filterRefs,
      );
      repaired.repairAttempts = 1;

      if (repaired.validation?.status === "pass" || repaired.validation?.status === "warn") {
        repaired.notes = `${repaired.notes}\n\nAI repair pass: corrected wiring after deterministic validation rejected the first attempt.`;
        normalized = repaired;
      } else {
        normalized.repairAttempts = 1;
        normalized.notes = `${normalized.notes}\n\nAI repair attempted but validation still failed; returning the first invalid wiring with validator errors for diagnosis.`;
      }
    }

    return Response.json(normalized, {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("gen-4brain-ai error:", err);
    const msg = err instanceof Error ? err.message : "Internal server error";
    if (/modelId\.replace is not a function/i.test(msg)) {
      return Response.json(
        {
          error:
            "AI provider/model configuration failed before strategy generation. This is a platform AI routing issue, not your strategy rules. Try again once; if it repeats, download the Evidence Pack and check the AI function logs.",
        },
        { status: 500, headers: CORS },
      );
    }
    return Response.json({ error: msg }, { status: 500, headers: CORS });
  }
};

export const config = {
  path: "/api/gen-4brain-ai",
  timeout: 26,
};
