//+------------------------------------------------------------------+
//| M5_IFVG_Pullback.mq5                                            |
//| M5 IFVG Pullback Strategy                                       |
//|                                                                  |
//| Direction : EMA 12 vs EMA 48 on M5                              |
//| Setup     : Swing high/low (3L + 3R) after EMA alignment        |
//| Execution : iFVG inversion close → entry on NEXT bar open       |
//| SL        : Swing low (buy) or swing high (sell) + 20pt buffer  |
//| TP        : 2R  |  BE : 1R                                      |
//+------------------------------------------------------------------+
#property copyright "EAbuilder2"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>
CTrade trade;

//--- Inputs
input string   InpSymbol      = "EURUSD";  // Trading symbol
input ulong    InpMagic       = 990002;    // EA magic number
input double   InpRiskPercent = 1.0;       // Risk per trade (% equity)
input double   InpRewardRisk  = 2.0;       // Reward : Risk ratio
input int      InpStopBuffer  = 20;        // Extra buffer on SL (points)
input int      InpMaxSpread   = 25;        // Max allowed spread (points, 0=off)
input double   InpBEAtR       = 1.0;       // Move SL to break-even at this R multiple
input int      InpEMAFast     = 12;        // Fast EMA period
input int      InpEMASlow     = 48;        // Slow EMA period

//--- Indicator handles
int hFast = INVALID_HANDLE;
int hSlow = INVALID_HANDLE;

//+------------------------------------------------------------------+
//| FVG / iFVG record                                                |
//+------------------------------------------------------------------+
#define MAX_FVGS 200

struct FvgRecord
{
   int      dir;            //  1=bull FVG   -1=bear FVG
   double   ul;             // upper limit
   double   ll;             // lower limit
   datetime c1Time;         // C1 bar time (birth marker, used for dedup)
   bool     inverted;       // true once inversion close detected
   datetime inversionTime;  // bar whose close caused the inversion
   bool     traded;         // true once an entry has been placed
};

FvgRecord fvgList[MAX_FVGS];
int       fvgCount = 0;

//--- Swing state (reset whenever a newer swing is confirmed)
double   gBottomPrice = 0.0;  // most recent confirmed swing low price
datetime gBottomTime  = 0;    // time of that candle
bool     gBuyReady    = false; // look for bull iFVG entries

double   gPeakPrice   = 0.0;
datetime gPeakTime    = 0;
bool     gSellReady   = false;

static datetime gLastBarTime = 0;

//+------------------------------------------------------------------+
//| Utility helpers                                                  |
//+------------------------------------------------------------------+
double NormalizeVol(double vol)
{
   double minL = SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_MIN);
   double maxL = SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_MAX);
   double step = SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_STEP);
   if(step <= 0) step = 0.01;
   vol = MathFloor(vol / step) * step;
   if(vol < minL) vol = minL;
   if(vol > maxL) vol = maxL;
   return NormalizeDouble(vol, 2);
}

