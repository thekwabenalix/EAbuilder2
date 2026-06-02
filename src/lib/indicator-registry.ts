/**
 * Built-in MT5 Indicator Registry
 *
 * MT5 ships these indicators natively. We do NOT rebuild them as custom detection
 * modules — instead the AI/generator references them through MQL5's built-in
 * indicator functions (handle + CopyBuffer). This file is the declarative
 * vocabulary the AI may reference: function name, parameters, and output buffers.
 *
 * Pattern the generator follows (already implemented for MA via B4_MA/B4_MAval):
 *   int h = iRSI(symbol, tf, period, applied_price);   // create handle
 *   double v; CopyBuffer(h, 0, shift, 1, ...);          // read buffer 0
 *
 * Custom modules are only built for concepts MT5 does NOT understand natively
 * (FVG, IFVG, OB, BOS, CHoCH, Classic/Gap SNR, SNRC2, MEF, QM_MEF, Engulfing,
 * RBR/DBD, ...). Those live in smc-modules / generators.
 */

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
  mql5: string; // MQL5 function name, e.g. "iMA"
  signature: string; // full call signature for reference
  params: IndicatorParam[];
  buffers: IndicatorBuffer[];
  /** true = renders in a separate sub-window (RSI, MACD, ...); false = overlays price */
  subWindow: boolean;
  aliases: string[];
  description: string;
}

const APPLIED_PRICE: IndicatorParam = {
  name: "applied_price",
  type: "enum",
  default: "PRICE_CLOSE",
  note: "PRICE_CLOSE | PRICE_OPEN | PRICE_HIGH | PRICE_LOW | PRICE_MEDIAN | PRICE_TYPICAL | PRICE_WEIGHTED",
};

