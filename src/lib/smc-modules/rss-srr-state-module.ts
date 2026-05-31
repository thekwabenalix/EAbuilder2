/**
 * SNR Module Library — Phase 2: RSS / SRR State Module v2.0.0
 *
 * Same detection as RSS_SRR_Detector v2 but exposes 4 iCustom buffers.
 *
 * Phase 3 buffer contract (read via iCustom):
 *   0 : SRRBuf    — 1.0 at SRR signal bar (support drove 2+ resistance breaks above it)
 *   1 : RSSBuf    — 1.0 at RSS signal bar (resistance drove 2+ support breaks below it)
 *   2 : SRRSLBuf  — price of the driving SUPPORT level (SL for SRR buys)
 *   3 : RSSSLBuf  — price of the driving RESISTANCE level (SL for RSS sells)
 *
 * SL semantics:
 *   RSS sell SL = driving resistance level (if close > R, sweep failed)
 *   SRR buy SL  = driving support level    (if close < S, rally failed)
 */

export const RSS_SRR_STATE_MODULE_VERSION = "2.0.0";
export const RSS_SRR_STATE_MODULE  = "RSS_SRR_State_Module";

export function generateRssSrrStateModule(): string {
  return `//+------------------------------------------------------------------+
//| RSS_SRR_State_Module.mq5                                       |
//| SNR Module Library v${RSS_SRR_STATE_MODULE_VERSION} — Phase 2: State + Buffers|
//|                                                                  |
//| RSS: Resistance drives 2+ support breaks → sell setup.          |
//| SRR: Support drives 2+ resistance breaks → buy setup.           |
//| Each driving level owns its sweep counter — fires exactly once.  |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SNR Module Library"
#property version   "2.00"
#property strict
#property indicator_chart_window
#property indicator_buffers 4
#property indicator_plots   0

//--- Buffers
double SRRBuf[];
double RSSBuf[];
double SRRSLBuf[];
double RSSSLBuf[];

#define TYPE_SUPPORT      1
#define TYPE_RESISTANCE   2
#define LVL_MAX           600
#define MAX_SWEPT         10
#define OBJ_PREFIX        "SMCRSS_"

//--- Inputs — Detection
input ENUM_TIMEFRAMES InpTF         = PERIOD_CURRENT; // Timeframe
input int             InpLookback   = 500;            // Historical bars to scan
input int             InpMinBreaks  = 2;              // Min opposite-side breaks to trigger
input int             InpExpiryBars = 150;            // Level expiry bars (0 = never)
input bool            InpIgnoreDoji = true;           // Skip doji candles
//--- Inputs — Drawing
input bool            InpDraw       = true;           // Draw visual labels
input color           InpRSSColor   = clrTomato;           // RSS colour
input color           InpSRRColor   = clrMediumSeaGreen;   // SRR colour
input color           InpSweptColor = clrDimGray;          // Swept level dashes
input int             InpExtBars    = 8;                   // Extension bars right of signal
input int             InpFontSize   = 9;                   // Label font size
input bool            InpShowLog    = true;           // Print to journal

//+------------------------------------------------------------------+
struct LevelRec
{
   int      id;
   int      type;
   double   level;
   datetime levelTime;
   datetime confirmTime;
   bool     broken;
   bool     justBroken;
   bool     swept;
   int      ageCounter;
   int      sweepCount;
   double   sweptPrices[MAX_SWEPT];
   int      sweptN;
};

LevelRec levList[LVL_MAX];
int      levTotal = 0;
int      nextId   = 0;

//+------------------------------------------------------------------+
string DrvLine(int id)        { return OBJ_PREFIX + IntegerToString(id) + "_rl"; }
string SwpLine(int id, int k) { return OBJ_PREFIX + IntegerToString(id) + "_sl" + IntegerToString(k); }
string LblObj (int id)        { return OBJ_PREFIX + IntegerToString(id) + "_lb"; }

//+------------------------------------------------------------------+
int CandleDir(int sh)
{
   double c = iClose(_Symbol, InpTF, sh);
   double o = iOpen (_Symbol, InpTF, sh);
   if(InpIgnoreDoji)
   {
      double range = iHigh(_Symbol, InpTF, sh) - iLow(_Symbol, InpTF, sh);
      if(range > 0 && MathAbs(c - o) / range < 0.1) return 0;
   }
   if(c > o) return  1;
   if(c < o) return -1;
   return 0;
}

//+------------------------------------------------------------------+
void AddLevel(int type, double level, datetime tA, datetime tB)
{
   for(int i = 0; i < levTotal; i++)
      if(levList[i].levelTime == tA && levList[i].type == type) return;
   int idx = -1;
   for(int i = 0; i < levTotal; i++)
      if(levList[i].broken && !levList[i].swept) { idx = i; break; }
   if(idx < 0 && levTotal < LVL_MAX) idx = levTotal++;
   if(idx < 0) return;

   levList[idx].id          = nextId++;
   levList[idx].type        = type;
   levList[idx].level       = level;
   levList[idx].levelTime   = tA;
   levList[idx].confirmTime = tB;
   levList[idx].broken      = false;
   levList[idx].justBroken  = false;
   levList[idx].swept       = false;
   levList[idx].ageCounter  = 0;
   levList[idx].sweepCount  = 0;
   levList[idx].sweptN      = 0;
}

//+------------------------------------------------------------------+
void DetectLevels(int shA, int shB)
{
   int avail = iBars(_Symbol, InpTF);
   if(shA >= avail || shB < 0) return;
   int dirA = CandleDir(shA);
   int dirB = CandleDir(shB);
   if(dirA == 0 || dirB == 0) return;

   double   lvl = iClose(_Symbol, InpTF, shA);
   datetime tA  = iTime (_Symbol, InpTF, shA);
   datetime tB  = iTime (_Symbol, InpTF, shB);

   if(dirA > 0 && dirB < 0) AddLevel(TYPE_RESISTANCE, lvl, tA, tB);
   if(dirA < 0 && dirB > 0) AddLevel(TYPE_SUPPORT,    lvl, tA, tB);
}

//+------------------------------------------------------------------+
void DrawSignal(int drivIdx, int dir, int sh, datetime t)
{
   if(!InpDraw) return;
   int    id    = levList[drivIdx].id;
   double drivL = levList[drivIdx].level;
   color  c     = (dir < 0) ? InpRSSColor : InpSRRColor;
   string txt   = (dir < 0) ? "RSS" : "SRR";

   datetime t1 = levList[drivIdx].levelTime;
   datetime t2 = t + (datetime)(PeriodSeconds(InpTF) * InpExtBars);
   if(ObjectCreate(0, DrvLine(id), OBJ_TREND, 0, t1, drivL, t2, drivL))
   {
      ObjectSetInteger(0, DrvLine(id), OBJPROP_COLOR,      c);
      ObjectSetInteger(0, DrvLine(id), OBJPROP_WIDTH,      2);
      ObjectSetInteger(0, DrvLine(id), OBJPROP_STYLE,      STYLE_SOLID);
      ObjectSetInteger(0, DrvLine(id), OBJPROP_RAY_RIGHT,  false);
      ObjectSetInteger(0, DrvLine(id), OBJPROP_SELECTABLE, false);
   }
   datetime dashL = t - (datetime)(PeriodSeconds(InpTF));
   datetime dashR = t + (datetime)(PeriodSeconds(InpTF));
   for(int k = 0; k < levList[drivIdx].sweptN; k++)
   {
      string nm = SwpLine(id, k);
      double sp = levList[drivIdx].sweptPrices[k];
      if(ObjectCreate(0, nm, OBJ_TREND, 0, dashL, sp, dashR, sp))
      {
         ObjectSetInteger(0, nm, OBJPROP_COLOR,      InpSweptColor);
         ObjectSetInteger(0, nm, OBJPROP_WIDTH,      1);
         ObjectSetInteger(0, nm, OBJPROP_STYLE,      STYLE_DOT);
         ObjectSetInteger(0, nm, OBJPROP_RAY_RIGHT,  false);
         ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      }
   }
   double labelPrice = (dir < 0) ? iLow(_Symbol, InpTF, sh) : iHigh(_Symbol, InpTF, sh);
   if(ObjectCreate(0, LblObj(id), OBJ_TEXT, 0, t, labelPrice))
   {
      ObjectSetString (0, LblObj(id), OBJPROP_TEXT,       txt);
      ObjectSetInteger(0, LblObj(id), OBJPROP_COLOR,      c);
      ObjectSetInteger(0, LblObj(id), OBJPROP_FONTSIZE,   InpFontSize);
      ObjectSetInteger(0, LblObj(id), OBJPROP_ANCHOR,     dir < 0 ? ANCHOR_UPPER : ANCHOR_LOWER);
      ObjectSetInteger(0, LblObj(id), OBJPROP_SELECTABLE, false);
   }
}

//+------------------------------------------------------------------+
void CheckSweeps(int sh)
{
   double   barClose = iClose(_Symbol, InpTF, sh);
   datetime t        = iTime (_Symbol, InpTF, sh);
   int      bufN     = ArraySize(SRRBuf);

   // Pass 1: mark close-breaks
   for(int i = 0; i < levTotal; i++)
   {
      levList[i].justBroken = false;
      if(levList[i].broken) continue;
      if(levList[i].confirmTime >= t) continue;

      if(levList[i].type == TYPE_SUPPORT && barClose < levList[i].level)
      {
         levList[i].broken = true; levList[i].justBroken = true;
      }
      else if(levList[i].type == TYPE_RESISTANCE && barClose > levList[i].level)
      {
         levList[i].broken = true; levList[i].justBroken = true;
      }
   }

   // Pass 2: update sweep counters on opposite active levels
   for(int i = 0; i < levTotal; i++)
   {
      if(!levList[i].justBroken) continue;

      if(levList[i].type == TYPE_SUPPORT)
      {
         double brokenSup = levList[i].level;
         for(int j = 0; j < levTotal; j++)
         {
            if(levList[j].type   != TYPE_RESISTANCE) continue;
            if(levList[j].broken)                    continue;
            if(levList[j].swept)                     continue;
            if(levList[j].confirmTime >= t)          continue;
            if(levList[j].level <= brokenSup)        continue;

            levList[j].sweepCount++;
            if(levList[j].sweptN < MAX_SWEPT)
               levList[j].sweptPrices[levList[j].sweptN++] = brokenSup;

            if(levList[j].sweepCount >= InpMinBreaks)
            {
               if(sh < bufN)
               {
                  RSSBuf[sh]   = 1.0;
                  RSSSLBuf[sh] = levList[j].level; // SL = driving resistance
               }
               DrawSignal(j, -1, sh, t);
               levList[j].swept = true;
               if(InpShowLog)
                  PrintFormat("RSS | R=%.5f | swept=%d | time=%s",
                     levList[j].level, levList[j].sweepCount,
                     TimeToString(t, TIME_DATE|TIME_MINUTES));
            }
         }
      }
      else // TYPE_RESISTANCE broken
      {
         double brokenRes = levList[i].level;
         for(int j = 0; j < levTotal; j++)
         {
            if(levList[j].type   != TYPE_SUPPORT) continue;
            if(levList[j].broken)                 continue;
            if(levList[j].swept)                  continue;
            if(levList[j].confirmTime >= t)       continue;
            if(levList[j].level >= brokenRes)     continue;

            levList[j].sweepCount++;
            if(levList[j].sweptN < MAX_SWEPT)
               levList[j].sweptPrices[levList[j].sweptN++] = brokenRes;

            if(levList[j].sweepCount >= InpMinBreaks)
            {
               if(sh < bufN)
               {
                  SRRBuf[sh]   = 1.0;
                  SRRSLBuf[sh] = levList[j].level; // SL = driving support
               }
               DrawSignal(j, 1, sh, t);
               levList[j].swept = true;
               if(InpShowLog)
                  PrintFormat("SRR | S=%.5f | swept=%d | time=%s",
                     levList[j].level, levList[j].sweepCount,
                     TimeToString(t, TIME_DATE|TIME_MINUTES));
            }
         }
      }
   }
}

//+------------------------------------------------------------------+
void AgeLevels()
{
   if(InpExpiryBars <= 0) return;
   for(int i = 0; i < levTotal; i++)
   {
      if(levList[i].broken || levList[i].swept) continue;
      levList[i].ageCounter++;
      if(levList[i].ageCounter >= InpExpiryBars) levList[i].broken = true;
   }
}

//+------------------------------------------------------------------+
void ResetState()
{
   levTotal = 0;
   nextId   = 0;
   ObjectsDeleteAll(0, OBJ_PREFIX);
   ArrayInitialize(SRRBuf,   0.0);
   ArrayInitialize(RSSBuf,   0.0);
   ArrayInitialize(SRRSLBuf, 0.0);
   ArrayInitialize(RSSSLBuf, 0.0);
}

//+------------------------------------------------------------------+
int OnInit()
{
   SetIndexBuffer(0, SRRBuf,   INDICATOR_DATA);
   SetIndexBuffer(1, RSSBuf,   INDICATOR_DATA);
   SetIndexBuffer(2, SRRSLBuf, INDICATOR_DATA);
   SetIndexBuffer(3, RSSSLBuf, INDICATOR_DATA);
   ArraySetAsSeries(SRRBuf,   true);
   ArraySetAsSeries(RSSBuf,   true);
   ArraySetAsSeries(SRRSLBuf, true);
   ArraySetAsSeries(RSSSLBuf, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "RSS_SRR_State v${RSS_SRR_STATE_MODULE_VERSION}");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { ObjectsDeleteAll(0, OBJ_PREFIX); }

//+------------------------------------------------------------------+
int OnCalculate(const int rates_total,
                const int prev_calculated,
                const datetime &time[],
                const double &open[],
                const double &high[],
                const double &low[],
                const double &close[],
                const long &tick_volume[],
                const long &volume[],
                const int &spread[])
{
   if(rates_total < 3) return 0;

   if(prev_calculated == 0)
   {
      ResetState();
      int limit = (int)MathMin((long)(rates_total - 2), (long)InpLookback);
      if(limit < 1) return rates_total;
      for(int sh = limit; sh >= 1; sh--)
      {
         DetectLevels(sh + 1, sh);
         CheckSweeps(sh);
         AgeLevels();
      }
      return rates_total;
   }

   if(sh1IsNewBar())
   {
      DetectLevels(2, 1);
      CheckSweeps(1);
      AgeLevels();
   }
   return rates_total;
}

//+------------------------------------------------------------------+
bool sh1IsNewBar()
{
   static datetime last = 0;
   datetime t = iTime(_Symbol, InpTF, 0);
   if(t == last) return false;
   last = t;
   return true;
}
`;
}
