/**
 * Generic MT5 built-in indicator → confluence filter codegen.
 *
 * Uses INDICATOR_REGISTRY signatures to emit verified iX() + CopyBuffer gates.
 * Not freeform AI MQL5 — deterministic templates from the registry vocabulary.
 */

import type { BuiltinFilterRef } from "@/lib/builtin-filter-contracts";
import {
  findBuiltinIndicator,
  type BuiltinIndicator,
  type IndicatorParam,
} from "@/lib/indicator-registry";

export const MT5_BUFFER_FILTER_ID = "mt5_buffer_filter";

export function isMt5BufferFilter(filter: BuiltinFilterRef): boolean {
  return filter.id === MT5_BUFFER_FILTER_ID;
}

function paramValue(
  params: Record<string, unknown>,
  def: IndicatorParam,
): string | number {
  const raw = params[def.name];
  if (def.type === "enum") {
    const s = typeof raw === "string" && raw ? raw : String(def.default);
    return s;
  }
  if (def.type === "double") {
    const n = typeof raw === "number" && Number.isFinite(raw) ? raw : Number(def.default);
    return Number.isFinite(n) ? n : 0;
  }
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : Number(def.default);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

/** Build `iMA(InpSymbol, PERIOD_H1, 50, 0, MODE_EMA, PRICE_CLOSE)` from registry. */
export function emitMt5IndicatorHandleCall(
  indicator: BuiltinIndicator,
  tfConstExpr: string,
  params: Record<string, unknown>,
): string {
  const args = indicator.params.map((p) => {
    const v = paramValue(params, p);
    return typeof v === "string" ? v : String(v);
  });
  if (indicator.via === "icustom") {
    // Examples path is encoded in signature notes / mql5 field conventionally as Examples\\Name
    const path =
      typeof params.customPath === "string" && params.customPath
        ? params.customPath
        : indicator.aliases[0]
          ? `Examples\\\\${indicator.name.split("(")[0]!.trim().replace(/\s+/g, "")}`
          : "Examples\\\\Custom";
    return `iCustom(InpSymbol, ${tfConstExpr}, "${path}"${args.length ? `, ${args.join(", ")}` : ""})`;
  }
  return `${indicator.mql5}(InpSymbol, ${tfConstExpr}${args.length ? `, ${args.join(", ")}` : ""})`;
}

export function defaultMt5BufferFilterParams(
  indicator: BuiltinIndicator,
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    registryId: indicator.id,
    buffer: indicator.buffers[0]?.index ?? 0,
  };
  for (const p of indicator.params) {
    params[p.name] = p.default;
  }
  if (indicator.subWindow) {
    params.compareTo = "level";
    params.level =
      indicator.id === "rsi" || indicator.id === "mfi" || indicator.id === "demarker"
        ? 50
        : indicator.id === "wpr"
          ? -50
          : 0;
    params.operator = "directional";
  } else {
    // Overlay indicators: gate by close vs buffer (trend side)
    params.compareTo = "price";
    params.level = 0;
    params.operator = "directional";
  }
  return params;
}

export function createMt5BufferFilterRef(
  indicator: BuiltinIndicator,
  timeframe: string,
  appliesTo: "setup" | "execution",
): BuiltinFilterRef {
  return {
    id: MT5_BUFFER_FILTER_ID,
    label: `${indicator.name} filter`,
    indicatorId: indicator.id,
    role: "filter",
    appliesTo,
    timeframe,
    params: defaultMt5BufferFilterParams(indicator),
    status: "builtin_filter",
    note: `Native ${indicator.mql5} confluence gate from MT5 built-in registry.`,
  };
}

function resolveIndicator(filter: BuiltinFilterRef): BuiltinIndicator | undefined {
  const registryId =
    (typeof filter.params?.registryId === "string" && filter.params.registryId) ||
    filter.indicatorId;
  return findBuiltinIndicator(registryId);
}

export function emitMt5BufferFilterDecls(
  filter: BuiltinFilterRef,
  suffix: string,
  tfConstExpr: string,
): string {
  const indicator = resolveIndicator(filter);
  if (!indicator || indicator.via !== "builtin") return "";

  const params = filter.params ?? {};
  const buffer =
    typeof params.buffer === "number" && Number.isFinite(params.buffer)
      ? Math.max(0, Math.floor(params.buffer))
      : 0;
  const call = emitMt5IndicatorHandleCall(indicator, tfConstExpr, params);
  const sub = indicator.subWindow ? 1 : 0;

  return `   int hMt5_${suffix} = ${call};
   if(hMt5_${suffix} != INVALID_HANDLE) ChartIndicatorAdd(0, ${sub}, hMt5_${suffix});
   double mt5Val_${suffix} = B4_Buf(hMt5_${suffix}, ${buffer}, 1);`;
}

export function emitMt5BufferFilterCondition(
  filter: BuiltinFilterRef,
  suffix: string,
  dirExpr: string,
  tfConstExpr: string,
): string {
  const indicator = resolveIndicator(filter);
  if (!indicator) return "true";

  const params = filter.params ?? {};
  const operator =
    typeof params.operator === "string" && params.operator ? params.operator : "directional";
  const compareTo =
    typeof params.compareTo === "string" && params.compareTo
      ? params.compareTo
      : indicator.subWindow
        ? "level"
        : "price";
  const level =
    typeof params.level === "number" && Number.isFinite(params.level) ? params.level : 0;

  if (compareTo === "price") {
    const closeExpr = `iClose(InpSymbol, ${tfConstExpr}, 1)`;
    if (operator === "above") return `${closeExpr} > mt5Val_${suffix}`;
    if (operator === "below") return `${closeExpr} < mt5Val_${suffix}`;
    return `((${dirExpr} == 1 && ${closeExpr} > mt5Val_${suffix}) || (${dirExpr} == -1 && ${closeExpr} < mt5Val_${suffix}))`;
  }

  if (compareTo === "zero" || (compareTo === "level" && level === 0 && operator.includes("zero"))) {
    if (operator === "above" || operator === "above_zero") return `mt5Val_${suffix} > 0.0`;
    if (operator === "below" || operator === "below_zero") return `mt5Val_${suffix} < 0.0`;
    return `((${dirExpr} == 1 && mt5Val_${suffix} > 0.0) || (${dirExpr} == -1 && mt5Val_${suffix} < 0.0))`;
  }

  // value vs level
  if (operator === "above" || operator === "above_zero") return `mt5Val_${suffix} > ${level}`;
  if (operator === "below" || operator === "below_zero") return `mt5Val_${suffix} < ${level}`;
  return `((${dirExpr} == 1 && mt5Val_${suffix} > ${level}) || (${dirExpr} == -1 && mt5Val_${suffix} < ${level}))`;
}
