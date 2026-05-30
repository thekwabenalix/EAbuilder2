//+------------------------------------------------------------------+
//| EMA_IFVG.mq5                                                    |
//| EMA Trend + iFVG Execution                                      |
//|                                                                  |
//| Architecture (4-Brain):                                         |
//|   Direction : EMA12 vs EMA48                                    |
//|               EMA12 > EMA48 = BULL  EMA12 < EMA48 = BEAR       |
//|   Execution : iFVG created in trend direction                   |
//|               (IFVG itself proves the pullback occurred)        |
//|   Management: SL = lowest pullback low / highest pullback high  |
//|               TP = 2R  |  BE = 1R                              |
//|                                                                  |
//| Entry flow (BUY example):                                       |
//|   1. EMA12 > EMA48 → bullish direction                         |
//|   2. Bearish FVG forms (pullback creates gap)                   |
//|   3. Candle CLOSES above bearish FVG UL → bullish iFVG born    |
//|   4. BUY at next bar open                                       |
//|   5. SL = lowest low of last InpSLLookback bars − buffer        |
//|   Invalidation: EMA flips before entry fires → skip trade      |
//|                                                                  |
//| FVG definition (Phase 3 module):                                |
//|   Bullish FVG : C3.Low > C1.High (C1=oldest, C3=newest)        |
//|   Bearish FVG : C3.High < C1.Low                               |
//|   Bull iFVG   : bearish FVG, close > FVG UL                    |
//|   Bear iFVG   : bullish FVG, close < FVG LL                    |
//+------------------------------------------------------------------+
#property copyright "EAbuilder2"
#property version   "1.10"
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
input int      InpSLLookback  = 30;    // Bars to scan back for pullback swing (SL)
input int      InpMaxSLPips   = 20;   // Max SL distance in pips (0 = no limit)

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

      PrintFormat("[IFVG] %s CREATED | ul=%.5f ll=%.5f | inv_close=%.5f | %s",
                  bullInv?"BULL":"BEAR",
                  fvg[k].ul, fvg[k].ll, cl1,
                  TimeToString(bar1,TIME_DATE|TIME_MINUTES));

      // Draw iFVG zone rectangle
      string rn=StringFormat("IFVG_%s_%d",bullInv?"B":"S",(int)bar1);
      datetime rt2=bar1+PeriodSeconds(PERIOD_CURRENT)*40;
      if(ObjectCreate(0,rn,OBJ_RECTANGLE,0,fvg[k].c1Time,fvg[k].ul,rt2,fvg[k].ll))
      {
         ObjectSetInteger(0,rn,OBJPROP_COLOR,     bullInv?clrSteelBlue:clrOrchid);
         ObjectSetInteger(0,rn,OBJPROP_BGCOLOR,   bullInv?0xFFE0F0FF:0xFFFFE0FF);
         ObjectSetInteger(0,rn,OBJPROP_BACK,      true);
         ObjectSetInteger(0,rn,OBJPROP_FILL,      true);
         ObjectSetInteger(0,rn,OBJPROP_SELECTABLE,false);
      }
      // Label "iFVG" inside the zone
      string ln=StringFormat("IFVG_L_%s_%d",bullInv?"B":"S",(int)bar1);
      if(ObjectCreate(0,ln,OBJ_TEXT,0,bar1,bullInv?fvg[k].ul:fvg[k].ll))
      {
         ObjectSetString (0,ln,OBJPROP_TEXT,      "iFVG");
         ObjectSetInteger(0,ln,OBJPROP_COLOR,     bullInv?clrSteelBlue:clrOrchid);
         ObjectSetInteger(0,ln,OBJPROP_FONTSIZE,  8);
         ObjectSetInteger(0,ln,OBJPROP_ANCHOR,    bullInv?ANCHOR_LOWER:ANCHOR_UPPER);
         ObjectSetInteger(0,ln,OBJPROP_SELECTABLE,false);
      }
      // SL line will be drawn at entry time (pullback swing, not zone boundary)
   }
}

