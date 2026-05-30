/**
 * Module Library — Claude's reference for all available inline state machines.
 *
 * Every entry describes:
 *  - what the module detects
 *  - the API functions it exposes (with exact signatures)
 *  - when to use it (direction / setup / execution)
 *  - what parameters the trader can configure
 *
 * This manifest is injected into Claude's system prompt so it can reference
 * the correct state machine when generating wiring code for any description.
 */

export interface SMApi {
  /** Function Claude should call once per bar-open */
  tick: string;
  /** Bias or signal query functions */
  queries: Array<{ fn: string; returns: string; meaning: string }>;
  /** Parameters the trader can tune */
  params: Array<{ name: string; default: number; meaning: string }>;
}

export interface ModuleSpec {
  id: string;
  label: string;
  /** One-sentence description of what it detects */
  detects: string;
  /** Which brain roles it is well-suited for */
  roles: Array<"direction" | "setup" | "execution">;
  /** State machine lifecycle */
  lifecycle: string;
  /** The API after inlining with genXxxSM(id, TF, tf) */
  api: SMApi;
  /** Example usage in generated MQL5 code */
  example: string;
}

export const MODULE_SPECS: ModuleSpec[] = [
  // ── FVG ──────────────────────────────────────────────────────────────────
  {
    id: "fvg",
    label: "Fair Value Gap",
    detects: "3-candle price imbalance zones; tracks them ACTIVE→RETESTED→CONFIRMED",
    roles: ["setup", "execution"],
    lifecycle: "ACTIVE (gap born) → RETESTED (wick enters zone) → CONFIRMED (close exits back outside) | MITIGATED / INVALIDATED / EXPIRED",
    api: {
      tick: "FVGSM_{id}_Tick(lookback)",
      queries: [
        { fn: "FVGSM_{id}_BullJustConfirmed()", returns: "bool", meaning: "Bull FVG confirmed this bar — fire entry" },
        { fn: "FVGSM_{id}_BearJustConfirmed()", returns: "bool", meaning: "Bear FVG confirmed this bar — fire entry" },
        { fn: "FVGSM_{id}_BullConfirmSL()",     returns: "double", meaning: "SL price = retestLow at bull confirmation" },
        { fn: "FVGSM_{id}_BearConfirmSL()",     returns: "double", meaning: "SL price = retestHigh at bear confirmation" },
        { fn: "FVGSM_{id}_HasActiveBull()",     returns: "bool", meaning: "A live bull FVG zone exists (ACTIVE or RETESTED)" },
        { fn: "FVGSM_{id}_HasActiveBear()",     returns: "bool", meaning: "A live bear FVG zone exists" },
      ],
      params: [
        { name: "expiryBars", default: 100, meaning: "Bars before a zone expires" },
      ],
    },
    example: `// Setup: FVG active on H4
FVGSM_H4_Tick(50);
if(FVGSM_H4_HasActiveBull() && gBias == 1) gSetupActive = true;

// Execution: FVG confirmed on M15
FVGSM_M15_Tick(50);
if(FVGSM_M15_BullJustConfirmed()) { gExecSignal=true; gExecSL=FVGSM_M15_BullConfirmSL(); }`,
  },

  // ── FVG Inversion ─────────────────────────────────────────────────────────
  {
    id: "fvg_inversion",
    label: "FVG Inversion (iFVG)",
    detects: "FVGs that get closed through and flip polarity; tracks the inverted zone ACTIVE→RETESTED→CONFIRMED",
    roles: ["direction", "setup", "execution"],
    lifecycle: "FVG born → price closes THROUGH it → iFVG born (opposite direction) → ACTIVE → RETESTED → CONFIRMED",
    api: {
      tick: "IFVGSM_{id}_Tick(lookback)",
      queries: [
        { fn: "IFVGSM_{id}_BullJustConfirmed()", returns: "bool", meaning: "Bull iFVG confirmed this bar" },
        { fn: "IFVGSM_{id}_BearJustConfirmed()", returns: "bool", meaning: "Bear iFVG confirmed this bar" },
        { fn: "IFVGSM_{id}_BullConfirmSL()",     returns: "double", meaning: "SL = retestLow at bull iFVG confirmation" },
        { fn: "IFVGSM_{id}_BearConfirmSL()",     returns: "double", meaning: "SL = retestHigh at bear iFVG confirmation" },
        { fn: "IFVGSM_{id}_HasActiveBull()",     returns: "bool", meaning: "A live bull iFVG zone exists" },
        { fn: "IFVGSM_{id}_HasActiveBear()",     returns: "bool", meaning: "A live bear iFVG zone exists" },
        { fn: "IFVGSM_{id}_LatestBullLL()",      returns: "double", meaning: "Lower limit of the most recent bull iFVG" },
        { fn: "IFVGSM_{id}_LatestBearUL()",      returns: "double", meaning: "Upper limit of the most recent bear iFVG" },
      ],
      params: [
        { name: "expiryBars", default: 100, meaning: "Bars before a zone expires" },
      ],
    },
    example: `// Direction: iFVG inversion confirmed on H1 sets bias
IFVGSM_H1_Tick(100);
if(IFVGSM_H1_BullJustConfirmed()) gBias = 1;
if(IFVGSM_H1_BearJustConfirmed()) gBias = -1;`,
  },

  // ── Order Block ───────────────────────────────────────────────────────────
  {
    id: "order_block",
    label: "Order Block",
    detects: "Last opposing candle before an ATR-displacement move; zone tracks ACTIVE→RETESTED→CONFIRMED",
    roles: ["setup", "execution"],
    lifecycle: "Displacement detected → last opposing candle is the OB → ACTIVE → RETESTED (wick enters) → CONFIRMED (close exits near edge)",
    api: {
      tick: "OBSM_{id}_Tick(lookback)",
      queries: [
        { fn: "OBSM_{id}_BullJustConfirmed()", returns: "bool", meaning: "Bull OB confirmed this bar" },
        { fn: "OBSM_{id}_BearJustConfirmed()", returns: "bool", meaning: "Bear OB confirmed this bar" },
        { fn: "OBSM_{id}_BullConfirmSL()",     returns: "double", meaning: "SL = retestLow at bull OB confirmation" },
        { fn: "OBSM_{id}_BearConfirmSL()",     returns: "double", meaning: "SL = retestHigh at bear OB confirmation" },
        { fn: "OBSM_{id}_HasActiveBull()",     returns: "bool", meaning: "A live bull OB zone exists" },
        { fn: "OBSM_{id}_HasActiveBear()",     returns: "bool", meaning: "A live bear OB zone exists" },
        { fn: "OBSM_{id}_LatestBullLL()",      returns: "double", meaning: "Lower limit of the most recent bull OB" },
        { fn: "OBSM_{id}_LatestBearUL()",      returns: "double", meaning: "Upper limit of the most recent bear OB" },
      ],
      params: [
        { name: "dispMult",   default: 0.6,  meaning: "Displacement: body must be >= dispMult * range" },
        { name: "scanBack",   default: 5,    meaning: "Bars before displacement to search for the OB candle" },
        { name: "expiryBars", default: 100,  meaning: "Bars before zone expires" },
      ],
    },
    example: `// Setup: OB active on H4 in bias direction
OBSM_H4_Tick(50);
if(OBSM_H4_HasActiveBull() && gBias == 1) { gSetupActive=true; gSetupSLHint=OBSM_H4_LatestBullLL(); }`,
  },

  // ── BOS ────────────────────────────────────────────────────────────────
  {
    id: "bos",
    label: "Break of Structure",
    detects: "Swing pivot formation + candle close beyond the pivot; sets persistent trend bias",
    roles: ["direction", "setup"],
    lifecycle: "Swing pivot confirmed → close breaks it → trend flips (persistent until opposite break)",
    api: {
      tick: "BOSSM_{id}_Tick(lookback)",
      queries: [
        { fn: "BOSSM_{id}_IsBull()",       returns: "bool", meaning: "Trend is currently BULL (persistent)" },
        { fn: "BOSSM_{id}_IsBear()",       returns: "bool", meaning: "Trend is currently BEAR (persistent)" },
        { fn: "BOSSM_{id}_BullJustBroke()", returns: "bool", meaning: "BOS BULL fired on this bar" },
        { fn: "BOSSM_{id}_BearJustBroke()", returns: "bool", meaning: "BOS BEAR fired on this bar" },
        { fn: "BOSSM_{id}_Trend()",        returns: "int",  meaning: "1=BULL, -1=BEAR, 0=UNKNOWN" },
      ],
      params: [
        { name: "swingLen", default: 5,  meaning: "Bars each side needed to confirm a pivot" },
        { name: "lookback", default: 20, meaning: "Bars to scan for swing levels" },
      ],
    },
    example: `// Direction: BOS on D1 sets the market bias
BOSSM_D1_Tick(50);
if(BOSSM_D1_IsBull()) gBias = 1;
else if(BOSSM_D1_IsBear()) gBias = -1;
else gBias = 0;`,
  },

  // ── CHoCH ──────────────────────────────────────────────────────────────
  {
    id: "choch",
    label: "Change of Character",
    detects: "Counter-trend structure break — only fires when price breaks AGAINST the current trend",
    roles: ["direction"],
    lifecycle: "Same as BOS but only fires on reversal breaks, not continuation breaks",
    api: {
      tick: "BOSSM_{id}_Tick(lookback)",
      queries: [
        { fn: "BOSSM_{id}_IsBull()",       returns: "bool", meaning: "Bias is BULL after a bull CHoCH" },
        { fn: "BOSSM_{id}_IsBear()",       returns: "bool", meaning: "Bias is BEAR after a bear CHoCH" },
        { fn: "BOSSM_{id}_BullJustBroke()", returns: "bool", meaning: "Bull CHoCH fired this bar (was bearish trend, now bullish)" },
        { fn: "BOSSM_{id}_BearJustBroke()", returns: "bool", meaning: "Bear CHoCH fired this bar" },
      ],
      params: [
        { name: "swingLen", default: 5, meaning: "Pivot confirmation bars" },
      ],
    },
    example: `// Direction: CHoCH on H4 for reversal bias
BOSSM_H4_Tick(50);  // generated with mode="choch"
if(BOSSM_H4_BullJustBroke()) gBias = 1;  // reversal confirmed bullish
if(BOSSM_H4_BearJustBroke()) gBias = -1;`,
  },

  // ── Liquidity Sweep ────────────────────────────────────────────────────
  {
    id: "liqsweep",
    label: "Liquidity Sweep",
    detects: "Wick pierces a swing extreme then closes back inside — the close-back IS the signal",
    roles: ["setup", "execution"],
    lifecycle: "Swing pivot confirmed → wick sweeps beyond it → SAME BAR close-back → CONFIRMED signal",
    api: {
      tick: "LSSM_{id}_Tick(lookback)",
      queries: [
        { fn: "LSSM_{id}_BullJustConfirmed()", returns: "bool", meaning: "Bull sweep confirmed — wick below swing low + close-back above" },
        { fn: "LSSM_{id}_BearJustConfirmed()", returns: "bool", meaning: "Bear sweep confirmed — wick above swing high + close-back below" },
        { fn: "LSSM_{id}_BullConfirmSL()",     returns: "double", meaning: "SL = wick low of the sweep candle" },
        { fn: "LSSM_{id}_BearConfirmSL()",     returns: "double", meaning: "SL = wick high of the sweep candle" },
      ],
      params: [
        { name: "swingLen", default: 3,  meaning: "Bars each side to confirm a pivot" },
        { name: "lookback", default: 20, meaning: "Bars to scan for swing levels" },
      ],
    },
    example: `// Execution: liquidity sweep entry on M5
LSSM_M5_Tick(30);
if(LSSM_M5_BullJustConfirmed() && gBias==1 && gSetupActive)
{ gExecSignal=true; gExecDir=1; gExecSL=LSSM_M5_BullConfirmSL(); }`,
  },

  // ── Engulfing candle ───────────────────────────────────────────────────
  {
    id: "engulfing",
    label: "Engulfing Candle",
    detects: "Strong reversal candle that fully engulfs the previous candle body",
    roles: ["execution"],
    lifecycle: "Point-in-time signal — fires on the bar the engulfing pattern completes",
    api: {
      tick: "(no state machine — inline check at bar-open)",
      queries: [
        { fn: "Inline check", returns: "bool", meaning: "c1>o1 && c2<o2 && c1>=o2 && o1<=c2 for bull; inverse for bear" },
      ],
      params: [],
    },
    example: `// Execution: engulfing entry aligned with bias
double o1=iOpen(InpSymbol,${"`"}${"{TF}"}${"`"},1), c1=iClose(InpSymbol,${"`"}${"{TF}"}${"`"},1);
double o2=iOpen(InpSymbol,${"`"}${"{TF}"}${"`"},2), c2=iClose(InpSymbol,${"`"}${"{TF}"}${"`"},2);
if(c1>o1 && c2<o2 && c1>=o2 && o1<=c2 && gBias==1 && gSetupActive)
{ gExecSignal=true; gExecDir=1; gExecSL=iLow(InpSymbol,${"`"}${"{TF}"}${"`"},1); }`,
  },

  // ── Pin Bar ────────────────────────────────────────────────────────────
  {
    id: "pin_bar",
    label: "Pin Bar",
    detects: "Long wick rejection candle (wick >= 60% of range, body <= 35%)",
    roles: ["execution"],
    lifecycle: "Point-in-time signal on the completed candle",
    api: {
      tick: "(no state machine — inline check at bar-open)",
      queries: [
        { fn: "Inline check", returns: "bool", meaning: "lwick >= range*0.6 && body <= range*0.35 for bull; uwick for bear" },
      ],
      params: [],
    },
    example: `// Execution: pin bar entry
double rng=h1-l1, body=MathAbs(c1-o1), lwick=MathMin(o1,c1)-l1;
if(lwick>=rng*0.6 && body<=rng*0.35 && gBias==1)
{ gExecSignal=true; gExecDir=1; gExecSL=l1; }`,
  },

  // ── EMA ───────────────────────────────────────────────────────────────
  {
    id: "ema",
    label: "EMA Alignment",
    detects: "Fast EMA vs slow EMA relative position for trend direction",
    roles: ["direction", "setup"],
    lifecycle: "Persistent alignment — fast>slow = BULL, fast<slow = BEAR",
    api: {
      tick: "(no state machine — inline rolling average)",
      queries: [
        { fn: "Inline check", returns: "int", meaning: "Calculate SMA(fast) vs SMA(slow) over last N bars" },
      ],
      params: [
        { name: "fastPeriod", default: 21, meaning: "Fast EMA period" },
        { name: "slowPeriod", default: 50, meaning: "Slow EMA period" },
      ],
    },
    example: `// Direction: EMA alignment on H4
double fast=0,slow=0;
for(int i=1;i<=50;i++){double c=iClose(InpSymbol,PERIOD_H4,i);if(i<=21)fast+=c;slow+=c;}
fast/=21.0; slow/=50.0;
gBias = (fast>slow) ? 1 : -1;`,
  },
];

