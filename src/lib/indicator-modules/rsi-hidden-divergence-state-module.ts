/**
 * Indicator Module — RSI Hidden Divergence State Module (Phase 2) v1.0.0
 *
 * Same detection as the Phase 1 detector, plus the standard Phase 2 lifecycle
 * and 4-buffer iCustom contract so Phase 3 EAs / the Setup Brain can consume it.
 *
 * Role: SETUP only (trend continuation). Does NOT determine direction.
 *
 * Lifecycle (Bullish HD example):
 *   ACTIVE      — divergence detected (price HL + RSI LL)
 *   CONFIRMED   — price closes ABOVE the swing high between the two lows
 *   INVALIDATED — price closes BELOW the second (newer) low
 *   EXPIRED     — InpExpiryBars pass without confirmation
 *
 * Buffers (iCustom):
 *   0 : BullConfirmBuf — 1.0 at the bar a bullish HD CONFIRMS
 *   1 : BearConfirmBuf — 1.0 at the bar a bearish HD CONFIRMS
 *   2 : BullSLBuf      — second swing low  (SL for bull continuation)
 *   3 : BearSLBuf      — second swing high (SL for bear continuation)
 */

export const RSI_HD_STATE_MODULE_VERSION = "1.0.0";
export const RSI_HD_STATE_MODULE  = "RSI_Hidden_Divergence_State_Module";

