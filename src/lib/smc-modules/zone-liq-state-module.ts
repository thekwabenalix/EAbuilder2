/**
 * Liquidity Buildup State Module — derived from the Liquidity_Buildup indicator.
 *
 * Renames the file header so MetaEditor distinguishes it from the standalone
 * indicator. The same detection logic applies; a Phase 3 EA can attach this
 * as an iCustom source for zone + liquidity state.
 */

import {
  generateLiquidityBuildup,
  LIQUIDITY_BUILDUP_VERSION,
} from "./zone-liquidity-setup-indicator";

export const ZONE_LIQ_STATE_MODULE_VERSION = "1.0.0";
export const ZONE_LIQ_STATE_MODULE = "Zone_Liq_State_Module";

export function generateZoneLiqStateModule(): string {
  return generateLiquidityBuildup()
    .replace(
      "//| Liquidity_Buildup.mq5",
      "//| Zone_Liq_State_Module.mq5",
    )
    .replace(
      `//| SMC Liquidity v${LIQUIDITY_BUILDUP_VERSION} — Combined OB + BB + FVG`,
      `//| Zone Liq State Module v${ZONE_LIQ_STATE_MODULE_VERSION} — Liquidity Buildup`,
    )
    .replace(
      'IndicatorSetString(INDICATOR_SHORTNAME, "Liquidity Buildup (OB+BB+FVG)");',
      'IndicatorSetString(INDICATOR_SHORTNAME, "Zone Liq State (OB+BB+FVG)");',
    );
}