export const INDICATOR_REGISTRY: BuiltinIndicator[] = [
  {
    id: "ma",
    name: "Moving Average (EMA / SMA / SMMA / LWMA)",
    mql5: "iMA",
    signature: "iMA(symbol, timeframe, ma_period, ma_shift, ma_method, applied_price)",
    params: [
      { name: "ma_period", type: "int", default: 50, min: 1, max: 1000 },
      { name: "ma_shift", type: "int", default: 0, min: 0, max: 100 },
      {
        name: "ma_method",
        type: "enum",
        default: "MODE_EMA",
        note: "MODE_SMA | MODE_EMA | MODE_SMMA | MODE_LWMA",
      },
      APPLIED_PRICE,
    ],
    buffers: [{ index: 0, name: "MA line" }],
    subWindow: false,
    aliases: ["ema", "sma", "moving average", "ma", "smma", "lwma", "wma"],
    description:
      "Moving average of price. EMA/SMA/etc. selected via ma_method. Already wired " +
      "in the assembler via B4_MA()/B4_MAval(); the EMA brain uses it directly.",
  },
  {
    id: "rsi",
    name: "RSI (Relative Strength Index)",
    mql5: "iRSI",
    signature: "iRSI(symbol, timeframe, ma_period, applied_price)",
    params: [
      { name: "ma_period", type: "int", default: 14, min: 2, max: 1000 },
      APPLIED_PRICE,
    ],
    buffers: [{ index: 0, name: "RSI value (0–100)" }],
    subWindow: true,
    aliases: ["rsi", "relative strength index"],
    description:
      "Momentum oscillator 0–100. Pair with custom divergence/overbought-oversold " +
      "logic (e.g. the RSI hidden-divergence module).",
  },
  {
    id: "macd",
    name: "MACD",
    mql5: "iMACD",
    signature: "iMACD(symbol, timeframe, fast_ema_period, slow_ema_period, signal_period, applied_price)",
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
    description:
      "Trend/momentum. MAIN vs SIGNAL crossovers and histogram. Combine with a " +
      "crossover primitive for entries.",
  },
  {
    id: "bands",
    name: "Bollinger Bands",
    mql5: "iBands",
    signature: "iBands(symbol, timeframe, bands_period, bands_shift, deviation, applied_price)",
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
    description:
      "Volatility envelope around a moving average. Use band touches/squeezes with " +
      "custom logic.",
  },
  {
    id: "atr",
    name: "ATR (Average True Range)",
    mql5: "iATR",
    signature: "iATR(symbol, timeframe, ma_period)",
    params: [{ name: "ma_period", type: "int", default: 14, min: 1, max: 1000 }],
    buffers: [{ index: 0, name: "ATR value" }],
    subWindow: true,
    aliases: ["atr", "average true range", "volatility"],
    description:
      "Volatility in price units. Commonly used for SL/TP distance and position " +
      "sizing (management brain), not entries.",
  },
  {
    id: "stochastic",
    name: "Stochastic Oscillator",
    mql5: "iStochastic",
    signature: "iStochastic(symbol, timeframe, Kperiod, Dperiod, slowing, ma_method, price_field)",
    params: [
      { name: "Kperiod", type: "int", default: 5, min: 1, max: 1000 },
      { name: "Dperiod", type: "int", default: 3, min: 1, max: 1000 },
      { name: "slowing", type: "int", default: 3, min: 1, max: 1000 },
      { name: "ma_method", type: "enum", default: "MODE_SMA", note: "MODE_SMA | MODE_EMA | MODE_SMMA | MODE_LWMA" },
      { name: "price_field", type: "enum", default: "STO_LOWHIGH", note: "STO_LOWHIGH | STO_CLOSECLOSE" },
    ],
    buffers: [
      { index: 0, name: "MAIN (%K)" },
      { index: 1, name: "SIGNAL (%D)" },
    ],
    subWindow: true,
    aliases: ["stochastic", "stoch", "%k", "%d"],
    description: "Momentum oscillator 0–100. %K/%D crossovers and overbought/oversold zones.",
  },
  {
    id: "adx",
    name: "ADX (Average Directional Index)",
    mql5: "iADX",
    signature: "iADX(symbol, timeframe, adx_period)",
    params: [{ name: "adx_period", type: "int", default: 14, min: 1, max: 1000 }],
    buffers: [
      { index: 0, name: "MAIN (ADX)" },
      { index: 1, name: "PLUSDI (+DI)" },
      { index: 2, name: "MINUSDI (-DI)" },
    ],
    subWindow: true,
    aliases: ["adx", "average directional index", "dmi", "+di", "-di"],
    description:
      "Trend strength (ADX) and direction (+DI/-DI). Common trend filter: ADX > 20/25.",
  },
  {
    id: "ichimoku",
    name: "Ichimoku Kinko Hyo",
    mql5: "iIchimoku",
    signature: "iIchimoku(symbol, timeframe, tenkan_sen, kijun_sen, senkou_span_b)",
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
    description: "Full Ichimoku system: lines + cloud (Senkou A/B). Overlays price.",
  },
  {
    id: "sar",
    name: "Parabolic SAR",
    mql5: "iSAR",
    signature: "iSAR(symbol, timeframe, step, maximum)",
    params: [
      { name: "step", type: "double", default: 0.02, min: 0.001, max: 1 },
      { name: "maximum", type: "double", default: 0.2, min: 0.01, max: 1 },
    ],
    buffers: [{ index: 0, name: "SAR dots" }],
    subWindow: false,
    aliases: ["sar", "parabolic sar", "psar"],
    description: "Trailing stop/reversal dots. Often used as a trailing-stop primitive.",
  },
  {
    id: "fractals",
    name: "Fractals (Bill Williams)",
    mql5: "iFractals",
    signature: "iFractals(symbol, timeframe)",
    params: [],
    buffers: [
      { index: 0, name: "UPPER fractal" },
      { index: 1, name: "LOWER fractal" },
    ],
    subWindow: false,
    aliases: ["fractals", "fractal", "bill williams"],
    description:
      "Marks 5-bar swing highs/lows. A simple swing-point primitive (note: a fractal " +
      "confirms 2 bars late).",
  },
];

/** Look up a built-in indicator by id or alias (case-insensitive). */
export function findBuiltinIndicator(query: string): BuiltinIndicator | undefined {
  const q = query.trim().toLowerCase();
  return INDICATOR_REGISTRY.find(
    (ind) => ind.id === q || ind.aliases.some((a) => a.toLowerCase() === q),
  );
}
