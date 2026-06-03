export type BuiltinFilterRole = "setup" | "execution";

export interface BuiltinFilterParam {
  name: string;
  type: "int" | "double" | "string";
  default: number | string;
  description: string;
}

export interface BuiltinFilterContract {
  id: string;
  label: string;
  indicatorId: string;
  roles: BuiltinFilterRole[];
  params: BuiltinFilterParam[];
  aliases: string[];
  allowedHelpers: string[];
  semantics: string;
  notes: string;
}

export interface BuiltinFilterRef {
  id: string;
  label: string;
  indicatorId: string;
  role: "filter";
  appliesTo?: BuiltinFilterRole;
  timeframe: string;
  params: Record<string, unknown>;
  status: "builtin_filter";
  note: string;
}

export const BUILTIN_FILTER_CONTRACTS: Record<string, BuiltinFilterContract> = {
  rsi_level_filter: {
    id: "rsi_level_filter",
    label: "RSI Level Filter",
    indicatorId: "rsi",
    roles: ["setup", "execution"],
    params: [
      { name: "period", type: "int", default: 14, description: "RSI lookback period." },
      { name: "level", type: "double", default: 50, description: "RSI threshold level." },
      {
        name: "operator",
        type: "string",
        default: "above",
        description:
          "above, below, or directional. Directional means buys above level and sells below level.",
      },
    ],
    aliases: [
      "rsi above",
      "rsi below",
      "rsi overbought",
      "rsi oversold",
      "rsi greater than",
      "rsi less than",
      "rsi filter",
    ],
    allowedHelpers: ["B4_RSI", "B4_Buf"],
    semantics:
      "Creates an RSI handle with B4_RSI(tf, period), reads buffer 0 with B4_Buf(handle, 0, 1), then gates an already-detected setup or execution signal. It must not create direction, setup, or execution events by itself.",
    notes: "Use only as a confluence filter. Do not put rsi or rsi_level_filter in sm_configs.",
  },
  atr_volatility_filter: {
    id: "atr_volatility_filter",
    label: "ATR Volatility Filter",
    indicatorId: "atr",
    roles: ["setup", "execution"],
    params: [
      { name: "period", type: "int", default: 14, description: "ATR lookback period." },
      {
        name: "minAtrPoints",
        type: "double",
        default: 0,
        description: "Minimum ATR in points. A value of 0 means no minimum threshold.",
      },
      {
        name: "maxAtrPoints",
        type: "double",
        default: 0,
        description: "Maximum ATR in points. A value of 0 means no maximum threshold.",
      },
      {
        name: "operator",
        type: "string",
        default: "above",
        description: "above, below, or between. Thresholds are expressed in symbol points.",
      },
    ],
    aliases: [
      "atr above",
      "atr below",
      "atr volatility",
      "volatility filter",
      "skip low volatility",
      "skip high volatility",
      "atr filter",
    ],
    allowedHelpers: ["B4_ATR", "B4_Buf"],
    semantics:
      "Creates an ATR handle with B4_ATR(tf, period), reads buffer 0 with B4_Buf(handle, 0, 1), converts ATR price distance to points using SYMBOL_POINT, then gates an already-detected setup or execution signal. It must not create direction, setup, or execution events by itself.",
    notes:
      "Use only as a volatility confluence filter. Do not put atr or atr_volatility_filter in sm_configs.",
  },
  macd_histogram_filter: {
    id: "macd_histogram_filter",
    label: "MACD Histogram Filter",
    indicatorId: "macd",
    roles: ["setup", "execution"],
    params: [
      { name: "fastPeriod", type: "int", default: 12, description: "MACD fast EMA period." },
      { name: "slowPeriod", type: "int", default: 26, description: "MACD slow EMA period." },
      { name: "signalPeriod", type: "int", default: 9, description: "MACD signal period." },
      {
        name: "operator",
        type: "string",
        default: "directional",
        description:
          "above_zero, below_zero, or directional. Directional means buys above zero and sells below zero.",
      },
    ],
    aliases: [
      "macd histogram above zero",
      "macd histogram below zero",
      "macd above zero",
      "macd below zero",
      "macd filter",
      "macd momentum filter",
    ],
    allowedHelpers: ["B4_MACD", "B4_Buf"],
    semantics:
      "Creates a MACD handle with B4_MACD(tf, fast, slow, signal), reads MACD buffers with B4_Buf(handle, buffer, 1), computes or reads histogram momentum, then gates an already-detected setup or execution signal. It must not create direction, setup, or execution events by itself.",
    notes:
      "Use only as a momentum confluence filter. Do not put macd or macd_histogram_filter in sm_configs.",
  },
};

