/**
 * Module Library — The AI builder's vocabulary.
 *
 * This is NOT a user-facing file list.
 * This is what the AI reads to understand what can be built and how.
 *
 * When a trader writes any strategy description, Claude reads this manifest
 * to understand:
 *   - Which concepts the trader is describing (via aliases and example phrases)
 *   - Which brain role each concept suits best (and which roles it can also fill)
 *   - How to configure the module from the trader's words
 *   - What the module outputs and how to wire it into the confluence gate
 *
 * DESIGN PRINCIPLES:
 *   1. Modules are never installed by the user — logic is always inlined in the EA.
 *   2. The same module can serve different roles depending on context.
 *   3. The AI configures parameters from the description — never hardcodes defaults blindly.
 *   4. The final EA is always one self-contained file.
 */

export interface ModuleAlias {
  phrase: string;
  notes?: string;
}

export interface RoleSuitability {
  role: "direction" | "setup" | "execution";
  /** How naturally this module fits this role (primary = best fit, secondary = works well, possible = can work) */
  fit: "primary" | "secondary" | "possible";
  /** How the module's output is used in this role */
  usage: string;
}

export interface ConfigParam {
  name: string;
  type: "int" | "double" | "bool";
  default: number | boolean;
  range?: [number, number];
  description: string;
  /** Example phrases a trader might use to set this parameter */
  traderPhrases: string[];
}

export interface OutputState {
  name: string;
  meaning: string;
  tradingImplication: string;
}

export interface InlineApi {
  /** Function to call once per bar-open */
  tick: string;
  /** Functions to read after tick */
  signals: Array<{
    fn: string;
    returns: string;
    meaning: string;
  }>;
  /** Reset function called in OnInit */
  reset: string;
}

export interface ModuleSpec {
  id: string;
  label: string;
  /** All names and phrases a trader might use to refer to this concept */
  aliases: ModuleAlias[];
  /** One-line description of the concept */
  concept: string;
  /** Detailed explanation of what the module detects and how */
  detectionLogic: string;
  /** Which brain roles this module can fill */
  roles: RoleSuitability[];
  /** State machine lifecycle */
  lifecycle: string;
  /** Configurable parameters with trader vocabulary */
  params: ConfigParam[];
  /** Output states and their trading meaning */
  outputStates: OutputState[];
  /** Inline state machine API after genXxxSM(id, TF, tf) */
  inlineApi: InlineApi;
  /** Real trader phrases that would map to this module */
  examplePhrases: string[];
  /** When NOT to use this module */
  notSuitedFor: string[];
  /** Which modules it combines well with */
  combinesWith: string[];
}

