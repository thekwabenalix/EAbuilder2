//+------------------------------------------------------------------+
//| EMA_IFVG.mq5                                                    |
//| EMA 12/48 Cross + iFVG Entry                                    |
//|                                                                  |
//| Direction : EMA 12 cross EMA 48                                 |
//|             EMA12 > EMA48 → bullish → look for bull iFVG        |
//|             EMA12 < EMA48 → bearish → look for bear iFVG        |
//|                                                                  |
//| Entry     : Next bar open after iFVG is CREATED (inversion      |
//|             candle closes through the FVG)                       |
//|                                                                  |
//| SL        : High of inversion candle (sell) or                  |
//|             Low  of inversion candle (buy)  + buffer            |
//| TP        : 2R  |  BE : 1R                                      |
//|                                                                  |
//| FVG definition (from Phase 3 module):                           |
//|   Bullish FVG : C3.Low > C1.High  (C1=oldest, C3=newest)        |
//|   Bearish FVG : C3.High < C1.Low                                |
//|   Bullish iFVG: bearish FVG → close > FVG upper limit           |
//|   Bearish iFVG: bullish FVG → close < FVG lower limit           |
//+------------------------------------------------------------------+
#property copyright "EAbuilder2"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>
CTrade trade;

//--- Inputs
input string   InpSymbol      = "EURUSD";  // Symbol
input ulong    InpMagic       = 990003;
input double   InpRiskPercent = 1.0;       // Risk % per trade
input double   InpRewardRisk  = 2.0;       // Reward : Risk
input int      InpStopBuffer  = 20;        // SL buffer (points)
input int      InpMaxSpread   = 25;        // Max spread (points)
input double   InpBEAtR       = 1.0;       // Break-even at N × R
input int      InpEMAFast     = 12;
input int      InpEMASlow     = 48;

//--- EMA handles
int hFast = INVALID_HANDLE;
int hSlow = INVALID_HANDLE;

//+------------------------------------------------------------------+
//| FVG record                                                       |
//+------------------------------------------------------------------+
#define MAX_FVGS 300

struct FvgRec
{
   int      dir;           //  1=bull FVG  -1=bear FVG
   double   ul;            // upper limit of gap
   double   ll;            // lower limit of gap
   datetime c1Time;        // C1 bar time — dedup key
   bool     inverted;
   datetime invTime;       // bar whose close caused the inversion
   double   invHigh;       // inversion bar high  (SL for sell)
   double   invLow;        // inversion bar low   (SL for buy)
   bool     traded;
};

FvgRec   fvg[MAX_FVGS];
int      fvgN = 0;

static datetime gLastBar = 0;

//+------------------------------------------------------------------+
//| Helpers                                                          |
//+------------------------------------------------------------------+
double NormVol(double v)
{
   double mn=SymbolInfoDouble(InpSymbol,SYMBOL_VOLUME_MIN);
   double mx=SymbolInfoDouble(InpSymbol,SYMBOL_VOLUME_MAX);
   double st=SymbolInfoDouble(InpSymbol,SYMBOL_VOLUME_STEP);
   if(st<=0) st=0.01;
   v=MathFloor(v/st)*st;
   if(v<mn)v=mn; if(v>mx)v=mx;
   return NormalizeDouble(v,2);
}

double CalcLot(double slPts)
{
   if(slPts<=0) return 0.0;
   double eq=AccountInfoDouble(ACCOUNT_EQUITY);
   double tv=SymbolInfoDouble(InpSymbol,SYMBOL_TRADE_TICK_VALUE);
   double ts=SymbolInfoDouble(InpSymbol,SYMBOL_TRADE_TICK_SIZE);
   double pt=SymbolInfoDouble(InpSymbol,SYMBOL_POINT);
   if(tv<=0||ts<=0||pt<=0) return 0.0;
   double lpl=(slPts*pt/ts)*tv;
   if(lpl<=0) return 0.0;
   return NormVol((eq*InpRiskPercent/100.0)/lpl);
}

bool HasPos()
{
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong t=PositionGetTicket(i);
      if(!PositionSelectByTicket(t)) continue;
      if(PositionGetString(POSITION_SYMBOL)==InpSymbol &&
         PositionGetInteger(POSITION_MAGIC)==InpMagic) return true;
   }
   return false;
}

bool SpreadOk()
{
   if(InpMaxSpread<=0) return true;
   return (int)SymbolInfoInteger(InpSymbol,SYMBOL_SPREAD)<=InpMaxSpread;
}