export function getBuiltinFilterContract(id: string): BuiltinFilterContract | undefined {
  return BUILTIN_FILTER_CONTRACTS[id];
}

function uniqueById(refs: BuiltinFilterRef[]): BuiltinFilterRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.id}|${ref.appliesTo ?? "execution"}|${ref.timeframe}|${JSON.stringify(ref.params)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractTimeframe(text: string, fallback = "M5"): string {
  return (text.match(/\b(M1|M5|M15|M30|H1|H4|D1|W1|MN)\b/i)?.[1] ?? fallback).toUpperCase();
}

function numberAfter(text: string, pattern: RegExp): number | undefined {
  const match = text.match(pattern);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function pointsFromText(text: string): number | undefined {
  const pointValue = numberAfter(text, /\b(\d+(?:\.\d+)?)\s*points?\b/i);
  if (pointValue !== undefined) return pointValue;
  const pipValue = numberAfter(text, /\b(\d+(?:\.\d+)?)\s*pips?\b/i);
  return pipValue === undefined ? undefined : pipValue * 10;
}

function rsiParams(text: string): Record<string, unknown> {
  const rsiScope = (text.match(/\brsi\b.{0,60}/i)?.[0] ?? text).split(/[.;,]/)[0];
  const period =
    numberAfter(text, /\brsi\s*(\d{1,3})\b/i) ?? numberAfter(text, /\b(\d{1,3})\s*rsi\b/i) ?? 14;
  const explicitLevel =
    numberAfter(
      rsiScope,
      /\brsi\b.{0,40}\b(?:above|over|greater\s+than|>)\s*(\d{1,3}(?:\.\d+)?)/i,
    ) ??
    numberAfter(rsiScope, /\brsi\b.{0,40}\b(?:below|under|less\s+than|<)\s*(\d{1,3}(?:\.\d+)?)/i);
  const operator = /\b(overbought|above|over|greater\s+than|>)\b/i.test(text)
    ? "above"
    : /\b(oversold|below|under|less\s+than|<)\b/i.test(text)
      ? "below"
      : "directional";
  const level =
    explicitLevel ?? (/\boverbought\b/i.test(text) ? 70 : /\boversold\b/i.test(text) ? 30 : 50);
  return { period, level, operator };
}

function atrParams(text: string): Record<string, unknown> {
  const period =
    numberAfter(text, /\batr\s*(\d{1,3})\b/i) ?? numberAfter(text, /\b(\d{1,3})\s*atr\b/i) ?? 14;
  const threshold = pointsFromText(text) ?? 0;
  const operator = /\bbelow|under|less\s+than|skip\s+high\s+volatility|max(?:imum)?\b/i.test(text)
    ? "below"
    : /\bbetween\b/i.test(text)
      ? "between"
      : "above";
  return {
    period,
    minAtrPoints: operator === "above" ? threshold : 0,
    maxAtrPoints: operator === "below" ? threshold : 0,
    operator,
  };
}

function macdParams(text: string): Record<string, unknown> {
  const values = [...text.matchAll(/\b(\d{1,3})\b/g)].map((match) => Number(match[1]));
  const [fastPeriod = 12, slowPeriod = 26, signalPeriod = 9] =
    /\bmacd\b/i.test(text) && values.length >= 3 ? values : [12, 26, 9];
  const operator = /\bbelow|under|negative|<\s*0\b/i.test(text)
    ? "below_zero"
    : /\babove|over|positive|>\s*0\b/i.test(text)
      ? "above_zero"
      : "directional";
  return { fastPeriod, slowPeriod, signalPeriod, operator };
}

function sentenceScopeFor(text: string, keyword: RegExp): string {
  const sentences = text
    .split(/(?<=[.!?])\s+|[\r\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return sentences.find((sentence) => keyword.test(sentence)) ?? text;
}

function inferFilterPlacement(scope: string): BuiltinFilterRole {
  const hay = scope.toLowerCase();
  if (
    /\b(entry|entries|enter|trigger|execution|execute|trade|signal|before\s+(?:entry|entering|execution)|pre-entry)\b/.test(
      hay,
    )
  ) {
    return "execution";
  }
  if (
    /\b(setup|setups|confirm|confirmation|confluence|condition|qualif(?:y|ies|ication)|valid\s+setup|before\s+setup|setup\s+filter)\b/.test(
      hay,
    )
  ) {
    return "setup";
  }
  return "execution";
}

export function collectBuiltinFilterRefs(
  text: string,
  fallbackTimeframe = "M5",
): BuiltinFilterRef[] {
  const hay = text.toLowerCase();
  const timeframe = extractTimeframe(text, fallbackTimeframe);
  const refs: BuiltinFilterRef[] = [];

  if (
    /\brsi\b/.test(hay) &&
    /\b(filter|above|below|overbought|oversold|greater|less|>|<)\b/.test(hay)
  ) {
    const contract = BUILTIN_FILTER_CONTRACTS.rsi_level_filter;
    const scope = sentenceScopeFor(text, /\brsi\b/i);
    refs.push({
      id: contract.id,
      label: contract.label,
      indicatorId: contract.indicatorId,
      role: "filter",
      appliesTo: inferFilterPlacement(scope),
      timeframe,
      params: rsiParams(text),
      status: "builtin_filter",
      note: contract.notes,
    });
  }

  if (
    /\batr\b/.test(hay) ||
    /\bvolatility\s+filter\b/.test(hay) ||
    /\bskip\s+(?:low|high)\s+volatility\b/.test(hay)
  ) {
    const contract = BUILTIN_FILTER_CONTRACTS.atr_volatility_filter;
    const scope = sentenceScopeFor(text, /\b(?:atr|volatility)\b/i);
    refs.push({
      id: contract.id,
      label: contract.label,
      indicatorId: contract.indicatorId,
      role: "filter",
      appliesTo: inferFilterPlacement(scope),
      timeframe,
      params: atrParams(text),
      status: "builtin_filter",
      note: contract.notes,
    });
  }

  if (
    /\bmacd\b/.test(hay) &&
    /\b(filter|histogram|above|below|zero|positive|negative)\b/.test(hay)
  ) {
    const contract = BUILTIN_FILTER_CONTRACTS.macd_histogram_filter;
    const scope = sentenceScopeFor(text, /\bmacd\b/i);
    refs.push({
      id: contract.id,
      label: contract.label,
      indicatorId: contract.indicatorId,
      role: "filter",
      appliesTo: inferFilterPlacement(scope),
      timeframe,
      params: macdParams(text),
      status: "builtin_filter",
      note: contract.notes,
    });
  }

  return uniqueById(refs);
}

export function buildCompactBuiltinFilterContractContext(): string {
  const lines = [
    "BUILT-IN FILTER CONTRACT REGISTRY - these are verified filters, not 4-Brain modules.",
    "Put these in semantics.filters, never in semantics.modules or sm_configs.",
    "",
  ];

  for (const contract of Object.values(BUILTIN_FILTER_CONTRACTS)) {
    lines.push(`[${contract.id}] ${contract.label}`);
    lines.push(`  Indicator: ${contract.indicatorId}`);
    lines.push(`  Roles: ${contract.roles.join(", ")}`);
    lines.push(`  Params: ${contract.params.map((p) => `${p.name}=${p.default}`).join(", ")}`);
    lines.push(`  Allowed helpers: ${contract.allowedHelpers.join(", ")}`);
    lines.push(`  Semantics: ${contract.semantics}`);
    lines.push(`  Note: ${contract.notes}`);
    lines.push("");
  }

  return lines.join("\n");
}