export const MODULE_LIBRARY: ModuleSpec[] = [
  // ─── BOS ────────────────────────────────────────────────────────────────────
  {
    id: "bos",
    label: "Break of Structure",
    aliases: [
      { phrase: "BOS" },
      { phrase: "break of structure" },
      { phrase: "structure break" },
      { phrase: "break above resistance" },
      { phrase: "break below support" },
      { phrase: "higher high" },
      { phrase: "lower low" },
      { phrase: "structure continuation" },
      { phrase: "trend continuation break" },
    ],
    concept:
      "Detects when price closes beyond a confirmed swing high or low, signalling continuation of the current trend.",
    detectionLogic:
      "Identifies swing pivots (price must be higher/lower than N bars on both sides). When a candle CLOSES beyond an unconsumed pivot, a BOS fires and the trend state updates persistently. Each pivot can generate exactly one BOS — consumed pivots are never re-used.",
    roles: [
      {
        role: "direction",
        fit: "primary",
        usage: "BOS fires → trend direction set to BULL or BEAR. Persists until opposite BOS.",
      },
      {
        role: "setup",
        fit: "secondary",
        usage: "Fresh BOS in bias direction means momentum is active — valid setup zone.",
      },
      {
        role: "execution",
        fit: "possible",
        usage: "Enter on the BOS bar itself if risk allows — break-and-go entry.",
      },
    ],
    lifecycle:
      "Swing pivot formed → price closes beyond it → BOS fires (one-time event) → trend bias updated persistently",
    params: [
      {
        name: "swingLen",
        type: "int",
        default: 5,
        range: [2, 20],
        description: "Bars on each side needed to confirm a pivot high/low",
        traderPhrases: ["5-bar pivot", "use 3 bars each side", "strict pivots", "loose pivots"],
      },
      {
        name: "lookback",
        type: "int",
        default: 20,
        range: [10, 100],
        description: "How many bars back to scan for swing levels",
        traderPhrases: ["last 20 bars", "look back 30 bars", "recent structure only"],
      },
    ],
    outputStates: [
      {
        name: "IsBull()",
        meaning: "Trend is currently BULL",
        tradingImplication: "Only take buy setups",
      },
      {
        name: "IsBear()",
        meaning: "Trend is currently BEAR",
        tradingImplication: "Only take sell setups",
      },
      {
        name: "BullJustBroke()",
        meaning: "BOS BULL fired on this exact bar",
        tradingImplication: "Fresh momentum — immediate entry or start watching for setup",
      },
      {
        name: "BearJustBroke()",
        meaning: "BOS BEAR fired on this exact bar",
        tradingImplication: "Fresh momentum — immediate entry or start watching for setup",
      },
    ],
    inlineApi: {
      tick: "BOSSM_{id}_Tick(lookback)",
      signals: [
        { fn: "BOSSM_{id}_IsBull()", returns: "bool", meaning: "Trend is BULL (persistent)" },
        { fn: "BOSSM_{id}_IsBear()", returns: "bool", meaning: "Trend is BEAR (persistent)" },
        { fn: "BOSSM_{id}_BullJustBroke()", returns: "bool", meaning: "BOS BULL fired this bar" },
        { fn: "BOSSM_{id}_BearJustBroke()", returns: "bool", meaning: "BOS BEAR fired this bar" },
        { fn: "BOSSM_{id}_Trend()", returns: "int", meaning: "1=BULL, -1=BEAR, 0=UNKNOWN" },
      ],
      reset: "BOSSM_{id}_Reset()",
    },
    examplePhrases: [
      "Use BOS on D1 for direction",
      "I want to trade in the direction of the H4 break of structure",
      "Enter after BOS on M15 in the direction of the D1 trend",
      "Bias is set by the daily structure break",
      "Use higher highs and higher lows on H4 to define the trend",
    ],
    notSuitedFor: ["Ranging/consolidating markets without clear swings"],
    combinesWith: ["fvg", "order_block", "fvg_inversion", "liqsweep"],
  },

  // ─── CHoCH ──────────────────────────────────────────────────────────────────
  {
    id: "choch",
    label: "Change of Character",
    aliases: [
      { phrase: "CHoCH" },
      { phrase: "change of character" },
      { phrase: "reversal signal" },
      { phrase: "structure reversal" },
      { phrase: "market structure shift", notes: "MSS is essentially CHoCH" },
      { phrase: "MSS" },
      { phrase: "trend reversal break" },
      { phrase: "flip in structure" },
      { phrase: "counter-trend break" },
    ],
    concept:
      "Fires ONLY when price breaks structure AGAINST the current trend — a signal that the trend may be reversing.",
    detectionLogic:
      "Same swing pivot detection as BOS. But CHoCH fires ONLY on counter-trend breaks: in a BEAR trend, a close above a swing high = Bull CHoCH. In a BULL trend, a close below a swing low = Bear CHoCH. With-trend breaks are silently consumed (not drawn). This filters noise and highlights genuine reversals.",
    roles: [
      {
        role: "direction",
        fit: "primary",
        usage: "CHoCH fires → direction flips. Trade the new direction until next CHoCH.",
      },
      {
        role: "setup",
        fit: "possible",
        usage: "Fresh CHoCH near key level = high-probability reversal setup.",
      },
    ],
    lifecycle:
      "Trend established → counter-trend break fires CHoCH → trend flips to opposite direction",
    params: [
      {
        name: "swingLen",
        type: "int",
        default: 5,
        range: [2, 20],
        description: "Pivot confirmation bars",
        traderPhrases: ["5-bar pivots", "use swing strength of 3"],
      },
    ],
    outputStates: [
      {
        name: "IsBull()",
        meaning: "After bull CHoCH — now looking for buys",
        tradingImplication: "Bias is BULL",
      },
      {
        name: "IsBear()",
        meaning: "After bear CHoCH — now looking for sells",
        tradingImplication: "Bias is BEAR",
      },
      {
        name: "BullJustBroke()",
        meaning: "Bull CHoCH fired this bar",
        tradingImplication: "Trend just flipped bullish — start fresh",
      },
      {
        name: "BearJustBroke()",
        meaning: "Bear CHoCH fired this bar",
        tradingImplication: "Trend just flipped bearish",
      },
    ],
    inlineApi: {
      tick: "BOSSM_{id}_Tick(lookback)  // generated with mode='choch'",
      signals: [
        { fn: "BOSSM_{id}_IsBull()", returns: "bool", meaning: "Bias is BULL (post CHoCH)" },
        { fn: "BOSSM_{id}_IsBear()", returns: "bool", meaning: "Bias is BEAR (post CHoCH)" },
        { fn: "BOSSM_{id}_BullJustBroke()", returns: "bool", meaning: "CHoCH BULL fired this bar" },
        { fn: "BOSSM_{id}_BearJustBroke()", returns: "bool", meaning: "CHoCH BEAR fired this bar" },
      ],
      reset: "BOSSM_{id}_Reset()",
    },
    examplePhrases: [
      "Use CHoCH on H4 for direction",
      "Enter when market structure shifts bullish on D1",
      "Trade reversals confirmed by MSS",
      "Only enter after a change of character in the HTF",
      "I want to catch the first CHoCH after a trend reversal",
    ],
    notSuitedFor: ["Trending markets where continuation is the strategy"],
    combinesWith: ["fvg", "order_block", "liqsweep"],
  },

  // ─── FVG ────────────────────────────────────────────────────────────────────
  {
    id: "fvg",
    label: "Fair Value Gap",
    aliases: [
      { phrase: "FVG" },
      { phrase: "fair value gap" },
      { phrase: "imbalance" },
      { phrase: "price imbalance" },
      { phrase: "gap" },
      { phrase: "inefficiency" },
      { phrase: "price inefficiency" },
      { phrase: "3-candle gap" },
      { phrase: "bullish FVG" },
      { phrase: "bearish FVG" },
      { phrase: "retest the gap" },
      { phrase: "fill the gap" },
      { phrase: "mitigate the imbalance" },
    ],
    concept:
      "A 3-candle imbalance where C3.Low > C1.High (bull) or C3.High < C1.Low (bear). Tracks the zone from formation through retest and confirmation.",
    detectionLogic:
      "Scans each bar for a 3-candle formation where candle 3's low is above candle 1's high (bullish gap) or candle 3's high is below candle 1's low (bearish gap). Zone is stored with its upper limit (UL) and lower limit (LL). State machine tracks: ACTIVE (gap born) → RETESTED (wick enters zone) → CONFIRMED (close exits back outside near edge). Terminal states: MITIGATED (close inside zone), INVALIDATED (close through far edge), EXPIRED (too old).",
    roles: [
      {
        role: "setup",
        fit: "primary",
        usage:
          "Active FVG in bias direction = there is a zone to retest. Setup is active while zone is ACTIVE or RETESTED.",
      },
      {
        role: "execution",
        fit: "primary",
        usage: "FVG CONFIRMED = price retested the zone and held. Entry fires on confirmation bar.",
      },
      {
        role: "direction",
        fit: "possible",
        usage: "Recent FVG direction can indicate short-term momentum bias.",
      },
    ],
    lifecycle:
      "3-candle gap formed → ACTIVE → wick enters zone → RETESTED → close holds outside near edge → CONFIRMED | MITIGATED | INVALIDATED | EXPIRED",
    params: [
      {
        name: "expiryBars",
        type: "int",
        default: 100,
        range: [10, 500],
        description: "Bars before an unmitigated FVG expires",
        traderPhrases: ["expire after 50 bars", "use only recent FVGs", "keep FVGs for 200 bars"],
      },
    ],
    outputStates: [
      {
        name: "HasActiveBull()",
        meaning: "A bull FVG zone exists and has not been mitigated/invalidated",
        tradingImplication: "Setup zone present — watch for retest",
      },
      {
        name: "HasActiveBear()",
        meaning: "A bear FVG zone is live",
        tradingImplication: "Setup zone present",
      },
      {
        name: "BullJustConfirmed()",
        meaning: "Bull FVG retested and confirmed this bar",
        tradingImplication: "ENTRY SIGNAL — price respected the gap and bounced",
      },
      {
        name: "BearJustConfirmed()",
        meaning: "Bear FVG confirmed this bar",
        tradingImplication: "ENTRY SIGNAL",
      },
      {
        name: "BullConfirmSL()",
        meaning: "SL price = lowest wick during the retest",
        tradingImplication: "Use as stop-loss for the entry",
      },
      {
        name: "BearConfirmSL()",
        meaning: "SL price = highest wick during the retest",
        tradingImplication: "Use as stop-loss",
      },
    ],
    inlineApi: {
      tick: "FVGSM_{id}_Tick(lookback)",
      signals: [
        { fn: "FVGSM_{id}_HasActiveBull()", returns: "bool", meaning: "Live bull FVG zone" },
        { fn: "FVGSM_{id}_HasActiveBear()", returns: "bool", meaning: "Live bear FVG zone" },
        {
          fn: "FVGSM_{id}_BullJustConfirmed()",
          returns: "bool",
          meaning: "Bull FVG confirmed — entry signal",
        },
        {
          fn: "FVGSM_{id}_BearJustConfirmed()",
          returns: "bool",
          meaning: "Bear FVG confirmed — entry signal",
        },
        { fn: "FVGSM_{id}_BullConfirmSL()", returns: "double", meaning: "SL for bull entries" },
        { fn: "FVGSM_{id}_BearConfirmSL()", returns: "double", meaning: "SL for bear entries" },
      ],
      reset: "FVGSM_{id}_Reset()",
    },
    examplePhrases: [
      "Enter when price comes back to fill the FVG",
      "Use fair value gap retest as my entry",
      "Wait for price to retest the imbalance and confirm",
      "Setup is the FVG on H4, entry is M15 candle closing back above the gap",
      "FVG on H1 for setup, engulfing on M5 for execution",
      "Trade the gap fill after a BOS",
    ],
    notSuitedFor: ["Very fast scalping timeframes where gaps close too quickly"],
    combinesWith: ["bos", "choch", "order_block", "fvg_inversion", "liqsweep", "engulfing"],
  },

  // ─── FVG Inversion ──────────────────────────────────────────────────────────
  {
    id: "fvg_inversion",
    label: "FVG Inversion (iFVG)",
    aliases: [
      { phrase: "FVG inversion" },
      { phrase: "iFVG" },
      { phrase: "inverted FVG" },
      { phrase: "inverted fair value gap" },
      { phrase: "IFVG" },
      { phrase: "polarity flip" },
      { phrase: "gap flip" },
      { phrase: "imbalance inversion" },
      { phrase: "bullish inversion FVG" },
      { phrase: "bearish inversion FVG" },
    ],
    concept:
      "A FVG that price closes THROUGH — flipping its polarity. A bullish FVG that gets closed below becomes a bearish iFVG (resistance). A bearish FVG closed above becomes a bullish iFVG (support).",
    detectionLogic:
      "First detects all FVGs. Then monitors for close-through events: bull FVG closed below LL → bear iFVG born. Bear FVG closed above UL → bull iFVG born. The inverted zone then tracks ACTIVE → RETESTED → CONFIRMED as the price returns to it from the new direction.",
    roles: [
      {
        role: "direction",
        fit: "primary",
        usage: "iFVG confirmed = polarity flip confirmed. Sets directional bias.",
      },
      {
        role: "setup",
        fit: "primary",
        usage: "Active iFVG zone = setup waiting for retest entry.",
      },
      {
        role: "execution",
        fit: "primary",
        usage: "iFVG CONFIRMED = high-probability entry after polarity-flip retest.",
      },
    ],
    lifecycle:
      "FVG formed → price closes THROUGH it → iFVG born (opposite direction) → ACTIVE → RETESTED → CONFIRMED",
    params: [
      {
        name: "expiryBars",
        type: "int",
        default: 100,
        range: [10, 500],
        description: "Bars before iFVG expires",
        traderPhrases: ["50-bar expiry", "expire old iFVGs after 100 bars"],
      },
    ],
    outputStates: [
      {
        name: "HasActiveBull()",
        meaning: "A bull iFVG zone is live",
        tradingImplication: "Polarity support zone present — wait for retest",
      },
      {
        name: "HasActiveBear()",
        meaning: "A bear iFVG zone is live",
        tradingImplication: "Polarity resistance zone present",
      },
      {
        name: "BullJustConfirmed()",
        meaning: "Bull iFVG retested and confirmed",
        tradingImplication: "ENTRY — zone held after polarity flip",
      },
      { name: "BearJustConfirmed()", meaning: "Bear iFVG confirmed", tradingImplication: "ENTRY" },
      {
        name: "BullConfirmSL()",
        meaning: "Retest low — use as SL",
        tradingImplication: "Tight SL at zone boundary",
      },
      {
        name: "BearConfirmSL()",
        meaning: "Retest high — use as SL",
        tradingImplication: "Tight SL at zone boundary",
      },
    ],
    inlineApi: {
      tick: "IFVGSM_{id}_Tick(1)",
      signals: [
        {
          fn: "IFVGSM_{id}_BullJustInverted()",
          returns: "bool",
          meaning: "Bull iFVG formed this bar: bearish FVG closed above its upper boundary",
        },
        {
          fn: "IFVGSM_{id}_BearJustInverted()",
          returns: "bool",
          meaning: "Bear iFVG formed this bar: bullish FVG closed below its lower boundary",
        },
        {
          fn: "IFVGSM_{id}_BullInversionSL()",
          returns: "double",
          meaning: "SL anchor from bull iFVG formation bar",
        },
        {
          fn: "IFVGSM_{id}_BearInversionSL()",
          returns: "double",
          meaning: "SL anchor from bear iFVG formation bar",
        },
        {
          fn: "IFVGSM_{id}_BullInversionTime()",
          returns: "datetime",
          meaning: "Formation time for the bull iFVG that was born this bar",
        },
        {
          fn: "IFVGSM_{id}_BearInversionTime()",
          returns: "datetime",
          meaning: "Formation time for the bear iFVG that was born this bar",
        },
        { fn: "IFVGSM_{id}_HasActiveBull()", returns: "bool", meaning: "Live bull iFVG zone" },
        { fn: "IFVGSM_{id}_HasActiveBear()", returns: "bool", meaning: "Live bear iFVG zone" },
        {
          fn: "IFVGSM_{id}_BullJustConfirmed()",
          returns: "bool",
          meaning: "Bull iFVG confirmed — entry",
        },
        {
          fn: "IFVGSM_{id}_BearJustConfirmed()",
          returns: "bool",
          meaning: "Bear iFVG confirmed — entry",
        },
        { fn: "IFVGSM_{id}_BullConfirmSL()", returns: "double", meaning: "SL for bull entries" },
        { fn: "IFVGSM_{id}_BearConfirmSL()", returns: "double", meaning: "SL for bear entries" },
        {
          fn: "IFVGSM_{id}_LatestBullLL()",
          returns: "double",
          meaning: "Lower limit of the most recent bull iFVG",
        },
        {
          fn: "IFVGSM_{id}_LatestBearUL()",
          returns: "double",
          meaning: "Upper limit of the most recent bear iFVG",
        },
        {
          fn: "IFVGSM_{id}_LatestBullInversionTime()",
          returns: "datetime",
          meaning: "When the latest bull iFVG formed; use for 'only after X' gates",
        },
        {
          fn: "IFVGSM_{id}_LatestBearInversionTime()",
          returns: "datetime",
          meaning: "When the latest bear iFVG formed; use for 'only after X' gates",
        },
        {
          fn: "IFVGSM_{id}_BullConfirmTime()",
          returns: "datetime",
          meaning: "Confirmation bar time for the current bull iFVG signal",
        },
        {
          fn: "IFVGSM_{id}_BearConfirmTime()",
          returns: "datetime",
          meaning: "Confirmation bar time for the current bear iFVG signal",
        },
      ],
      reset: "IFVGSM_{id}_Reset()",
    },
    examplePhrases: [
      "Enter on iFVG confirmation",
      "Trade the inverted FVG after polarity flip",
      "Wait for the gap to flip and then retest",
      "Use EMA for direction and iFVG for entry",
      "I want to enter when the bearish FVG flips bullish and price retests it",
      "iFVG as execution trigger after BOS sets direction",
    ],
    notSuitedFor: ["Traders who only want standard gap fills without polarity context"],
    combinesWith: ["bos", "choch", "ema", "order_block"],
  },

  // ─── Order Block ────────────────────────────────────────────────────────────
  {
    id: "order_block",
    label: "Order Block",
    aliases: [
      { phrase: "OB" },
      { phrase: "order block" },
      { phrase: "institutional candle" },
      { phrase: "last bearish candle before rally" },
      { phrase: "last bullish candle before drop" },
      { phrase: "supply zone" },
      { phrase: "demand zone" },
      { phrase: "institutional zone" },
      { phrase: "displacement zone" },
      { phrase: "origin of the move" },
    ],
    concept:
      "The last opposing candle before a strong ATR-displacement move. Represents institutional order flow. Tracks the zone through ACTIVE → RETESTED → CONFIRMED.",
    detectionLogic:
      "Identifies displacement moves: candles where body >= dispMult × candle range. Then looks back up to scanBack bars for the last candle moving in the opposite direction — this is the OB. Zone is UL = OB high, LL = OB low. Lifecycle mirrors FVG: ACTIVE until retested, CONFIRMED after close holds outside near edge, MITIGATED if close trades inside zone.",
    roles: [
      {
        role: "setup",
        fit: "primary",
        usage:
          "Active OB in bias direction = institutional zone to watch. Setup active while OB is live.",
      },
      {
        role: "execution",
        fit: "primary",
        usage:
          "OB CONFIRMED = price retested the zone and institutional orders held. Entry signal.",
      },
      {
        role: "direction",
        fit: "possible",
        usage: "Strong OB with large displacement indicates directional momentum.",
      },
    ],
    lifecycle:
      "Displacement detected → last opposing candle becomes OB zone → ACTIVE → RETESTED → CONFIRMED | MITIGATED | INVALIDATED | EXPIRED",
    params: [
      {
        name: "dispMult",
        type: "double",
        default: 0.6,
        range: [0.4, 0.9],
        description: "Body must be >= dispMult × candle range to count as displacement",
        traderPhrases: [
          "strong displacement candles only",
          "use 70% body filter",
          "looser displacement filter",
        ],
      },
      {
        name: "scanBack",
        type: "int",
        default: 5,
        range: [1, 10],
        description: "Bars before displacement to look for the OB candle",
        traderPhrases: ["look 3 bars before the move", "scan back 5 candles"],
      },
      {
        name: "expiryBars",
        type: "int",
        default: 100,
        range: [10, 500],
        description: "Bars before OB expires",
        traderPhrases: ["expire after 50 bars", "keep OBs for 200 bars"],
      },
    ],
    outputStates: [
      {
        name: "HasActiveBull()",
        meaning: "A bull OB zone is live",
        tradingImplication: "Demand zone present",
      },
      {
        name: "HasActiveBear()",
        meaning: "A bear OB zone is live",
        tradingImplication: "Supply zone present",
      },
      {
        name: "BullJustConfirmed()",
        meaning: "Bull OB retested and confirmed",
        tradingImplication: "ENTRY — institutional demand held",
      },
      {
        name: "BearJustConfirmed()",
        meaning: "Bear OB confirmed",
        tradingImplication: "ENTRY — institutional supply held",
      },
      {
        name: "BullConfirmSL()",
        meaning: "SL below the OB (OB low)",
        tradingImplication: "Place SL below zone",
      },
      {
        name: "BearConfirmSL()",
        meaning: "SL above the OB (OB high)",
        tradingImplication: "Place SL above zone",
      },
    ],
    inlineApi: {
      tick: "OBSM_{id}_Tick(lookback)",
      signals: [
        { fn: "OBSM_{id}_HasActiveBull()", returns: "bool", meaning: "Live bull OB" },
        { fn: "OBSM_{id}_HasActiveBear()", returns: "bool", meaning: "Live bear OB" },
        {
          fn: "OBSM_{id}_BullJustConfirmed()",
          returns: "bool",
          meaning: "Bull OB confirmed — entry",
        },
        {
          fn: "OBSM_{id}_BearJustConfirmed()",
          returns: "bool",
          meaning: "Bear OB confirmed — entry",
        },
        { fn: "OBSM_{id}_BullConfirmSL()", returns: "double", meaning: "SL for bull entries" },
        { fn: "OBSM_{id}_BearConfirmSL()", returns: "double", meaning: "SL for bear entries" },
        {
          fn: "OBSM_{id}_LatestBullLL()",
          returns: "double",
          meaning: "Lower limit of most recent bull OB",
        },
        {
          fn: "OBSM_{id}_LatestBearUL()",
          returns: "double",
          meaning: "Upper limit of most recent bear OB",
        },
      ],
      reset: "OBSM_{id}_Reset()",
    },
    examplePhrases: [
      "Enter when price retests the order block",
      "Use the OB on H4 as my setup zone",
      "I trade demand and supply zones from displacement",
      "Setup is the last bearish candle before the bullish move",
      "Enter at the origin of the displacement move",
      "BOS on D1 for bias, order block on H4 for setup, entry on M15 FVG",
    ],
    notSuitedFor: ["Very fast scalping where OBs form and expire too quickly"],
    combinesWith: ["bos", "choch", "fvg", "liqsweep"],
  },

  // ─── OB + FVG (combination) ──────────────────────────────────────────────────
  {
    id: "ob_fvg",
    label: "OB + FVG",
    aliases: [
      { phrase: "OB+FVG" },
      { phrase: "OB and FVG" },
      { phrase: "order block with fair value gap" },
      { phrase: "order block FVG" },
      { phrase: "OB FVG combo" },
      { phrase: "FVG with order block" },
      { phrase: "high probability order block" },
    ],
    concept:
      "A high-probability confluence: a Fair Value Gap whose FIRST candle is the opposite colour to the gap — that first candle is the order block. Entry is at the OB body.",
    detectionLogic:
      "Scans 3-candle FVGs (C1 oldest, C3 newest). A bullish OB+FVG is a bullish gap (high(C1) < low(C3)) where C1 is bearish; a bearish OB+FVG is a bearish gap (low(C1) > high(C3)) where C1 is bullish. The OB = C1's body. Only FRESH zones count — a zone is consumed the instant price tests the OB body (a wick into it). Entry fires on that tap; SL = the OB candle's low (bull) / high (bear).",
    roles: [
      {
        role: "setup",
        fit: "primary",
        usage:
          "A fresh OB+FVG zone in the bias direction is the setup; HasActiveBull/Bear means a zone is waiting.",
      },
      {
        role: "execution",
        fit: "primary",
        usage: "Entry triggers when price taps the OB body (BullJustConfirmed/BearJustConfirmed).",
      },
    ],
    lifecycle:
      "OB+FVG forms (fresh) → ACTIVE while untouched → CONSUMED when price taps the OB body (entry) | EXPIRED after expiryBars",
    params: [
      {
        name: "expiryBars",
        type: "int",
        default: 250,
        range: [20, 600],
        description: "Bars before an untested zone expires",
        traderPhrases: [],
      },
    ],
    outputStates: [
      {
        name: "HasActiveBull()",
        meaning: "A fresh bullish OB+FVG zone exists",
        tradingImplication: "Setup armed — watch for a tap of the OB body",
      },
      {
        name: "HasActiveBear()",
        meaning: "A fresh bearish OB+FVG zone exists",
        tradingImplication: "Setup armed — watch for a tap of the OB body",
      },
      {
        name: "BullJustConfirmed()",
        meaning: "Price tapped a bullish OB body",
        tradingImplication: "ENTRY LONG at the OB",
      },
      {
        name: "BearJustConfirmed()",
        meaning: "Price tapped a bearish OB body",
        tradingImplication: "ENTRY SHORT at the OB",
      },
      {
        name: "BullConfirmSL()",
        meaning: "The OB candle low",
        tradingImplication: "SL below the order block",
      },
      {
        name: "BearConfirmSL()",
        meaning: "The OB candle high",
        tradingImplication: "SL above the order block",
      },
    ],
    inlineApi: {
      tick: "OBFVGSM_{id}_Tick(lookback)",
      signals: [
        {
          fn: "OBFVGSM_{id}_HasActiveBull()",
          returns: "bool",
          meaning: "Fresh bullish OB+FVG zone",
        },
        {
          fn: "OBFVGSM_{id}_HasActiveBear()",
          returns: "bool",
          meaning: "Fresh bearish OB+FVG zone",
        },
        {
          fn: "OBFVGSM_{id}_BullJustConfirmed()",
          returns: "bool",
          meaning: "OB body tapped — long entry",
        },
        {
          fn: "OBFVGSM_{id}_BearJustConfirmed()",
          returns: "bool",
          meaning: "OB body tapped — short entry",
        },
        {
          fn: "OBFVGSM_{id}_BullConfirmSL()",
          returns: "double",
          meaning: "SL below the OB (entry)",
        },
        {
          fn: "OBFVGSM_{id}_BearConfirmSL()",
          returns: "double",
          meaning: "SL above the OB (entry)",
        },
        {
          fn: "OBFVGSM_{id}_ActiveBullSL()",
          returns: "double",
          meaning: "Freshest live bull zone OB low (setup SL hint)",
        },
        {
          fn: "OBFVGSM_{id}_ActiveBearSL()",
          returns: "double",
          meaning: "Freshest live bear zone OB high (setup SL hint)",
        },
      ],
      reset: "OBFVGSM_{id}_Reset()",
    },
    examplePhrases: [
      "Enter at the OB+FVG on M15",
      "Order block with a fair value gap for my setup",
      "BOS on H4, OB+FVG entry on M15",
      "High probability order block that has an FVG",
    ],
    notSuitedFor: ["Direction bias — it is a setup/entry zone, not a trend signal"],
    combinesWith: ["bos", "choch", "ema", "liqsweep"],
  },

  // ─── Liquidity Sweep ────────────────────────────────────────────────────────
  {
    id: "liqsweep",
    label: "Liquidity Sweep",
    aliases: [
      { phrase: "liquidity sweep" },
      { phrase: "stop hunt" },
      { phrase: "sweep" },
      { phrase: "liquidity grab" },
      { phrase: "equal highs sweep" },
      { phrase: "equal lows sweep" },
      { phrase: "run the stops" },
      { phrase: "wick beyond swing" },
      { phrase: "false break" },
      { phrase: "spring" },
      { phrase: "upthrust" },
      { phrase: "hunt the stops then reverse" },
    ],
    concept:
      "Price wicks beyond a swing extreme (sweeping liquidity/stops), then closes back inside. The close-back IS the confirmation signal.",
    detectionLogic:
      "Confirms swing pivots. When a candle's wick pierces a swing level AND the SAME candle closes back on the correct side, a CONFIRMED sweep fires immediately. The wick extreme becomes the SL. No waiting for a separate retest candle — the close-back is the entry signal.",
    roles: [
      {
        role: "execution",
        fit: "primary",
        usage: "Sweep CONFIRMED = immediate entry signal. SL at wick extreme.",
      },
      {
        role: "setup",
        fit: "secondary",
        usage: "Sweep sets context that liquidity has been cleared — setup for continuation.",
      },
    ],
    lifecycle:
      "Swing pivot confirmed → wick sweeps beyond it → SAME BAR close-back → CONFIRMED (SL = wick extreme)",
    params: [
      {
        name: "swingLen",
        type: "int",
        default: 3,
        range: [2, 10],
        description: "Bars each side to confirm a swing pivot",
        traderPhrases: ["use 3-bar pivots", "strict swing confirmation"],
      },
      {
        name: "lookback",
        type: "int",
        default: 20,
        range: [5, 50],
        description: "Bars to scan for swing levels",
        traderPhrases: ["recent swings only", "look back 30 bars"],
      },
    ],
    outputStates: [
      {
        name: "BullJustConfirmed()",
        meaning: "Bull sweep: wick below swing low + close above it",
        tradingImplication: "ENTRY LONG — stops hunted, now go up",
      },
      {
        name: "BearJustConfirmed()",
        meaning: "Bear sweep: wick above swing high + close below it",
        tradingImplication: "ENTRY SHORT — stops hunted, now go down",
      },
      {
        name: "BullConfirmSL()",
        meaning: "Wick low of the sweep candle",
        tradingImplication: "Tight SL — place just below the wick",
      },
      {
        name: "BearConfirmSL()",
        meaning: "Wick high of the sweep candle",
        tradingImplication: "Tight SL — place just above the wick",
      },
    ],
    inlineApi: {
      tick: "LSSM_{id}_Tick(lookback)",
      signals: [
        { fn: "LSSM_{id}_BullJustConfirmed()", returns: "bool", meaning: "Bull sweep confirmed" },
        { fn: "LSSM_{id}_BearJustConfirmed()", returns: "bool", meaning: "Bear sweep confirmed" },
        { fn: "LSSM_{id}_BullConfirmSL()", returns: "double", meaning: "SL = wick low" },
        { fn: "LSSM_{id}_BearConfirmSL()", returns: "double", meaning: "SL = wick high" },
      ],
      reset: "LSSM_{id}_Reset()",
    },
    examplePhrases: [
      "Enter after the liquidity sweep",
      "Trade the stop hunt and reversal",
      "Wait for equal lows to be swept then enter long",
      "Enter when the wick sweeps below the swing low and closes back above",
      "I trade sweeps of previous highs/lows",
      "Liquidity sweep on M5 as my execution signal",
    ],
    notSuitedFor: ["Trending markets with little consolidation/swing structure"],
    combinesWith: ["bos", "choch", "fvg", "order_block"],
  },

  // ─── SNR (Classic Support/Resistance) ─────────────────────────────────────────
  {
    id: "snr",
    label: "Support / Resistance",
    aliases: [
      { phrase: "support and resistance" },
      { phrase: "S/R" },
      { phrase: "SNR" },
      { phrase: "support level" },
      { phrase: "resistance level" },
      { phrase: "horizontal level" },
      { phrase: "key level" },
      { phrase: "price level" },
      { phrase: "bounce off support" },
      { phrase: "reject off resistance" },
    ],
    concept:
      "Horizontal support/resistance levels from candle-pair reversals; tracks each level ACTIVE→RETESTED→CONFIRMED.",
    detectionLogic:
      "A bullish candle followed by a bearish candle marks the first candle's close as RESISTANCE. A bearish candle followed by a bullish candle marks it as SUPPORT. The level is then watched: RETESTED when a wick reaches it, CONFIRMED when a close holds on the correct side, BROKEN when a close pushes through.",
    roles: [
      {
        role: "setup",
        fit: "primary",
        usage: "Active level near price = setup zone in the bias direction.",
      },
      {
        role: "execution",
        fit: "primary",
        usage: "Level CONFIRMED = price respected support/resistance → entry.",
      },
      {
        role: "direction",
        fit: "possible",
        usage: "Price above/below a major level can indicate bias.",
      },
    ],
    lifecycle:
      "Candle-pair forms level → ACTIVE → RETESTED (wick touches) → CONFIRMED (close holds) | BROKEN | EXPIRED",
    params: [
      {
        name: "lookback",
        type: "int",
        default: 20,
        range: [5, 200],
        description: "Bars scanned for new levels each tick",
        traderPhrases: ["recent levels only", "look back 30 bars"],
      },
      {
        name: "expiryBars",
        type: "int",
        default: 100,
        range: [10, 500],
        description: "Bars before an untouched level expires",
        traderPhrases: ["keep levels for 200 bars"],
      },
    ],
    outputStates: [
      {
        name: "HasActiveBull()",
        meaning: "A live support level exists",
        tradingImplication: "Watch for a bounce",
      },
      {
        name: "HasActiveBear()",
        meaning: "A live resistance level exists",
        tradingImplication: "Watch for a rejection",
      },
      {
        name: "BullJustConfirmed()",
        meaning: "Support held this bar",
        tradingImplication: "ENTRY LONG — buyers defended the level",
      },
      {
        name: "BearJustConfirmed()",
        meaning: "Resistance held this bar",
        tradingImplication: "ENTRY SHORT — sellers defended the level",
      },
      {
        name: "BullConfirmSL()",
        meaning: "Retest low — SL below support",
        tradingImplication: "SL just under the level",
      },
      {
        name: "BearConfirmSL()",
        meaning: "Retest high — SL above resistance",
        tradingImplication: "SL just above the level",
      },
    ],
    inlineApi: {
      tick: "SNRSM_{id}_Tick(lookback)",
      signals: [
        { fn: "SNRSM_{id}_HasActiveBull()", returns: "bool", meaning: "Live support level" },
        { fn: "SNRSM_{id}_HasActiveBear()", returns: "bool", meaning: "Live resistance level" },
        { fn: "SNRSM_{id}_BullJustConfirmed()", returns: "bool", meaning: "Support held — entry" },
        {
          fn: "SNRSM_{id}_BearJustConfirmed()",
          returns: "bool",
          meaning: "Resistance held — entry",
        },
        { fn: "SNRSM_{id}_BullConfirmSL()", returns: "double", meaning: "SL below support" },
        { fn: "SNRSM_{id}_BearConfirmSL()", returns: "double", meaning: "SL above resistance" },
      ],
      reset: "SNRSM_{id}_Reset()",
    },
    examplePhrases: [
      "Buy when price bounces off support",
      "Sell at resistance on H4",
      "Enter when a key level holds",
      "Use support and resistance on H1 for setup, FVG on M15 for entry",
      "Trade rejections at horizontal levels",
    ],
    notSuitedFor: ["Strong trending markets that blow through levels"],
    combinesWith: ["bos", "ema", "fvg", "engulfing", "pin_bar"],
  },

  // ─── Gap SNR (continuation S/R) ───────────────────────────────────────────────
  {
    id: "gap_snr",
    label: "Gap S/R",
    aliases: [
      { phrase: "gap S/R" },
      { phrase: "gap support resistance" },
      { phrase: "open-close level" },
      { phrase: "kissing candle" },
      { phrase: "DMB", notes: "Drop-Momentum-Base / open-close S/R" },
      { phrase: "momentum level" },
      { phrase: "continuation level" },
    ],
    concept:
      "Horizontal levels from candle-pair CONTINUATION (same-direction pair). Same lifecycle as Classic S/R, different detection.",
    detectionLogic:
      "Two consecutive bullish candles mark the first candle's close as SUPPORT (gap support). Two consecutive bearish candles mark it as RESISTANCE. Tracks each level ACTIVE→RETESTED→CONFIRMED, BROKEN when a close pushes through.",
    roles: [
      {
        role: "setup",
        fit: "primary",
        usage: "Active gap level near price = momentum setup zone in bias direction.",
      },
      {
        role: "execution",
        fit: "primary",
        usage: "Gap level CONFIRMED = momentum level held → entry.",
      },
    ],
    lifecycle:
      "Same-direction candle pair forms level → ACTIVE → RETESTED → CONFIRMED | BROKEN | EXPIRED",
    params: [
      {
        name: "lookback",
        type: "int",
        default: 20,
        range: [5, 200],
        description: "Bars scanned for new levels each tick",
        traderPhrases: ["recent levels only"],
      },
      {
        name: "expiryBars",
        type: "int",
        default: 100,
        range: [10, 500],
        description: "Bars before an untouched level expires",
        traderPhrases: ["keep levels for 200 bars"],
      },
    ],
    outputStates: [
      {
        name: "HasActiveBull()",
        meaning: "A live gap support level exists",
        tradingImplication: "Watch for a momentum bounce",
      },
      {
        name: "HasActiveBear()",
        meaning: "A live gap resistance level exists",
        tradingImplication: "Watch for a momentum rejection",
      },
      {
        name: "BullJustConfirmed()",
        meaning: "Gap support held this bar",
        tradingImplication: "ENTRY LONG",
      },
      {
        name: "BearJustConfirmed()",
        meaning: "Gap resistance held this bar",
        tradingImplication: "ENTRY SHORT",
      },
      {
        name: "BullConfirmSL()",
        meaning: "Retest low — SL below support",
        tradingImplication: "SL under the level",
      },
      {
        name: "BearConfirmSL()",
        meaning: "Retest high — SL above resistance",
        tradingImplication: "SL above the level",
      },
    ],
    inlineApi: {
      tick: "GSNRSM_{id}_Tick(lookback)",
      signals: [
        { fn: "GSNRSM_{id}_HasActiveBull()", returns: "bool", meaning: "Live gap support level" },
        {
          fn: "GSNRSM_{id}_HasActiveBear()",
          returns: "bool",
          meaning: "Live gap resistance level",
        },
        {
          fn: "GSNRSM_{id}_BullJustConfirmed()",
          returns: "bool",
          meaning: "Gap support held — entry",
        },
        {
          fn: "GSNRSM_{id}_BearJustConfirmed()",
          returns: "bool",
          meaning: "Gap resistance held — entry",
        },
        { fn: "GSNRSM_{id}_BullConfirmSL()", returns: "double", meaning: "SL below gap support" },
        {
          fn: "GSNRSM_{id}_BearConfirmSL()",
          returns: "double",
          meaning: "SL above gap resistance",
        },
      ],
      reset: "GSNRSM_{id}_Reset()",
    },
    examplePhrases: [
      "Trade open-close levels on H1",
      "Use kissing candle support for entries",
      "Gap S/R for setup, engulfing for execution",
    ],
    notSuitedFor: ["Strong trends that ignore momentum levels"],
    combinesWith: ["bos", "ema", "fvg", "engulfing"],
  },

  // ─── Rejection ───────────────────────────────────────────────────────────────
  {
    id: "rejection",
    label: "Rejection",
    aliases: [
      { phrase: "rejection" },
      { phrase: "rejection candle" },
      { phrase: "wick rejection" },
      { phrase: "reject off support" },
      { phrase: "reject off resistance" },
      { phrase: "candle closed below resistance" },
      { phrase: "candle closed above support" },
      { phrase: "respected the level" },
    ],
    concept:
      "A candle whose wick pierces an S/R level but CLOSES BACK on the origin side — the level held. (Reactive SNR Rule 2.)",
    detectionLogic:
      "Embeds Classic + Gap S/R level detection. A bullish rejection fires when a candle's low pierces a support but the close stays above it, with a long lower wick (≥ minWickRatio of range). A bearish rejection fires when the high pierces a resistance but the close stays below it. SL = the rejection candle's wick extreme.",
    roles: [
      {
        role: "execution",
        fit: "primary",
        usage: "Rejection candle off a level in the bias direction = entry. SL at the wick.",
      },
      {
        role: "setup",
        fit: "secondary",
        usage: "A rejection validates the level as an active setup zone.",
      },
    ],
    lifecycle: "Point-in-time — fires on the bar a rejection completes at a live S/R level",
    params: [
      {
        name: "lookback",
        type: "int",
        default: 30,
        range: [10, 200],
        description: "Bars scanned for S/R levels",
        traderPhrases: ["recent levels"],
      },
      {
        name: "minWickRatio",
        type: "double",
        default: 0.5,
        range: [0.3, 0.8],
        description: "Rejection wick must be ≥ this fraction of candle range",
        traderPhrases: ["strong rejection only", "long wick"],
      },
      {
        name: "expiryBars",
        type: "int",
        default: 150,
        range: [20, 500],
        description: "Bars before a level expires",
        traderPhrases: [],
      },
    ],
    outputStates: [
      {
        name: "BullJustConfirmed()",
        meaning: "Bullish rejection off support",
        tradingImplication: "ENTRY LONG — support held with a wick",
      },
      {
        name: "BearJustConfirmed()",
        meaning: "Bearish rejection off resistance",
        tradingImplication: "ENTRY SHORT — resistance held with a wick",
      },
      {
        name: "BullConfirmSL()",
        meaning: "Wick low of rejection candle",
        tradingImplication: "Tight SL below the wick",
      },
      {
        name: "BearConfirmSL()",
        meaning: "Wick high of rejection candle",
        tradingImplication: "Tight SL above the wick",
      },
    ],
    inlineApi: {
      tick: "REJSM_{id}_Tick(lookback)",
      signals: [
        { fn: "REJSM_{id}_HasActiveBull()", returns: "bool", meaning: "Live support level" },
        { fn: "REJSM_{id}_HasActiveBear()", returns: "bool", meaning: "Live resistance level" },
        {
          fn: "REJSM_{id}_BullJustConfirmed()",
          returns: "bool",
          meaning: "Bullish rejection — entry",
        },
        {
          fn: "REJSM_{id}_BearJustConfirmed()",
          returns: "bool",
          meaning: "Bearish rejection — entry",
        },
        { fn: "REJSM_{id}_BullConfirmSL()", returns: "double", meaning: "SL below rejection wick" },
        { fn: "REJSM_{id}_BearConfirmSL()", returns: "double", meaning: "SL above rejection wick" },
      ],
      reset: "REJSM_{id}_Reset()",
    },
    examplePhrases: [
      "Enter on a rejection off support",
      "Sell when price rejects resistance with a wick",
      "Use rejection candles at key levels for entry",
      "S/R for setup, rejection candle for execution",
    ],
    notSuitedFor: ["Direction bias — this is a reactive entry trigger"],
    combinesWith: ["snr", "gap_snr", "bos", "ema"],
  },

  // ─── Miss ────────────────────────────────────────────────────────────────────
  {
    id: "miss",
    label: "Miss",
    aliases: [
      { phrase: "miss" },
      { phrase: "missed the level" },
      { phrase: "came close but didn't touch" },
      { phrase: "failed to reach the level" },
      { phrase: "liquidity miss" },
      { phrase: "near miss" },
    ],
    concept:
      "Price turns away NEAR an S/R level without touching it — the level is respected/validated and the miss leaves liquidity behind. (Reactive SNR, Slide 27.)",
    detectionLogic:
      "Embeds Classic + Gap S/R level detection and swing-pivot detection. A bullish miss fires when a confirmed swing LOW forms within nearPoints ABOVE a support without its low reaching the level. A bearish miss fires when a swing HIGH forms within nearPoints BELOW a resistance without its high reaching the level. SL = the missed swing extreme.",
    roles: [
      {
        role: "execution",
        fit: "primary",
        usage: "A miss is a strong reversal entry — price respected the level without testing it.",
      },
      {
        role: "setup",
        fit: "secondary",
        usage: "A miss validates the level; the next approach is higher probability.",
      },
    ],
    lifecycle:
      "Point-in-time — fires when a swing pivot is confirmed near (but not touching) a live level",
    params: [
      {
        name: "lookback",
        type: "int",
        default: 40,
        range: [10, 200],
        description: "Bars scanned for S/R levels",
        traderPhrases: [],
      },
      {
        name: "swingLen",
        type: "int",
        default: 3,
        range: [1, 10],
        description: "Pivot confirmation bars each side",
        traderPhrases: ["3-bar pivots"],
      },
      {
        name: "nearPoints",
        type: "int",
        default: 50,
        range: [10, 300],
        description: "Max distance (points) the pivot can be from the level to count as a miss",
        traderPhrases: ["within 30 points", "very close to the level"],
      },
      {
        name: "expiryBars",
        type: "int",
        default: 200,
        range: [20, 600],
        description: "Bars before a level expires",
        traderPhrases: [],
      },
    ],
    outputStates: [
      {
        name: "BullJustConfirmed()",
        meaning: "Swing low missed support (stayed above)",
        tradingImplication: "ENTRY LONG — strong demand respected the level",
      },
      {
        name: "BearJustConfirmed()",
        meaning: "Swing high missed resistance (stayed below)",
        tradingImplication: "ENTRY SHORT — strong supply respected the level",
      },
      {
        name: "BullConfirmSL()",
        meaning: "The missed swing low",
        tradingImplication: "SL below the turning point",
      },
      {
        name: "BearConfirmSL()",
        meaning: "The missed swing high",
        tradingImplication: "SL above the turning point",
      },
    ],
    inlineApi: {
      tick: "MISSSM_{id}_Tick(lookback)",
      signals: [
        { fn: "MISSSM_{id}_HasActiveBull()", returns: "bool", meaning: "Live support level" },
        { fn: "MISSSM_{id}_HasActiveBear()", returns: "bool", meaning: "Live resistance level" },
        { fn: "MISSSM_{id}_BullJustConfirmed()", returns: "bool", meaning: "Bullish miss — entry" },
        { fn: "MISSSM_{id}_BearJustConfirmed()", returns: "bool", meaning: "Bearish miss — entry" },
        {
          fn: "MISSSM_{id}_BullConfirmSL()",
          returns: "double",
          meaning: "SL below missed swing low",
        },
        {
          fn: "MISSSM_{id}_BearConfirmSL()",
          returns: "double",
          meaning: "SL above missed swing high",
        },
      ],
      reset: "MISSSM_{id}_Reset()",
    },
    examplePhrases: [
      "Enter when price misses support and turns up",
      "Trade the miss off resistance",
      "Buy the near-miss of a key level",
      "S/R miss on H4 for entry",
    ],
    notSuitedFor: ["Direction bias — reactive entry trigger"],
    combinesWith: ["snr", "gap_snr", "bos", "ema"],
  },

  // ─── SNRC2 (Support/Resistance Continuation 2) ───────────────────────────────
  {
    id: "snrc2",
    label: "SNRC2",
    aliases: [
      { phrase: "snrc2" },
      { phrase: "support resistance continuation" },
      { phrase: "support/resistance continuation 2" },
      { phrase: "classic snr continuation" },
      { phrase: "snr continuation pattern" },
    ],
    concept:
      "Continuation after a Classic SNR break with a manipulation pullback across the broken level. " +
      "Requires a qualifying HTF engulfing before the pattern forms.",
    detectionLogic:
      "Builds alternating swing pivots and scans 6-pivot windows. Bearish: L1→H1→L2(<L1)→H2(>L1,<res)→L3(<L2). " +
      "Bullish mirror. Entry = first Classic SNR level; SL = manipulation extreme. Invalidates on SL trade-through.",
    roles: [
      {
        role: "setup",
        fit: "primary",
        usage: "Active SNRC2 entry level — wait for retest of the first level after confirmation.",
      },
      {
        role: "execution",
        fit: "secondary",
        usage: "Fire on pattern confirmation bar (L3/R3 pivot) when trader wants immediate entry.",
      },
    ],
    lifecycle: "Confirmed at continuation pivot → entry level live until tapped, SL hit, or expiry",
    params: [
      {
        name: "lookback",
        type: "int",
        default: 400,
        range: [100, 800],
        description: "Bars scanned for pivot structure",
        traderPhrases: ["400 bars lookback"],
      },
      {
        name: "swingStrength",
        type: "int",
        default: 2,
        range: [1, 5],
        description: "Fractal strength (bars each side of pivot)",
        traderPhrases: ["2-bar pivots", "swing strength 3"],
      },
      {
        name: "htfLookback",
        type: "int",
        default: 4,
        range: [1, 20],
        description: "HTF bars before pattern start to find engulfing (default HTF filter: H4)",
        traderPhrases: ["H4 engulfing first", "4 HTF bars lookback"],
      },
      {
        name: "expiryBars",
        type: "int",
        default: 250,
        range: [50, 600],
        description: "Bars until unfilled setup expires",
        traderPhrases: [],
      },
    ],
    outputStates: [
      {
        name: "BullJustConfirmed()",
        meaning: "Bullish SNRC2 confirmed this bar",
        tradingImplication: "Continuation higher after manipulation below R1",
      },
      {
        name: "BearJustConfirmed()",
        meaning: "Bearish SNRC2 confirmed this bar",
        tradingImplication: "Continuation lower after manipulation above L1",
      },
      {
        name: "HasActiveBull() / HasActiveBear()",
        meaning: "Live SNRC2 setup awaiting entry tap",
        tradingImplication: "Setup armed — retest the first level",
      },
      {
        name: "BullConfirmSL() / BearConfirmSL()",
        meaning: "Manipulation extreme (SL reference)",
        tradingImplication: "Place SL beyond manipulation pivot",
      },
    ],
    inlineApi: {
      tick: "SNRC2SM_{id}_Tick(lookback)",
      signals: [
        { fn: "SNRC2SM_{id}_HasActiveBull()", returns: "bool", meaning: "Live bullish SNRC2" },
        { fn: "SNRC2SM_{id}_HasActiveBear()", returns: "bool", meaning: "Live bearish SNRC2" },
        {
          fn: "SNRC2SM_{id}_BullJustConfirmed()",
          returns: "bool",
          meaning: "Bullish SNRC2 confirmed this bar",
        },
        {
          fn: "SNRC2SM_{id}_BearJustConfirmed()",
          returns: "bool",
          meaning: "Bearish SNRC2 confirmed this bar",
        },
        {
          fn: "SNRC2SM_{id}_BullConfirmSL()",
          returns: "double",
          meaning: "SL below manipulation low",
        },
        {
          fn: "SNRC2SM_{id}_BearConfirmSL()",
          returns: "double",
          meaning: "SL above manipulation high",
        },
        {
          fn: "SNRC2SM_{id}_ActiveBullSL()",
          returns: "double",
          meaning: "SL for active bullish setup",
        },
        {
          fn: "SNRC2SM_{id}_ActiveBearSL()",
          returns: "double",
          meaning: "SL for active bearish setup",
        },
      ],
      reset: "SNRC2SM_{id}_Reset()",
    },
    examplePhrases: [
      "SNRC2 setup on H1 after H4 engulfing",
      "Trade support resistance continuation with manipulation pullback",
      "Enter on SNRC2 retest of the first level",
      "Classic SNR break then continuation pattern",
    ],
    notSuitedFor: ["Simple single-candle triggers without structure context"],
    combinesWith: ["snr", "gap_snr", "engulfing", "bos", "ema"],
  },

  // ─── Liquidity Buildup (OB + BB + FVG) ─────────────────────────────────────
  {
    id: "zone_liq",
    label: "Liquidity Buildup",
    aliases: [
      { phrase: "liquidity buildup" },
      { phrase: "liquidity build up" },
      { phrase: "liquidity build-up" },
      { phrase: "zone liquidity" },
      { phrase: "fvg liquidity buildup" },
      { phrase: "ob liquidity buildup" },
      { phrase: "bb liquidity buildup" },
    ],
    concept:
      "Combined OB, Breaker Block, and FVG liquidity detector. Each zone is drawn as a " +
      "rectangle; the closest wick that approaches the zone edge without entering is " +
      "marked with a horizontal liquidity line.",
    detectionLogic:
      "Detects OB (displacement + opposing candle), BB (OB closed through → flip), and " +
      "FVG (3-candle gap). Liquidity = wick within InpNearATR × ATR of the body/gap edge " +
      "without crossing the edge. Touch kills the zone (rectangle + line removed).",
    roles: [
      {
        role: "setup",
        fit: "primary",
        usage: "HasActive = zone with liquidity built (armed). Use as setup filter before entry.",
      },
      {
        role: "execution",
        fit: "secondary",
        usage: "BullJustConfirmed/BearJustConfirmed fires when new buildup is detected this bar.",
      },
    ],
    lifecycle: "DETECTED → LIQUIDITY BUILT → CONSUMED (edge touch) | EXPIRED",
    params: [
      {
        name: "lookback",
        type: "int",
        default: 200,
        range: [50, 500],
        description: "Bars scanned for zone detection",
        traderPhrases: [],
      },
      {
        name: "minLiqBars",
        type: "int",
        default: 1,
        range: [1, 5],
        description: "Minimum liquidity bars before tap counts",
        traderPhrases: ["one bar liquidity", "2 bars near the zone"],
      },
      {
        name: "nearATR",
        type: "double",
        default: 0.2,
        range: [0.05, 1.0],
        description: "Proximity to zone edge as ATR fraction",
        traderPhrases: ["close near the fvg", "within 20% ATR"],
      },
      {
        name: "expiryBars",
        type: "int",
        default: 200,
        range: [20, 600],
        description: "Bars before an unconfirmed zone expires",
        traderPhrases: [],
      },
      {
        name: "dispMult",
        type: "double",
        default: 1.5,
        range: [0.5, 3.0],
        description: "OB displacement body >= N × ATR",
        traderPhrases: ["1.5 ATR displacement"],
      },
    ],
    outputStates: [
      {
        name: "HasActiveBull()",
        meaning: "Bull zone with liquidity built — wick approached edge without entering",
        tradingImplication: "SETUP LONG context active",
      },
      {
        name: "BullJustConfirmed()",
        meaning: "New liquidity buildup confirmed this bar",
        tradingImplication: "ENTRY trigger when paired with execution module",
      },
      {
        name: "BullConfirmSL()",
        meaning: "SL below zone + buffer",
        tradingImplication: "Stop below OB/BB/FVG zone",
      },
    ],
    inlineApi: {
      tick: "ZLSM_{id}_Tick(lookback)",
      signals: [
        { fn: "ZLSM_{id}_HasActiveBull()", returns: "bool", meaning: "Zone with liquidity built (bull)" },
        { fn: "ZLSM_{id}_HasActiveBear()", returns: "bool", meaning: "Zone with liquidity built (bear)" },
        { fn: "ZLSM_{id}_BullJustConfirmed()", returns: "bool", meaning: "New bull buildup this bar" },
        { fn: "ZLSM_{id}_BearJustConfirmed()", returns: "bool", meaning: "New bear buildup this bar" },
        { fn: "ZLSM_{id}_BullConfirmSL()", returns: "double", meaning: "Bull SL" },
        { fn: "ZLSM_{id}_BearConfirmSL()", returns: "double", meaning: "Bear SL" },
        { fn: "ZLSM_{id}_ActiveBullSL()", returns: "double", meaning: "Armed bull SL hint" },
        { fn: "ZLSM_{id}_ActiveBearSL()", returns: "double", meaning: "Armed bear SL hint" },
      ],
      reset: "ZLSM_{id}_Reset()",
    },
    examplePhrases: [
      "Wait for liquidity to build near the FVG without entering the gap",
      "OB liquidity buildup on H4 — wick near the block edge",
      "Combined OB BB FVG liquidity buildup detector",
    ],
    notSuitedFor: ["Pure direction bias without a zone"],
    combinesWith: ["bos", "choch", "ema", "engulfing", "rejection"],
  },

  // ─── RSI Hidden Divergence ───────────────────────────────────────────────────
  {
    id: "rsi_hd",
    label: "RSI Hidden Divergence",
    aliases: [
      { phrase: "hidden divergence" },
      { phrase: "RSI hidden divergence" },
      { phrase: "bullish hidden divergence" },
      { phrase: "bearish hidden divergence" },
      { phrase: "HD" },
      { phrase: "RSI HD" },
      { phrase: "hidden RSI div" },
      { phrase: "continuation divergence" },
    ],
    concept:
      "Trend-CONTINUATION divergence between price and RSI during a pullback. Bullish HD: price makes a Higher Low while RSI makes a Lower Low. Bearish HD: price makes a Lower High while RSI makes a Higher High. Signals that the pullback is ending and the trend should resume.",
    detectionLogic:
      "On each newly-confirmed swing pivot, compares it to the previous swing of the same kind. Bullish HD fires when the newer swing LOW is HIGHER than the prior swing low (price HL) but the RSI at that low is LOWER (RSI LL). Bearish HD fires when the newer swing HIGH is LOWER (price LH) but RSI is HIGHER (RSI HH). RSI is read at the pivot bar. SL = the second (newer) swing point.",
    roles: [
      {
        role: "setup",
        fit: "primary",
        usage:
          "A hidden divergence in the trend direction = continuation setup; pair with a Direction Brain that already set the trend.",
      },
    ],
    lifecycle:
      "Two comparable swings form → divergence detected on the second pivot (ACTIVE) → pending continuation until the trend resumes or price closes beyond the second swing (invalidation)",
    params: [
      {
        name: "rsiPeriod",
        type: "int",
        default: 14,
        range: [2, 50],
        description: "RSI period",
        traderPhrases: ["RSI 14", "9-period RSI"],
      },
      {
        name: "pivotLeft",
        type: "int",
        default: 3,
        range: [1, 10],
        description: "Pivot confirmation bars on the older side",
        traderPhrases: ["3-bar swings"],
      },
      {
        name: "pivotRight",
        type: "int",
        default: 3,
        range: [1, 10],
        description: "Pivot confirmation bars on the newer side",
        traderPhrases: [],
      },
      {
        name: "minBars",
        type: "int",
        default: 5,
        range: [1, 50],
        description: "Minimum bars between the two swings",
        traderPhrases: [],
      },
      {
        name: "maxBars",
        type: "int",
        default: 50,
        range: [10, 200],
        description: "Maximum bars between the two swings",
        traderPhrases: [],
      },
      {
        name: "expiryBars",
        type: "int",
        default: 60,
        range: [10, 300],
        description: "Bars a pending HD stays valid awaiting continuation",
        traderPhrases: [],
      },
    ],
    outputStates: [
      {
        name: "BullJustConfirmed()",
        meaning: "Bullish HD detected (price HL + RSI LL)",
        tradingImplication: "Continuation LONG setup in an uptrend",
      },
      {
        name: "BearJustConfirmed()",
        meaning: "Bearish HD detected (price LH + RSI HH)",
        tradingImplication: "Continuation SHORT setup in a downtrend",
      },
      {
        name: "BullConfirmSL()",
        meaning: "The second (newer) swing low",
        tradingImplication: "SL below the higher low",
      },
      {
        name: "BearConfirmSL()",
        meaning: "The second (newer) swing high",
        tradingImplication: "SL above the lower high",
      },
    ],
    inlineApi: {
      tick: "RSIHDSM_{id}_Tick(lookback)",
      signals: [
        {
          fn: "RSIHDSM_{id}_HasActiveBull()",
          returns: "bool",
          meaning: "Pending bullish HD awaiting continuation",
        },
        {
          fn: "RSIHDSM_{id}_HasActiveBear()",
          returns: "bool",
          meaning: "Pending bearish HD awaiting continuation",
        },
        {
          fn: "RSIHDSM_{id}_BullJustConfirmed()",
          returns: "bool",
          meaning: "Bullish HD detected this bar",
        },
        {
          fn: "RSIHDSM_{id}_BearJustConfirmed()",
          returns: "bool",
          meaning: "Bearish HD detected this bar",
        },
        {
          fn: "RSIHDSM_{id}_BullConfirmSL()",
          returns: "double",
          meaning: "SL below the second swing low",
        },
        {
          fn: "RSIHDSM_{id}_BearConfirmSL()",
          returns: "double",
          meaning: "SL above the second swing high",
        },
      ],
      reset: "RSIHDSM_{id}_Reset()",
    },
    examplePhrases: [
      "M15 hidden divergence setup",
      "Continuation on RSI hidden divergence",
      "Bullish hidden divergence entry in an uptrend",
      "H4 BOS direction, M15 hidden divergence setup, M5 IFVG entry",
    ],
    notSuitedFor: [
      "Direction bias — it assumes a trend already exists",
      "Reversal trading — it is a continuation signal",
    ],
    combinesWith: ["bos", "choch", "ema", "fvg_inversion", "order_block"],
  },

  // ─── Breakout ──────────────────────────────────────────────────────────────
  {
    id: "breakout",
    label: "Breakout (RBS / SBR)",
    aliases: [
      { phrase: "breakout" },
      { phrase: "break and retest" },
      { phrase: "RBS" },
      { phrase: "SBR" },
      { phrase: "resistance becomes support" },
      { phrase: "support becomes resistance" },
      { phrase: "level flip" },
      { phrase: "break of the range" },
      { phrase: "range breakout" },
      { phrase: "retest after breakout" },
    ],
    concept:
      "Detects a candle-close break of a recent range, then tracks the broken level flipping polarity (RBS/SBR) and being retested.",
    detectionLogic:
      "When a candle closes above the recent range high, the broken high flips to support (RBS — Resistance Becomes Support). When a candle closes below the range low, the broken low flips to resistance (SBR). The flipped level is then watched: RETESTED when price wicks back to it, CONFIRMED when a close holds on the breakout side, INVALIDATED when a close pushes back through.",
    roles: [
      {
        role: "setup",
        fit: "primary",
        usage: "Active flipped level = break-and-retest setup in the breakout direction.",
      },
      {
        role: "execution",
        fit: "primary",
        usage: "RBS/SBR CONFIRMED = retest held → break-and-retest entry.",
      },
      {
        role: "direction",
        fit: "secondary",
        usage: "A breakout sets short-term directional bias.",
      },
    ],
    lifecycle:
      "Close beyond range → level flips (RBS/SBR) → ACTIVE → RETESTED → CONFIRMED | INVALIDATED | EXPIRED",
    params: [
      {
        name: "lookback",
        type: "int",
        default: 20,
        range: [5, 100],
        description: "Range whose high/low defines the breakout level",
        traderPhrases: ["20-bar range", "break the 50-bar high"],
      },
      {
        name: "expiryBars",
        type: "int",
        default: 100,
        range: [10, 500],
        description: "Bars before a flipped level expires",
        traderPhrases: ["keep flips for 100 bars"],
      },
    ],
    outputStates: [
      {
        name: "HasActiveBull()",
        meaning: "A live RBS (flipped support) exists",
        tradingImplication: "Watch for a retest buy",
      },
      {
        name: "HasActiveBear()",
        meaning: "A live SBR (flipped resistance) exists",
        tradingImplication: "Watch for a retest sell",
      },
      {
        name: "BullJustConfirmed()",
        meaning: "RBS retest held this bar",
        tradingImplication: "ENTRY LONG — break-and-retest",
      },
      {
        name: "BearJustConfirmed()",
        meaning: "SBR retest held this bar",
        tradingImplication: "ENTRY SHORT — break-and-retest",
      },
      {
        name: "BullConfirmSL()",
        meaning: "Retest low — SL below the flip",
        tradingImplication: "SL under the flipped level",
      },
      {
        name: "BearConfirmSL()",
        meaning: "Retest high — SL above the flip",
        tradingImplication: "SL above the flipped level",
      },
    ],
    inlineApi: {
      tick: "BRKSM_{id}_Tick(lookback)",
      signals: [
        { fn: "BRKSM_{id}_HasActiveBull()", returns: "bool", meaning: "Live RBS level" },
        { fn: "BRKSM_{id}_HasActiveBear()", returns: "bool", meaning: "Live SBR level" },
        {
          fn: "BRKSM_{id}_BullJustConfirmed()",
          returns: "bool",
          meaning: "RBS retest held — entry",
        },
        {
          fn: "BRKSM_{id}_BearJustConfirmed()",
          returns: "bool",
          meaning: "SBR retest held — entry",
        },
        { fn: "BRKSM_{id}_BullConfirmSL()", returns: "double", meaning: "SL below RBS" },
        { fn: "BRKSM_{id}_BearConfirmSL()", returns: "double", meaning: "SL above SBR" },
      ],
      reset: "BRKSM_{id}_Reset()",
    },
    examplePhrases: [
      "Break and retest of the range high",
      "Enter when resistance becomes support",
      "Trade the breakout retest on M15",
      "BOS on H4 for direction, breakout retest on M5 for entry",
      "Buy the retest after price breaks the range",
    ],
    notSuitedFor: ["Choppy ranges with no clean breakouts"],
    combinesWith: ["bos", "ema", "snr", "engulfing"],
  },

  // ─── EMA ────────────────────────────────────────────────────────────────────
  {
    id: "ema",
    label: "EMA / Moving Average",
    aliases: [
      { phrase: "EMA" },
      { phrase: "exponential moving average" },
      { phrase: "moving average" },
      { phrase: "MA" },
      { phrase: "trend filter" },
      { phrase: "EMA cross" },
      { phrase: "above the MA" },
      { phrase: "below the EMA" },
      { phrase: "SMA" },
      { phrase: "50 EMA" },
      { phrase: "200 EMA" },
      { phrase: "golden cross" },
      { phrase: "death cross" },
      { phrase: "fast and slow EMA" },
    ],
    concept:
      "One or more EMA periods. Single EMA: price above/below the line for bias, retest that line. Dual EMA: fast/slow cross → retest slower → confirm beyond faster. Multi EMA (3+): all lines must stack in order; cross-retest uses shortest vs longest.",
    detectionLogic:
      "Real iMA handles (drawn on the chart via B4_MA). TWO usage modes: (1) SIMPLE CROSS for Direction — fast vs slow alignment checked inline every bar, persistent (no state machine). (2) CROSS→RETEST SEQUENCE for Setup+Execution — the verified EMASM state machine persists IDLE → CROSSED (fast/slow CROSS in the bias direction arms the setup) → ARMED (price retests the slow EMA within tolerance; the retest bar only arms) → CONFIRMED (a LATER bar closes outside the fast EMA → entry next bar, SL = swing). After a confirmation a NEW cross is required. Use EMASM for any multi-bar 'cross then retest then close outside' rule — never hand-write it inline (the phases collapse onto one bar).",
    roles: [
      {
        role: "direction",
        fit: "primary",
        usage:
          "Fast > slow = BULL bias. Fast < slow = BEAR bias. Inline B4_MA or EMASM_{id}_Bias().",
      },
      {
        role: "setup",
        fit: "primary",
        usage:
          "EMASM SetupActive() = an aligned fast/slow CROSS has occurred (setup armed), retest in progress.",
      },
      {
        role: "execution",
        fit: "primary",
        usage:
          "EMASM JustConfirmed() = a bar closed outside the fast EMA after the retest → entry.",
      },
    ],
    lifecycle:
      "Simple cross: persistent alignment. Cross→retest SM: IDLE → CROSSED (aligned cross) → ARMED (retest slow EMA) → CONFIRMED (close outside fast EMA). Default mode consumes the setup and requires a new cross. Repeat mode returns to CROSSED after confirmation so every fresh retest can create another opportunity until an opposite cross.",
    params: [
      {
        name: "fastPeriod",
        type: "int",
        default: 21,
        range: [5, 50],
        description: "Fast EMA period",
        traderPhrases: ["EMA 21", "fast EMA of 9", "12-period EMA", "use the 50 EMA as fast"],
      },
      {
        name: "slowPeriod",
        type: "int",
        default: 50,
        range: [20, 200],
        description: "Slow EMA period",
        traderPhrases: ["EMA 50", "slow EMA of 200", "use 200 as the trend filter"],
      },
      {
        name: "retestPoints",
        type: "int",
        default: 100,
        range: [10, 500],
        description:
          "Retest tolerance in POINTS for the EMASM (1 pip = 10 points on a 5-digit symbol)",
        traderPhrases: ["within 10 pips of the EMA", "touch the slow MA within 5 pips"],
      },
      {
        name: "requireCross",
        type: "bool",
        default: true,
        description:
          "Require an aligned fast/slow cross BEFORE the retest (the canonical EMA pullback). False = pure retest, no cross required.",
        traderPhrases: [
          "wait for the EMA cross first",
          "cross then retest",
          "any pullback to the EMA",
        ],
      },
      {
        name: "repeatAfterConfirmation",
        type: "bool",
        default: false,
        description:
          "After a confirmed CTC entry, continue watching for another EMA retest in the same active direction instead of requiring a new cross.",
        traderPhrases: [
          "do not limit to the first test",
          "multiple trades after one cross",
          "continue watching for another retest until opposite cross",
        ],
      },
    ],
    outputStates: [
      {
        name: "fast > slow",
        meaning: "Bullish alignment",
        tradingImplication: "Bias BULL / only buys",
      },
      {
        name: "fast < slow",
        meaning: "Bearish alignment",
        tradingImplication: "Bias BEAR / only sells",
      },
      {
        name: "SetupActive()",
        meaning: "Aligned cross occurred — setup live",
        tradingImplication: "Setup armed — await retest+confirmation",
      },
      {
        name: "JustConfirmed()",
        meaning: "Close outside fast EMA after retest",
        tradingImplication: "ENTRY in bias direction",
      },
    ],
    inlineApi: {
      tick: "EMASM_{id}_Tick(gBias)   // cross→retest mode; simple cross uses inline B4_MA, no tick",
      signals: [
        { fn: "EMASM_{id}_Bias()", returns: "int", meaning: "Own fast/slow alignment (1/-1/0)" },
        {
          fn: "EMASM_{id}_SetupActive()",
          returns: "bool",
          meaning: "Aligned cross occurred — setup live (CROSSED or ARMED)",
        },
        {
          fn: "EMASM_{id}_RetestActive()",
          returns: "bool",
          meaning: "Retest of the slow EMA in progress (ARMED)",
        },
        { fn: "EMASM_{id}_ActiveDir()", returns: "int", meaning: "Direction of the live setup" },
        { fn: "EMASM_{id}_ActiveSL()", returns: "double", meaning: "Swing SL hint while live" },
        {
          fn: "EMASM_{id}_JustConfirmed()",
          returns: "bool",
          meaning: "Close outside fast EMA after retest (entry)",
        },
        { fn: "EMASM_{id}_ConfirmDir()", returns: "int", meaning: "Direction of the confirmation" },
        { fn: "EMASM_{id}_ConfirmSL()", returns: "double", meaning: "Swing SL at confirmation" },
      ],
      reset: "EMASM_{id}_Reset()",
    },
    examplePhrases: [
      "Use EMA 12/48 cross for direction",
      "Only trade when price is above the 200 EMA",
      "EMA alignment on H4 for trend filter",
      "Enter after EMA cross in direction of the daily bias",
      "Fast EMA above slow EMA = bullish bias",
      "Use the 50 and 200 EMA for trend direction",
    ],
    notSuitedFor: ["Ranging/choppy markets where EMAs give false signals"],
    combinesWith: ["fvg", "fvg_inversion", "order_block", "liqsweep"],
  },

  // ─── Engulfing / Engulfing Failed (MES) ─────────────────────────────────────
  {
    id: "engulfing",
    label: "Engulfing / Engulfing Failed",
    aliases: [
      { phrase: "engulfing" },
      { phrase: "EG" },
      { phrase: "EF" },
      { phrase: "engulfing failed" },
      { phrase: "engulfing candle" },
      { phrase: "engulfing pattern" },
      { phrase: "bullish engulfing" },
      { phrase: "bearish engulfing" },
      { phrase: "Malaysian engulfing" },
      { phrase: "MES" },
      { phrase: "reversal zone" },
      { phrase: "outside bar" },
    ],
    concept:
      "Malaysian Engulfing Strategy (MES) zones. " +
      "EG (Engulfing): C2 closes beyond C1's full wick — zone = C1 wick range (hi=C1.High, lo=C1.Low). " +
      "EF (Engulfing Failed): a failed EG — price closes through the EG zone (bearish close below a bull EG's lower wick, or bullish close above a bear EG's upper wick). " +
      "The EF is the same C1 wick zone, now acting in the opposite direction. " +
      "EF is NOT a Breaker Block — it needs no BOS or displacement context. It is simply an EG that price closed through. " +
      "Both EG and EF are tracked in one SM with the same ACTIVE → RETESTED → CONFIRMED lifecycle.",
    detectionLogic:
      "Scans C1 (engulfed candle) and C2 (engulfing candle). " +
      "Bullish EG: C1 bearish, C2 bullish and close > C1.High (upper wick). " +
      "Bearish EG: C1 bullish, C2 bearish and close < C1.Low (lower wick). " +
      "Zone = C1 full wick range (hi=C1.High, lo=C1.Low). " +
      "EF flip: bull EG zone — a bearish candle closes below C1.Low → zone becomes bear EF. " +
      "Bear EG zone — a bullish candle closes above C1.High → zone becomes bull EF. " +
      "CONFIRMED fires when price retests the EG or EF zone and closes back outside it in the zone's direction.",
    roles: [
      {
        role: "direction",
        fit: "primary",
        usage:
          "W1 or D1 EG/EF zones establish directional bias. Price moves from one EG/EF zone to an opposing zone. " +
          "HasActiveBull/Bear with a higher-TF instance drives gBias.",
      },
      {
        role: "setup",
        fit: "primary",
        usage:
          "H4 EG or EF zone in the bias direction = Direction Setup (DS). Setup is active while the zone is live (HasActiveBull/Bear). " +
          "SL hint = zone lo (bull) or hi (bear).",
      },
      {
        role: "execution",
        fit: "primary",
        usage:
          "M30 or M5 EG/EF zone CONFIRMED = entry signal. BullJustConfirmed/BearJustConfirmed fires the trade. " +
          "SL from BullConfirmSL/BearConfirmSL (retest extreme).",
      },
    ],
    lifecycle:
      "C2 closes beyond C1 wick → EG ACTIVE → price enters zone: RETESTED → close back outside: CONFIRMED (entry) | " +
      "close through zone: MITIGATED | zone violated: → EF ACTIVE (dir flipped) → same lifecycle → CONFIRMED (EF entry)",
    params: [
      {
        name: "scanBack",
        type: "int",
        default: 3,
        range: [1, 10],
        description: "Bars scanned each tick for new EG patterns",
        traderPhrases: ["look back 3 bars", "scan 5 candles for engulfing"],
      },
      {
        name: "expiryBars",
        type: "int",
        default: 100,
        range: [20, 500],
        description: "Bars until an untested zone expires",
        traderPhrases: ["expire after 50 bars", "keep zones for 200 candles"],
      },
    ],
    outputStates: [
      {
        name: "HasActiveBull()",
        meaning: "A live bull EG or bull EF zone exists",
        tradingImplication: "Setup armed — watch for zone to be retested and confirmed",
      },
      {
        name: "HasActiveBear()",
        meaning: "A live bear EG or bear EF zone exists",
        tradingImplication: "Setup armed — watch for zone to be retested and confirmed",
      },
      {
        name: "BullJustConfirmed()",
        meaning: "Bull EG or EF confirmed this bar — zone held as support",
        tradingImplication: "ENTRY LONG — SL from BullConfirmSL()",
      },
      {
        name: "BearJustConfirmed()",
        meaning: "Bear EG or EF confirmed this bar — zone held as resistance",
        tradingImplication: "ENTRY SHORT — SL from BearConfirmSL()",
      },
    ],
    inlineApi: {
      tick: "EGSM_{id}_Tick(lookback)",
      signals: [
        {
          fn: "EGSM_{id}_BullJustConfirmed()",
          returns: "bool",
          meaning: "Bull EG/EF confirmed — long entry",
        },
        {
          fn: "EGSM_{id}_BearJustConfirmed()",
          returns: "bool",
          meaning: "Bear EG/EF confirmed — short entry",
        },
        {
          fn: "EGSM_{id}_BullConfirmSL()",
          returns: "double",
          meaning: "SL level for bull entry (retestLow)",
        },
        {
          fn: "EGSM_{id}_BearConfirmSL()",
          returns: "double",
          meaning: "SL level for bear entry (retestHigh)",
        },
        { fn: "EGSM_{id}_HasActiveBull()", returns: "bool", meaning: "Live bull zone exists" },
        { fn: "EGSM_{id}_HasActiveBear()", returns: "bool", meaning: "Live bear zone exists" },
        {
          fn: "EGSM_{id}_LatestBullUL()",
          returns: "double",
          meaning: "Upper limit of most recent bull zone",
        },
        {
          fn: "EGSM_{id}_LatestBullLL()",
          returns: "double",
          meaning: "Lower limit of most recent bull zone",
        },
        {
          fn: "EGSM_{id}_LatestBearUL()",
          returns: "double",
          meaning: "Upper limit of most recent bear zone",
        },
        {
          fn: "EGSM_{id}_LatestBearLL()",
          returns: "double",
          meaning: "Lower limit of most recent bear zone",
        },
        {
          fn: "EGSM_{id}_LatestBullZoneTime()",
          returns: "datetime",
          meaning: "C1 time of most recent bull zone (for chart drawing)",
        },
        {
          fn: "EGSM_{id}_LatestBearZoneTime()",
          returns: "datetime",
          meaning: "C1 time of most recent bear zone (for chart drawing)",
        },
      ],
      reset: "EGSM_{id}_Reset()",
    },
    examplePhrases: [
      "Use W1 and D1 engulfing zones for direction",
      "H4 EG or EF as my setup zone",
      "Enter on M30 engulfing after H4 setup",
      "Trade the EF zone when the EG fails",
      "Malaysian engulfing strategy — EG for direction, EF for continuation",
      "Bullish engulfing failed on H4 is my buy zone",
      "Enter when price retests the engulfing zone",
      "Direction from weekly EG, setup from daily EF, entry on H4 confirm",
      "MES strategy with EG and EF zones",
    ],
    notSuitedFor: ["Strategies needing FVG-style gap detection — use fvg or fvg_inversion instead"],
    combinesWith: ["bos", "ema", "liqsweep", "snr", "fvg"],
  },

  // ─── Pin Bar ─────────────────────────────────────────────────────────────────
  {
    id: "pin_bar",
    label: "Pin Bar",
    aliases: [
      { phrase: "pin bar" },
      { phrase: "hammer" },
      { phrase: "shooting star" },
      { phrase: "rejection candle" },
      { phrase: "wick rejection" },
      { phrase: "long wick candle" },
      { phrase: "doji with wick" },
      { phrase: "pinocchio bar" },
    ],
    concept:
      "A candle with a long wick (>= 60% of range) rejecting a level, with a small body (<= 35% of range). The wick represents failed price acceptance.",
    detectionLogic:
      "Calculates wick and body ratios from the bar. Bull pin: lower wick >= 60% of range AND body <= 35% of range. Bear pin: upper wick >= 60%. Point-in-time signal.",
    roles: [
      {
        role: "execution",
        fit: "primary",
        usage: "Pin bar at key level aligned with bias = rejection entry. SL at wick tip.",
      },
    ],
    lifecycle: "Point-in-time — fires on the bar the pattern completes",
    params: [],
    outputStates: [
      {
        name: "Bull pin bar",
        meaning: "Lower wick rejection — price rejected lower prices",
        tradingImplication: "ENTRY LONG",
      },
      {
        name: "Bear pin bar",
        meaning: "Upper wick rejection — price rejected higher prices",
        tradingImplication: "ENTRY SHORT",
      },
    ],
    inlineApi: {
      tick: "(none — inline check at bar open)",
      signals: [
        {
          fn: "lwick >= range*0.6 && body <= range*0.35",
          returns: "bool",
          meaning: "Bull pin bar",
        },
        {
          fn: "uwick >= range*0.6 && body <= range*0.35",
          returns: "bool",
          meaning: "Bear pin bar",
        },
      ],
      reset: "(none)",
    },
    examplePhrases: [
      "Enter on a pin bar at the FVG",
      "Hammer candle at the demand zone = entry",
      "Wait for a rejection candle at the order block",
      "Pin bar rejection at support/resistance",
      "Shooting star at the supply zone",
    ],
    notSuitedFor: ["Direction bias or setup zones — purely an entry trigger"],
    combinesWith: ["fvg", "order_block", "bos", "choch"],
  },
];