double CalcLot(double slPoints)
{
   if(slPoints <= 0) return 0.0;
   double equity    = AccountInfoDouble(ACCOUNT_EQUITY);
   double riskAmt   = equity * InpRiskPercent / 100.0;
   double tickVal   = SymbolInfoDouble(InpSymbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSz    = SymbolInfoDouble(InpSymbol, SYMBOL_TRADE_TICK_SIZE);
   double pt        = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   if(tickVal <= 0 || tickSz <= 0 || pt <= 0) return 0.0;
   double lossPerLot = (slPoints * pt / tickSz) * tickVal;
   if(lossPerLot <= 0) return 0.0;
   return NormalizeVol(riskAmt / lossPerLot);
}

bool HasOpenPos()
{
   for(int i = PositionsTotal()-1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(!PositionSelectByTicket(t)) continue;
      if(PositionGetString(POSITION_SYMBOL) == InpSymbol &&
         PositionGetInteger(POSITION_MAGIC)  == InpMagic) return true;
   }
   return false;
}

bool SpreadOk()
{
   if(InpMaxSpread <= 0) return true;
   return (int)SymbolInfoInteger(InpSymbol, SYMBOL_SPREAD) <= InpMaxSpread;
}

double EMAVal(int handle, int shift)
{
   double arr[1];
   ArraySetAsSeries(arr, true);
   if(CopyBuffer(handle, 0, shift, 1, arr) != 1) return 0.0;
   return arr[0];
}

//+------------------------------------------------------------------+
//| Swing detection — 3 bars each side                              |
//| sh = candidate bar shift. Needs shifts sh-3..sh+3 all closed.   |
//| We check at sh=4 each bar-open: right side = shifts 1,2,3       |
//|                                  left side  = shifts 5,6,7      |
//+------------------------------------------------------------------+
bool IsSwingLow(int sh)
{
   double lo = iLow(InpSymbol, PERIOD_M5, sh);
   if(lo <= 0) return false;
   for(int k = 1; k <= 3; k++)
   {
      if(iLow(InpSymbol, PERIOD_M5, sh - k) <= lo) return false; // right (newer)
      if(iLow(InpSymbol, PERIOD_M5, sh + k) <= lo) return false; // left  (older)
   }
   return true;
}

bool IsSwingHigh(int sh)
{
   double hi = iHigh(InpSymbol, PERIOD_M5, sh);
   if(hi <= 0) return false;
   for(int k = 1; k <= 3; k++)
   {
      if(iHigh(InpSymbol, PERIOD_M5, sh - k) >= hi) return false;
      if(iHigh(InpSymbol, PERIOD_M5, sh + k) >= hi) return false;
   }
   return true;
}

//+------------------------------------------------------------------+
//| FVG detection on just-closed 3-bar set (C3=shift1, C1=shift3)   |
//+------------------------------------------------------------------+
void DetectFVG()
{
   if(iBars(InpSymbol, PERIOD_M5) < 4) return;

   datetime c1T = iTime(InpSymbol, PERIOD_M5, 3); // C1 = oldest

   // Dedup: skip if we already have a live FVG from this C1 bar
   for(int k = 0; k < fvgCount; k++)
      if(!fvgList[k].traded && fvgList[k].c1Time == c1T) return;

   double c3Lo = iLow (InpSymbol, PERIOD_M5, 1); // C3 = newest
   double c1Hi = iHigh(InpSymbol, PERIOD_M5, 3);
   double c3Hi = iHigh(InpSymbol, PERIOD_M5, 1);
   double c1Lo = iLow (InpSymbol, PERIOD_M5, 3);

   bool bullGap = (c3Lo > c1Hi); // Bullish FVG: C3.Low > C1.High
   bool bearGap = (c3Hi < c1Lo); // Bearish FVG: C3.High < C1.Low
   if(!bullGap && !bearGap) return;

   // Find a free slot (recycle traded slots)
   int idx = -1;
   for(int k = 0; k < fvgCount; k++)
      if(fvgList[k].traded) { idx = k; break; }
   if(idx < 0)
   {
      if(fvgCount >= MAX_FVGS) return;
      idx = fvgCount++;
   }

   fvgList[idx].dir           = bullGap ? 1 : -1;
   // Bull FVG: UL=C3.Low, LL=C1.High  |  Bear FVG: UL=C1.Low, LL=C3.High
   fvgList[idx].ul            = bullGap ? c3Lo : c1Lo;
   fvgList[idx].ll            = bullGap ? c1Hi : c3Hi;
   fvgList[idx].c1Time        = c1T;
   fvgList[idx].inverted      = false;
   fvgList[idx].inversionTime = 0;
   fvgList[idx].traded        = false;

   PrintFormat("[FVG] %s | ul=%.5f ll=%.5f | born=%s",
               bullGap?"BULL":"BEAR",
               fvgList[idx].ul, fvgList[idx].ll,
               TimeToString(c1T, TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
//| Inversion check on just-closed bar (shift 1)                    |
//| Bullish iFVG: bearish FVG, close > UL                           |
//| Bearish iFVG: bullish FVG, close < LL                           |
//+------------------------------------------------------------------+
void CheckInversions()
{
   double   cl1  = iClose(InpSymbol, PERIOD_M5, 1);
   datetime bar1 = iTime (InpSymbol, PERIOD_M5, 1);

   for(int k = 0; k < fvgCount; k++)
   {
      if(fvgList[k].inverted) continue;
      if(fvgList[k].traded)   continue;
      if(fvgList[k].c1Time >= bar1) continue; // FVG must pre-date this bar

      // Bullish iFVG: bearish FVG (dir=-1) inverted when close > UL
      // Bearish iFVG: bullish FVG  (dir=+1) inverted when close < LL
      bool bullInv = (fvgList[k].dir == -1 && cl1 > fvgList[k].ul);
      bool bearInv = (fvgList[k].dir ==  1 && cl1 < fvgList[k].ll);
      if(!bullInv && !bearInv) continue;

      fvgList[k].inverted      = true;
      fvgList[k].inversionTime = bar1;

      PrintFormat("[IFVG] %s BORN | ul=%.5f ll=%.5f | inv_close=%.5f | %s",
                  bullInv ? "BULL" : "BEAR",
                  fvgList[k].ul, fvgList[k].ll, cl1,
                  TimeToString(bar1, TIME_DATE|TIME_MINUTES));

      // Draw iFVG zone on chart
      string rn = StringFormat("IFVG_%s_%d", bullInv?"B":"S", (int)bar1);
      datetime rt2 = bar1 + PeriodSeconds(PERIOD_M5) * 30;
      if(ObjectCreate(0, rn, OBJ_RECTANGLE, 0, fvgList[k].c1Time, fvgList[k].ul, rt2, fvgList[k].ll))
      {
         ObjectSetInteger(0, rn, OBJPROP_COLOR,     bullInv ? clrMediumSeaGreen : clrOrchid);
         ObjectSetInteger(0, rn, OBJPROP_STYLE,     STYLE_SOLID);
         ObjectSetInteger(0, rn, OBJPROP_WIDTH,     1);
         ObjectSetInteger(0, rn, OBJPROP_BACK,      true);
         ObjectSetInteger(0, rn, OBJPROP_FILL,      true);
         ObjectSetInteger(0, rn, OBJPROP_SELECTABLE,false);
      }
      string ln = StringFormat("IFVG_L_%s_%d", bullInv?"B":"S", (int)bar1);
      if(ObjectCreate(0, ln, OBJ_TEXT, 0, fvgList[k].c1Time, fvgList[k].ul))
      {
         ObjectSetString (0, ln, OBJPROP_TEXT,     bullInv ? "iFVG↑" : "iFVG↓");
         ObjectSetInteger(0, ln, OBJPROP_COLOR,    bullInv ? clrMediumSeaGreen : clrOrchid);
         ObjectSetInteger(0, ln, OBJPROP_FONTSIZE, 8);
         ObjectSetInteger(0, ln, OBJPROP_SELECTABLE, false);
      }
   }
}

//+------------------------------------------------------------------+
//| Entry execution — fires on the bar AFTER the inversion close    |
//+------------------------------------------------------------------+
void ExecuteEntries(double emaFast, double emaSlow)
{
   if(HasOpenPos() || !SpreadOk()) return;

   double pt     = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   double ask    = SymbolInfoDouble(InpSymbol, SYMBOL_ASK);
   double bid    = SymbolInfoDouble(InpSymbol, SYMBOL_BID);
   int    digits = (int)SymbolInfoInteger(InpSymbol, SYMBOL_DIGITS);
   long   stops  = SymbolInfoInteger(InpSymbol, SYMBOL_TRADE_STOPS_LEVEL);
   datetime bar1 = iTime(InpSymbol, PERIOD_M5, 1); // bar that just closed (= inversion bar)

   for(int k = 0; k < fvgCount; k++)
   {
      if(!fvgList[k].inverted)    continue;
      if(fvgList[k].traded)       continue;
      // Entry is on the bar AFTER the inversion:
      // inversionTime = bar1 from the PREVIOUS tick → now bar1 == inversionTime means
      // we're on the bar IMMEDIATELY after (current bar opened after that close).
      if(fvgList[k].inversionTime != bar1) continue;

      //--- BUY: bullish iFVG (was bearish FVG, dir=-1, inverted → bull signal)
      if(fvgList[k].dir == -1 &&
         emaFast > emaSlow &&
         gBuyReady &&
         fvgList[k].c1Time > gBottomTime &&   // FVG born AFTER the bottom
         gBottomPrice > 0)
      {
         double sl   = NormalizeDouble(gBottomPrice - InpStopBuffer * pt, digits);
         double dist = (ask - sl) / pt;
         if(dist <= (double)stops) { PrintFormat("[SKIP] BUY dist=%.0f <= stops_level=%d", dist, stops); continue; }
         double lot  = CalcLot(dist);
         if(lot <= 0) { Print("[SKIP] BUY CalcLot=0"); continue; }
         double tp   = NormalizeDouble(ask + dist * InpRewardRisk * pt, digits);

         PrintFormat("[ENTRY] BUY | entry=%.5f sl=%.5f (bottom=%.5f) tp=%.5f lot=%.2f dist=%.0f pts",
                     ask, sl, gBottomPrice, tp, lot, dist);

         if(trade.Buy(lot, InpSymbol, ask, sl, tp, "M5_IFVG_BUY"))
         {
            fvgList[k].traded = true;
            gBuyReady = false;  // wait for next bottom
            // Mark entry on chart
            string an = StringFormat("ENTRY_BUY_%d", (int)TimeCurrent());
            if(ObjectCreate(0, an, OBJ_ARROW_BUY, 0, iTime(InpSymbol,PERIOD_M5,0), sl))
            {
               ObjectSetInteger(0, an, OBJPROP_COLOR, clrLime);
               ObjectSetInteger(0, an, OBJPROP_WIDTH, 2);
               ObjectSetInteger(0, an, OBJPROP_SELECTABLE, false);
            }
         }
         break;
      }

      //--- SELL: bearish iFVG (was bullish FVG, dir=+1, inverted → bear signal)
      if(fvgList[k].dir ==  1 &&
         emaFast < emaSlow &&
         gSellReady &&
         fvgList[k].c1Time > gPeakTime &&     // FVG born AFTER the peak
         gPeakPrice > 0)
      {
         double sl   = NormalizeDouble(gPeakPrice + InpStopBuffer * pt, digits);
         double dist = (sl - bid) / pt;
         if(dist <= (double)stops) { PrintFormat("[SKIP] SELL dist=%.0f <= stops_level=%d", dist, stops); continue; }
         double lot  = CalcLot(dist);
         if(lot <= 0) { Print("[SKIP] SELL CalcLot=0"); continue; }
         double tp   = NormalizeDouble(bid - dist * InpRewardRisk * pt, digits);

         PrintFormat("[ENTRY] SELL | entry=%.5f sl=%.5f (peak=%.5f) tp=%.5f lot=%.2f dist=%.0f pts",
                     bid, sl, gPeakPrice, tp, lot, dist);

         if(trade.Sell(lot, InpSymbol, bid, sl, tp, "M5_IFVG_SELL"))
         {
            fvgList[k].traded = true;
            gSellReady = false; // wait for next peak
            string an = StringFormat("ENTRY_SELL_%d", (int)TimeCurrent());
            if(ObjectCreate(0, an, OBJ_ARROW_SELL, 0, iTime(InpSymbol,PERIOD_M5,0), sl))
            {
               ObjectSetInteger(0, an, OBJPROP_COLOR, clrOrangeRed);
               ObjectSetInteger(0, an, OBJPROP_WIDTH, 2);
               ObjectSetInteger(0, an, OBJPROP_SELECTABLE, false);
            }
         }
         break;
      }
   }
}

//+------------------------------------------------------------------+
//| Break-even — move SL to entry price at InpBEAtR × initial risk  |
//+------------------------------------------------------------------+
void ManageBreakEven()
{
   double pt     = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   int    digits = (int)SymbolInfoInteger(InpSymbol, SYMBOL_DIGITS);
   for(int i = PositionsTotal()-1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL) != InpSymbol) continue;
      if(PositionGetInteger(POSITION_MAGIC)  != InpMagic)  continue;

      long   type = PositionGetInteger(POSITION_TYPE);
      double open = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl   = PositionGetDouble(POSITION_SL);
      double tp   = PositionGetDouble(POSITION_TP);
      if(open <= 0 || sl <= 0) continue;

      double initRisk = MathAbs(open - sl);
      if(initRisk < pt) continue;

      double bid = SymbolInfoDouble(InpSymbol, SYMBOL_BID);
      double ask = SymbolInfoDouble(InpSymbol, SYMBOL_ASK);

      if(type == POSITION_TYPE_BUY)
      {
         if(sl >= open - pt) continue; // already at or past break-even
         if(bid - open >= initRisk * InpBEAtR)
         {
            PrintFormat("[BE] Moving BUY SL to breakeven=%.5f", open);
            trade.PositionModify(ticket, NormalizeDouble(open, digits), tp);
         }
      }
      else // SELL
      {
         if(sl <= open + pt) continue;
         if(open - ask >= initRisk * InpBEAtR)
         {
            PrintFormat("[BE] Moving SELL SL to breakeven=%.5f", open);
            trade.PositionModify(ticket, NormalizeDouble(open, digits), tp);
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Draw swing markers on chart                                      |
//+------------------------------------------------------------------+
void DrawSwing(bool isBull, double price, datetime t)
{
   string nm = StringFormat("SWING_%s_%d", isBull?"BOT":"TOP", (int)t);
   double offset = isBull
                   ? price - 10 * SymbolInfoDouble(InpSymbol, SYMBOL_POINT)
                   : price + 10 * SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   if(ObjectCreate(0, nm, OBJ_TEXT, 0, t, offset))
   {
      ObjectSetString (0, nm, OBJPROP_TEXT,     isBull ? "▲" : "▼");
      ObjectSetInteger(0, nm, OBJPROP_COLOR,    isBull ? clrDodgerBlue : clrOrangeRed);
      ObjectSetInteger(0, nm, OBJPROP_FONTSIZE, 12);
      ObjectSetInteger(0, nm, OBJPROP_ANCHOR,   isBull ? ANCHOR_UPPER : ANCHOR_LOWER);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
   }
   // Horizontal level line
   string hn = StringFormat("SWING_H_%s_%d", isBull?"BOT":"TOP", (int)t);
   if(ObjectCreate(0, hn, OBJ_HLINE, 0, t, price))
   {
      ObjectSetInteger(0, hn, OBJPROP_COLOR, isBull ? clrDodgerBlue : clrOrangeRed);
      ObjectSetInteger(0, hn, OBJPROP_STYLE, STYLE_DOT);
      ObjectSetInteger(0, hn, OBJPROP_WIDTH, 1);
      ObjectSetInteger(0, hn, OBJPROP_BACK,  true);
      ObjectSetInteger(0, hn, OBJPROP_SELECTABLE, false);
   }
}

//+------------------------------------------------------------------+
//| OnInit                                                           |
//+------------------------------------------------------------------+
int OnInit()
{
   hFast = iMA(InpSymbol, PERIOD_M5, InpEMAFast, 0, MODE_EMA, PRICE_CLOSE);
   hSlow = iMA(InpSymbol, PERIOD_M5, InpEMASlow, 0, MODE_EMA, PRICE_CLOSE);
   if(hFast == INVALID_HANDLE || hSlow == INVALID_HANDLE)
   {
      Print("[INIT] Failed to create EMA handles");
      return INIT_FAILED;
   }
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetTypeFillingBySymbol(InpSymbol);
   Print("[INIT] M5 IFVG Pullback EA loaded");
   PrintFormat("[CONFIG] EMA %d/%d | Risk %.1f%% | RR %.1f | SL buf %d pts | BE at %.1fR",
               InpEMAFast, InpEMASlow, InpRiskPercent, InpRewardRisk, InpStopBuffer, InpBEAtR);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   if(hFast != INVALID_HANDLE) IndicatorRelease(hFast);
   if(hSlow != INVALID_HANDLE) IndicatorRelease(hSlow);
   // Clean up chart objects
   for(int i = ObjectsTotal(0)-1; i >= 0; i--)
   {
      string nm = ObjectName(0, i);
      if(StringFind(nm,"IFVG_")==0 || StringFind(nm,"SWING_")==0 ||
         StringFind(nm,"ENTRY_")==0) ObjectDelete(0, nm);
   }
}

//+------------------------------------------------------------------+
//| OnTick                                                           |
//+------------------------------------------------------------------+
void OnTick()
{
   //--- Break-even runs every tick
   ManageBreakEven();

   //--- Bar-open guard: all detection runs once per closed bar
   datetime barT = iTime(InpSymbol, PERIOD_M5, 0);
   if(barT == gLastBarTime) return;
   gLastBarTime = barT;

   //--- Read EMA values from the just-closed bar (shift 1)
   double emaFast = EMAVal(hFast, 1);
   double emaSlow = EMAVal(hSlow, 1);
   if(emaFast <= 0 || emaSlow <= 0) return;

   int totalBars = iBars(InpSymbol, PERIOD_M5);
   if(totalBars < 8) return; // need at least 7 closed bars for swing detection

   //-------------------------------------------------------------------
   // 1. Swing detection — check bar at shift 4 as candidate
   //    right side confirmed by shifts 1,2,3 (newer, all closed)
   //    left  side confirmed by shifts 5,6,7 (older)
   //-------------------------------------------------------------------
   if(emaFast > emaSlow && IsSwingLow(4))
   {
      datetime swT = iTime(InpSymbol, PERIOD_M5, 4);
      double   swP = iLow (InpSymbol, PERIOD_M5, 4);
      if(swT > gBottomTime) // newer swing → update
      {
         gBottomPrice = swP;
         gBottomTime  = swT;
         gBuyReady    = true;
         PrintFormat("[SWING] BOTTOM | price=%.5f | %s",
                     swP, TimeToString(swT, TIME_DATE|TIME_MINUTES));
         DrawSwing(true, swP, swT);
      }
   }

   if(emaFast < emaSlow && IsSwingHigh(4))
   {
      datetime swT = iTime(InpSymbol, PERIOD_M5, 4);
      double   swP = iHigh(InpSymbol, PERIOD_M5, 4);
      if(swT > gPeakTime)
      {
         gPeakPrice  = swP;
         gPeakTime   = swT;
         gSellReady  = true;
         PrintFormat("[SWING] PEAK | price=%.5f | %s",
                     swP, TimeToString(swT, TIME_DATE|TIME_MINUTES));
         DrawSwing(false, swP, swT);
      }
   }

   //-------------------------------------------------------------------
   // 2. FVG detection on the 3-bar set that just closed (shifts 1,2,3)
   //    Only store if it might be relevant (buy or sell context active)
   //-------------------------------------------------------------------
   if(gBuyReady || gSellReady) DetectFVG();

   //-------------------------------------------------------------------
   // 3. Inversion check on just-closed bar (shift 1 close)
   //    Marks matching FVGs as inverted → iFVG born
   //-------------------------------------------------------------------
   CheckInversions();

   //-------------------------------------------------------------------
   // 4. Entry on the CURRENT bar open (bar after the inversion close)
   //    inversionTime == bar1 (just-closed) → we are exactly 1 bar later
   //-------------------------------------------------------------------
   ExecuteEntries(emaFast, emaSlow);
}
