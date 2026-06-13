/** Canonical module id resolution (aliases → verified module keys). */
const MODULE_ID_ALIASES: Record<string, string> = {
  ob: "order_block",
  liquidity_buildup: "zone_liq",
  liq_buildup: "zone_liq",
  "liquidity-buildup": "zone_liq",
};

export function resolveModuleId(moduleId: string): string {
  return MODULE_ID_ALIASES[moduleId] ?? moduleId;
}
