/**
 * Phase 3 — attach StrategyFlow from 4-Brain config when missing.
 *
 * Enables flow-engine preview and audit on /new interview results without
 * overwriting an explicit advanced flow the user already edited.
 */

import { fourBrainToStrategyFlow } from "@/lib/fourbrain-flow-adapter";
import type { StrategyBlueprint } from "@/types/blueprint";

export function enrichBlueprintWithStrategyFlow(bp: StrategyBlueprint): StrategyBlueprint {
  if (bp.strategyFlow?.steps?.length) return bp;
  if (!bp.fourBrain) return bp;
  return {
    ...bp,
    strategyFlow: fourBrainToStrategyFlow(bp.fourBrain),
  };
}
