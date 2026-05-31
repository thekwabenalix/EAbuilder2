/**
 * SNR Module Library — Phase 1: RSS / SRR Detector
 *
 * RSS_SRR_Detector v1.0.0
 * ────────────────────────────────────────────────
 * RSS (Resistance Sweeps Supports):
 *   Classic Resistance pushes price down to break at least two
 *   Classic Support levels (close-based, in sequence).
 *
 * SRR (Support Rallies Resistances):
 *   Classic Support rallies price up to break at least two
 *   Classic Resistance levels (close-based, in sequence).
 *
 * LEVEL SOURCE: Classic SNR only (Bull→Bear = Resistance, Bear→Bull = Support).
 * A level is BROKEN when a candle closes through it.
 * A signal fires when InpMinBreaks same-type levels are broken within
 * InpWindowBars bars. One signal per sweep (cooldown = window length).
 *
 * DRAWN ELEMENTS:
 *   "RSS" label below the signal bar (bearish sweep)
 *   "SRR" label above the signal bar (bullish sweep)
 *
 * JOURNAL:
 *   RSS | breaks=N | highestSup=X | time
 *   SRR | breaks=N | lowestRes=X  | time
 *
 * NO trading logic. Detection and visualisation only.
 */

export const RSS_SRR_DETECTOR_VERSION = "1.0.0";
export const RSS_SRR_DETECTOR_MODULE  = "RSS_SRR_Detector";

export function generateRssSrrDetector(): string {
  return `//+------------------------------------------------------------------+
//| RSS_SRR_Detector.mq5                                           |
//| SNR Module Library v${RSS_SRR_DETECTOR_VERSION} — Phase 1: Detection Only  |
//|                                                                  |
//| RSS: Resistance sweeps price through 2+ Classic Supports.       |
//| SRR: Support rallies price through 2+ Classic Resistances.      |
//| Signal fires when InpMinBreaks same-type levels close-break     |
//| within InpWindowBars bars. One label per sweep event.           |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SNR Module Library"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define TYPE_SUPPORT      1
#define TYPE_RESISTANCE   2
#define LVL_MAX           600
#define BREAK_MAX         400
#define OBJ_PREFIX        "SMCRSS_"

//--- Inputs — Detection
input ENUM_TIMEFRAMES InpTF          = PERIOD_CURRENT; // Timeframe
input int             InpLookback    = 500;            // Historical bars to scan
input int             InpMinBreaks   = 2;              // Min same-type breaks to trigger
input int             InpWindowBars  = 20;             // Sweep window (bars)
input int             InpExpiryBars  = 150;            // Level expiry (0 = never)
input bool            InpIgnoreDoji  = true;           // Skip doji candles
//--- Inputs — Drawing
input color           InpRSSColor    = clrTomato;           // RSS label colour
input color           InpSRRColor    = clrMediumSeaGreen;   // SRR label colour
input int             InpFontSize    = 9;                   // Label font size
input bool            InpShowLog     = true;                // Print to journal

//+------------------------------------------------------------------+
struct LevelRec
{
   int      id;
   int      type;         // TYPE_SUPPORT or TYPE_RESISTANCE
   double   level;        // Candle A close
   datetime levelTime;    // Candle A time
   datetime confirmTime;  // Candle B time — valid only AFTER this
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
datetime  lastBarTime = 0;

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

   // Classic SNR only: direction reversal between A and B
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
// Count same-type breaks that occurred within InpWindowBars of time t.
// Also tracks highest support / lowest resistance for SL reference.
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
void DrawLabel(int dir, double price, datetime t, int breakCount)
{
   int    id  = nextId++;
   string nm  = ObjLbl(id);
   color  c   = (dir < 0) ? InpRSSColor : InpSRRColor;
   string txt = (dir < 0) ? "RSS" : "SRR";

   if(ObjectCreate(0, nm, OBJ_TEXT, 0, t, price))
   {
      ObjectSetString (0, nm, OBJPROP_TEXT,       txt);
      ObjectSetInteger(0, nm, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, nm, OBJPROP_FONTSIZE,   InpFontSize);
      // RSS: label below bar low (bearish sweep)
      // SRR: label above bar high (bullish sweep)
      ObjectSetInteger(0, nm, OBJPROP_ANCHOR,     dir < 0 ? ANCHOR_UPPER : ANCHOR_LOWER);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
   }

   if(InpShowLog)
      PrintFormat("%s | breaks=%d | level=%.5f | time=%s",
         txt, breakCount, price, TimeToString(t, TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
// Check bar sh: mark broken levels, fire RSS/SRR when sweep threshold met.
void CheckBreaksAndSignal(int sh)
{
   double   barClose = iClose(_Symbol, InpTF, sh);
   double   barHigh  = iHigh (_Symbol, InpTF, sh);
   double   barLow   = iLow  (_Symbol, InpTF, sh);
   datetime t        = iTime (_Symbol, InpTF, sh);
   long     winSecs  = (long)PeriodSeconds(InpTF) * (long)InpWindowBars;

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

   // ── RSS: enough supports swept + cooldown passed ──────────────────
   if(newRSS)
   {
      double highestSup = 0.0;
      int cnt = CountBreaksInWindow(t, TYPE_SUPPORT, highestSup);
      if(cnt >= InpMinBreaks && (lastRSSTime == 0 || (long)(t - lastRSSTime) > winSecs))
      {
         DrawLabel(-1, barLow, t, cnt);
         lastRSSTime = t;
      }
   }

   // ── SRR: enough resistances swept + cooldown passed ───────────────
   if(newSRR)
   {
      double lowestRes = DBL_MAX;
      int cnt = CountBreaksInWindow(t, TYPE_RESISTANCE, lowestRes);
      if(cnt >= InpMinBreaks && (lastSRRTime == 0 || (long)(t - lastSRRTime) > winSecs))
      {
         DrawLabel(1, barHigh, t, cnt);
         lastSRRTime = t;
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
void Rebuild()
{
   ObjectsDeleteAll(0, OBJ_PREFIX);
   levTotal     = 0;
   nextId       = 0;
   breakTotal   = 0;
   lastRSSTime  = 0;
   lastSRRTime  = 0;

   int avail = iBars(_Symbol, InpTF);
   int scan  = MathMin(InpLookback, avail - 2);
   if(scan < 2) return;

   for(int sh = scan; sh >= 1; sh--)
   {
      DetectLevels(sh + 1, sh);
      CheckBreaksAndSignal(sh);
      AgeLevels();
   }
}

//+------------------------------------------------------------------+
int OnInit()
{
   lastBarTime = 0;
   Rebuild();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { ObjectsDeleteAll(0, OBJ_PREFIX); }

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
   datetime curBar = iTime(_Symbol, InpTF, 0);
   if(curBar != lastBarTime)
   {
      lastBarTime = curBar;
      DetectLevels(2, 1);
      CheckBreaksAndSignal(1);
      AgeLevels();
   }
   return rates_total;
}
`;
}
