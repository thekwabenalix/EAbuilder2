/**
 * Liquidity Buildup State Module — derived from Liquidity_Buildup indicator.
 */

import {
  generateLiquidityBuildup,
  LIQUIDITY_BUILDUP_VERSION,
  LIQUIDITY_BUILDUP_MODULE,
} from "./zone-liquidity-setup-indicator";

export const LIQUIDITY_BUILDUP_STATE_MODULE_VERSION = "1.0.0";
export const LIQUIDITY_BUILDUP_STATE_MODULE = "Liquidity_Buildup_State_Module";

/** @deprecated use LIQUIDITY_BUILDUP_STATE_MODULE */
export const ZONE_LIQ_STATE_MODULE = LIQUIDITY_BUILDUP_STATE_MODULE;
/** @deprecated use LIQUIDITY_BUILDUP_STATE_MODULE_VERSION */
export const ZONE_LIQ_STATE_MODULE_VERSION = LIQUIDITY_BUILDUP_STATE_MODULE_VERSION;

export function generateLiquidityBuildupStateModule(): string {
  return generateLiquidityBuildup()
    .replace("//| Liquidity_Buildup.mq5", `//| ${LIQUIDITY_BUILDUP_STATE_MODULE}.mq5`)
    .replace(
      `//| SMC Liquidity v${LIQUIDITY_BUILDUP_VERSION} — Combined OB + BB + FVG`,
      `//| Liquidity Buildup State Module v${LIQUIDITY_BUILDUP_STATE_MODULE_VERSION}`,
    )
    .replace(
      'IndicatorSetString(INDICATOR_SHORTNAME, "Liquidity Buildup (OB+BB+FVG)");',
      'IndicatorSetString(INDICATOR_SHORTNAME, "Liq Buildup State");',
    );
}

/** @deprecated use generateLiquidityBuildupStateModule */
export const generateZoneLiqStateModule = generateLiquidityBuildupStateModule;
