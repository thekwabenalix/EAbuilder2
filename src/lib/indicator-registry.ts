/**
 * Built-in MT5 Indicator Registry
 *
 * MT5 ships these indicators natively. We do NOT rebuild them as custom detection
 * modules — instead the AI/generator references them through MQL5's built-in
 * indicator functions (handle + CopyBuffer). This file is the declarative
 * vocabulary the AI may reference: function name, parameters, output buffers,
 * category, and typical applications.
 *
 * Pattern the generator follows (already implemented for MA via B4_MA/B4_MAval):
 *   int h = iRSI(symbol, tf, period, applied_price);   // create handle
 *   double v; CopyBuffer(h, 0, shift, 1, ...);          // read buffer 0
 *
 * `via`:
 *   "builtin" — a native iX() function (iMA, iRSI, ...).
 *   "icustom" — ships in MetaTrader's Indicators\Examples folder; referenced via
 *               iCustom(symbol, tf, "Examples\\Name", ...). Params vary per .ex5.
 *
 * Custom modules are only built for concepts MT5 does NOT understand natively
 * (FVG, IFVG, OB, BOS, CHoCH, Classic/Gap SNR, SNRC2, MEF, QM_MEF, Engulfing,
 * RBR/DBD, ...). Those live in smc-modules / generators.
 */

export type IndicatorCategory =
  | "trend"
  | "oscillator"
  | "volume"
  | "bill_williams"
  | "custom_included";

export type IndicatorVia = "builtin" | "icustom";

export interface IndicatorParam {
  name: string;
  type: "int" | "double" | "enum";
  default: number | string;
  min?: number;
  max?: number;
  note?: string;
}

export interface IndicatorBuffer {
  index: number;
  name: string;
}

export interface BuiltinIndicator {
  id: string;
  name: string;
  mql5: string; // MQL5 function name, e.g. "iMA" (or "iCustom" for via=icustom)
  signature: string; // full call signature for reference
  category: IndicatorCategory;
  via: IndicatorVia;
  params: IndicatorParam[];
  buffers: IndicatorBuffer[];
  /** true = renders in a separate sub-window (RSI, MACD, ...); false = overlays price */
  subWindow: boolean;
  aliases: string[];
  description: string;
  applications: string[];
}

const APPLIED_PRICE: IndicatorParam = {
  name: "applied_price",
  type: "enum",
  default: "PRICE_CLOSE",
  note: "PRICE_CLOSE | PRICE_OPEN | PRICE_HIGH | PRICE_LOW | PRICE_MEDIAN | PRICE_TYPICAL | PRICE_WEIGHTED",
};
const APPLIED_VOLUME: IndicatorParam = {
  name: "applied_volume",
  type: "enum",
  default: "VOLUME_TICK",
  note: "VOLUME_TICK | VOLUME_REAL",
};
const MA_METHOD: IndicatorParam = {
  name: "ma_method",
  type: "enum",
  default: "MODE_SMA",
  note: "MODE_SMA | MODE_EMA | MODE_SMMA | MODE_LWMA",
};

