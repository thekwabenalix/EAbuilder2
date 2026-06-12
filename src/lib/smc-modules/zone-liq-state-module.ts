/**
 * Phase 2 — Zone Liquidity Setup State Module
 *
 * Same lifecycle as Zone_Liquidity_Setup indicator with Phase 3 buffer contract:
 *   0: BullConfirmBuf — buy entry bar (next open after tap+reject)
 *   1: BearConfirmBuf
 *   2: BullSLBuf
 *   3: BearSLBuf
 */

import { generateZoneLiquiditySetupIndicator, ZONE_LIQ_SETUP_VERSION } from "./zone-liquidity-setup-indicator";

export const ZONE_LIQ_STATE_MODULE_VERSION = "1.0.0";
export const ZONE_LIQ_STATE_MODULE = "Zone_Liq_State_Module";

export function generateZoneLiqStateModule(): string {
  return generateZoneLiquiditySetupIndicator()
    .replace(
      "//| Zone_Liquidity_Setup.mq5",
      "//| Zone_Liq_State_Module.mq5",
    )
    .replace(
      `//| FVG + OB + BB liquidity detectors v${ZONE_LIQ_SETUP_VERSION}`,
      `//| Phase 2 State Module v${ZONE_LIQ_STATE_MODULE_VERSION} — Zone Liq Setup`,
    )
    .replace(
      '#property copyright "EA Builder — SMC Setup"',
      '#property copyright "EA Builder — SMC State"',
    )
    .replace(
      'IndicatorSetString(INDICATOR_SHORTNAME, "Zone Liq Setup");',
      'IndicatorSetString(INDICATOR_SHORTNAME, "Zone Liq State");',
    );
}
