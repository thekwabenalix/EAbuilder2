/**
 * Inputs Generator
 *
 * Generates the EA input parameters based on brain config.
 */

import type { FourBrainConfig } from "@/types/blueprint";

export function genInputs(config: FourBrainConfig, symbol: string, magic: number): string {
  const directionTF = config.direction?.timeframe || "D1";
  const setupTF = config.setup?.timeframe || "H4";
  const executionTF = config.execution?.timeframe || "H1";

  return `
//--- EA Settings
input string   InpSymbol      = "${symbol}";
input ulong    InpMagic       = ${magic};

//--- Brain Timeframes
input ENUM_TIMEFRAMES InpDirectionTF = PERIOD_${directionTF === "D1" ? "D1" : directionTF === "H1" ? "H1" : "H4"};
input ENUM_TIMEFRAMES InpSetupTF     = PERIOD_${setupTF === "H4" ? "H4" : setupTF === "H1" ? "H1" : "D1"};
input ENUM_TIMEFRAMES InpExecTF      = PERIOD_${executionTF === "H1" ? "H1" : executionTF === "M15" ? "M15" : "H4"};

//--- Risk Settings
input double   InpRiskPercent = ${config.management?.riskPercent || 1.0};
input double   InpRewardRisk  = ${config.management?.rewardRisk || 1.5};
input double   InpStopBuffer  = ${config.management?.stopBuffer || 0.001};

//--- Break-Even Settings
input bool     InpBreakEvenEnabled = ${config.management?.breakEvenEnabled ? "true" : "false"};
input double   InpBreakEvenAtR     = ${config.management?.breakEvenAtR || 0.5};
input int      InpMaxOpenTrades    = ${config.management?.maxOpenTrades || 10};
`;
}
