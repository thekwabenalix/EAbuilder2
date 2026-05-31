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
    concept: "Detects when price closes beyond a confirmed swing high or low, signalling continuation of the current trend.",
    detectionLogic: "Identifies swing pivots (price must be higher/lower than N bars on both sides). When a candle CLOSES beyond an unconsumed pivot, a BOS fires and the trend state updates persistently. Each pivot can generate exactly one BOS — consumed pivots are never re-used.",
    roles: [
      { role: "direction", fit: "primary",   usage: "BOS fires → trend direction set to BULL or BEAR. Persists until opposite BOS." },
      { role: "setup",     fit: "secondary", usage: "Fresh BOS in bias direction means momentum is active — valid setup zone." },
      { role: "execution", fit: "possible",  usage: "Enter on the BOS bar itself if risk allows — break-and-go entry." },
    ],
    lifecycle: "Swing pivot formed → price closes beyond it → BOS fires (one-time event) → trend bias updated persistently",
    params: [
      { name: "swingLen", type: "int", default: 5, range: [2, 20],
        description: "Bars on each side needed to confirm a pivot high/low",
        traderPhrases: ["5-bar pivot", "use 3 bars each side", "strict pivots", "loose pivots"] },
      { name: "lookback", type: "int", default: 20, range: [10, 100],
        description: "How many bars back to scan for swing levels",
        traderPhrases: ["last 20 bars", "look back 30 bars", "recent structure only"] },
    ],
    outputStates: [
      { name: "IsBull()", meaning: "Trend is currently BULL", tradingImplication: "Only take buy setups" },
      { name: "IsBear()", meaning: "Trend is currently BEAR", tradingImplication: "Only take sell setups" },
      { name: "BullJustBroke()", meaning: "BOS BULL fired on this exact bar", tradingImplication: "Fresh momentum — immediate entry or start watching for setup" },
      { name: "BearJustBroke()", meaning: "BOS BEAR fired on this exact bar", tradingImplication: "Fresh momentum — immediate entry or start watching for setup" },
    ],
    inlineApi: {
      tick: "BOSSM_{id}_Tick(lookback)",
      signals: [
        { fn: "BOSSM_{id}_IsBull()",        returns: "bool",   meaning: "Trend is BULL (persistent)" },
        { fn: "BOSSM_{id}_IsBear()",        returns: "bool",   meaning: "Trend is BEAR (persistent)" },
        { fn: "BOSSM_{id}_BullJustBroke()", returns: "bool",   meaning: "BOS BULL fired this bar" },
        { fn: "BOSSM_{id}_BearJustBroke()", returns: "bool",   meaning: "BOS BEAR fired this bar" },
        { fn: "BOSSM_{id}_Trend()",         returns: "int",    meaning: "1=BULL, -1=BEAR, 0=UNKNOWN" },
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
    concept: "Fires ONLY when price breaks structure AGAINST the current trend — a signal that the trend may be reversing.",
    detectionLogic: "Same swing pivot detection as BOS. But CHoCH fires ONLY on counter-trend breaks: in a BEAR trend, a close above a swing high = Bull CHoCH. In a BULL trend, a close below a swing low = Bear CHoCH. With-trend breaks are silently consumed (not drawn). This filters noise and highlights genuine reversals.",
    roles: [
      { role: "direction", fit: "primary",   usage: "CHoCH fires → direction flips. Trade the new direction until next CHoCH." },
      { role: "setup",     fit: "possible",  usage: "Fresh CHoCH near key level = high-probability reversal setup." },
    ],
    lifecycle: "Trend established → counter-trend break fires CHoCH → trend flips to opposite direction",
    params: [
      { name: "swingLen", type: "int", default: 5, range: [2, 20],
        description: "Pivot confirmation bars",
        traderPhrases: ["5-bar pivots", "use swing strength of 3"] },
    ],
    outputStates: [
      { name: "IsBull()",        meaning: "After bull CHoCH — now looking for buys", tradingImplication: "Bias is BULL" },
      { name: "IsBear()",        meaning: "After bear CHoCH — now looking for sells", tradingImplication: "Bias is BEAR" },
      { name: "BullJustBroke()", meaning: "Bull CHoCH fired this bar", tradingImplication: "Trend just flipped bullish — start fresh" },
      { name: "BearJustBroke()", meaning: "Bear CHoCH fired this bar", tradingImplication: "Trend just flipped bearish" },
    ],
    inlineApi: {
      tick: "BOSSM_{id}_Tick(lookback)  // generated with mode='choch'",
      signals: [
        { fn: "BOSSM_{id}_IsBull()",        returns: "bool", meaning: "Bias is BULL (post CHoCH)" },
        { fn: "BOSSM_{id}_IsBear()",        returns: "bool", meaning: "Bias is BEAR (post CHoCH)" },
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
    concept: "A 3-candle imbalance where C3.Low > C1.High (bull) or C3.High < C1.Low (bear). Tracks the zone from formation through retest and confirmation.",
    detectionLogic: "Scans each bar for a 3-candle formation where candle 3's low is above candle 1's high (bullish gap) or candle 3's high is below candle 1's low (bearish gap). Zone is stored with its upper limit (UL) and lower limit (LL). State machine tracks: ACTIVE (gap born) → RETESTED (wick enters zone) → CONFIRMED (close exits back outside near edge). Terminal states: MITIGATED (close inside zone), INVALIDATED (close through far edge), EXPIRED (too old).",
    roles: [
      { role: "setup",     fit: "primary",   usage: "Active FVG in bias direction = there is a zone to retest. Setup is active while zone is ACTIVE or RETESTED." },
      { role: "execution", fit: "primary",   usage: "FVG CONFIRMED = price retested the zone and held. Entry fires on confirmation bar." },
      { role: "direction", fit: "possible",  usage: "Recent FVG direction can indicate short-term momentum bias." },
    ],
    lifecycle: "3-candle gap formed → ACTIVE → wick enters zone → RETESTED → close holds outside near edge → CONFIRMED | MITIGATED | INVALIDATED | EXPIRED",
    params: [
      { name: "expiryBars", type: "int", default: 100, range: [10, 500],
        description: "Bars before an unmitigated FVG expires",
        traderPhrases: ["expire after 50 bars", "use only recent FVGs", "keep FVGs for 200 bars"] },
    ],
    outputStates: [
      { name: "HasActiveBull()",     meaning: "A bull FVG zone exists and has not been mitigated/invalidated", tradingImplication: "Setup zone present — watch for retest" },
      { name: "HasActiveBear()",     meaning: "A bear FVG zone is live",         tradingImplication: "Setup zone present" },
      { name: "BullJustConfirmed()", meaning: "Bull FVG retested and confirmed this bar", tradingImplication: "ENTRY SIGNAL — price respected the gap and bounced" },
      { name: "BearJustConfirmed()", meaning: "Bear FVG confirmed this bar",     tradingImplication: "ENTRY SIGNAL" },
      { name: "BullConfirmSL()",     meaning: "SL price = lowest wick during the retest", tradingImplication: "Use as stop-loss for the entry" },
      { name: "BearConfirmSL()",     meaning: "SL price = highest wick during the retest", tradingImplication: "Use as stop-loss" },
    ],
    inlineApi: {
      tick: "FVGSM_{id}_Tick(lookback)",
      signals: [
        { fn: "FVGSM_{id}_HasActiveBull()",     returns: "bool",   meaning: "Live bull FVG zone" },
        { fn: "FVGSM_{id}_HasActiveBear()",     returns: "bool",   meaning: "Live bear FVG zone" },
        { fn: "FVGSM_{id}_BullJustConfirmed()", returns: "bool",   meaning: "Bull FVG confirmed — entry signal" },
        { fn: "FVGSM_{id}_BearJustConfirmed()", returns: "bool",   meaning: "Bear FVG confirmed — entry signal" },
        { fn: "FVGSM_{id}_BullConfirmSL()",     returns: "double", meaning: "SL for bull entries" },
        { fn: "FVGSM_{id}_BearConfirmSL()",     returns: "double", meaning: "SL for bear entries" },
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
    concept: "A FVG that price closes THROUGH — flipping its polarity. A bullish FVG that gets closed below becomes a bearish iFVG (resistance). A bearish FVG closed above becomes a bullish iFVG (support).",
    detectionLogic: "First detects all FVGs. Then monitors for close-through events: bull FVG closed below LL → bear iFVG born. Bear FVG closed above UL → bull iFVG born. The inverted zone then tracks ACTIVE → RETESTED → CONFIRMED as the price returns to it from the new direction.",
    roles: [
      { role: "direction", fit: "primary",   usage: "iFVG confirmed = polarity flip confirmed. Sets directional bias." },
      { role: "setup",     fit: "primary",   usage: "Active iFVG zone = setup waiting for retest entry." },
      { role: "execution", fit: "primary",   usage: "iFVG CONFIRMED = high-probability entry after polarity-flip retest." },
    ],
    lifecycle: "FVG formed → price closes THROUGH it → iFVG born (opposite direction) → ACTIVE → RETESTED → CONFIRMED",
    params: [
      { name: "expiryBars", type: "int", default: 100, range: [10, 500],
        description: "Bars before iFVG expires",
        traderPhrases: ["50-bar expiry", "expire old iFVGs after 100 bars"] },
    ],
    outputStates: [
      { name: "HasActiveBull()",     meaning: "A bull iFVG zone is live",          tradingImplication: "Polarity support zone present — wait for retest" },
      { name: "HasActiveBear()",     meaning: "A bear iFVG zone is live",          tradingImplication: "Polarity resistance zone present" },
      { name: "BullJustConfirmed()", meaning: "Bull iFVG retested and confirmed",  tradingImplication: "ENTRY — zone held after polarity flip" },
      { name: "BearJustConfirmed()", meaning: "Bear iFVG confirmed",               tradingImplication: "ENTRY" },
      { name: "BullConfirmSL()",     meaning: "Retest low — use as SL",            tradingImplication: "Tight SL at zone boundary" },
      { name: "BearConfirmSL()",     meaning: "Retest high — use as SL",           tradingImplication: "Tight SL at zone boundary" },
    ],
    inlineApi: {
      tick: "IFVGSM_{id}_Tick(lookback)",
      signals: [
        { fn: "IFVGSM_{id}_HasActiveBull()",     returns: "bool",   meaning: "Live bull iFVG zone" },
        { fn: "IFVGSM_{id}_HasActiveBear()",     returns: "bool",   meaning: "Live bear iFVG zone" },
        { fn: "IFVGSM_{id}_BullJustConfirmed()", returns: "bool",   meaning: "Bull iFVG confirmed — entry" },
        { fn: "IFVGSM_{id}_BearJustConfirmed()", returns: "bool",   meaning: "Bear iFVG confirmed — entry" },
        { fn: "IFVGSM_{id}_BullConfirmSL()",     returns: "double", meaning: "SL for bull entries" },
        { fn: "IFVGSM_{id}_BearConfirmSL()",     returns: "double", meaning: "SL for bear entries" },
        { fn: "IFVGSM_{id}_LatestBullLL()",      returns: "double", meaning: "Lower limit of the most recent bull iFVG" },
        { fn: "IFVGSM_{id}_LatestBearUL()",      returns: "double", meaning: "Upper limit of the most recent bear iFVG" },
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
    concept: "The last opposing candle before a strong ATR-displacement move. Represents institutional order flow. Tracks the zone through ACTIVE → RETESTED → CONFIRMED.",
    detectionLogic: "Identifies displacement moves: candles where body >= dispMult × candle range. Then looks back up to scanBack bars for the last candle moving in the opposite direction — this is the OB. Zone is UL = OB high, LL = OB low. Lifecycle mirrors FVG: ACTIVE until retested, CONFIRMED after close holds outside near edge, MITIGATED if close trades inside zone.",
    roles: [
      { role: "setup",     fit: "primary",   usage: "Active OB in bias direction = institutional zone to watch. Setup active while OB is live." },
      { role: "execution", fit: "primary",   usage: "OB CONFIRMED = price retested the zone and institutional orders held. Entry signal." },
      { role: "direction", fit: "possible",  usage: "Strong OB with large displacement indicates directional momentum." },
    ],
    lifecycle: "Displacement detected → last opposing candle becomes OB zone → ACTIVE → RETESTED → CONFIRMED | MITIGATED | INVALIDATED | EXPIRED",
    params: [
      { name: "dispMult",   type: "double", default: 0.6, range: [0.4, 0.9],
        description: "Body must be >= dispMult × candle range to count as displacement",
        traderPhrases: ["strong displacement candles only", "use 70% body filter", "looser displacement filter"] },
      { name: "scanBack",   type: "int",    default: 5, range: [1, 10],
        description: "Bars before displacement to look for the OB candle",
        traderPhrases: ["look 3 bars before the move", "scan back 5 candles"] },
      { name: "expiryBars", type: "int",    default: 100, range: [10, 500],
        description: "Bars before OB expires",
        traderPhrases: ["expire after 50 bars", "keep OBs for 200 bars"] },
    ],
    outputStates: [
      { name: "HasActiveBull()",     meaning: "A bull OB zone is live",          tradingImplication: "Demand zone present" },
      { name: "HasActiveBear()",     meaning: "A bear OB zone is live",          tradingImplication: "Supply zone present" },
      { name: "BullJustConfirmed()", meaning: "Bull OB retested and confirmed",  tradingImplication: "ENTRY — institutional demand held" },
      { name: "BearJustConfirmed()", meaning: "Bear OB confirmed",               tradingImplication: "ENTRY — institutional supply held" },
      { name: "BullConfirmSL()",     meaning: "SL below the OB (OB low)",        tradingImplication: "Place SL below zone" },
      { name: "BearConfirmSL()",     meaning: "SL above the OB (OB high)",       tradingImplication: "Place SL above zone" },
    ],
    inlineApi: {
      tick: "OBSM_{id}_Tick(lookback)",
      signals: [
        { fn: "OBSM_{id}_HasActiveBull()",     returns: "bool",   meaning: "Live bull OB" },
        { fn: "OBSM_{id}_HasActiveBear()",     returns: "bool",   meaning: "Live bear OB" },
        { fn: "OBSM_{id}_BullJustConfirmed()", returns: "bool",   meaning: "Bull OB confirmed — entry" },
        { fn: "OBSM_{id}_BearJustConfirmed()", returns: "bool",   meaning: "Bear OB confirmed — entry" },
        { fn: "OBSM_{id}_BullConfirmSL()",     returns: "double", meaning: "SL for bull entries" },
        { fn: "OBSM_{id}_BearConfirmSL()",     returns: "double", meaning: "SL for bear entries" },
        { fn: "OBSM_{id}_LatestBullLL()",      returns: "double", meaning: "Lower limit of most recent bull OB" },
        { fn: "OBSM_{id}_LatestBearUL()",      returns: "double", meaning: "Upper limit of most recent bear OB" },
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
    concept: "Price wicks beyond a swing extreme (sweeping liquidity/stops), then closes back inside. The close-back IS the confirmation signal.",
    detectionLogic: "Confirms swing pivots. When a candle's wick pierces a swing level AND the SAME candle closes back on the correct side, a CONFIRMED sweep fires immediately. The wick extreme becomes the SL. No waiting for a separate retest candle — the close-back is the entry signal.",
    roles: [
      { role: "execution", fit: "primary",   usage: "Sweep CONFIRMED = immediate entry signal. SL at wick extreme." },
      { role: "setup",     fit: "secondary", usage: "Sweep sets context that liquidity has been cleared — setup for continuation." },
    ],
    lifecycle: "Swing pivot confirmed → wick sweeps beyond it → SAME BAR close-back → CONFIRMED (SL = wick extreme)",
    params: [
      { name: "swingLen", type: "int", default: 3, range: [2, 10],
        description: "Bars each side to confirm a swing pivot",
        traderPhrases: ["use 3-bar pivots", "strict swing confirmation"] },
      { name: "lookback", type: "int", default: 20, range: [5, 50],
        description: "Bars to scan for swing levels",
        traderPhrases: ["recent swings only", "look back 30 bars"] },
    ],
    outputStates: [
      { name: "BullJustConfirmed()", meaning: "Bull sweep: wick below swing low + close above it",  tradingImplication: "ENTRY LONG — stops hunted, now go up" },
      { name: "BearJustConfirmed()", meaning: "Bear sweep: wick above swing high + close below it", tradingImplication: "ENTRY SHORT — stops hunted, now go down" },
      { name: "BullConfirmSL()",     meaning: "Wick low of the sweep candle",                       tradingImplication: "Tight SL — place just below the wick" },
      { name: "BearConfirmSL()",     meaning: "Wick high of the sweep candle",                      tradingImplication: "Tight SL — place just above the wick" },
    ],
    inlineApi: {
      tick: "LSSM_{id}_Tick(lookback)",
      signals: [
        { fn: "LSSM_{id}_BullJustConfirmed()", returns: "bool",   meaning: "Bull sweep confirmed" },
        { fn: "LSSM_{id}_BearJustConfirmed()", returns: "bool",   meaning: "Bear sweep confirmed" },
        { fn: "LSSM_{id}_BullConfirmSL()",     returns: "double", meaning: "SL = wick low" },
        { fn: "LSSM_{id}_BearConfirmSL()",     returns: "double", meaning: "SL = wick high" },
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
    concept: "Two moving averages (fast and slow) whose relative position defines the trend direction. When fast > slow = BULL. When fast < slow = BEAR.",
    detectionLogic: "Calculates rolling average of close prices for fast period and slow period. Compares fast vs slow. For Direction brain, the alignment is checked every bar and is persistent. For Execution brain, the CROSS event fires once when the relationship changes.",
    roles: [
      { role: "direction", fit: "primary",   usage: "Fast > slow = BULL bias. Fast < slow = BEAR bias. Persistent trend filter." },
      { role: "setup",     fit: "secondary", usage: "Price pulling back to the EMA = setup zone. EMA acting as dynamic support/resistance." },
    ],
    lifecycle: "Persistent alignment check. Direction flips when fast/slow relationship crosses.",
    params: [
      { name: "fastPeriod", type: "int", default: 21, range: [5, 50],
        description: "Fast EMA period",
        traderPhrases: ["EMA 21", "fast EMA of 9", "12-period EMA", "use the 50 EMA as fast"] },
      { name: "slowPeriod", type: "int", default: 50, range: [20, 200],
        description: "Slow EMA period",
        traderPhrases: ["EMA 50", "slow EMA of 200", "use 200 as the trend filter"] },
    ],
    outputStates: [
      { name: "fast > slow", meaning: "Bullish alignment",  tradingImplication: "Only take buys" },
      { name: "fast < slow", meaning: "Bearish alignment",  tradingImplication: "Only take sells" },
      { name: "Cross up",    meaning: "Golden cross event", tradingImplication: "Start looking for buys" },
      { name: "Cross down",  meaning: "Death cross event",  tradingImplication: "Start looking for sells" },
    ],
    inlineApi: {
      tick: "(inline rolling average — no state machine reset needed)",
      signals: [
        { fn: "Inline: fastMA > slowMA", returns: "bool", meaning: "BULL alignment" },
        { fn: "Inline: fastMA < slowMA", returns: "bool", meaning: "BEAR alignment" },
      ],
      reset: "(none required)",
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

  // ─── Engulfing ───────────────────────────────────────────────────────────────
  {
    id: "engulfing",
    label: "Engulfing Candle",
    aliases: [
      { phrase: "engulfing" },
      { phrase: "engulfing candle" },
      { phrase: "engulfing pattern" },
      { phrase: "bullish engulfing" },
      { phrase: "bearish engulfing" },
      { phrase: "reversal candle" },
      { phrase: "strong close candle" },
      { phrase: "outside bar" },
    ],
    concept: "A strong reversal candle whose body completely engulfs the previous candle. Indicates decisive directional momentum.",
    detectionLogic: "Checks the relationship between the current candle (c1) and the previous candle (c2). Bullish: c1 close > c1 open, c2 close < c2 open, c1 close >= c2 open, c1 open <= c2 close. Bearish: inverse. Point-in-time signal — no state machine.",
    roles: [
      { role: "execution", fit: "primary", usage: "Engulfing pattern aligned with bias = entry signal. SL at wick of engulfing candle." },
    ],
    lifecycle: "Point-in-time — fires on the bar the pattern completes",
    params: [],
    outputStates: [
      { name: "Bull engulfing", meaning: "Bullish reversal candle",  tradingImplication: "ENTRY LONG — strong buying pressure" },
      { name: "Bear engulfing", meaning: "Bearish reversal candle",  tradingImplication: "ENTRY SHORT" },
    ],
    inlineApi: {
      tick: "(none — inline check at bar open)",
      signals: [
        { fn: "c1>o1 && c2<o2 && c1>=o2 && o1<=c2", returns: "bool", meaning: "Bullish engulfing" },
        { fn: "c1<o1 && c2>o2 && c1<=o2 && o1>=c2", returns: "bool", meaning: "Bearish engulfing" },
      ],
      reset: "(none)",
    },
    examplePhrases: [
      "Enter on engulfing candle after FVG setup",
      "Use engulfing candle for execution",
      "Wait for a strong reversal candle at the zone",
      "Bullish engulfing at the demand zone = buy signal",
      "Enter on an outside bar at the order block",
    ],
    notSuitedFor: ["Direction bias or setup — this is purely an entry trigger"],
    combinesWith: ["fvg", "order_block", "liqsweep", "bos"],
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
    concept: "A candle with a long wick (>= 60% of range) rejecting a level, with a small body (<= 35% of range). The wick represents failed price acceptance.",
    detectionLogic: "Calculates wick and body ratios from the bar. Bull pin: lower wick >= 60% of range AND body <= 35% of range. Bear pin: upper wick >= 60%. Point-in-time signal.",
    roles: [
      { role: "execution", fit: "primary", usage: "Pin bar at key level aligned with bias = rejection entry. SL at wick tip." },
    ],
    lifecycle: "Point-in-time — fires on the bar the pattern completes",
    params: [],
    outputStates: [
      { name: "Bull pin bar", meaning: "Lower wick rejection — price rejected lower prices",  tradingImplication: "ENTRY LONG" },
      { name: "Bear pin bar", meaning: "Upper wick rejection — price rejected higher prices", tradingImplication: "ENTRY SHORT" },
    ],
    inlineApi: {
      tick: "(none — inline check at bar open)",
      signals: [
        { fn: "lwick >= range*0.6 && body <= range*0.35", returns: "bool", meaning: "Bull pin bar" },
        { fn: "uwick >= range*0.6 && body <= range*0.35", returns: "bool", meaning: "Bear pin bar" },
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
    lines.push(`  Trader calls it: ${m.aliases.slice(0, 8).map(a => `"${a.phrase}"`).join(", ")}`);
    // Primary roles
    const primary = m.roles.filter(r => r.fit === "primary").map(r => r.role);
    const secondary = m.roles.filter(r => r.fit !== "primary").map(r => r.role);
    lines.push(`  Best role: ${primary.join(", ")}${secondary.length ? ` | also works as: ${secondary.join(", ")}` : ""}`);
    // Params (compact)
    if (m.params.length > 0) {
      const pList = m.params.map(p => `${p.name}=${p.default}`).join(", ");
      lines.push(`  Params: ${pList}`);
    }
    // Inline API
    lines.push(`  Reset: ${m.inlineApi.reset}`);
    lines.push(`  Tick:  ${m.inlineApi.tick}`);
    for (const s of m.inlineApi.signals.slice(0, 6)) {
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
    lines.push(`  Aliases: ${m.aliases.map(a => `"${a.phrase}"`).join(", ")}`);
    lines.push(`  Best roles: ${m.roles.filter(r => r.fit === "primary").map(r => r.role.toUpperCase()).join(", ")}`);
    lines.push(`  Can also do: ${m.roles.filter(r => r.fit !== "primary").map(r => `${r.role} (${r.fit})`).join(", ") || "—"}`);
    lines.push(`  Role usage:`);
    for (const r of m.roles) {
      lines.push(`    ${r.role.padEnd(12)}: ${r.usage}`);
    }
    if (m.params.length > 0) {
      lines.push(`  Configurable params:`);
      for (const p of m.params) {
        lines.push(`    ${p.name} (default ${p.default}): ${p.description}`);
        lines.push(`      Trader phrases: ${p.traderPhrases.slice(0, 3).map(s => `"${s}"`).join(", ")}`);
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
