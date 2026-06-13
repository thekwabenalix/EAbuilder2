/**
 * User-facing labels for SMC zone rejection vs SNR Rejection.
 */

import type { BrainModuleType } from "@/types/blueprint";
import { STRATEGY_EVENT_CONTRACTS, type StrategyEventType } from "@/lib/strategy-events";
import { ZONE_SCOPED_SETUP_MODULES } from "@/lib/zone-scoped-rejection-repair";

const ZONE_SHORT_LABEL: Partial<Record<BrainModuleType, string>> = {
  unicorn: "Unicorn",
  fvg: "FVG",
  fvg_inversion: "IFVG",
  order_block: "OB",
  ob_fvg: "OB + FVG",
  breaker_block: "Breaker Block",
};

/** Standard event label prefix for zone touch + close-outside confirm. */
export function smcZoneRejectionEventLabel(zoneModule: BrainModuleType): string {
  const short = ZONE_SHORT_LABEL[zoneModule] ?? zoneModule.replace(/_/g, " ");
  return `SMC Zone Rejection — ${short}`;
}

export function isZoneScopedRejectionPair(
  setupModule: BrainModuleType | undefined,
  executionModule: BrainModuleType | undefined,
): boolean {
  return (
    executionModule === "rejection" &&
    setupModule !== undefined &&
    ZONE_SCOPED_SETUP_MODULES.has(setupModule)
  );
}

/** Display label for 4-Brain module chips when execution is zone-scoped (not SNR). */
export function brainModuleDisplayLabel(
  moduleId: BrainModuleType,
  context?: { role?: "direction" | "setup" | "execution"; setupModule?: BrainModuleType },
): string {
  if (
    context?.role === "execution" &&
    moduleId === "rejection" &&
    context.setupModule &&
    ZONE_SCOPED_SETUP_MODULES.has(context.setupModule)
  ) {
    return `${smcZoneRejectionEventLabel(context.setupModule)} + Next Bar`;
  }
  return moduleId;
}

const ZONE_FLOW_EVENTS: Partial<
  Record<BrainModuleType, { active: StrategyEventType; confirm: StrategyEventType }>
> = {
  unicorn: { active: "UNICORN_ACTIVE", confirm: "UNICORN_CONFIRMED" },
  fvg: { active: "FVG_CREATED", confirm: "FVG_CONFIRMED" },
  fvg_inversion: { active: "IFVG_FORMED", confirm: "IFVG_CONFIRMED" },
  order_block: { active: "OB_CREATED", confirm: "OB_CONFIRMED" },
  ob_fvg: { active: "OB_FVG_CONFLUENCE", confirm: "OB_FVG_CONFIRMED" },
  breaker_block: { active: "BB_ZONE_ACTIVE", confirm: "BB_CONFIRMED" },
};

/** Three-step chain shown on presets and zone-scoped execution summaries. */
export function zoneScopedFlowChainDisplay(zoneModule: BrainModuleType): string[] {
  const events = ZONE_FLOW_EVENTS[zoneModule];
  if (!events) {
    return [
      `Setup — ${ZONE_SHORT_LABEL[zoneModule] ?? zoneModule} zone active`,
      smcZoneRejectionEventLabel(zoneModule),
      "Entry — Next bar after confirm",
    ];
  }
  const activeLabel = STRATEGY_EVENT_CONTRACTS[events.active]?.label ?? events.active;
  const confirmLabel = STRATEGY_EVENT_CONTRACTS[events.confirm]?.label ?? events.confirm;
  const entryLabel =
    STRATEGY_EVENT_CONTRACTS.BAR_AFTER_CONFIRM?.label ?? "Next Bar After Confirm";
  return [`1. ${activeLabel}`, `2. ${confirmLabel}`, `3. ${entryLabel}`];
}

export const UNICORN_POCKET_FLOW_CHAIN = zoneScopedFlowChainDisplay("unicorn");

/** Module ids shown in brain / flow pickers — SNR Rejection hidden for SMC school. */
export function shouldHideSnrRejectionInPicker(
  family: import("@/lib/strategy-family").StrategyFamily | null | undefined,
  setupModules?: BrainModuleType[],
): boolean {
  if (family === "smc_ict") return true;
  if (setupModules?.some((m) => ZONE_SCOPED_SETUP_MODULES.has(m))) return true;
  return false;
}
