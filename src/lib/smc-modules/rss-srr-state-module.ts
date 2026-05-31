/**
 * SNR Module Library — Phase 2: RSS / SRR State Module
 *
 * RSS_SRR_State_Module v1.0.0
 * ────────────────────────────────────────────────
 * Same detection as the RSS/SRR Detector but exposes 4 iCustom buffers
 * so Phase 3 EAs can trade the sweep events.
 *
 * Phase 3 buffer contract (read via iCustom):
 *   0 : SRRBuf    — 1.0 at the SRR signal bar (bullish: swept 2+ resistances)
 *   1 : RSSBuf    — 1.0 at the RSS signal bar (bearish: swept 2+ supports)
 *   2 : SRRSLBuf  — lowest broken resistance level (SL for SRR buy entries)
 *   3 : RSSSLBuf  — highest broken support level (SL for RSS sell entries)
 *
 * SL semantics:
 *   SRR buy SL  = lowest resistance that was swept (if price drops back below it, sweep failed)
 *   RSS sell SL = highest support that was swept (if price reclaims it, sweep failed)
 *
 * NO trading logic — state tracking, signal buffers, and visualisation only.
 */

export const RSS_SRR_STATE_MODULE_VERSION = "1.0.0";
export const RSS_SRR_STATE_MODULE  = "RSS_SRR_State_Module";

