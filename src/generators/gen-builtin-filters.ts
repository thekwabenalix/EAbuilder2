/**
 * Shared built-in filter MQL5 snippets for assembler and Strategy Flow engine.
 */

import type { BuiltinFilterRef } from "@/lib/builtin-filter-contracts";
import { tfConst } from "./sm-embed-registry";

export function filterPlacement(filter: BuiltinFilterRef): "setup" | "execution" {
  return filter.appliesTo === "setup" ? "setup" : "execution";
}

function filterNum(params: Record<string, unknown>, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function filterStr(params: Record<string, unknown>, key: string, fallback: string): string {
  const value = params[key];
  return typeof value === "string" && value ? value : fallback;
}

function filterSuffix(filter: BuiltinFilterRef, index: number): string {
  return `${filter.id}_${filter.timeframe}_${index}`.replace(/[^A-Za-z0-9_]/g, "_");
}

function filterCondition(filter: BuiltinFilterRef, suffix: string, dirExpr: string): string {
  const params = filter.params ?? {};

  if (filter.id === "rsi_level_filter") {
    const period = filterNum(params, "period", 14);
    const level = filterNum(params, "level", 50);
    const operator = filterStr(params, "operator", "directional");
    if (operator === "above") return `rsi_${suffix} > ${level}`;
    if (operator === "below") return `rsi_${suffix} < ${level}`;
    return `(${dirExpr} == 1 && rsi_${suffix} > ${level}) || (${dirExpr} == -1 && rsi_${suffix} < ${level})`;
  }

  if (filter.id === "atr_volatility_filter") {
    const minAtr = filterNum(params, "minAtrPoints", 0);
    const maxAtr = filterNum(params, "maxAtrPoints", 0);
    const operator = filterStr(params, "operator", minAtr > 0 ? "above" : "below");
    if (operator === "below") return maxAtr > 0 ? `atrPts_${suffix} <= ${maxAtr}` : "true";
    if (operator === "between") {
      return `(${minAtr <= 0 ? "true" : `atrPts_${suffix} >= ${minAtr}`}) && (${maxAtr <= 0 ? "true" : `atrPts_${suffix} <= ${maxAtr}`})`;
    }
    return minAtr > 0 ? `atrPts_${suffix} >= ${minAtr}` : "true";
  }

  if (filter.id === "macd_histogram_filter") {
    const operator = filterStr(params, "operator", "directional");
    if (operator === "above_zero") return `macdHist_${suffix} > 0.0`;
    if (operator === "below_zero") return `macdHist_${suffix} < 0.0`;
    return `(${dirExpr} == 1 && macdHist_${suffix} > 0.0) || (${dirExpr} == -1 && macdHist_${suffix} < 0.0)`;
  }

  return "true";
}

function filterDecls(filter: BuiltinFilterRef, suffix: string, tf: string): string {
  const params = filter.params ?? {};

  if (filter.id === "rsi_level_filter") {
    const period = filterNum(params, "period", 14);
    return `   int hRsi_${suffix} = B4_RSI(${tf}, ${period});
   double rsi_${suffix} = B4_Buf(hRsi_${suffix}, 0, 1);`;
  }

  if (filter.id === "atr_volatility_filter") {
    const period = filterNum(params, "period", 14);
    return `   int hAtr_${suffix} = B4_ATR(${tf}, ${period});
   double atrPts_${suffix} = B4_Buf(hAtr_${suffix}, 0, 1) / SymbolInfoDouble(InpSymbol, SYMBOL_POINT);`;
  }

  if (filter.id === "macd_histogram_filter") {
    const fast = filterNum(params, "fastPeriod", 12);
    const slow = filterNum(params, "slowPeriod", 26);
    const signal = filterNum(params, "signalPeriod", 9);
    return `   int hMacd_${suffix} = B4_MACD(${tf}, ${fast}, ${slow}, ${signal});
   double macdMain_${suffix} = B4_Buf(hMacd_${suffix}, 0, 1);
   double macdSignal_${suffix} = B4_Buf(hMacd_${suffix}, 1, 1);
   double macdHist_${suffix} = macdMain_${suffix} - macdSignal_${suffix};`;
  }

  return "";
}

/** Assembler brain-body filter injection (clears gSetupActive / gExecSignal). */
export function emitAssemblerFilterSnippet(filter: BuiltinFilterRef, index: number): string {
  const tf = tfConst(filter.timeframe || "M5");
  const suffix = filterSuffix(filter, index);
  const placement = filterPlacement(filter);
  const target = placement === "setup" ? "gSetupActive" : "gExecSignal";
  const direction = placement === "setup" ? "gSetupDir" : "gExecDir";
  const condition = filterCondition(filter, suffix, direction);
  const decls = filterDecls(filter, suffix, tf);
  if (!decls) return "";

  return `
   // Verified built-in ${placement} filter: ${filter.label}
${decls}
   if(${target} && !(${condition})) {
      PrintFormat("[FILTER] ${filter.id} blocked");
      ${target} = false;
   }`;
}

export function buildAssemblerFilterCode(
  filterRefs: BuiltinFilterRef[] | undefined,
  placement: "setup" | "execution",
): string {
  return (filterRefs ?? [])
    .filter((filter) => filterPlacement(filter) === placement)
    .map((filter, index) => emitAssemblerFilterSnippet(filter, index))
    .filter(Boolean)
    .join("\n");
}

/** Strategy Flow entry gate — block trade when filter fails. */
export function emitFlowEntryFilterCheck(filter: BuiltinFilterRef, index: number): string {
  const tf = tfConst(filter.timeframe || "M5");
  const suffix = filterSuffix(filter, index);
  const placement = filterPlacement(filter);
  const condition = filterCondition(filter, suffix, "dir");
  const decls = filterDecls(filter, suffix, tf);
  if (!decls) return "";

  return `
   // Flow ${placement} filter: ${filter.label}
${decls}
   if(!(${condition})) {
      gLastGate = "BLOCKED: ${filter.id}";
      PrintFormat("[FILTER] ${filter.id} blocked at entry");
      return;
   }`;
}

export function buildFlowEntryFilterChecks(filterRefs: BuiltinFilterRef[] | undefined): string {
  return (filterRefs ?? [])
    .map((filter, index) => emitFlowEntryFilterCheck(filter, index))
    .filter(Boolean)
    .join("\n");
}

export function flowNeedsFilterHelpers(filterRefs: BuiltinFilterRef[] | undefined): boolean {
  return (filterRefs?.length ?? 0) > 0;
}

/** Indicator handle helpers for built-in filters (RSI / ATR / MACD). */
export const B4_FILTER_INDICATOR_HELPERS = `
int            B4_indHandles[];
string         B4_indKey[];
int            B4_indCount = 0;

int B4_RegisterHandle(string key, int handle, int subWindow)
{
   if(handle == INVALID_HANDLE) return INVALID_HANDLE;
   for(int _i = 0; _i < B4_indCount; _i++)
      if(B4_indKey[_i] == key || B4_indHandles[_i] == handle) return B4_indHandles[_i];
   ChartIndicatorAdd(0, subWindow, handle);
   int n = B4_indCount + 1;
   ArrayResize(B4_indHandles, n); ArrayResize(B4_indKey, n);
   B4_indHandles[B4_indCount] = handle; B4_indKey[B4_indCount] = key;
   B4_indCount++;
   return handle;
}

double B4_Buf(int handle, int buffer, int shift)
{
   double _b[];
   if(handle == INVALID_HANDLE || CopyBuffer(handle, buffer, shift, 1, _b) != 1) return 0.0;
   return _b[0];
}

int B4_RSI(ENUM_TIMEFRAMES tf, int period, ENUM_APPLIED_PRICE price = PRICE_CLOSE)
{
   string key = StringFormat("RSI|%d|%d|%d", (int)tf, period, (int)price);
   for(int _i = 0; _i < B4_indCount; _i++)
      if(B4_indKey[_i] == key) return B4_indHandles[_i];
   int h = iRSI(InpSymbol, tf, period, price);
   if(h == INVALID_HANDLE) return INVALID_HANDLE;
   B4_RegisterHandle(key, h, 1);
   return h;
}

int B4_ATR(ENUM_TIMEFRAMES tf, int period)
{
   string key = StringFormat("ATR|%d|%d", (int)tf, period);
   for(int _i = 0; _i < B4_indCount; _i++)
      if(B4_indKey[_i] == key) return B4_indHandles[_i];
   int h = iATR(InpSymbol, tf, period);
   if(h == INVALID_HANDLE) return INVALID_HANDLE;
   B4_RegisterHandle(key, h, 1);
   return h;
}

int B4_MACD(ENUM_TIMEFRAMES tf, int fast, int slow, int signal, ENUM_APPLIED_PRICE price = PRICE_CLOSE)
{
   string key = StringFormat("MACD|%d|%d|%d|%d|%d", (int)tf, fast, slow, signal, (int)price);
   for(int _i = 0; _i < B4_indCount; _i++)
      if(B4_indKey[_i] == key) return B4_indHandles[_i];
   int h = iMACD(InpSymbol, tf, fast, slow, signal, price);
   if(h == INVALID_HANDLE) return INVALID_HANDLE;
   B4_RegisterHandle(key, h, 1);
   return h;
}
`;

/** Append when B4_MA_HELPER registry is already embedded (EMA + filters). */
export const B4_FILTER_EXTRA_FUNCTIONS = `
int B4_RSI(ENUM_TIMEFRAMES tf, int period, ENUM_APPLIED_PRICE price = PRICE_CLOSE)
{
   string key = StringFormat("RSI|%d|%d|%d", (int)tf, period, (int)price);
   for(int _i = 0; _i < B4_indCount; _i++)
      if(B4_indKey[_i] == key) return B4_indHandles[_i];
   int h = iRSI(InpSymbol, tf, period, price);
   if(h == INVALID_HANDLE) return INVALID_HANDLE;
   B4_RegisterHandle(key, h, 1);
   return h;
}

int B4_ATR(ENUM_TIMEFRAMES tf, int period)
{
   string key = StringFormat("ATR|%d|%d", (int)tf, period);
   for(int _i = 0; _i < B4_indCount; _i++)
      if(B4_indKey[_i] == key) return B4_indHandles[_i];
   int h = iATR(InpSymbol, tf, period);
   if(h == INVALID_HANDLE) return INVALID_HANDLE;
   B4_RegisterHandle(key, h, 1);
   return h;
}

int B4_MACD(ENUM_TIMEFRAMES tf, int fast, int slow, int signal, ENUM_APPLIED_PRICE price = PRICE_CLOSE)
{
   string key = StringFormat("MACD|%d|%d|%d|%d|%d", (int)tf, fast, slow, signal, (int)price);
   for(int _i = 0; _i < B4_indCount; _i++)
      if(B4_indKey[_i] == key) return B4_indHandles[_i];
   int h = iMACD(InpSymbol, tf, fast, slow, signal, price);
   if(h == INVALID_HANDLE) return INVALID_HANDLE;
   B4_RegisterHandle(key, h, 1);
   return h;
}
`;
