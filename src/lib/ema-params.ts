/**
 * Normalize EMA module params — traders may use 1, 2, or many EMA periods.
 * Legacy fastPeriod/slowPeriod are kept in sync for older blueprints.
 */

export type EmaMode = "single" | "dual" | "multi";

export interface NormalizedEmaParams {
  mode: EmaMode;
  /** Sorted ascending (shortest period first). */
  periods: number[];
  fast: number;
  slow: number;
  retestPoints: number;
  requireCross: boolean;
  repeatAfterConfirmation: boolean;
  retestTarget: "fast" | "slow" | "either";
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parsePeriodList(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw
      .map((v) => (typeof v === "number" ? v : parseInt(String(v), 10)))
      .filter((n) => Number.isFinite(n) && n >= 2);
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw
      .split(/[,/\s]+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 2);
  }
  return [];
}

/** Unique sorted ascending periods, capped at 6 lines. */
export function sanitizeEmaPeriods(periods: number[]): number[] {
  const out = [...new Set(periods.filter((n) => n >= 2 && n <= 500))].sort((a, b) => a - b);
  return out.slice(0, 6);
}

export function emaModeFromPeriods(periods: number[]): EmaMode {
  if (periods.length <= 1) return "single";
  if (periods.length === 2) return "dual";
  return "multi";
}

export function normalizeEmaParams(params: Record<string, unknown> = {}): NormalizedEmaParams {
  let periods = sanitizeEmaPeriods(parsePeriodList(params.emaPeriods));

  const fastLegacy = num(params.fastPeriod, NaN);
  const slowLegacy = num(params.slowPeriod, NaN);

  if (periods.length === 0) {
    if (Number.isFinite(fastLegacy) && Number.isFinite(slowLegacy)) {
      periods = sanitizeEmaPeriods([fastLegacy, slowLegacy]);
    } else if (Number.isFinite(fastLegacy)) {
      periods = sanitizeEmaPeriods([fastLegacy]);
    } else if (Number.isFinite(slowLegacy)) {
      periods = sanitizeEmaPeriods([slowLegacy]);
    } else {
      periods = [21, 50];
    }
  }

  const mode = emaModeFromPeriods(periods);
  const fast = periods[0];
  const slow = periods[periods.length - 1];

  const retestTargetRaw = String(params.retestTarget ?? "slow").toLowerCase();
  const retestTarget: NormalizedEmaParams["retestTarget"] =
    retestTargetRaw === "fast" || retestTargetRaw === "either" ? retestTargetRaw : "slow";

  let requireCross =
    typeof params.requireCross === "boolean" ? params.requireCross : mode !== "single";

  if (mode === "single") requireCross = false;

  return {
    mode,
    periods,
    fast,
    slow,
    retestPoints: num(params.retestPoints, 0),
    requireCross,
    repeatAfterConfirmation:
      typeof params.repeatAfterConfirmation === "boolean" ? params.repeatAfterConfirmation : true,
    retestTarget,
  };
}

/** Blueprint params with emaPeriods + legacy fast/slow kept aligned. */
export function emaParamsForBlueprint(params: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeEmaParams(params);
  return {
    ...params,
    emaPeriods: normalized.periods,
    fastPeriod: normalized.fast,
    slowPeriod: normalized.slow,
    requireCross: normalized.requireCross,
  };
}

export function emaPeriodsFromText(text: string): number[] {
  const matches = [...text.matchAll(/\b(\d{1,3})\s*(?:period\s*)?ema\b/gi)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n >= 2);
  return sanitizeEmaPeriods(matches.length ? matches : [12, 48]);
}

export function extractEmaPeriodsFromConfig(
  text: string,
  config?: {
    direction?: { params?: Record<string, unknown> };
    setup?: { params?: Record<string, unknown> };
    execution?: { params?: Record<string, unknown> };
  },
): NormalizedEmaParams {
  const merged = {
    ...(config?.direction?.params ?? {}),
    ...(config?.setup?.params ?? {}),
    ...(config?.execution?.params ?? {}),
  };
  const fromParams = normalizeEmaParams(merged);
  if (
    fromParams.periods.length >= 1 &&
    (merged.emaPeriods || merged.fastPeriod || merged.slowPeriod)
  ) {
    return fromParams;
  }
  return normalizeEmaParams({ emaPeriods: emaPeriodsFromText(text) });
}