double EMAv(int h,int sh)
{
   double a[1]; ArraySetAsSeries(a,true);
   if(CopyBuffer(h,0,sh,1,a)!=1) return 0.0;
   return a[0];
}

//+------------------------------------------------------------------+
//| Detect new FVG from just-closed 3-bar set (C3=sh1,C1=sh3)      |
//+------------------------------------------------------------------+
void DetectFVG(int emaBias)
{
   if(iBars(InpSymbol,PERIOD_CURRENT)<4) return;

   datetime c1T = iTime(InpSymbol,PERIOD_CURRENT,3);

   // Dedup
   for(int k=0;k<fvgN;k++)
      if(!fvg[k].traded && fvg[k].c1Time==c1T) return;

   double c3Lo = iLow (InpSymbol,PERIOD_CURRENT,1);  // C3 newest
   double c1Hi = iHigh(InpSymbol,PERIOD_CURRENT,3);  // C1 oldest
   double c3Hi = iHigh(InpSymbol,PERIOD_CURRENT,1);
   double c1Lo = iLow (InpSymbol,PERIOD_CURRENT,3);

   bool bull = (c3Lo > c1Hi);   // Bullish FVG: C3.Low > C1.High
   bool bear = (c3Hi < c1Lo);   // Bearish FVG: C3.High < C1.Low
   if(!bull && !bear) return;

   // Only track FVGs that MATCH bias (bear iFVG needs bull FVG, bull iFVG needs bear FVG)
   // Bear iFVG = bullish FVG inverted → only store bull FVGs when bias is SELL
   // Bull iFVG = bearish FVG inverted → only store bear FVGs when bias is BUY
   if(emaBias== 1 && !bear) return;   // BUY  bias: need bearish FVG to invert bullishly
   if(emaBias==-1 && !bull) return;   // SELL bias: need bullish FVG to invert bearishly

   // Slot allocation
   int idx=-1;
   for(int k=0;k<fvgN;k++) if(fvg[k].traded){idx=k;break;}
   if(idx<0){if(fvgN>=MAX_FVGS)return;idx=fvgN++;}

   fvg[idx].dir      = bull ? 1 : -1;
   fvg[idx].ul       = bull ? c3Lo : c1Lo;  // Bull: UL=C3.Low  Bear: UL=C1.Low
   fvg[idx].ll       = bull ? c1Hi : c3Hi;  // Bull: LL=C1.High Bear: LL=C3.High
   fvg[idx].c1Time   = c1T;
   fvg[idx].inverted = false;
   fvg[idx].invTime  = 0;
   fvg[idx].invHigh  = 0;
   fvg[idx].invLow   = 0;
   fvg[idx].traded   = false;

   PrintFormat("[FVG] %s | ul=%.5f ll=%.5f | born=%s",
               bull?"BULL":"BEAR", fvg[idx].ul, fvg[idx].ll,
               TimeToString(c1T,TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
//| Check if just-closed bar (sh1) inverts any matching FVG         |
//+------------------------------------------------------------------+
void CheckInversions(int emaBias)
{
   double   cl1  = iClose(InpSymbol,PERIOD_CURRENT,1);
   double   hi1  = iHigh (InpSymbol,PERIOD_CURRENT,1);
   double   lo1  = iLow  (InpSymbol,PERIOD_CURRENT,1);
   datetime bar1 = iTime (InpSymbol,PERIOD_CURRENT,1);

   for(int k=0;k<fvgN;k++)
   {
      if(fvg[k].inverted)      continue;
      if(fvg[k].traded)        continue;
      if(fvg[k].c1Time>=bar1)  continue;  // FVG must pre-date this bar

      // Bullish iFVG: bearish FVG (dir=-1) inverted when close > UL
      // → only in BUY bias
      bool bullInv = (fvg[k].dir==-1 && emaBias==1  && cl1 > fvg[k].ul);
      // Bearish iFVG: bullish FVG (dir=+1) inverted when close < LL
      // → only in SELL bias
      bool bearInv = (fvg[k].dir== 1 && emaBias==-1 && cl1 < fvg[k].ll);

      if(!bullInv && !bearInv) continue;

      fvg[k].inverted = true;
      fvg[k].invTime  = bar1;
      fvg[k].invHigh  = hi1;   // SL for SELL entries
      fvg[k].invLow   = lo1;   // SL for BUY  entries

      PrintFormat("[IFVG] %s CREATED | ul=%.5f ll=%.5f | inv_close=%.5f | hi=%.5f lo=%.5f | %s",
                  bullInv?"BULL":"BEAR",
                  fvg[k].ul, fvg[k].ll, cl1, hi1, lo1,
                  TimeToString(bar1,TIME_DATE|TIME_MINUTES));

      // Draw iFVG zone
      string rn=StringFormat("IFVG_%s_%d",bullInv?"B":"S",(int)bar1);
      datetime rt2=bar1+PeriodSeconds(PERIOD_CURRENT)*40;
      if(ObjectCreate(0,rn,OBJ_RECTANGLE,0,fvg[k].c1Time,fvg[k].ul,rt2,fvg[k].ll))
      {
         ObjectSetInteger(0,rn,OBJPROP_COLOR,    bullInv?clrMediumSeaGreen:clrOrchid);
         ObjectSetInteger(0,rn,OBJPROP_BACK,     true);
         ObjectSetInteger(0,rn,OBJPROP_FILL,     true);
         ObjectSetInteger(0,rn,OBJPROP_SELECTABLE,false);
      }
   }
}

//+------------------------------------------------------------------+
//| Execute on bar AFTER inversion                                  |
//+------------------------------------------------------------------+
void ExecuteEntries()
{
   if(HasPos() || !SpreadOk()) return;

   double pt    = SymbolInfoDouble(InpSymbol,SYMBOL_POINT);
   double ask   = SymbolInfoDouble(InpSymbol,SYMBOL_ASK);
   double bid   = SymbolInfoDouble(InpSymbol,SYMBOL_BID);
   int    digs  = (int)SymbolInfoInteger(InpSymbol,SYMBOL_DIGITS);
   long   stops = SymbolInfoInteger(InpSymbol,SYMBOL_TRADE_STOPS_LEVEL);
   datetime bar1= iTime(InpSymbol,PERIOD_CURRENT,1);  // just-closed bar = inversion bar

   for(int k=0;k<fvgN;k++)
   {
      if(!fvg[k].inverted)   continue;
      if(fvg[k].traded)      continue;
      if(fvg[k].invTime!=bar1) continue;  // entry on the bar immediately after inversion

      if(fvg[k].dir==-1)   // bearish FVG inverted → BUY
      {
         double sl  = NormalizeDouble(fvg[k].invLow - InpStopBuffer*pt, digs);
         double dist= (ask-sl)/pt;
         if(dist<=(double)stops){PrintFormat("[SKIP] BUY dist=%.0f",dist);continue;}
         double lot = CalcLot(dist);
         if(lot<=0){Print("[SKIP] BUY lot=0");continue;}
         double tp  = NormalizeDouble(ask+dist*InpRewardRisk*pt, digs);
         PrintFormat("[ENTRY] BUY | ask=%.5f sl=%.5f tp=%.5f lot=%.2f dist=%.0fpts",
                     ask,sl,tp,lot,dist);
         if(trade.Buy(lot,InpSymbol,ask,sl,tp,"EMA_IFVG_BUY"))
         {
            fvg[k].traded=true;
            // Arrow
            string an=StringFormat("E_BUY_%d",(int)TimeCurrent());
            if(ObjectCreate(0,an,OBJ_ARROW_BUY,0,iTime(InpSymbol,PERIOD_CURRENT,0),sl))
            { ObjectSetInteger(0,an,OBJPROP_COLOR,clrLime); ObjectSetInteger(0,an,OBJPROP_WIDTH,2); ObjectSetInteger(0,an,OBJPROP_SELECTABLE,false); }
         }
         break;
      }

      if(fvg[k].dir== 1)   // bullish FVG inverted → SELL
      {
         double sl  = NormalizeDouble(fvg[k].invHigh + InpStopBuffer*pt, digs);
         double dist= (sl-bid)/pt;
         if(dist<=(double)stops){PrintFormat("[SKIP] SELL dist=%.0f",dist);continue;}
         double lot = CalcLot(dist);
         if(lot<=0){Print("[SKIP] SELL lot=0");continue;}
         double tp  = NormalizeDouble(bid-dist*InpRewardRisk*pt, digs);
         PrintFormat("[ENTRY] SELL | bid=%.5f sl=%.5f tp=%.5f lot=%.2f dist=%.0fpts",
                     bid,sl,tp,lot,dist);
         if(trade.Sell(lot,InpSymbol,bid,sl,tp,"EMA_IFVG_SELL"))
         {
            fvg[k].traded=true;
            string an=StringFormat("E_SELL_%d",(int)TimeCurrent());
            if(ObjectCreate(0,an,OBJ_ARROW_SELL,0,iTime(InpSymbol,PERIOD_CURRENT,0),sl))
            { ObjectSetInteger(0,an,OBJPROP_COLOR,clrOrangeRed); ObjectSetInteger(0,an,OBJPROP_WIDTH,2); ObjectSetInteger(0,an,OBJPROP_SELECTABLE,false); }
         }
         break;
      }
   }
}

//+------------------------------------------------------------------+
//| Break-even management                                           |
//+------------------------------------------------------------------+
void ManageBE()
{
   double pt=SymbolInfoDouble(InpSymbol,SYMBOL_POINT);
   int digs=(int)SymbolInfoInteger(InpSymbol,SYMBOL_DIGITS);
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong t=PositionGetTicket(i);
      if(!PositionSelectByTicket(t)) continue;
      if(PositionGetString(POSITION_SYMBOL)!=InpSymbol) continue;
      if(PositionGetInteger(POSITION_MAGIC)!=InpMagic)  continue;
      double open=PositionGetDouble(POSITION_PRICE_OPEN);
      double sl=PositionGetDouble(POSITION_SL);
      double tp=PositionGetDouble(POSITION_TP);
      if(open<=0||sl<=0) continue;
      double risk=MathAbs(open-sl);
      if(risk<pt) continue;
      long type=PositionGetInteger(POSITION_TYPE);
      double bid=SymbolInfoDouble(InpSymbol,SYMBOL_BID);
      double ask=SymbolInfoDouble(InpSymbol,SYMBOL_ASK);
      if(type==POSITION_TYPE_BUY)
      {
         if(sl>=open-pt) continue;
         if(bid-open>=risk*InpBEAtR) trade.PositionModify(t,NormalizeDouble(open,digs),tp);
      }
      else
      {
         if(sl<=open+pt) continue;
         if(open-ask>=risk*InpBEAtR) trade.PositionModify(t,NormalizeDouble(open,digs),tp);
      }
   }
}

//+------------------------------------------------------------------+
//| OnInit                                                           |
//+------------------------------------------------------------------+
int OnInit()
{
   hFast=iMA(InpSymbol,PERIOD_CURRENT,InpEMAFast,0,MODE_EMA,PRICE_CLOSE);
   hSlow=iMA(InpSymbol,PERIOD_CURRENT,InpEMASlow,0,MODE_EMA,PRICE_CLOSE);
   if(hFast==INVALID_HANDLE||hSlow==INVALID_HANDLE)
   { Print("[INIT] EMA handles failed"); return INIT_FAILED; }
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetTypeFillingBySymbol(InpSymbol);
   Print("[INIT] EMA_IFVG EA loaded");
   PrintFormat("[CONFIG] EMA %d/%d | Risk %.1f%% | RR %.1f | Buf %dpts | BE %.1fR",
               InpEMAFast,InpEMASlow,InpRiskPercent,InpRewardRisk,InpStopBuffer,InpBEAtR);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   if(hFast!=INVALID_HANDLE) IndicatorRelease(hFast);
   if(hSlow!=INVALID_HANDLE) IndicatorRelease(hSlow);
   for(int i=ObjectsTotal(0)-1;i>=0;i--)
   {
      string n=ObjectName(0,i);
      if(StringFind(n,"IFVG_")==0||StringFind(n,"E_BUY_")==0||StringFind(n,"E_SELL_")==0)
         ObjectDelete(0,n);
   }
}

//+------------------------------------------------------------------+
//| OnTick                                                           |
//+------------------------------------------------------------------+
void OnTick()
{
   ManageBE();

   // Bar-open guard
   datetime barT=iTime(InpSymbol,PERIOD_CURRENT,0);
   if(barT==gLastBar) return;
   gLastBar=barT;

   // EMA direction (use just-closed bar, shift 1)
   double ef=EMAv(hFast,1);
   double es=EMAv(hSlow,1);
   if(ef<=0||es<=0) return;
   int bias = (ef>es)?1:-1;  // 1=BULL  -1=BEAR

   // 1. Detect new FVGs matching bias
   DetectFVG(bias);

   // 2. Check if just-closed bar inverts any stored FVG
   CheckInversions(bias);

   // 3. Enter on bar AFTER inversion
   ExecuteEntries();
}