//+------------------------------------------------------------------+
//| Execute on bar AFTER inversion                                  |
//| SL = pullback swing extreme (lowest low / highest high of the  |
//|      last InpSLLookback bars before entry)                      |
//| Invalidation: if EMA direction flipped since iFVG was created, |
//|               skip the trade (setup no longer valid)           |
//+------------------------------------------------------------------+
void ExecuteEntries(int currentBias)
{
   if(HasPos() || !SpreadOk()) return;

   double pt    = SymbolInfoDouble(InpSymbol,SYMBOL_POINT);
   double ask   = SymbolInfoDouble(InpSymbol,SYMBOL_ASK);
   double bid   = SymbolInfoDouble(InpSymbol,SYMBOL_BID);
   int    digs  = (int)SymbolInfoInteger(InpSymbol,SYMBOL_DIGITS);
   long   stops = SymbolInfoInteger(InpSymbol,SYMBOL_TRADE_STOPS_LEVEL);
   // 1 pip = 10 points for 5-decimal (EURUSD) and 3-decimal (USDJPY) brokers
   int    pipDigits = (digs==3||digs==5) ? 10 : 1;
   double maxDistPts = (InpMaxSLPips > 0) ? (double)InpMaxSLPips * pipDigits : 1e10;
   datetime bar1= iTime(InpSymbol,PERIOD_CURRENT,1);  // just-closed bar = inversion bar

   for(int k=0;k<fvgN;k++)
   {
      if(!fvg[k].inverted)    continue;
      if(fvg[k].traded)       continue;
      if(fvg[k].invTime!=bar1) continue;  // entry on the bar immediately after inversion

      // ── Invalidation: EMA must still agree with the iFVG direction ──────────
      // Bull iFVG (was bear FVG, dir=-1) requires BULL bias (currentBias==1)
      // Bear iFVG (was bull FVG, dir==1) requires BEAR bias (currentBias==-1)
      bool needsBull = (fvg[k].dir == -1);  // bull iFVG needs bull EMA
      if(needsBull  && currentBias != 1)  { PrintFormat("[SKIP] iFVG BULL invalidated — EMA now BEAR"); fvg[k].traded=true; continue; }
      if(!needsBull && currentBias != -1) { PrintFormat("[SKIP] iFVG BEAR invalidated — EMA now BULL"); fvg[k].traded=true; continue; }

      if(fvg[k].dir==-1)   // bearish FVG inverted → BUY
      {
         // SL = lowest low of last InpSLLookback bars (the pullback low before the iFVG)
         double pullbackLow = 1e10;
         for(int i=1; i<=InpSLLookback; i++)
         {
            double l = iLow(InpSymbol,PERIOD_CURRENT,i);
            if(l < pullbackLow) pullbackLow = l;
         }
         double sl  = NormalizeDouble(pullbackLow - InpStopBuffer*pt, digs);
         double dist= (ask-sl)/pt;
         if(dist<=(double)stops){PrintFormat("[SKIP] BUY dist=%.0fpts < stops_level",dist);fvg[k].traded=true;continue;}
         if(dist>maxDistPts){PrintFormat("[SKIP] BUY SL too wide: %.1f pips (max %d pips)",dist/pipDigits,InpMaxSLPips);fvg[k].traded=true;continue;}
         double lot = CalcLot(dist);
         if(lot<=0){Print("[SKIP] BUY lot=0");continue;}
         double tp  = NormalizeDouble(ask+dist*InpRewardRisk*pt, digs);
         PrintFormat("[ENTRY] BUY | ask=%.5f sl=%.5f tp=%.5f lot=%.2f dist=%.1fpips",
                     ask,sl,tp,lot,dist/pipDigits);
         if(trade.Buy(lot,InpSymbol,ask,sl,tp,"EMA_IFVG_BUY"))
         {
            fvg[k].traded=true;
            datetime et=iTime(InpSymbol,PERIOD_CURRENT,0);
            // Arrow + label
            string an=StringFormat("E_BUY_%d",(int)et);
            if(ObjectCreate(0,an,OBJ_ARROW_BUY,0,et,sl))
            { ObjectSetInteger(0,an,OBJPROP_COLOR,clrLime); ObjectSetInteger(0,an,OBJPROP_WIDTH,2); ObjectSetInteger(0,an,OBJPROP_SELECTABLE,false); }
            string el=StringFormat("E_BUY_L_%d",(int)et);
            if(ObjectCreate(0,el,OBJ_TEXT,0,et,ask))
            { ObjectSetString(0,el,OBJPROP_TEXT,"Buy entry"); ObjectSetInteger(0,el,OBJPROP_COLOR,clrLime); ObjectSetInteger(0,el,OBJPROP_FONTSIZE,8); ObjectSetInteger(0,el,OBJPROP_SELECTABLE,false); }
            // SL line at pullback low
            string sn=StringFormat("IFVG_SL_B_%d",(int)et);
            if(ObjectCreate(0,sn,OBJ_HLINE,0,0,sl))
            { ObjectSetInteger(0,sn,OBJPROP_COLOR,clrRed); ObjectSetInteger(0,sn,OBJPROP_STYLE,STYLE_DOT); ObjectSetInteger(0,sn,OBJPROP_WIDTH,1); ObjectSetInteger(0,sn,OBJPROP_BACK,true); ObjectSetInteger(0,sn,OBJPROP_SELECTABLE,false); }
            string st=StringFormat("IFVG_SLT_B_%d",(int)et);
            if(ObjectCreate(0,st,OBJ_TEXT,0,et,sl))
            { ObjectSetString(0,st,OBJPROP_TEXT,"SL"); ObjectSetInteger(0,st,OBJPROP_COLOR,clrRed); ObjectSetInteger(0,st,OBJPROP_FONTSIZE,8); ObjectSetInteger(0,st,OBJPROP_SELECTABLE,false); }
         }
         break;
      }

      if(fvg[k].dir== 1)   // bullish FVG inverted → SELL
      {
         // SL = highest high of last InpSLLookback bars (the pullback high before the iFVG)
         double pullbackHigh = 0.0;
         for(int i=1; i<=InpSLLookback; i++)
         {
            double h = iHigh(InpSymbol,PERIOD_CURRENT,i);
            if(h > pullbackHigh) pullbackHigh = h;
         }
         double sl  = NormalizeDouble(pullbackHigh + InpStopBuffer*pt, digs);
         double dist= (sl-bid)/pt;
         if(dist<=(double)stops){PrintFormat("[SKIP] SELL dist=%.0fpts < stops_level",dist);fvg[k].traded=true;continue;}
         if(dist>maxDistPts){PrintFormat("[SKIP] SELL SL too wide: %.1f pips (max %d pips)",dist/pipDigits,InpMaxSLPips);fvg[k].traded=true;continue;}
         double lot = CalcLot(dist);
         if(lot<=0){Print("[SKIP] SELL lot=0");continue;}
         double tp  = NormalizeDouble(bid-dist*InpRewardRisk*pt, digs);
         PrintFormat("[ENTRY] SELL | bid=%.5f sl=%.5f tp=%.5f lot=%.2f dist=%.1fpips",
                     bid,sl,tp,lot,dist/pipDigits);
         if(trade.Sell(lot,InpSymbol,bid,sl,tp,"EMA_IFVG_SELL"))
         {
            fvg[k].traded=true;
            datetime et=iTime(InpSymbol,PERIOD_CURRENT,0);
            string an=StringFormat("E_SELL_%d",(int)et);
            if(ObjectCreate(0,an,OBJ_ARROW_SELL,0,et,sl))
            { ObjectSetInteger(0,an,OBJPROP_COLOR,clrOrangeRed); ObjectSetInteger(0,an,OBJPROP_WIDTH,2); ObjectSetInteger(0,an,OBJPROP_SELECTABLE,false); }
            string el=StringFormat("E_SELL_L_%d",(int)et);
            if(ObjectCreate(0,el,OBJ_TEXT,0,et,bid))
            { ObjectSetString(0,el,OBJPROP_TEXT,"Sell entry"); ObjectSetInteger(0,el,OBJPROP_COLOR,clrOrangeRed); ObjectSetInteger(0,el,OBJPROP_FONTSIZE,8); ObjectSetInteger(0,el,OBJPROP_SELECTABLE,false); }
            // SL line at pullback high
            string sn=StringFormat("IFVG_SL_S_%d",(int)et);
            if(ObjectCreate(0,sn,OBJ_HLINE,0,0,sl))
            { ObjectSetInteger(0,sn,OBJPROP_COLOR,clrRed); ObjectSetInteger(0,sn,OBJPROP_STYLE,STYLE_DOT); ObjectSetInteger(0,sn,OBJPROP_WIDTH,1); ObjectSetInteger(0,sn,OBJPROP_BACK,true); ObjectSetInteger(0,sn,OBJPROP_SELECTABLE,false); }
            string st=StringFormat("IFVG_SLT_S_%d",(int)et);
            if(ObjectCreate(0,st,OBJ_TEXT,0,et,sl))
            { ObjectSetString(0,st,OBJPROP_TEXT,"SL"); ObjectSetInteger(0,st,OBJPROP_COLOR,clrRed); ObjectSetInteger(0,st,OBJPROP_FONTSIZE,8); ObjectSetInteger(0,st,OBJPROP_SELECTABLE,false); }
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
      // Remove SL and label objects too (already prefixed IFVG_SL_ / IFVG_SLT_)
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

   // 3. Enter on bar AFTER inversion (re-checks current EMA for invalidation)
   ExecuteEntries(bias);
}
