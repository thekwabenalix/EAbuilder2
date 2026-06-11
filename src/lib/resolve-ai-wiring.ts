/**
 * Phase 3 — unified AI wiring resolution.
 *
 * Priority: strategy_flow → blessed deterministic adapter → legacy brain_bodies.
 */

import type { AiBrainWiring } from "@/lib/api-client";
import type { BuiltinFilterRef } from "@/lib/builtin-filter-contracts";
import type { FourBrainConfig } from "@/types/blueprint";
import { aiWiringHasStrategyFlow } from "@/lib/ai-strategy-flow";
import {
  buildBlessedAdapterWiring,
  detectBlessedAdapterId,
  isBlessedAdapterWiring,
} from "@/lib/blessed-ema-adapters";

export type ResolvedAiMode = "strategy_flow" | "blessed_adapter" | "brain_bodies";

export interface ResolveAiWiringInput {
  wiring: AiBrainWiring;
  text?: string;
  config?: FourBrainConfig;
  filterRefs?: BuiltinFilterRef[];
}

export interface ResolvedAiWiring {
  wiring: AiBrainWiring;
  mode: ResolvedAiMode;
  warnings: string[];
}

export function resolveAiWiring(input: ResolveAiWiringInput): ResolvedAiWiring {
  const { wiring, text = "", config } = input;
  const warnings: string[] = [];

  if (aiWiringHasStrategyFlow(wiring)) {
    return { wiring, mode: "strategy_flow", warnings };
  }

  if (isBlessedAdapterWiring(wiring)) {
    return { wiring, mode: "blessed_adapter", warnings };
  }

  const adapterId = detectBlessedAdapterId(text, config);
  if (adapterId) {
    return {
      wiring: buildBlessedAdapterWiring(adapterId, text, config),
      mode: "blessed_adapter",
      warnings,
    };
  }

  warnings.push(
    "AI returned legacy brain_bodies wiring. Prefer strategy_flow output or a blessed adapter pattern (EMA+IFVG, EMA CTC).",
  );
  return { wiring, mode: "brain_bodies", warnings };
}
