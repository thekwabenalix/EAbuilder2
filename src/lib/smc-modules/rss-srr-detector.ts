/**
 * SNR Module Library — Phase 1: RSS / SRR Detector v2.0.0
 *
 * RSS (Resistance Sweeps Supports):
 *   A Classic Resistance R pushes price down to CLOSE-BREAK at least
 *   InpMinBreaks Classic Support levels that sit BELOW R.
 *   The R level is marked as the driving level + entry reference.
 *
 * SRR (Support Rallies Resistances):
 *   A Classic Support S rallies price up to CLOSE-BREAK at least
 *   InpMinBreaks Classic Resistance levels that sit ABOVE S.
 *   The S level is marked as the driving level + entry reference.
 *
 * DETECTION:
 *   Each active resistance R owns a sweep counter. Every time a support S
 *   (where S.level < R.level) is close-broken after R was confirmed, R's
 *   counter increments. When the counter hits InpMinBreaks, RSS fires for R.
 *   Mirror logic for SRR on each active support.
 *
 * DRAWN ELEMENTS (on RSS):
 *   Solid horizontal line at R (the driving resistance) — entry reference
 *   Short dash at each swept support price — shows what was broken
 *   "RSS" label at the signal bar
 *
 * JOURNAL:
 *   RSS | R=X | swept=N | time
 *   SRR | S=X | swept=N | time
 */

export const RSS_SRR_DETECTOR_VERSION = "2.0.0";
export const RSS_SRR_DETECTOR_MODULE  = "RSS_SRR_Detector";