// ─── Context string for Claude ────────────────────────────────────────────────

/**
 * Builds the system-prompt context string that tells Claude
 * exactly which state machines are available and how to use them.
 */
export function buildModuleLibraryContext(): string {
  const lines: string[] = [
    "=== INLINE STATE MACHINE LIBRARY ===",
    "",
    "These state machines are available for use in generated EA code.",
    "All are EMBEDDED INLINE in the EA — zero external dependencies.",
    "When you generate wiring code, use these exact function signatures.",
    "Replace {id} with a short TF label like H4, D1, M15.",
    "Replace {TF} with the MQL5 period constant like PERIOD_H4.",
    "",
    "IMPORTANT RULES FOR CODE GENERATION:",
    "1. Call each SM's Tick() once per bar-open inside the brain's bar-open check",
    "2. Read query functions AFTER Tick() — never before",
    "3. JustConfirmed() returns true for ONE bar only — do not cache it",
    "4. SL functions return the price level — always validate sl > 0",
    "5. Multiple SMs can run on the same TF — they share no state",
    "6. If a trader's description implies a specific threshold (e.g. 'use 30-bar swing'), pass it as a parameter",
    "",
  ];

  for (const m of MODULE_SPECS) {
    lines.push(`--- MODULE: ${m.label} (id="${m.id}") ---`);
    lines.push(`Detects: ${m.detects}`);
    lines.push(`Best for: ${m.roles.join(", ")} brain`);
    lines.push(`Lifecycle: ${m.lifecycle}`);
    lines.push(`Tick: ${m.api.tick}`);
    lines.push(`Query functions:`);
    for (const q of m.api.queries) {
      lines.push(`  ${q.fn} → ${q.returns}: ${q.meaning}`);
    }
    if (m.api.params.length > 0) {
      lines.push(`Configurable params (pass to genXxxSM()):`);
      for (const p of m.api.params) {
        lines.push(`  ${p.name} (default ${p.default}): ${p.meaning}`);
      }
    }
    lines.push(`Example:`);
    lines.push(m.example.split("\n").map(l => "  " + l).join("\n"));
    lines.push("");
  }

  lines.push("=== END OF MODULE LIBRARY ===");
  return lines.join("\n");
}
