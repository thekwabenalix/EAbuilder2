/**
 * Management Brain Generator
 *
 * Takes risk/exit config and generates Management_Brain_ManageBreakEven() function.
 * This brain is mostly static (risk%, R:R, BE settings).
 */

import type { ManagementBrainConfig } from "@/types/blueprint";
import { MANAGEMENT_BRAIN_TEMPLATE } from "@/templates/brain-management.mql5";

export function genManagementBrain(
  config: ManagementBrainConfig | undefined
): string {
  if (!config) {
    return `
// Default risk configuration
ManagementBrainState gMgmtState = {1.0, 1.5, 0.0010, false, 0.5, 10};
void Management_Brain_ManageBreakEven() {}
`;
  }

  const riskPercent = config.riskPercent ?? 1.0;
  const rewardRisk = config.rewardRisk ?? 1.5;
  const stopBuffer = config.stopBuffer ?? 0.001;
  const breakEvenEnabled = config.breakEvenEnabled ? "true" : "false";
  const breakEvenAtR = config.breakEvenAtR ?? 0.5;
  const maxOpenTrades = config.maxOpenTrades ?? 10;

  let breakEvenLogic = `
   // Check break-even conditions
   PositionSelect(InpSymbol);
   if(PositionGetTicket() > 0)
   {
      double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      double stopLoss = PositionGetDouble(POSITION_SL);
      double profit = PositionGetDouble(POSITION_PROFIT);

      // Simple BE logic: if profit > some threshold, move SL to breakeven
      if(${breakEvenEnabled} && profit > 0)
      {
         // Placeholder for full break-even logic
      }
   }
`;

  return MANAGEMENT_BRAIN_TEMPLATE.replace(
    "{{ riskPercent }}",
    riskPercent.toString()
  )
    .replace("{{ rewardRisk }}", rewardRisk.toString())
    .replace("{{ stopBuffer }}", stopBuffer.toString())
    .replace("{{ breakEvenEnabled }}", breakEvenEnabled)
    .replace("{{ breakEvenAtR }}", breakEvenAtR.toString())
    .replace("{{ maxOpenTrades }}", maxOpenTrades.toString())
    .replace("{{ breakEvenLogic }}", breakEvenLogic);
}
