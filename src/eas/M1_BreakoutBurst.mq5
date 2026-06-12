//+------------------------------------------------------------------+
//| M1 Breakout Burst EA                                             |
//| Breakout momentum EA for MT5                                     |
//+------------------------------------------------------------------+
#property copyright "EAbuilder2"
#property version   "1.01"
#property strict

#include <Trade/Trade.mqh>
CTrade trade;

//-------------------- Inputs --------------------
input int    LookbackCandles       = 20;
input int    NumberOfOrders        = 3;
input double LotSize               = 0.01;

input int    MaxSpreadPips         = 2;

input int    CooldownMinutes       = 10;
input double CloseAllAtProfitUSD   = 2.0;
input double MaxFloatingLossUSD    = 10.0;

input double MinBodyPercent        = 60.0;

input ulong  MagicNumber           = 20260612;

//-------------------- Globals --------------------
datetime lastBarTime        = 0;
datetime lastTradeCloseTime = 0;
datetime lastSignalBarTime  = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   trade.SetExpertMagicNumber(MagicNumber);
   Print("M1 Breakout Burst EA initialized.");
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnTick()
{
   ManageBasketProfitAndLoss();

   if(_Period != PERIOD_M1)
      return;

   if(!IsNewBar())
      return;

   if(!IsSpreadAcceptable())
      return;

   if(IsInCooldown())
      return;

   if(CountOpenPositions() > 0)
      return;

   CheckForBreakoutSignal();
}

//+------------------------------------------------------------------+
bool IsNewBar()
{
   datetime currentBarTime = iTime(_Symbol, PERIOD_M1, 0);

   if(currentBarTime != lastBarTime)
   {
      lastBarTime = currentBarTime;
      return true;
   }

   return false;
}

//+------------------------------------------------------------------+
double Pip()
{
   if(_Digits == 3 || _Digits == 5)
      return _Point * 10;

   return _Point;
}

//+------------------------------------------------------------------+
bool IsSpreadAcceptable()
{
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);

   double spreadPips = (ask - bid) / Pip();

   return spreadPips <= MaxSpreadPips;
}

//+------------------------------------------------------------------+
bool IsInCooldown()
{
   if(lastTradeCloseTime == 0)
      return false;

   return (TimeCurrent() - lastTradeCloseTime) < CooldownMinutes * 60;
}

//+------------------------------------------------------------------+
void CheckForBreakoutSignal()
{
   int breakoutCandle = 1;

   double close1 = iClose(_Symbol, PERIOD_M1, breakoutCandle);
   double open1  = iOpen(_Symbol, PERIOD_M1, breakoutCandle);
   double high1  = iHigh(_Symbol, PERIOD_M1, breakoutCandle);
   double low1   = iLow(_Symbol, PERIOD_M1, breakoutCandle);

   datetime signalTime = iTime(_Symbol, PERIOD_M1, breakoutCandle);

   if(signalTime == lastSignalBarTime)
      return;

   if(!IsStrongBody(open1, close1, high1, low1))
      return;

   double resistance = GetResistance();
   double support    = GetSupport();

   if(close1 > resistance)
   {
      lastSignalBarTime = signalTime;
      OpenBuyBurst();
      return;
   }

   if(close1 < support)
   {
      lastSignalBarTime = signalTime;
      OpenSellBurst();
      return;
   }
}

//+------------------------------------------------------------------+
double GetResistance()
{
   double resistance = -DBL_MAX;

   for(int i = 2; i < LookbackCandles + 2; i++)
   {
      double high = iHigh(_Symbol, PERIOD_M1, i);

      if(high > resistance)
         resistance = high;
   }

   return resistance;
}

//+------------------------------------------------------------------+
double GetSupport()
{
   double support = DBL_MAX;

   for(int i = 2; i < LookbackCandles + 2; i++)
   {
      double low = iLow(_Symbol, PERIOD_M1, i);

      if(low < support)
         support = low;
   }

   return support;
}

//+------------------------------------------------------------------+
bool IsStrongBody(double open, double close, double high, double low)
{
   double range = high - low;

   if(range <= 0)
      return false;

   double body = MathAbs(close - open);
   double bodyPercent = (body / range) * 100.0;

   return bodyPercent >= MinBodyPercent;
}

//+------------------------------------------------------------------+
void OpenBuyBurst()
{
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);

   for(int i = 0; i < NumberOfOrders; i++)
   {
      trade.Buy(
         LotSize,
         _Symbol,
         ask,
         0,
         0,
         "M1 Breakout Buy"
      );
   }
}

//+------------------------------------------------------------------+
void OpenSellBurst()
{
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);

   for(int i = 0; i < NumberOfOrders; i++)
   {
      trade.Sell(
         LotSize,
         _Symbol,
         bid,
         0,
         0,
         "M1 Breakout Sell"
      );
   }
}

//+------------------------------------------------------------------+
void ManageBasketProfitAndLoss()
{
   double totalProfit = 0.0;
   int count = 0;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);

      if(PositionSelectByTicket(ticket))
      {
         if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
            PositionGetInteger(POSITION_MAGIC) == (long)MagicNumber)
         {
            totalProfit += PositionGetDouble(POSITION_PROFIT);
            count++;
         }
      }
   }

   if(count == 0)
      return;

   if(totalProfit >= CloseAllAtProfitUSD)
   {
      CloseAllPositions();
      lastTradeCloseTime = TimeCurrent();
      return;
   }

   if(totalProfit <= -MaxFloatingLossUSD)
   {
      CloseAllPositions();
      lastTradeCloseTime = TimeCurrent();
      return;
   }
}

//+------------------------------------------------------------------+
int CountOpenPositions()
{
   int count = 0;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);

      if(PositionSelectByTicket(ticket))
      {
         if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
            PositionGetInteger(POSITION_MAGIC) == (long)MagicNumber)
         {
            count++;
         }
      }
   }

   return count;
}

//+------------------------------------------------------------------+
void CloseAllPositions()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);

      if(PositionSelectByTicket(ticket))
      {
         if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
            PositionGetInteger(POSITION_MAGIC) == (long)MagicNumber)
         {
            trade.PositionClose(ticket);
         }
      }
   }
}
//+------------------------------------------------------------------+
