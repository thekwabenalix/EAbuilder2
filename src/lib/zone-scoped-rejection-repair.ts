/**
 * Shared repair: SNR `rejection` in execution + SMC zone in setup/direction
 * → zone-scoped confirm + next-bar entry (not generic REJSM).
 *
 * Used by parse-strategy intake and gen-4brain-ai post-processing.
 */

import type { BrainModuleType, FourBrainConfig } from "@/types/blueprint";

export const ZONE_SCOPED_SETUP_MODULES = new Set<BrainModuleType>([
  "fvg",
  "fvg_inversion",
  "order_block",
  "ob_fvg",
  "unicorn",
  "breaker_block",
]);

export function mentionsIfvgConcept(text: string): boolean {
  const hay = text.toLowerCase();
  return (
    /\bifvg\b|inversion\s+(?:fvg|fair\s+value\s+gap)|inverted\s+(?:fvg|fair\s+value\s+gap)/.test(
      hay,
    ) ||
    /\b(?:fvg|fair\s+value\s+gap|gap)\b.{0,100}\b(?:invert|inverts|inverted|inversion|becomes|turns?\s+into|converted?\s+to|creating\s+an?\s+ifvg)\b/.test(
      hay,
    ) ||
    /\b(?:invert|inverts|inverted|inversion|becomes|turns?\s+into|converted?\s+to|creating\s+an?\s+ifvg)\b.{0,100}\b(?:fvg|fair\s+value\s+gap|gap|ifvg)\b/.test(
      hay,
    )
  );
}

export function resolveZoneModuleFromCorpus(corpus: string): BrainModuleType | undefined {
  const hay = corpus.toLowerCase();
  if (/\bunicorn\b|ict unicorn|overlap pocket|breaker fvg overlap/.test(hay)) return "unicorn";
  if (mentionsIfvgConcept(hay)) return "fvg_inversion";
  if (/\bfvg\b|fair value gap|imbalance/.test(hay)) return "fvg";
  if (/ob fvg|ob_fvg|order block with fvg/.test(hay)) return "ob_fvg";
  if (/order block|demand zone|supply zone/.test(hay)) return "order_block";
  if (/breaker block/.test(hay) && !/bollinger/.test(hay)) return "breaker_block";
  return undefined;
}

/** True when `rejection` is the internal remap trigger paired with an SMC zone module. */
export function moduleListHasZoneScopedRejectionTrigger(
  moduleIds: Array<BrainModuleType | string | undefined>,
): boolean {
  if (!moduleIds.includes("rejection")) return false;
  return moduleIds.some(
    (id): id is BrainModuleType =>
      typeof id === "string" && ZONE_SCOPED_SETUP_MODULES.has(id as BrainModuleType),
  );
}

export function wantsZoneRejectionRemap(corpus: string, executionModule?: string): boolean {
  return (
    /reject|rejection|wick.{0,24}(hold|outside|pocket)|close.{0,40}outside|overlap pocket|zone confirm/i.test(
      corpus,
    ) ||
    executionModule === "rejection" ||
    /next candle|next bar|bar after|following candle/i.test(corpus)
  );
}

function shouldSkipZoneRepair(config: FourBrainConfig, corpus: string): boolean {
  const setupMod = config.setup?.modules?.[0];
  const directionMod = config.direction?.modules?.[0];

  if (
    config.execution?.modules?.[0] === "fvg_inversion" ||
    setupMod === "fvg_inversion" ||
    mentionsIfvgConcept(corpus)
  ) {
    return true;
  }

  if (
    config.direction?.modules?.includes("ema") ||
    config.setup?.modules?.includes("ema") ||
    /\b\d+\s*(?:period\s*)?ema\b|\bema cross\b|\bema retest\b/i.test(corpus)
  ) {
    return true;
  }

  if (setupMod === "gap_snr" && !/\bunicorn\b|\bfvg\b|order block|overlap pocket/i.test(corpus)) {
    return true;
  }

  void directionMod;
  return false;
}

/** Remap zone + SNR rejection execution to setup=zone, execution=rejection (flow adapter expands). */
export function repairZoneScopedRejectionConfig(
  config: FourBrainConfig,
  corpus: string,
): FourBrainConfig {
  const zoneFromBrains = [config.setup?.modules?.[0], config.direction?.modules?.[0]].find(
    (m): m is BrainModuleType =>
      typeof m === "string" && ZONE_SCOPED_SETUP_MODULES.has(m as BrainModuleType),
  );
  const zoneMod = zoneFromBrains ?? resolveZoneModuleFromCorpus(corpus);
  if (!zoneMod) return config;
  if (shouldSkipZoneRepair(config, corpus)) return config;

  if (!wantsZoneRejectionRemap(corpus, config.execution?.modules?.[0])) return config;

  const zoneTf =
    config.setup?.timeframe ?? config.direction?.timeframe ?? config.execution.timeframe ?? "H1";
  const entryTf = config.execution.timeframe ?? zoneTf;
  const zoneParams = { ...(config.direction?.params ?? {}), ...(config.setup?.params ?? {}) };

  let nextDirection = config.direction;
  if (
    config.direction?.modules?.[0] &&
    ZONE_SCOPED_SETUP_MODULES.has(config.direction.modules[0])
  ) {
    nextDirection = undefined;
  }

  const nextSetup = {
    modules: [zoneMod] as BrainModuleType[],
    timeframe: zoneTf,
    params: zoneParams,
    description:
      config.setup?.description ||
      config.direction?.description ||
      `${zoneMod} zone — SMC pocket/setup for zone-scoped rejection.`,
  };

  const nextExecution = {
    modules: ["rejection"] as BrainModuleType[],
    timeframe: entryTf,
    params: config.execution.params ?? zoneParams,
    description:
      config.execution.description ||
      "Zone rejection entry (execution id rejection → flow engine zone confirm + next bar).",
  };

  return {
    ...config,
    direction: nextDirection,
    setup: nextSetup,
    execution: nextExecution,
  };
}