// ─── UI param definitions ─────────────────────────────────────────────────────

/**
 * UI-facing parameter definitions per module.
 * These drive the input fields shown in the brain config editor.
 * Each entry maps module id → array of user-facing inputs.
 */
export interface UIParam {
  key: string; // matches ConfigParam.name in the library + key in brain.params
  label: string; // user-facing label  e.g. "Fast EMA Period"
  type: "number";
  default: number;
  min: number;
  max: number;
  step: number;
  hint: string; // one-line tooltip  e.g. "12 = faster, more responsive"
}

export const MODULE_UI_PARAMS: Record<string, UIParam[]> = {
  ema: [
    {
      key: "fastPeriod",
      label: "Fast EMA Period",
      type: "number",
      default: 21,
      min: 2,
      max: 200,
      step: 1,
      hint: "e.g. 9, 12, 21 — shorter = faster response",
    },
    {
      key: "slowPeriod",
      label: "Slow EMA Period",
      type: "number",
      default: 50,
      min: 5,
      max: 500,
      step: 1,
      hint: "e.g. 48, 50, 200 — longer = stronger trend filter",
    },
  ],
  bos: [
    {
      key: "lookback",
      label: "Structure Lookback (bars)",
      type: "number",
      default: 20,
      min: 5,
      max: 200,
      step: 1,
      hint: "How many bars back to scan for swing levels",
    },
    {
      key: "swingLen",
      label: "Pivot Strength (bars each side)",
      type: "number",
      default: 5,
      min: 1,
      max: 20,
      step: 1,
      hint: "Bars each side needed to confirm a pivot high/low",
    },
  ],
  choch: [
    {
      key: "lookback",
      label: "Structure Lookback (bars)",
      type: "number",
      default: 20,
      min: 5,
      max: 200,
      step: 1,
      hint: "How many bars back to scan for swing levels",
    },
    {
      key: "swingLen",
      label: "Pivot Strength (bars each side)",
      type: "number",
      default: 5,
      min: 1,
      max: 20,
      step: 1,
      hint: "Bars each side needed to confirm a pivot",
    },
  ],
  bos_choch: [
    {
      key: "lookback",
      label: "Structure Lookback (bars)",
      type: "number",
      default: 20,
      min: 5,
      max: 200,
      step: 1,
      hint: "How many bars back to scan for swing levels",
    },
    {
      key: "swingLen",
      label: "Pivot Strength (bars each side)",
      type: "number",
      default: 5,
      min: 1,
      max: 20,
      step: 1,
      hint: "Bars each side needed to confirm a pivot",
    },
  ],
  fvg: [
    {
      key: "expiryBars",
      label: "Zone Expiry (bars)",
      type: "number",
      default: 100,
      min: 10,
      max: 500,
      step: 10,
      hint: "How many bars before an untouched FVG expires",
    },
  ],
  fvg_inversion: [
    {
      key: "expiryBars",
      label: "Zone Expiry (bars)",
      type: "number",
      default: 100,
      min: 10,
      max: 500,
      step: 10,
      hint: "How many bars before an untouched iFVG expires",
    },
  ],
  order_block: [
    {
      key: "dispMult",
      label: "Displacement Body %",
      type: "number",
      default: 0.6,
      min: 0.4,
      max: 0.9,
      step: 0.05,
      hint: "Minimum body as fraction of candle range (0.6 = 60%)",
    },
    {
      key: "scanBack",
      label: "OB Scan Lookback (bars)",
      type: "number",
      default: 5,
      min: 1,
      max: 15,
      step: 1,
      hint: "Bars before displacement to look for the OB candle",
    },
    {
      key: "expiryBars",
      label: "Zone Expiry (bars)",
      type: "number",
      default: 100,
      min: 10,
      max: 500,
      step: 10,
      hint: "How many bars before an untouched OB expires",
    },
  ],
  liqsweep: [
    {
      key: "swingLen",
      label: "Pivot Strength (bars each side)",
      type: "number",
      default: 3,
      min: 1,
      max: 10,
      step: 1,
      hint: "Bars each side needed to confirm a swing pivot",
    },
    {
      key: "lookback",
      label: "Swing Lookback (bars)",
      type: "number",
      default: 20,
      min: 5,
      max: 100,
      step: 1,
      hint: "How many bars back to scan for swing levels to sweep",
    },
  ],
  snr: [
    {
      key: "lookback",
      label: "Level Lookback (bars)",
      type: "number",
      default: 20,
      min: 5,
      max: 200,
      step: 5,
      hint: "How many bars back to identify S/R levels",
    },
  ],
  gap_snr: [
    {
      key: "lookback",
      label: "Level Lookback (bars)",
      type: "number",
      default: 20,
      min: 5,
      max: 200,
      step: 5,
      hint: "How many bars back to identify gap S/R levels",
    },
  ],
  rejection: [
    {
      key: "lookback",
      label: "Level Lookback (bars)",
      type: "number",
      default: 30,
      min: 10,
      max: 200,
      step: 5,
      hint: "Bars back to identify S/R levels to react from",
    },
    {
      key: "minWickRatio",
      label: "Min Wick %",
      type: "number",
      default: 0.5,
      min: 0.3,
      max: 0.8,
      step: 0.05,
      hint: "Rejection wick as fraction of candle range (0.5 = 50%)",
    },
  ],
  miss: [
    {
      key: "lookback",
      label: "Level Lookback (bars)",
      type: "number",
      default: 40,
      min: 10,
      max: 200,
      step: 5,
      hint: "Bars back to identify S/R levels",
    },
    {
      key: "swingLen",
      label: "Pivot Strength (bars)",
      type: "number",
      default: 3,
      min: 1,
      max: 10,
      step: 1,
      hint: "Bars each side to confirm the swing turning point",
    },
    {
      key: "nearPoints",
      label: "Near Distance (points)",
      type: "number",
      default: 50,
      min: 10,
      max: 300,
      step: 5,
      hint: "How close (points) the pivot must be to the level to count as a miss",
    },
  ],
  snrc2: [
    {
      key: "lookback",
      label: "Lookback (bars)",
      type: "number",
      default: 400,
      min: 100,
      max: 800,
      step: 10,
      hint: "Historical bars scanned for pivot structure",
    },
    {
      key: "swingStrength",
      label: "Swing Strength (bars)",
      type: "number",
      default: 2,
      min: 1,
      max: 5,
      step: 1,
      hint: "Fractal strength — bars each side of pivot confirmation",
    },
    {
      key: "htfLookback",
      label: "HTF Lookback (bars)",
      type: "number",
      default: 4,
      min: 1,
      max: 20,
      step: 1,
      hint: "HTF bars before pattern start to find qualifying engulfing",
    },
    {
      key: "expiryBars",
      label: "Setup Expiry (bars)",
      type: "number",
      default: 250,
      min: 50,
      max: 600,
      step: 10,
      hint: "Bars until an unfilled SNRC2 setup is removed",
    },
  ],
  zone_liq: [
    {
      key: "lookback",
      label: "Lookback (bars)",
      type: "number",
      default: 200,
      min: 50,
      max: 500,
      step: 10,
      hint: "Historical bars scanned for FVG/OB/BB zones",
    },
    {
      key: "minLiqBars",
      label: "Min Liquidity Bars",
      type: "number",
      default: 1,
      min: 1,
      max: 5,
      step: 1,
      hint: "Wick approach bars within proximity before zone counts as armed",
    },
    {
      key: "nearATR",
      label: "Near Zone (ATR ×)",
      type: "number",
      default: 0.2,
      min: 0.05,
      max: 1.0,
      step: 0.05,
      hint: "Wick proximity to zone edge as ATR fraction (same as Liquidity_Buildup indicator)",
    },
    {
      key: "expiryBars",
      label: "Zone Expiry (bars)",
      type: "number",
      default: 200,
      min: 20,
      max: 600,
      step: 10,
      hint: "Bars before an unconfirmed zone expires",
    },
  ],
  bb: [
    {
      key: "period",
      label: "Period",
      type: "number",
      default: 20,
      min: 5,
      max: 100,
      step: 1,
      hint: "Moving average period for the Bollinger midline",
    },
  ],
  swing_structure: [
    {
      key: "lookback",
      label: "Range Lookback (bars)",
      type: "number",
      default: 50,
      min: 10,
      max: 200,
      step: 5,
      hint: "Bar range used to define the swing structure",
    },
  ],
  breakout: [
    {
      key: "lookback",
      label: "Range Lookback (bars)",
      type: "number",
      default: 20,
      min: 5,
      max: 100,
      step: 5,
      hint: "Bar range whose high/low defines the breakout level",
    },
  ],
  ob_fvg: [
    {
      key: "expiryBars",
      label: "Zone Expiry (bars)",
      type: "number",
      default: 250,
      min: 20,
      max: 600,
      step: 10,
      hint: "Bars an untested OB+FVG zone stays valid",
    },
  ],
  rsi_hd: [
    {
      key: "rsiPeriod",
      label: "RSI Period",
      type: "number",
      default: 14,
      min: 2,
      max: 50,
      step: 1,
      hint: "RSI period used to measure momentum",
    },
    {
      key: "pivotLeft",
      label: "Pivot Strength (left)",
      type: "number",
      default: 3,
      min: 1,
      max: 10,
      step: 1,
      hint: "Bars on the older side to confirm a swing",
    },
    {
      key: "pivotRight",
      label: "Pivot Strength (right)",
      type: "number",
      default: 3,
      min: 1,
      max: 10,
      step: 1,
      hint: "Bars on the newer side to confirm a swing",
    },
    {
      key: "minBars",
      label: "Min Bars Between Swings",
      type: "number",
      default: 5,
      min: 1,
      max: 50,
      step: 1,
      hint: "Minimum spacing between the two swings",
    },
    {
      key: "maxBars",
      label: "Max Bars Between Swings",
      type: "number",
      default: 50,
      min: 10,
      max: 200,
      step: 5,
      hint: "Maximum spacing between the two swings",
    },
  ],
};