export function generateRsiHiddenDivergenceStateModule(): string {
  return `//+------------------------------------------------------------------+
//| RSI_Hidden_Divergence_State_Module.mq5                        |
//| Indicator Module v${RSI_HD_STATE_MODULE_VERSION} — RSI Hidden Divergence State |
//|                                                                  |
//| ACTIVE → CONFIRMED (close beyond intervening swing) →           |
//| INVALIDATED (close beyond 2nd swing) / EXPIRED.                 |
//| Buffers 0/1 confirm, 2/3 SL. SETUP role only.                  |
//+------------------------------------------------------------------+
#property copyright "EA Builder — Indicator Module"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_buffers 4
#property indicator_plots   0

double BullConfirmBuf[];
double BearConfirmBuf[];
double BullSLBuf[];
double BearSLBuf[];

#define DIR_BULL    1
#define DIR_BEAR   -1
#define ST_ACTIVE   0
#define ST_CONFIRM  1
#define ST_INVALID  2
#define ST_EXPIRED  3
#define REC_MAX    200
#define OBJ_PREFIX "RSIHDS_"

input ENUM_TIMEFRAMES InpTF         = PERIOD_CURRENT;
input int             InpLookback   = 500;
input int             InpRSIPeriod  = 14;
input int             InpPivotLeft  = 3;
input int             InpPivotRight = 3;
input int             InpMinBars    = 5;
input int             InpMaxBars    = 50;
input int             InpExpiryBars = 60;             // Bars allowed before EXPIRED
input int             InpLineWidth  = 2;
input int             InpFontSize   = 8;
input color           InpBullColor  = clrMediumSeaGreen;
input color           InpBearColor  = clrTomato;
input bool            InpShowLog     = true;

int      gRSI = INVALID_HANDLE;
datetime lastBarTime = 0;
int      gObjCnt = 0;

bool     gHasLow  = false; double gLowPrice  = 0, gLowRSI  = 0; datetime gLowTime  = 0;
bool     gHasHigh = false; double gHighPrice = 0, gHighRSI = 0; datetime gHighTime = 0;

struct HDRec
{
   int      id;
   int      dir;          // DIR_BULL or DIR_BEAR
   int      state;
   double   swing1;       // older swing price
   double   swing2;       // newer swing price (also the SL ref)
   double   midLevel;     // intervening swing high (bull) / low (bear) = confirm threshold
   datetime t1;           // older swing time
   datetime t2;           // newer swing time
   datetime confirmTime;  // detection bar time — react only on newer bars
   bool     dead;
   int      ageCounter;
};

HDRec rec[REC_MAX];
int   recTotal = 0;
int   nextId   = 0;

//+------------------------------------------------------------------+
string DivLn(int id) { return OBJ_PREFIX + IntegerToString(id) + "_ln"; }
string DivLb(int id) { return OBJ_PREFIX + IntegerToString(id) + "_lb"; }

double RSIv(int sh)
{
   double b[];
   if(CopyBuffer(gRSI, 0, sh, 1, b) != 1) return EMPTY_VALUE;
   return b[0];
}

bool IsPivotLow(int p)
{
   int bars = iBars(_Symbol, InpTF);
   if(p - InpPivotRight < 0 || p + InpPivotLeft >= bars) return false;
   double lo = iLow(_Symbol, InpTF, p);
   for(int k = 1; k <= InpPivotLeft;  k++) if(iLow(_Symbol, InpTF, p + k) <= lo) return false;
   for(int k = 1; k <= InpPivotRight; k++) if(iLow(_Symbol, InpTF, p - k) <  lo) return false;
   return true;
}

bool IsPivotHigh(int p)
{
   int bars = iBars(_Symbol, InpTF);
   if(p - InpPivotRight < 0 || p + InpPivotLeft >= bars) return false;
   double hi = iHigh(_Symbol, InpTF, p);
   for(int k = 1; k <= InpPivotLeft;  k++) if(iHigh(_Symbol, InpTF, p + k) >= hi) return false;
   for(int k = 1; k <= InpPivotRight; k++) if(iHigh(_Symbol, InpTF, p - k) >  hi) return false;
   return true;
}

//+------------------------------------------------------------------+
void DrawDiv(int dir, datetime t1, double p1, datetime t2, double p2)
{
   string ln = DivLn(gObjCnt), lb = DivLb(gObjCnt);
   gObjCnt++;
   color c = (dir > 0) ? InpBullColor : InpBearColor;
   if(ObjectCreate(0, ln, OBJ_TREND, 0, t1, p1, t2, p2))
   {
      ObjectSetInteger(0, ln, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, ln, OBJPROP_WIDTH,      InpLineWidth);
      ObjectSetInteger(0, ln, OBJPROP_RAY_RIGHT,  false);
      ObjectSetInteger(0, ln, OBJPROP_SELECTABLE, false);
   }
   if(ObjectCreate(0, lb, OBJ_TEXT, 0, t2, p2))
   {
      ObjectSetString (0, lb, OBJPROP_TEXT,       dir > 0 ? "Bull HD" : "Bear HD");
      ObjectSetInteger(0, lb, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, lb, OBJPROP_FONTSIZE,   InpFontSize);
      ObjectSetInteger(0, lb, OBJPROP_ANCHOR,     dir > 0 ? ANCHOR_UPPER : ANCHOR_LOWER);
      ObjectSetInteger(0, lb, OBJPROP_SELECTABLE, false);
   }
}

//+------------------------------------------------------------------+
void AddRec(int dir, double s1, double s2, double mid, datetime t1, datetime t2, datetime confT)
{
   int idx = -1;
   for(int i = 0; i < recTotal; i++) if(rec[i].dead) { idx = i; break; }
   if(idx < 0 && recTotal < REC_MAX) idx = recTotal++;
   if(idx < 0) return;
   rec[idx].id          = nextId++;
   rec[idx].dir         = dir;
   rec[idx].state       = ST_ACTIVE;
   rec[idx].swing1      = s1;
   rec[idx].swing2      = s2;
   rec[idx].midLevel    = mid;
   rec[idx].t1          = t1;
   rec[idx].t2          = t2;
   rec[idx].confirmTime = confT;
   rec[idx].dead        = false;
   rec[idx].ageCounter  = 0;
   DrawDiv(dir, t1, s1, t2, s2);
   if(InpShowLog)
      PrintFormat("RSI_HD_%s_ACTIVE | s1=%.5f s2=%.5f | mid=%.5f", dir > 0 ? "BULL" : "BEAR", s1, s2, mid);
}

//+------------------------------------------------------------------+
double HighestBetween(int sNew, int sOld)
{
   double mx = -DBL_MAX;
   for(int k = sNew + 1; k <= sOld - 1; k++) mx = MathMax(mx, iHigh(_Symbol, InpTF, k));
   return mx;
}
double LowestBetween(int sNew, int sOld)
{
   double mn = DBL_MAX;
   for(int k = sNew + 1; k <= sOld - 1; k++) mn = MathMin(mn, iLow(_Symbol, InpTF, k));
   return mn;
}

//+------------------------------------------------------------------+
void ProcessPivots(int sh)
{
   int p = sh + InpPivotRight;

   if(IsPivotLow(p))
   {
      double price = iLow(_Symbol, InpTF, p);
      double rsi   = RSIv(p);
      datetime tp  = iTime(_Symbol, InpTF, p);
      if(gHasLow && rsi != EMPTY_VALUE)
      {
         int s1  = iBarShift(_Symbol, InpTF, gLowTime);
         int gap = s1 - p;
         if(gap >= InpMinBars && gap <= InpMaxBars && price > gLowPrice && rsi < gLowRSI)
         {
            double mid = HighestBetween(p, s1);
            if(mid > -DBL_MAX)
               AddRec(DIR_BULL, gLowPrice, price, mid, gLowTime, tp, iTime(_Symbol, InpTF, sh));
         }
      }
      if(rsi != EMPTY_VALUE) { gLowPrice = price; gLowRSI = rsi; gLowTime = tp; gHasLow = true; }
   }

   if(IsPivotHigh(p))
   {
      double price = iHigh(_Symbol, InpTF, p);
      double rsi   = RSIv(p);
      datetime tp  = iTime(_Symbol, InpTF, p);
      if(gHasHigh && rsi != EMPTY_VALUE)
      {
         int s1  = iBarShift(_Symbol, InpTF, gHighTime);
         int gap = s1 - p;
         if(gap >= InpMinBars && gap <= InpMaxBars && price < gHighPrice && rsi > gHighRSI)
         {
            double mid = LowestBetween(p, s1);
            if(mid < DBL_MAX)
               AddRec(DIR_BEAR, gHighPrice, price, mid, gHighTime, tp, iTime(_Symbol, InpTF, sh));
         }
      }
      if(rsi != EMPTY_VALUE) { gHighPrice = price; gHighRSI = rsi; gHighTime = tp; gHasHigh = true; }
   }
}

//+------------------------------------------------------------------+
void Lifecycle(int sh)
{
   double cl = iClose(_Symbol, InpTF, sh);
   datetime t = iTime(_Symbol, InpTF, sh);
   int bufN = ArraySize(BullConfirmBuf);

   for(int i = 0; i < recTotal; i++)
   {
      if(rec[i].dead || rec[i].state != ST_ACTIVE) continue;
      if(rec[i].confirmTime >= t) continue;

      if(rec[i].dir == DIR_BULL)
      {
         if(cl < rec[i].swing2)            // closed below 2nd low → invalid
            { rec[i].state = ST_INVALID; rec[i].dead = true;
              if(InpShowLog) PrintFormat("RSI_HD_BULL_INVALID | %s", TimeToString(t,TIME_DATE|TIME_MINUTES)); continue; }
         if(cl > rec[i].midLevel)          // closed above intervening high → confirm
         {
            rec[i].state = ST_CONFIRM;
            if(sh < bufN) { BullConfirmBuf[sh] = 1.0; BullSLBuf[sh] = rec[i].swing2; }
            if(InpShowLog) PrintFormat("RSI_HD_BULL_CONFIRMED | sl=%.5f | %s", rec[i].swing2, TimeToString(t,TIME_DATE|TIME_MINUTES));
            rec[i].dead = true; continue;
         }
      }
      else
      {
         if(cl > rec[i].swing2)            // closed above 2nd high → invalid
            { rec[i].state = ST_INVALID; rec[i].dead = true;
              if(InpShowLog) PrintFormat("RSI_HD_BEAR_INVALID | %s", TimeToString(t,TIME_DATE|TIME_MINUTES)); continue; }
         if(cl < rec[i].midLevel)          // closed below intervening low → confirm
         {
            rec[i].state = ST_CONFIRM;
            if(sh < bufN) { BearConfirmBuf[sh] = 1.0; BearSLBuf[sh] = rec[i].swing2; }
            if(InpShowLog) PrintFormat("RSI_HD_BEAR_CONFIRMED | sl=%.5f | %s", rec[i].swing2, TimeToString(t,TIME_DATE|TIME_MINUTES));
            rec[i].dead = true; continue;
         }
      }

      rec[i].ageCounter++;
      if(InpExpiryBars > 0 && rec[i].ageCounter >= InpExpiryBars)
         { rec[i].state = ST_EXPIRED; rec[i].dead = true; }
   }
}

//+------------------------------------------------------------------+
void ResetState()
{
   ObjectsDeleteAll(0, OBJ_PREFIX);
   gObjCnt = 0; recTotal = 0; nextId = 0;
   gHasLow = false; gHasHigh = false;
   ArrayInitialize(BullConfirmBuf, 0.0);
   ArrayInitialize(BearConfirmBuf, 0.0);
   ArrayInitialize(BullSLBuf,      0.0);
   ArrayInitialize(BearSLBuf,      0.0);
}

//+------------------------------------------------------------------+
int OnInit()
{
   SetIndexBuffer(0, BullConfirmBuf, INDICATOR_DATA);
   SetIndexBuffer(1, BearConfirmBuf, INDICATOR_DATA);
   SetIndexBuffer(2, BullSLBuf,      INDICATOR_DATA);
   SetIndexBuffer(3, BearSLBuf,      INDICATOR_DATA);
   ArraySetAsSeries(BullConfirmBuf, true);
   ArraySetAsSeries(BearConfirmBuf, true);
   ArraySetAsSeries(BullSLBuf,      true);
   ArraySetAsSeries(BearSLBuf,      true);
   gRSI = iRSI(_Symbol, InpTF, InpRSIPeriod, PRICE_CLOSE);
   if(gRSI == INVALID_HANDLE) { Print("RSI handle failed"); return INIT_FAILED; }
   IndicatorSetString(INDICATOR_SHORTNAME, "RSI_HD_State v${RSI_HD_STATE_MODULE_VERSION}");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   ObjectsDeleteAll(0, OBJ_PREFIX);
   if(gRSI != INVALID_HANDLE) IndicatorRelease(gRSI);
}

//+------------------------------------------------------------------+
int OnCalculate(const int rates_total, const int prev_calculated,
                const datetime &time[], const double &open[],
                const double &high[], const double &low[],
                const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
{
   if(rates_total < InpPivotLeft + InpPivotRight + 5) return 0;
   if(BarsCalculated(gRSI) < rates_total) return prev_calculated;

   if(prev_calculated == 0)
   {
      ResetState();
      int limit = (int)MathMin((long)(rates_total - InpPivotLeft - 2), (long)InpLookback);
      for(int sh = limit; sh >= 1; sh--) { ProcessPivots(sh); Lifecycle(sh); }
      return rates_total;
   }

   datetime curBar = iTime(_Symbol, InpTF, 0);
   if(curBar != lastBarTime) { lastBarTime = curBar; ProcessPivots(1); Lifecycle(1); }
   return rates_total;
}
`;
}