export function generateRssSrrDetector(): string {
  return `//+------------------------------------------------------------------+
//| RSS_SRR_Detector.mq5                                           |
//| SNR Module Library v${RSS_SRR_DETECTOR_VERSION} — Phase 1: Detection Only  |
//|                                                                  |
//| RSS: Classic Resistance drives price to break 2+ Supports below.|
//| SRR: Classic Support drives price to break 2+ Resistances above.|
//| Each R/S owns a sweep counter — fires once when threshold met.  |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SNR Module Library"
#property version   "2.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define TYPE_SUPPORT      1
#define TYPE_RESISTANCE   2
#define LVL_MAX           600
#define MAX_SWEPT         10     // max swept prices stored per level
#define OBJ_PREFIX        "SMCRSS_"

//--- Inputs — Detection
input ENUM_TIMEFRAMES InpTF          = PERIOD_CURRENT; // Timeframe
input int             InpLookback    = 500;            // Historical bars to scan
input int             InpMinBreaks   = 2;              // Min opposite-side breaks to trigger
input int             InpExpiryBars  = 150;            // Level expiry bars (0 = never)
input bool            InpIgnoreDoji  = true;           // Skip doji candles
//--- Inputs — Drawing
input color           InpRSSColor    = clrTomato;           // RSS colour (driving R + label)
input color           InpSRRColor    = clrMediumSeaGreen;   // SRR colour (driving S + label)
input color           InpSweptColor  = clrDimGray;          // Colour for swept level dashes
input int             InpExtBars     = 8;                   // Extension bars right of signal
input int             InpFontSize    = 9;                   // Label font size
input bool            InpShowLog     = true;                // Print to journal

//+------------------------------------------------------------------+
struct LevelRec
{
   int      id;
   int      type;              // TYPE_SUPPORT or TYPE_RESISTANCE
   double   level;             // Candle A close
   datetime levelTime;         // Candle A time (left anchor)
   datetime confirmTime;       // Candle B time — valid only AFTER this
   bool     broken;            // permanently broken (can no longer receive sweeps)
   bool     justBroken;        // set this bar, used to update opposite levels
   bool     swept;             // already fired RSS/SRR — don't fire again
   int      ageCounter;
   int      sweepCount;        // opposite-type breaks below/above this level
   double   sweptPrices[MAX_SWEPT]; // prices of swept opposite levels (for drawing)
   int      sweptN;            // how many stored in sweptPrices
};

LevelRec levList[LVL_MAX];
int      levTotal    = 0;
int      nextId      = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
string DrvLine(int id)       { return OBJ_PREFIX + IntegerToString(id) + "_rl"; }
string SwpLine(int id, int k){ return OBJ_PREFIX + IntegerToString(id) + "_sl" + IntegerToString(k); }
string LblObj (int id)       { return OBJ_PREFIX + IntegerToString(id) + "_lb"; }

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

   // Classic SNR only
   if(dirA > 0 && dirB < 0) AddLevel(TYPE_RESISTANCE, lvl, tA, tB);
   if(dirA < 0 && dirB > 0) AddLevel(TYPE_SUPPORT,    lvl, tA, tB);
}

//+------------------------------------------------------------------+
// Draw the driving level line + swept support/resistance dashes + label
void FireSignal(int drivIdx, int dir, int sh, datetime t)
{
   int    id    = levList[drivIdx].id;
   double drivL = levList[drivIdx].level;
   color  c     = (dir < 0) ? InpRSSColor : InpSRRColor;
   string txt   = (dir < 0) ? "RSS" : "SRR";

   // Driving level line: from its origin to signal bar + extension
   datetime t1  = levList[drivIdx].levelTime;
   datetime t2  = t + (datetime)(PeriodSeconds(InpTF) * InpExtBars);
   if(ObjectCreate(0, DrvLine(id), OBJ_TREND, 0, t1, drivL, t2, drivL))
   {
      ObjectSetInteger(0, DrvLine(id), OBJPROP_COLOR,      c);
      ObjectSetInteger(0, DrvLine(id), OBJPROP_WIDTH,      2);
      ObjectSetInteger(0, DrvLine(id), OBJPROP_STYLE,      STYLE_SOLID);
      ObjectSetInteger(0, DrvLine(id), OBJPROP_RAY_RIGHT,  false);
      ObjectSetInteger(0, DrvLine(id), OBJPROP_SELECTABLE, false);
   }

   // Short dashes at each swept level (centered on signal bar)
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

   // Label at signal bar — above bar high for SRR, below bar low for RSS
   double labelPrice = (dir < 0) ? iLow(_Symbol, InpTF, sh) : iHigh(_Symbol, InpTF, sh);
   if(ObjectCreate(0, LblObj(id), OBJ_TEXT, 0, t, labelPrice))
   {
      ObjectSetString (0, LblObj(id), OBJPROP_TEXT,       txt);
      ObjectSetInteger(0, LblObj(id), OBJPROP_COLOR,      c);
      ObjectSetInteger(0, LblObj(id), OBJPROP_FONTSIZE,   InpFontSize);
      ObjectSetInteger(0, LblObj(id), OBJPROP_ANCHOR,     dir < 0 ? ANCHOR_UPPER : ANCHOR_LOWER);
      ObjectSetInteger(0, LblObj(id), OBJPROP_SELECTABLE, false);
   }

   if(InpShowLog)
      PrintFormat("%s | driving=%.5f | swept=%d | time=%s",
         txt, drivL, levList[drivIdx].sweepCount,
         TimeToString(t, TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
// Two-pass sweep detection:
// Pass 1 — mark newly close-broken levels (justBroken)
// Pass 2 — for each just-broken level, increment opposite-side sweep counters
void CheckSweeps(int sh)
{
   double   barClose = iClose(_Symbol, InpTF, sh);
   datetime t        = iTime (_Symbol, InpTF, sh);

   // ── Pass 1: mark close-breaks ────────────────────────────────────
   for(int i = 0; i < levTotal; i++)
   {
      levList[i].justBroken = false;
      if(levList[i].broken) continue;
      if(levList[i].confirmTime >= t) continue;

      if(levList[i].type == TYPE_SUPPORT && barClose < levList[i].level)
      {
         levList[i].broken     = true;
         levList[i].justBroken = true;
      }
      else if(levList[i].type == TYPE_RESISTANCE && barClose > levList[i].level)
      {
         levList[i].broken     = true;
         levList[i].justBroken = true;
      }
   }

   // ── Pass 2: update sweep counters on opposite active levels ───────
   for(int i = 0; i < levTotal; i++)
   {
      if(!levList[i].justBroken) continue;

      if(levList[i].type == TYPE_SUPPORT)
      {
         // Support broken — credit resistances that sit ABOVE it
         double brokenSup = levList[i].level;
         for(int j = 0; j < levTotal; j++)
         {
            if(levList[j].type   != TYPE_RESISTANCE) continue;
            if(levList[j].broken)                    continue;
            if(levList[j].swept)                     continue;
            if(levList[j].confirmTime >= t)          continue;
            if(levList[j].level <= brokenSup)        continue; // R must be above broken S

            levList[j].sweepCount++;
            if(levList[j].sweptN < MAX_SWEPT)
               levList[j].sweptPrices[levList[j].sweptN++] = brokenSup;

            if(levList[j].sweepCount >= InpMinBreaks)
            {
               FireSignal(j, -1, sh, t); // RSS
               levList[j].swept = true;
            }
         }
      }
      else // TYPE_RESISTANCE broken
      {
         // Resistance broken — credit supports that sit BELOW it
         double brokenRes = levList[i].level;
         for(int j = 0; j < levTotal; j++)
         {
            if(levList[j].type   != TYPE_SUPPORT) continue;
            if(levList[j].broken)                 continue;
            if(levList[j].swept)                  continue;
            if(levList[j].confirmTime >= t)       continue;
            if(levList[j].level >= brokenRes)     continue; // S must be below broken R

            levList[j].sweepCount++;
            if(levList[j].sweptN < MAX_SWEPT)
               levList[j].sweptPrices[levList[j].sweptN++] = brokenRes;

            if(levList[j].sweepCount >= InpMinBreaks)
            {
               FireSignal(j, 1, sh, t); // SRR
               levList[j].swept = true;
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
void Rebuild()
{
   ObjectsDeleteAll(0, OBJ_PREFIX);
   levTotal = 0;
   nextId   = 0;

   int avail = iBars(_Symbol, InpTF);
   int scan  = MathMin(InpLookback, avail - 2);
   if(scan < 2) return;

   for(int sh = scan; sh >= 1; sh--)
   {
      DetectLevels(sh + 1, sh);
      CheckSweeps(sh);
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
      CheckSweeps(1);
      AgeLevels();
   }
   return rates_total;
}
`;
}
