/** Canonical module id resolution (aliases → verified module keys). */
const MODULE_ID_ALIASES: Record<string, string> = {
  ob: "order_block",
  liquidity_buildup: "zone_liq",
  liq_buildup: "zone_liq",
  "liquidity-buildup": "zone_liq",
  breaker_block: "breaker_block",
  smc_bb: "breaker_block",
  "smc-breaker-block": "breaker_block",
  "breaker block": "breaker_block",
  rss_srr: "rss_srr",
  rss: "rss_srr",
  srr: "rss_srr",
  "rss-srr": "rss_srr",
  mef: "mef",
  "manipulation entry formula": "mef",
  "mef candle": "mef",
  qm_mef: "qm_mef",
  "qm mef": "qm_mef",
  "quasimodo mef": "qm_mef",
  rbr: "rbr_dbd",
  dbd: "rbr_dbd",
  "rbr-dbd": "rbr_dbd",
  "rbr dbd": "rbr_dbd",
  "rally base rally": "rbr_dbd",
  "drop base drop": "rbr_dbd",
  "swing structure": "swing_structure",
  "swing high": "swing_structure",
  "swing low": "swing_structure",
  unicorn: "unicorn",
  "bb fvg": "unicorn",
  "breaker fvg": "unicorn",
  "ict unicorn": "unicorn",
};

export function resolveModuleId(moduleId: string): string {
  return MODULE_ID_ALIASES[moduleId] ?? moduleId;
}