// ─── Context builders for Claude ─────────────────────────────────────────────

/**
 * COMPACT version — ~40% fewer tokens, same critical data.
 * Used in the generation prompt where latency matters.
 * Keeps: aliases, primary roles, inline API, 2 example phrases.
 * Drops: verbose descriptions, full role breakdowns, notSuitedFor, combinesWith.
 */
export function buildCompactModuleLibraryContext(): string {
  const lines: string[] = [
    "MODULE LIBRARY — map trader language to these modules and their APIs.",
    "Replace {id} with the TF label (H4, D1, M15, etc.) in every function name.",
    "",
  ];

  for (const m of MODULE_LIBRARY) {
    // Header: id, label, concept in one line
    lines.push(`[${m.id}] ${m.label}`);
    lines.push(`  Concept: ${m.concept}`);
    // Aliases — most critical for phrase matching
    lines.push(
      `  Trader calls it: ${m.aliases
        .slice(0, 8)
        .map((a) => `"${a.phrase}"`)
        .join(", ")}`,
    );
    // Primary roles
    const primary = m.roles.filter((r) => r.fit === "primary").map((r) => r.role);
    const secondary = m.roles.filter((r) => r.fit !== "primary").map((r) => r.role);
    lines.push(
      `  Best role: ${primary.join(", ")}${secondary.length ? ` | also works as: ${secondary.join(", ")}` : ""}`,
    );
    // Params (compact)
    if (m.params.length > 0) {
      const pList = m.params.map((p) => `${p.name}=${p.default}`).join(", ");
      lines.push(`  Params: ${pList}`);
    }
    // Inline API
    lines.push(`  Reset: ${m.inlineApi.reset}`);
    lines.push(`  Tick:  ${m.inlineApi.tick}`);
    for (const s of m.inlineApi.signals) {
      lines.push(`    ${s.fn} → ${s.meaning}`);
    }
    // 2 example phrases
    lines.push(`  e.g.: "${m.examplePhrases[0]}"`);
    if (m.examplePhrases[1]) lines.push(`        "${m.examplePhrases[1]}"`);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Builds the FULL system-prompt context block injected into Claude.
 * This is the AI builder's vocabulary — not user documentation.
 */
export function buildModuleLibraryContext(): string {
  const lines: string[] = [
    "╔══════════════════════════════════════════════════════════════════╗",
    "║              MODULE LIBRARY — AI BUILDER VOCABULARY             ║",
    "╚══════════════════════════════════════════════════════════════════╝",
    "",
    "You are the AI brain of a professional MT5 EA builder SaaS.",
    "Users describe their trading strategies in plain English.",
    "Your job is to interpret their descriptions, map concepts to modules,",
    "select the right module for each brain role, configure parameters from",
    "the user's words, and generate correct MQL5 wiring code.",
    "",
    "KEY PRINCIPLES:",
    "1. Modules are YOUR vocabulary — users never see or install them.",
    "2. The same module can serve different roles depending on context.",
    "3. Always extract configuration intent from the description — never hardcode defaults blindly.",
    "4. Generated EA must be self-contained — all module logic embedded inline.",
    "5. Think like a professional trader: understand WHAT the trader wants, THEN choose HOW.",
    "6. When a phrase is ambiguous, pick the most common trader interpretation.",
    "7. Multiple modules can be combined — e.g. FVG for setup AND engulfing for execution.",
    "",
    "AVAILABLE MODULES:",
    "",
  ];

  for (const m of MODULE_LIBRARY) {
    lines.push(`■ ${m.label.toUpperCase()} (id: "${m.id}")`);
    lines.push(`  Concept: ${m.concept}`);
    lines.push(`  Aliases: ${m.aliases.map((a) => `"${a.phrase}"`).join(", ")}`);
    lines.push(
      `  Best roles: ${m.roles
        .filter((r) => r.fit === "primary")
        .map((r) => r.role.toUpperCase())
        .join(", ")}`,
    );
    lines.push(
      `  Can also do: ${
        m.roles
          .filter((r) => r.fit !== "primary")
          .map((r) => `${r.role} (${r.fit})`)
          .join(", ") || "—"
      }`,
    );
    lines.push(`  Role usage:`);
    for (const r of m.roles) {
      lines.push(`    ${r.role.padEnd(12)}: ${r.usage}`);
    }
    if (m.params.length > 0) {
      lines.push(`  Configurable params:`);
      for (const p of m.params) {
        lines.push(`    ${p.name} (default ${p.default}): ${p.description}`);
        lines.push(
          `      Trader phrases: ${p.traderPhrases
            .slice(0, 3)
            .map((s) => `"${s}"`)
            .join(", ")}`,
        );
      }
    }
    lines.push(`  Inline API:`);
    lines.push(`    Reset:  ${m.inlineApi.reset}`);
    lines.push(`    Tick:   ${m.inlineApi.tick}`);
    for (const s of m.inlineApi.signals) {
      lines.push(`    ${s.fn.padEnd(42)} → ${s.returns}: ${s.meaning}`);
    }
    lines.push(`  Example phrases: "${m.examplePhrases[0]}", "${m.examplePhrases[1] ?? ""}"`);
    lines.push(`  Combines well with: ${m.combinesWith.join(", ")}`);
    lines.push("");
  }

  lines.push("╔══════════════════════════════════════════════════════════════════╗");
  lines.push("║                    END OF MODULE LIBRARY                        ║");
  lines.push("╚══════════════════════════════════════════════════════════════════╝");

  return lines.join("\n");
}
