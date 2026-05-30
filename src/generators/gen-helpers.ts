/**
 * Helpers Generator
 *
 * Generates common utility functions used across all brains.
 */

export function genHelpers(): string {
  return `
//+------------------------------------------------------------------+
//| Utility Functions                                                |
//+------------------------------------------------------------------+

bool IsNewBar(ENUM_TIMEFRAMES tf)
{
   static datetime lastBarTime = 0;
   datetime barTime = iTime(InpSymbol, tf, 0);
   if(barTime != lastBarTime)
   {
      lastBarTime = barTime;
      return true;
   }
   return false;
}

double GetHighest(ENUM_TIMEFRAMES tf, int period)
{
   double highest = iHigh(InpSymbol, tf, 0);
   for(int i = 1; i < period; i++)
   {
      highest = MathMax(highest, iHigh(InpSymbol, tf, i));
   }
   return highest;
}

double GetLowest(ENUM_TIMEFRAMES tf, int period)
{
   double lowest = iLow(InpSymbol, tf, 0);
   for(int i = 1; i < period; i++)
   {
      lowest = MathMin(lowest, iLow(InpSymbol, tf, i));
   }
   return lowest;
}

double CalculatePositionSize(double riskAmount, double stopDistance)
{
   if(stopDistance <= 0) return 0.1;
   double symbolPoint = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   if(symbolPoint <= 0) return 0.1;
   return riskAmount / (stopDistance / symbolPoint);
}

bool IsMarketOpen()
{
   datetime now = TimeCurrent();
   MqlDateTime mdt;
   TimeToStruct(now, mdt);
   return (mdt.day_of_week >= 1 && mdt.day_of_week <= 5) || (mdt.day_of_week == 0 && mdt.hour < 2);
}
`;
}