export function generateRssSrrStateModule(): string {
  return `//+------------------------------------------------------------------+
//| RSS_SRR_State_Module.mq5                                       |
//| SNR Module Library v${RSS_SRR_STATE_MODULE_VERSION} — Phase 2: State + Buffers|
//|                                                                  |
//| RSS: 2+ Classic Supports broken in window → SELL setup.         |
//| SRR: 2+ Classic Resistances broken in window → BUY setup.       |
//|                                                                  |
//| Buffers (iCustom):                                              |
//|   0 : SRRBuf   — 1.0 at SRR signal bar                         |
//|   1 : RSSBuf   — 1.0 at RSS signal bar                         |
//|   2 : SRRSLBuf — lowest swept resistance (SL for buys)          |
//|   3 : RSSSLBuf — highest swept support (SL for sells)           |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SNR Module Library"
#property version   "1.00"
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
#define BREAK_MAX         400
#define OBJ_PREFIX        "SMCRSS_"

//--- Inputs — Detection
input ENUM_TIMEFRAMES InpTF         = PERIOD_CURRENT; // Timeframe
input int             InpLookback   = 500;            // Historical bars to scan
input int             InpMinBreaks  = 2;              // Min same-type breaks to trigger
input int             InpWindowBars = 20;             // Sweep window (bars)
input int             InpExpiryBars = 150;            // Level expiry (0 = never)
input bool            InpIgnoreDoji = true;           // Skip doji candles
//--- Inputs — Drawing
input bool            InpDraw       = true;           // Draw labels
input color           InpRSSColor   = clrTomato;           // RSS colour
input color           InpSRRColor   = clrMediumSeaGreen;   // SRR colour
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
   int      ageCounter;
};

struct BreakRecord
{
   datetime breakTime;
   int      type;
   double   level;
};

LevelRec  levList[LVL_MAX];
int       levTotal = 0;
int       nextId   = 0;

BreakRecord breakList[BREAK_MAX];
int         breakTotal = 0;

datetime lastRSSTime = 0;
datetime lastSRRTime = 0;

//+------------------------------------------------------------------+
string ObjLbl(int id) { return OBJ_PREFIX + IntegerToString(id) + "_lb"; }

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
      if(levList[i].broken) { idx = i; break; }
   if(idx < 0)
   {
      if(levTotal >= LVL_MAX) return;
      idx = levTotal++;
   }
   levList[idx].id          = nextId++;
   levList[idx].type        = type;
   levList[idx].level       = level;
   levList[idx].levelTime   = tA;
   levList[idx].confirmTime = tB;
   levList[idx].broken      = false;
   levList[idx].ageCounter  = 0;
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
void RecordBreak(datetime t, int type, double level)
{
   if(breakTotal >= BREAK_MAX)
   {
      for(int i = 0; i < BREAK_MAX - 1; i++) breakList[i] = breakList[i + 1];
      breakTotal = BREAK_MAX - 1;
   }
   breakList[breakTotal].breakTime = t;
   breakList[breakTotal].type      = type;
   breakList[breakTotal].level     = level;
   breakTotal++;
}

//+------------------------------------------------------------------+
int CountBreaksInWindow(datetime t, int type, double &extreme)
{
   long windowSecs = (long)PeriodSeconds(InpTF) * (long)InpWindowBars;
   int  cnt = 0;
   extreme  = (type == TYPE_SUPPORT) ? 0.0 : DBL_MAX;

   for(int i = 0; i < breakTotal; i++)
   {
      if(breakList[i].type != type) continue;
      if((long)(t - breakList[i].breakTime) > windowSecs) continue;
      cnt++;
      if(type == TYPE_SUPPORT    && breakList[i].level > extreme) extreme = breakList[i].level;
      if(type == TYPE_RESISTANCE && breakList[i].level < extreme) extreme = breakList[i].level;
   }
   return cnt;
}

//+------------------------------------------------------------------+
void DrawLabel(int dir, double price, datetime t)
{
   if(!InpDraw) return;
   int    id  = nextId++;
   string nm  = ObjLbl(id);
   color  c   = (dir < 0) ? InpRSSColor : InpSRRColor;
   string txt = (dir < 0) ? "RSS" : "SRR";
   if(ObjectCreate(0, nm, OBJ_TEXT, 0, t, price))
   {
      ObjectSetString (0, nm, OBJPROP_TEXT,       txt);
      ObjectSetInteger(0, nm, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, nm, OBJPROP_FONTSIZE,   InpFontSize);
      ObjectSetInteger(0, nm, OBJPROP_ANCHOR,     dir < 0 ? ANCHOR_UPPER : ANCHOR_LOWER);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
   }
}

//+------------------------------------------------------------------+
void CheckBreaksAndSignal(int sh)
{
   double   barClose = iClose(_Symbol, InpTF, sh);
   double   barHigh  = iHigh (_Symbol, InpTF, sh);
   double   barLow   = iLow  (_Symbol, InpTF, sh);
   datetime t        = iTime (_Symbol, InpTF, sh);
   long     winSecs  = (long)PeriodSeconds(InpTF) * (long)InpWindowBars;
   int      bufN     = ArraySize(SRRBuf);

   bool newRSS = false;
   bool newSRR = false;

   for(int i = 0; i < levTotal; i++)
   {
      if(levList[i].broken) continue;
      if(levList[i].confirmTime >= t) continue;
      double lvl = levList[i].level;

      if(levList[i].type == TYPE_SUPPORT && barClose < lvl)
      {
         levList[i].broken = true;
         RecordBreak(t, TYPE_SUPPORT, lvl);
         newRSS = true;
      }
      else if(levList[i].type == TYPE_RESISTANCE && barClose > lvl)
      {
         levList[i].broken = true;
         RecordBreak(t, TYPE_RESISTANCE, lvl);
         newSRR = true;
      }
   }

   // ── RSS ──────────────────────────────────────────────────────────
   if(newRSS)
   {
      double highestSup = 0.0;
      int cnt = CountBreaksInWindow(t, TYPE_SUPPORT, highestSup);
      if(cnt >= InpMinBreaks && (lastRSSTime == 0 || (long)(t - lastRSSTime) > winSecs))
      {
         if(sh < bufN)
         {
            RSSBuf[sh]   = 1.0;
            RSSSLBuf[sh] = highestSup;  // SL for sell: highest swept support
         }
         DrawLabel(-1, barLow, t);
         lastRSSTime = t;
         if(InpShowLog)
            PrintFormat("RSS | breaks=%d | sl=%.5f | time=%s",
               cnt, highestSup, TimeToString(t, TIME_DATE|TIME_MINUTES));
      }
   }

   // ── SRR ──────────────────────────────────────────────────────────
   if(newSRR)
   {
      double lowestRes = DBL_MAX;
      int cnt = CountBreaksInWindow(t, TYPE_RESISTANCE, lowestRes);
      if(cnt >= InpMinBreaks && (lastSRRTime == 0 || (long)(t - lastSRRTime) > winSecs))
      {
         if(sh < bufN)
         {
            SRRBuf[sh]   = 1.0;
            SRRSLBuf[sh] = lowestRes;  // SL for buy: lowest swept resistance
         }
         DrawLabel(1, barHigh, t);
         lastSRRTime = t;
         if(InpShowLog)
            PrintFormat("SRR | breaks=%d | sl=%.5f | time=%s",
               cnt, lowestRes, TimeToString(t, TIME_DATE|TIME_MINUTES));
      }
   }
}

//+------------------------------------------------------------------+
void AgeLevels()
{
   if(InpExpiryBars <= 0) return;
   for(int i = 0; i < levTotal; i++)
   {
      if(levList[i].broken) continue;
      levList[i].ageCounter++;
      if(levList[i].ageCounter >= InpExpiryBars) levList[i].broken = true;
   }
}

//+------------------------------------------------------------------+
void ResetState()
{
   levTotal    = 0;
   nextId      = 0;
   breakTotal  = 0;
   lastRSSTime = 0;
   lastSRRTime = 0;
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
         CheckBreaksAndSignal(sh);
         AgeLevels();
      }
      return rates_total;
   }

   if(sh1IsNewBar())
   {
      DetectLevels(2, 1);
      CheckBreaksAndSignal(1);
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