export const INDICATOR_REGISTRY: BuiltinIndicator[] = [
  // ── Trend ──────────────────────────────────────────────────────────────────
  {
    id: "ma",
    name: "Moving Average (EMA / SMA / SMMA / LWMA)",
    mql5: "iMA",
    signature: "iMA(symbol, tf, ma_period, ma_shift, ma_method, applied_price)",
    category: "trend",
    via: "builtin",
    params: [
      { name: "ma_period", type: "int", default: 50, min: 1, max: 1000 },
      { name: "ma_shift", type: "int", default: 0, min: 0, max: 100 },
      { ...MA_METHOD, default: "MODE_EMA" },
      APPLIED_PRICE,
    ],
    buffers: [{ index: 0, name: "MA line" }],
    subWindow: false,
    aliases: ["ema", "sma", "moving average", "ma", "smma", "lwma", "wma"],
    description:
      "Moving average of price; EMA/SMA/etc. via ma_method. Wired in the assembler " +
      "via B4_MA()/B4_MAval(); the EMA brain uses it directly.",
    applications: ["Direction Brain", "Trend filter", "Retest filter", "Crossovers"],
  },
  {
    id: "ama",
    name: "Adaptive Moving Average (AMA)",
    mql5: "iAMA",
    signature: "iAMA(symbol, tf, ama_period, fast_ema_period, slow_ema_period, ama_shift, applied_price)",
    category: "trend",
    via: "builtin",
    params: [
      { name: "ama_period", type: "int", default: 9, min: 1, max: 1000 },
      { name: "fast_ema_period", type: "int", default: 2, min: 1, max: 1000 },
      { name: "slow_ema_period", type: "int", default: 30, min: 1, max: 1000 },
      { name: "ama_shift", type: "int", default: 0, min: 0, max: 100 },
      APPLIED_PRICE,
    ],
    buffers: [{ index: 0, name: "AMA line" }],
    subWindow: false,
    aliases: ["ama", "adaptive moving average", "kaufman"],
    description: "Kaufman adaptive MA — speeds up in trends, slows in chop.",
    applications: ["Trend filter", "Direction Brain"],
  },
  {
    id: "bands",
    name: "Bollinger Bands",
    mql5: "iBands",
    signature: "iBands(symbol, tf, bands_period, bands_shift, deviation, applied_price)",
    category: "trend",
    via: "builtin",
    params: [
      { name: "bands_period", type: "int", default: 20, min: 1, max: 1000 },
      { name: "bands_shift", type: "int", default: 0, min: 0, max: 100 },
      { name: "deviation", type: "double", default: 2.0, min: 0.1, max: 10 },
      APPLIED_PRICE,
    ],
    buffers: [
      { index: 0, name: "BASE (middle)" },
      { index: 1, name: "UPPER" },
      { index: 2, name: "LOWER" },
    ],
    subWindow: false,
    aliases: ["bollinger", "bollinger bands", "bbands", "bands"],
    description: "Volatility envelope around an MA.",
    applications: ["Mean reversion", "Volatility expansion", "Squeeze detection"],
  },
  {
    id: "envelopes",
    name: "Envelopes",
    mql5: "iEnvelopes",
    signature: "iEnvelopes(symbol, tf, ma_period, ma_shift, ma_method, applied_price, deviation)",
    category: "trend",
    via: "builtin",
    params: [
      { name: "ma_period", type: "int", default: 14, min: 1, max: 1000 },
      { name: "ma_shift", type: "int", default: 0, min: 0, max: 100 },
      MA_METHOD,
      APPLIED_PRICE,
      { name: "deviation", type: "double", default: 0.1, min: 0.01, max: 10, note: "percent" },
    ],
    buffers: [
      { index: 0, name: "UPPER" },
      { index: 1, name: "LOWER" },
    ],
    subWindow: false,
    aliases: ["envelopes", "envelope"],
    description: "Percentage envelope around an MA.",
    applications: ["Mean reversion", "Overextension filter"],
  },
  {
    id: "frama",
    name: "Fractal Adaptive Moving Average (FrAMA)",
    mql5: "iFrAMA",
    signature: "iFrAMA(symbol, tf, ma_period, ma_shift, applied_price)",
    category: "trend",
    via: "builtin",
    params: [
      { name: "ma_period", type: "int", default: 14, min: 1, max: 1000 },
      { name: "ma_shift", type: "int", default: 0, min: 0, max: 100 },
      APPLIED_PRICE,
    ],
    buffers: [{ index: 0, name: "FrAMA line" }],
    subWindow: false,
    aliases: ["frama", "fractal adaptive moving average"],
    description: "MA whose smoothing adapts to fractal dimension (volatility).",
    applications: ["Trend filter"],
  },
  {
    id: "ichimoku",
    name: "Ichimoku Kinko Hyo",
    mql5: "iIchimoku",
    signature: "iIchimoku(symbol, tf, tenkan_sen, kijun_sen, senkou_span_b)",
    category: "trend",
    via: "builtin",
    params: [
      { name: "tenkan_sen", type: "int", default: 9, min: 1, max: 1000 },
      { name: "kijun_sen", type: "int", default: 26, min: 1, max: 1000 },
      { name: "senkou_span_b", type: "int", default: 52, min: 1, max: 1000 },
    ],
    buffers: [
      { index: 0, name: "TENKAN" },
      { index: 1, name: "KIJUN" },
      { index: 2, name: "SENKOUSPANA" },
      { index: 3, name: "SENKOUSPANB" },
      { index: 4, name: "CHIKOUSPAN" },
    ],
    subWindow: false,
    aliases: ["ichimoku", "kumo", "cloud", "tenkan", "kijun"],
    description: "Full Ichimoku system: lines + cloud (Senkou A/B).",
    applications: ["Direction Brain", "Trend filter", "Dynamic S/R"],
  },
  {
    id: "sar",
    name: "Parabolic SAR",
    mql5: "iSAR",
    signature: "iSAR(symbol, tf, step, maximum)",
    category: "trend",
    via: "builtin",
    params: [
      { name: "step", type: "double", default: 0.02, min: 0.001, max: 1 },
      { name: "maximum", type: "double", default: 0.2, min: 0.01, max: 1 },
    ],
    buffers: [{ index: 0, name: "SAR dots" }],
    subWindow: false,
    aliases: ["sar", "parabolic sar", "psar"],
    description: "Trailing stop / reversal dots.",
    applications: ["Trailing stop", "Trend direction"],
  },
  {
    id: "stddev",
    name: "Standard Deviation",
    mql5: "iStdDev",
    signature: "iStdDev(symbol, tf, ma_period, ma_shift, ma_method, applied_price)",
    category: "trend",
    via: "builtin",
    params: [
      { name: "ma_period", type: "int", default: 20, min: 1, max: 1000 },
      { name: "ma_shift", type: "int", default: 0, min: 0, max: 100 },
      MA_METHOD,
      APPLIED_PRICE,
    ],
    buffers: [{ index: 0, name: "StdDev value" }],
    subWindow: true,
    aliases: ["stddev", "standard deviation", "sd"],
    description: "Statistical dispersion of price — a volatility gauge.",
    applications: ["Volatility filter", "Squeeze detection"],
  },

  // ── Oscillators ─────────────────────────────────────────────────────────────
  {
    id: "atr",
    name: "Average True Range (ATR)",
    mql5: "iATR",
    signature: "iATR(symbol, tf, ma_period)",
    category: "oscillator",
    via: "builtin",
    params: [{ name: "ma_period", type: "int", default: 14, min: 1, max: 1000 }],
    buffers: [{ index: 0, name: "ATR value" }],
    subWindow: true,
    aliases: ["atr", "average true range", "volatility"],
    description: "Volatility in price units.",
    applications: ["Volatility filter", "Dynamic SL", "Dynamic TP", "Min candle size"],
  },
  {
    id: "bears",
    name: "Bears Power",
    mql5: "iBearsPower",
    signature: "iBearsPower(symbol, tf, ma_period)",
    category: "oscillator",
    via: "builtin",
    params: [{ name: "ma_period", type: "int", default: 13, min: 1, max: 1000 }],
    buffers: [{ index: 0, name: "Bears Power" }],
    subWindow: true,
    aliases: ["bears power", "bears"],
    description: "Strength of sellers relative to an EMA.",
    applications: ["Momentum filter"],
  },
  {
    id: "bulls",
    name: "Bulls Power",
    mql5: "iBullsPower",
    signature: "iBullsPower(symbol, tf, ma_period)",
    category: "oscillator",
    via: "builtin",
    params: [{ name: "ma_period", type: "int", default: 13, min: 1, max: 1000 }],
    buffers: [{ index: 0, name: "Bulls Power" }],
    subWindow: true,
    aliases: ["bulls power", "bulls"],
    description: "Strength of buyers relative to an EMA.",
    applications: ["Momentum filter"],
  },
  {
    id: "cci",
    name: "Commodity Channel Index (CCI)",
    mql5: "iCCI",
    signature: "iCCI(symbol, tf, ma_period, applied_price)",
    category: "oscillator",
    via: "builtin",
    params: [
      { name: "ma_period", type: "int", default: 14, min: 1, max: 1000 },
      APPLIED_PRICE,
    ],
    buffers: [{ index: 0, name: "CCI value" }],
    subWindow: true,
    aliases: ["cci", "commodity channel index"],
    description: "Deviation from average — overbought/oversold beyond ±100.",
    applications: ["Overbought/oversold", "Divergence"],
  },
  {
    id: "demarker",
    name: "DeMarker",
    mql5: "iDeMarker",
    signature: "iDeMarker(symbol, tf, ma_period)",
    category: "oscillator",
    via: "builtin",
    params: [{ name: "ma_period", type: "int", default: 14, min: 1, max: 1000 }],
    buffers: [{ index: 0, name: "DeMarker (0–1)" }],
    subWindow: true,
    aliases: ["demarker", "dem"],
    description: "Exhaustion oscillator 0–1.",
    applications: ["Overbought/oversold", "Reversal"],
  },
  {
    id: "force",
    name: "Force Index",
    mql5: "iForce",
    signature: "iForce(symbol, tf, ma_period, ma_method, applied_volume)",
    category: "oscillator",
    via: "builtin",
    params: [
      { name: "ma_period", type: "int", default: 13, min: 1, max: 1000 },
      MA_METHOD,
      APPLIED_VOLUME,
    ],
    buffers: [{ index: 0, name: "Force Index" }],
    subWindow: true,
    aliases: ["force index", "force"],
    description: "Combines price move and volume into a force reading.",
    applications: ["Momentum filter", "Volume confirmation"],
  },
  {
    id: "macd",
    name: "MACD",
    mql5: "iMACD",
    signature: "iMACD(symbol, tf, fast_ema_period, slow_ema_period, signal_period, applied_price)",
    category: "oscillator",
    via: "builtin",
    params: [
      { name: "fast_ema_period", type: "int", default: 12, min: 1, max: 500 },
      { name: "slow_ema_period", type: "int", default: 26, min: 1, max: 500 },
      { name: "signal_period", type: "int", default: 9, min: 1, max: 500 },
      APPLIED_PRICE,
    ],
    buffers: [
      { index: 0, name: "MAIN (MACD line)" },
      { index: 1, name: "SIGNAL line" },
    ],
    subWindow: true,
    aliases: ["macd", "moving average convergence divergence"],
    description: "Trend/momentum via fast vs slow EMA and a signal line.",
    applications: ["Momentum confirmation", "Trend confirmation", "Divergence"],
  },
  {
    id: "momentum",
    name: "Momentum",
    mql5: "iMomentum",
    signature: "iMomentum(symbol, tf, mom_period, applied_price)",
    category: "oscillator",
    via: "builtin",
    params: [
      { name: "mom_period", type: "int", default: 14, min: 1, max: 1000 },
      APPLIED_PRICE,
    ],
    buffers: [{ index: 0, name: "Momentum (%)" }],
    subWindow: true,
    aliases: ["momentum", "mom"],
    description: "Rate-of-change of price around 100.",
    applications: ["Momentum filter"],
  },
  {
    id: "osma",
    name: "Moving Average of Oscillator (OsMA)",
    mql5: "iOsMA",
    signature: "iOsMA(symbol, tf, fast_ema_period, slow_ema_period, signal_period, applied_price)",
    category: "oscillator",
    via: "builtin",
    params: [
      { name: "fast_ema_period", type: "int", default: 12, min: 1, max: 500 },
      { name: "slow_ema_period", type: "int", default: 26, min: 1, max: 500 },
      { name: "signal_period", type: "int", default: 9, min: 1, max: 500 },
      APPLIED_PRICE,
    ],
    buffers: [{ index: 0, name: "OsMA histogram" }],
    subWindow: true,
    aliases: ["osma", "moving average of oscillator"],
    description: "MACD main minus its signal (histogram).",
    applications: ["Momentum confirmation"],
  },
  {
    id: "rsi",
    name: "RSI (Relative Strength Index)",
    mql5: "iRSI",
    signature: "iRSI(symbol, tf, ma_period, applied_price)",
    category: "oscillator",
    via: "builtin",
    params: [
      { name: "ma_period", type: "int", default: 14, min: 2, max: 1000 },
      APPLIED_PRICE,
    ],
    buffers: [{ index: 0, name: "RSI value (0–100)" }],
    subWindow: true,
    aliases: ["rsi", "relative strength index"],
    description: "Momentum oscillator 0–100.",
    applications: ["Regular divergence", "Hidden divergence", "Momentum filter"],
  },
  {
    id: "rvi",
    name: "Relative Vigor Index (RVI)",
    mql5: "iRVI",
    signature: "iRVI(symbol, tf, ma_period)",
    category: "oscillator",
    via: "builtin",
    params: [{ name: "ma_period", type: "int", default: 10, min: 1, max: 1000 }],
    buffers: [
      { index: 0, name: "MAIN (RVI)" },
      { index: 1, name: "SIGNAL" },
    ],
    subWindow: true,
    aliases: ["rvi", "relative vigor index"],
    description: "Vigor of a move via close-vs-open relative to range.",
    applications: ["Momentum confirmation", "Reversal"],
  },
  {
    id: "stochastic",
    name: "Stochastic Oscillator",
    mql5: "iStochastic",
    signature: "iStochastic(symbol, tf, Kperiod, Dperiod, slowing, ma_method, price_field)",
    category: "oscillator",
    via: "builtin",
    params: [
      { name: "Kperiod", type: "int", default: 5, min: 1, max: 1000 },
      { name: "Dperiod", type: "int", default: 3, min: 1, max: 1000 },
      { name: "slowing", type: "int", default: 3, min: 1, max: 1000 },
      MA_METHOD,
      { name: "price_field", type: "enum", default: "STO_LOWHIGH", note: "STO_LOWHIGH | STO_CLOSECLOSE" },
    ],
    buffers: [
      { index: 0, name: "MAIN (%K)" },
      { index: 1, name: "SIGNAL (%D)" },
    ],
    subWindow: true,
    aliases: ["stochastic", "stoch", "%k", "%d"],
    description: "Momentum oscillator 0–100 with %K/%D.",
    applications: ["Overbought/oversold", "Divergence", "Reversal signals"],
  },
  {
    id: "wpr",
    name: "Williams Percent Range (%R)",
    mql5: "iWPR",
    signature: "iWPR(symbol, tf, calc_period)",
    category: "oscillator",
    via: "builtin",
    params: [{ name: "calc_period", type: "int", default: 14, min: 1, max: 1000 }],
    buffers: [{ index: 0, name: "%R (-100..0)" }],
    subWindow: true,
    aliases: ["williams percent range", "wpr", "%r", "williams %r"],
    description: "Momentum oscillator -100..0.",
    applications: ["Overbought/oversold", "Reversal"],
  },

  // ── Volumes ─────────────────────────────────────────────────────────────────
  {
    id: "ad",
    name: "Accumulation / Distribution",
    mql5: "iAD",
    signature: "iAD(symbol, tf, applied_volume)",
    category: "volume",
    via: "builtin",
    params: [APPLIED_VOLUME],
    buffers: [{ index: 0, name: "A/D line" }],
    subWindow: true,
    aliases: ["accumulation distribution", "a/d", "ad"],
    description: "Cumulative volume-weighted accumulation/distribution.",
    applications: ["Volume confirmation", "Divergence"],
  },
  {
    id: "mfi",
    name: "Money Flow Index (MFI)",
    mql5: "iMFI",
    signature: "iMFI(symbol, tf, ma_period, applied_volume)",
    category: "volume",
    via: "builtin",
    params: [
      { name: "ma_period", type: "int", default: 14, min: 1, max: 1000 },
      APPLIED_VOLUME,
    ],
    buffers: [{ index: 0, name: "MFI (0–100)" }],
    subWindow: true,
    aliases: ["money flow index", "mfi"],
    description: "Volume-weighted RSI-like oscillator 0–100.",
    applications: ["Overbought/oversold", "Volume confirmation"],
  },
  {
    id: "obv",
    name: "On Balance Volume (OBV)",
    mql5: "iOBV",
    signature: "iOBV(symbol, tf, applied_volume)",
    category: "volume",
    via: "builtin",
    params: [APPLIED_VOLUME],
    buffers: [{ index: 0, name: "OBV line" }],
    subWindow: true,
    aliases: ["on balance volume", "obv"],
    description: "Running total of volume by candle direction.",
    applications: ["Volume confirmation", "Divergence"],
  },
  {
    id: "volumes",
    name: "Volumes",
    mql5: "iVolumes",
    signature: "iVolumes(symbol, tf, applied_volume)",
    category: "volume",
    via: "builtin",
    params: [APPLIED_VOLUME],
    buffers: [{ index: 0, name: "Volume" }],
    subWindow: true,
    aliases: ["volumes", "volume"],
    description: "Per-bar tick/real volume histogram.",
    applications: ["Volume filter"],
  },

  // ── Bill Williams ────────────────────────────────────────────────────────────
  {
    id: "ac",
    name: "Accelerator Oscillator (AC)",
    mql5: "iAC",
    signature: "iAC(symbol, tf)",
    category: "bill_williams",
    via: "builtin",
    params: [],
    buffers: [{ index: 0, name: "AC histogram" }],
    subWindow: true,
    aliases: ["accelerator oscillator", "ac"],
    description: "Acceleration/deceleration of the Awesome Oscillator.",
    applications: ["Momentum confirmation"],
  },
  {
    id: "alligator",
    name: "Alligator",
    mql5: "iAlligator",
    signature: "iAlligator(symbol, tf, jaw_period, jaw_shift, teeth_period, teeth_shift, lips_period, lips_shift, ma_method, applied_price)",
    category: "bill_williams",
    via: "builtin",
    params: [
      { name: "jaw_period", type: "int", default: 13, min: 1, max: 1000 },
      { name: "jaw_shift", type: "int", default: 8, min: 0, max: 100 },
      { name: "teeth_period", type: "int", default: 8, min: 1, max: 1000 },
      { name: "teeth_shift", type: "int", default: 5, min: 0, max: 100 },
      { name: "lips_period", type: "int", default: 5, min: 1, max: 1000 },
      { name: "lips_shift", type: "int", default: 3, min: 0, max: 100 },
      { ...MA_METHOD, default: "MODE_SMMA" },
      { ...APPLIED_PRICE, default: "PRICE_MEDIAN" },
    ],
    buffers: [
      { index: 0, name: "JAW" },
      { index: 1, name: "TEETH" },
      { index: 2, name: "LIPS" },
    ],
    subWindow: false,
    aliases: ["alligator", "jaw", "teeth", "lips"],
    description: "Three smoothed MAs (jaw/teeth/lips) for trend vs range.",
    applications: ["Trend filter", "Range detection"],
  },
  {
    id: "ao",
    name: "Awesome Oscillator (AO)",
    mql5: "iAO",
    signature: "iAO(symbol, tf)",
    category: "bill_williams",
    via: "builtin",
    params: [],
    buffers: [{ index: 0, name: "AO histogram" }],
    subWindow: true,
    aliases: ["awesome oscillator", "ao"],
    description: "Momentum via 5- vs 34-period median-price SMAs.",
    applications: ["Momentum confirmation", "Saucer / twin peaks"],
  },
  {
    id: "fractals",
    name: "Fractals (Bill Williams)",
    mql5: "iFractals",
    signature: "iFractals(symbol, tf)",
    category: "bill_williams",
    via: "builtin",
    params: [],
    buffers: [
      { index: 0, name: "UPPER fractal" },
      { index: 1, name: "LOWER fractal" },
    ],
    subWindow: false,
    aliases: ["fractals", "fractal"],
    description:
      "Marks 5-bar swing highs/lows (confirms 2 bars late). A swing-point primitive.",
    applications: ["Swing high/low", "BOS", "CHoCH", "Structure detection"],
  },
  {
    id: "gator",
    name: "Gator Oscillator",
    mql5: "iGator",
    signature: "iGator(symbol, tf, jaw_period, jaw_shift, teeth_period, teeth_shift, lips_period, lips_shift, ma_method, applied_price)",
    category: "bill_williams",
    via: "builtin",
    params: [
      { name: "jaw_period", type: "int", default: 13, min: 1, max: 1000 },
      { name: "jaw_shift", type: "int", default: 8, min: 0, max: 100 },
      { name: "teeth_period", type: "int", default: 8, min: 1, max: 1000 },
      { name: "teeth_shift", type: "int", default: 5, min: 0, max: 100 },
      { name: "lips_period", type: "int", default: 5, min: 1, max: 1000 },
      { name: "lips_shift", type: "int", default: 3, min: 0, max: 100 },
      { ...MA_METHOD, default: "MODE_SMMA" },
      { ...APPLIED_PRICE, default: "PRICE_MEDIAN" },
    ],
    buffers: [
      { index: 0, name: "UPPER histogram" },
      { index: 1, name: "LOWER histogram" },
    ],
    subWindow: true,
    aliases: ["gator", "gator oscillator"],
    description: "Alligator-derived histogram of convergence/divergence.",
    applications: ["Range vs trend detection"],
  },
  {
    id: "bwmfi",
    name: "Market Facilitation Index (BW MFI)",
    mql5: "iBWMFI",
    signature: "iBWMFI(symbol, tf, applied_volume)",
    category: "bill_williams",
    via: "builtin",
    params: [APPLIED_VOLUME],
    buffers: [{ index: 0, name: "BW MFI" }],
    subWindow: true,
    aliases: ["market facilitation index", "bwmfi", "bw mfi"],
    description: "Price movement per unit of volume (Bill Williams).",
    applications: ["Volume/price efficiency"],
  },

  // ── Custom indicators shipped with MT5 (Indicators\Examples → iCustom) ────────
  {
    id: "tema",
    name: "Triple Exponential Moving Average (TEMA)",
    mql5: "iCustom",
    signature: 'iCustom(symbol, tf, "Examples\\\\TEMA", period, applied_price)',
    category: "custom_included",
    via: "icustom",
    params: [
      { name: "period", type: "int", default: 14, min: 1, max: 1000 },
      APPLIED_PRICE,
    ],
    buffers: [{ index: 0, name: "TEMA line" }],
    subWindow: false,
    aliases: ["tema", "triple ema"],
    description: "Ships in Indicators\\Examples — referenced via iCustom. Low-lag MA.",
    applications: ["Trend filter"],
  },
  {
    id: "vidya",
    name: "Variable Index Dynamic Average (VIDYA)",
    mql5: "iCustom",
    signature: 'iCustom(symbol, tf, "Examples\\\\VIDYA", cmo_period, ema_period, shift, applied_price)',
    category: "custom_included",
    via: "icustom",
    params: [
      { name: "cmo_period", type: "int", default: 9, min: 1, max: 1000 },
      { name: "ema_period", type: "int", default: 12, min: 1, max: 1000 },
      { name: "shift", type: "int", default: 0, min: 0, max: 100 },
      APPLIED_PRICE,
    ],
    buffers: [{ index: 0, name: "VIDYA line" }],
    subWindow: false,
    aliases: ["vidya", "variable index dynamic average"],
    description: "Ships in Indicators\\Examples — referenced via iCustom. Volatility-adaptive MA.",
    applications: ["Trend filter"],
  },
  {
    id: "zerolag",
    name: "Zero Lag Moving Average",
    mql5: "iCustom",
    signature: 'iCustom(symbol, tf, "Examples\\\\ZeroLag", period, applied_price)',
    category: "custom_included",
    via: "icustom",
    params: [
      { name: "period", type: "int", default: 14, min: 1, max: 1000 },
      APPLIED_PRICE,
    ],
    buffers: [{ index: 0, name: "ZeroLag line" }],
    subWindow: false,
    aliases: ["zero lag", "zerolag", "zlma"],
    description: "Ships in Indicators\\Examples — referenced via iCustom. Reduced-lag MA.",
    applications: ["Trend filter"],
  },
  {
    id: "fisher",
    name: "Fisher Transform",
    mql5: "iCustom",
    signature: 'iCustom(symbol, tf, "Examples\\\\Fisher", period)',
    category: "custom_included",
    via: "icustom",
    params: [{ name: "period", type: "int", default: 10, min: 1, max: 1000 }],
    buffers: [{ index: 0, name: "Fisher value" }],
    subWindow: true,
    aliases: ["fisher", "fisher transform"],
    description: "Ships in Indicators\\Examples — referenced via iCustom. Sharpens turning points.",
    applications: ["Reversal", "Overbought/oversold"],
  },
  {
    id: "rsi-of-rsi",
    name: "RSI of RSI",
    mql5: "iCustom",
    signature: 'iCustom(symbol, tf, "Examples\\\\RSI_of_RSI", rsi_period, rsi2_period, applied_price)',
    category: "custom_included",
    via: "icustom",
    params: [
      { name: "rsi_period", type: "int", default: 14, min: 1, max: 1000 },
      { name: "rsi2_period", type: "int", default: 14, min: 1, max: 1000 },
      APPLIED_PRICE,
    ],
    buffers: [{ index: 0, name: "RSI-of-RSI value" }],
    subWindow: true,
    aliases: ["rsi of rsi", "double rsi"],
    description: "Ships in Indicators\\Examples — referenced via iCustom. Smoothed momentum.",
    applications: ["Momentum filter"],
  },
  {
    id: "smi",
    name: "Stochastic Momentum Index (SMI)",
    mql5: "iCustom",
    signature: 'iCustom(symbol, tf, "Examples\\\\SMI", k_period, d_period, smoothing)',
    category: "custom_included",
    via: "icustom",
    params: [
      { name: "k_period", type: "int", default: 13, min: 1, max: 1000 },
      { name: "d_period", type: "int", default: 25, min: 1, max: 1000 },
      { name: "smoothing", type: "int", default: 2, min: 1, max: 1000 },
    ],
    buffers: [
      { index: 0, name: "SMI" },
      { index: 1, name: "SIGNAL" },
    ],
    subWindow: true,
    aliases: ["smi", "stochastic momentum index"],
    description: "Ships in Indicators\\Examples — referenced via iCustom. Refined stochastic.",
    applications: ["Overbought/oversold", "Reversal"],
  },
  {
    id: "keltner",
    name: "Keltner Channel",
    mql5: "iCustom",
    signature: 'iCustom(symbol, tf, "Examples\\\\Keltner", ma_period, atr_period, multiplier)',
    category: "custom_included",
    via: "icustom",
    params: [
      { name: "ma_period", type: "int", default: 20, min: 1, max: 1000 },
      { name: "atr_period", type: "int", default: 10, min: 1, max: 1000 },
      { name: "multiplier", type: "double", default: 2.0, min: 0.1, max: 10 },
    ],
    buffers: [
      { index: 0, name: "MIDDLE" },
      { index: 1, name: "UPPER" },
      { index: 2, name: "LOWER" },
    ],
    subWindow: false,
    aliases: ["keltner", "keltner channel"],
    description: "Ships in Indicators\\Examples — referenced via iCustom. ATR-based channel.",
    applications: ["Volatility expansion", "Squeeze (with Bollinger)"],
  },
  {
    id: "donchian",
    name: "Donchian Channel",
    mql5: "iCustom",
    signature: 'iCustom(symbol, tf, "Examples\\\\Donchian", period)',
    category: "custom_included",
    via: "icustom",
    params: [{ name: "period", type: "int", default: 20, min: 1, max: 1000 }],
    buffers: [
      { index: 0, name: "UPPER (highest high)" },
      { index: 1, name: "LOWER (lowest low)" },
      { index: 2, name: "MIDDLE" },
    ],
    subWindow: false,
    aliases: ["donchian", "donchian channel", "price channel"],
    description: "Ships in Indicators\\Examples — referenced via iCustom. N-bar high/low channel.",
    applications: ["Breakout", "Range bounds", "Trailing stop"],
  },
];

/** Look up a built-in indicator by id or alias (case-insensitive). */
export function findBuiltinIndicator(query: string): BuiltinIndicator | undefined {
  const q = query.trim().toLowerCase();
  return INDICATOR_REGISTRY.find(
    (ind) => ind.id === q || ind.aliases.some((a) => a.toLowerCase() === q),
  );
}

/** Human-readable label for a category. */
export const INDICATOR_CATEGORY_LABEL: Record<IndicatorCategory, string> = {
  trend: "Trend",
  oscillator: "Oscillator",
  volume: "Volume",
  bill_williams: "Bill Williams",
  custom_included: "Custom (shipped with MT5)",
};
