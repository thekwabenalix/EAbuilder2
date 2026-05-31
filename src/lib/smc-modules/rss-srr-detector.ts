/**
 * SNR Module Library — Phase 1: RSS / SRR Detector v3.0.0
 *
 * RSS (Resistance Sweeps Supports):
 *   A Classic Resistance R pushes price down to close-break ≥ InpMinBreaks
 *   Classic Supports below it.
 *
 *   Visual (matching the playbook diagram):
 *     ─── R ──────────────────────   ← driving resistance line, labeled "R"
 *                                        "Possible Sell" beneath it
 *     --- S ──────────────────────   ← each swept support line, labeled "S"
 *     --- S ──────────────────────
 *
 * SRR (Support Rallies Resistances): mirror.
 *   Driving support labeled "S" + "Possible Buy"
 *   Each swept resistance labeled "R"
 */

export const RSS_SRR_DETECTOR_VERSION = "3.0.0";
export const RSS_SRR_DETECTOR_MODULE  = "RSS_SRR_Detector";

export function generateRssSrrDetector(): string {
  return `//+------------------------------------------------------------------+
//| RSS_SRR_Detector.mq5                                           |
//| SNR Module Library v${RSS_SRR_DETECTOR_VERSION} — Phase 1: Detection Only  |
//|                                                                  |
//| RSS: Classic R drives price to close-break 2+ Supports below.  |
//| SRR: Classic S drives price to close-break 2+ Resistances above.|
//|                                                                  |
//| Visuals: driving level labeled "R"/"S" + "Possible Sell/Buy";  |
//| each swept level drawn from its origin, labeled "S"/"R".        |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SNR Module Library"
#property version   "3.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define TYPE_SUPPORT      1
#define TYPE_RESISTANCE   2
#define LVL_MAX           600
#define MAX_SWEPT         10
#define OBJ_PREFIX        "SMCRSS_"

//--- Inputs — Detection
input ENUM_TIMEFRAMES InpTF          = PERIOD_CURRENT; // Timeframe
input int             InpLookback    = 500;            // Historical bars to scan
input int             InpMinBreaks   = 2;              // Min opposite-side breaks to trigger
input int             InpExpiryBars  = 150;            // Level expiry bars (0 = never)
input bool            InpIgnoreDoji  = true;           // Skip doji candles
//--- Inputs — Drawing
input color           InpRSSColor    = clrTomato;           // RSS colour (R line + label)
input color           InpSRRColor    = clrMediumSeaGreen;   // SRR colour (S line + label)
input color           InpSweptColor  = clrDimGray;          // Swept-level line colour
input int             InpDrivWidth   = 2;                   // Driving level line width
input int             InpSwpWidth    = 1;                   // Swept level line width
input int             InpExtBars     = 20;                  // Extension bars right of signal
input int             InpFontSize    = 9;                   // Label font size
input int             InpNoteFontSz  = 7;                   // "Possible Sell/Buy" font size
input bool            InpShowLog     = true;                // Print to journal

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
   double   sweptPrices[MAX_SWEPT]; // prices of swept opposite levels
   datetime sweptTimes [MAX_SWEPT]; // origin times of swept opposite levels
   int      sweptN;
};

LevelRec levList[LVL_MAX];
int      levTotal    = 0;
int      nextId      = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
string DrvLine(int id)        { return OBJ_PREFIX + IntegerToString(id) + "_rl"; }
string DrvLbl (int id)        { return OBJ_PREFIX + IntegerToString(id) + "_lb"; }
string DrvNote(int id)        { return OBJ_PREFIX + IntegerToString(id) + "_nt"; }
string SwpLine(int id, int k) { return OBJ_PREFIX + IntegerToString(id) + "_sl" + IntegerToString(k); }
string SwpLbl (int id, int k) { return OBJ_PREFIX + IntegerToString(id) + "_sb" + IntegerToString(k); }

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
// Draw the full RSS/SRR visual:
//   dir = -1 → RSS: driving level is R (red), swept levels are S (gray)
//   dir = +1 → SRR: driving level is S (green), swept levels are R (gray)
void FireSignal(int drivIdx, int dir, int sh, datetime sigT)
{
   int    id    = levList[drivIdx].id;
   double drivL = levList[drivIdx].level;
   color  drivC = (dir < 0) ? InpRSSColor : InpSRRColor;

   string drivLabelTxt = (dir < 0) ? "R"             : "S";
   string noteTxt      = (dir < 0) ? "Possible Sell" : "Possible Buy";
   string swpLabelTxt  = (dir < 0) ? "S"             : "R";

   datetime tEnd = sigT + (datetime)(PeriodSeconds(InpTF) * InpExtBars);

   // ── Driving level line (R for RSS / S for SRR) ────────────────────
   datetime drivStart = levList[drivIdx].levelTime;
   if(ObjectCreate(0, DrvLine(id), OBJ_TREND, 0, drivStart, drivL, tEnd, drivL))
   {
      ObjectSetInteger(0, DrvLine(id), OBJPROP_COLOR,      drivC);
      ObjectSetInteger(0, DrvLine(id), OBJPROP_WIDTH,      InpDrivWidth);
      ObjectSetInteger(0, DrvLine(id), OBJPROP_STYLE,      STYLE_SOLID);
      ObjectSetInteger(0, DrvLine(id), OBJPROP_RAY_RIGHT,  false);
      ObjectSetInteger(0, DrvLine(id), OBJPROP_SELECTABLE, false);
   }
   // "R" or "S" label at right end of driving line
   if(ObjectCreate(0, DrvLbl(id), OBJ_TEXT, 0, tEnd, drivL))
   {
      ObjectSetString (0, DrvLbl(id), OBJPROP_TEXT,       drivLabelTxt);
      ObjectSetInteger(0, DrvLbl(id), OBJPROP_COLOR,      drivC);
      ObjectSetInteger(0, DrvLbl(id), OBJPROP_FONTSIZE,   InpFontSize);
      ObjectSetInteger(0, DrvLbl(id), OBJPROP_ANCHOR,
         dir < 0 ? ANCHOR_LEFT_UPPER : ANCHOR_LEFT_LOWER);
      ObjectSetInteger(0, DrvLbl(id), OBJPROP_SELECTABLE, false);
   }
   // "Possible Sell" / "Possible Buy" in smaller text below/above label
   if(ObjectCreate(0, DrvNote(id), OBJ_TEXT, 0, tEnd, drivL))
   {
      ObjectSetString (0, DrvNote(id), OBJPROP_TEXT,       noteTxt);
      ObjectSetInteger(0, DrvNote(id), OBJPROP_COLOR,      drivC);
      ObjectSetInteger(0, DrvNote(id), OBJPROP_FONTSIZE,   InpNoteFontSz);
      // Sell note sits below the label; Buy note sits above
      ObjectSetInteger(0, DrvNote(id), OBJPROP_ANCHOR,
         dir < 0 ? ANCHOR_LEFT_LOWER : ANCHOR_LEFT_UPPER);
      ObjectSetInteger(0, DrvNote(id), OBJPROP_SELECTABLE, false);
   }

   // ── Swept level lines (S for RSS / R for SRR) ─────────────────────
   for(int k = 0; k < levList[drivIdx].sweptN; k++)
   {
      double   sp    = levList[drivIdx].sweptPrices[k];
      datetime sTime = levList[drivIdx].sweptTimes[k];
      string   ln    = SwpLine(id, k);
      string   lb    = SwpLbl (id, k);

      if(ObjectCreate(0, ln, OBJ_TREND, 0, sTime, sp, tEnd, sp))
      {
         ObjectSetInteger(0, ln, OBJPROP_COLOR,      InpSweptColor);
         ObjectSetInteger(0, ln, OBJPROP_WIDTH,      InpSwpWidth);
         ObjectSetInteger(0, ln, OBJPROP_STYLE,      STYLE_SOLID);
         ObjectSetInteger(0, ln, OBJPROP_RAY_RIGHT,  false);
         ObjectSetInteger(0, ln, OBJPROP_SELECTABLE, false);
      }
      // "S" or "R" label at right end of swept line
      if(ObjectCreate(0, lb, OBJ_TEXT, 0, tEnd, sp))
      {
         ObjectSetString (0, lb, OBJPROP_TEXT,       swpLabelTxt);
         ObjectSetInteger(0, lb, OBJPROP_COLOR,      InpSweptColor);
         ObjectSetInteger(0, lb, OBJPROP_FONTSIZE,   InpFontSize);
         // Swept S labels: RSS sweeps down, so S is below R → anchor lower
         // Swept R labels: SRR sweeps up, so R is above S → anchor upper
         ObjectSetInteger(0, lb, OBJPROP_ANCHOR,
            dir < 0 ? ANCHOR_LEFT_LOWER : ANCHOR_LEFT_UPPER);
         ObjectSetInteger(0, lb, OBJPROP_SELECTABLE, false);
      }
   }

   if(InpShowLog)
      PrintFormat("%s | driving=%.5f | swept=%d | time=%s",
         dir < 0 ? "RSS" : "SRR", drivL, levList[drivIdx].sweepCount,
         TimeToString(sigT, TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
void CheckSweeps(int sh)
{
   double   barClose = iClose(_Symbol, InpTF, sh);
   datetime t        = iTime (_Symbol, InpTF, sh);

   // Pass 1: mark close-breaks
   for(int i = 0; i < levTotal; i++)
   {
      levList[i].justBroken = false;
      if(levList[i].broken) continue;
      if(levList[i].confirmTime >= t) continue;
      if(levList[i].type == TYPE_SUPPORT && barClose < levList[i].level)
         { levList[i].broken = true; levList[i].justBroken = true; }
      else if(levList[i].type == TYPE_RESISTANCE && barClose > levList[i].level)
         { levList[i].broken = true; levList[i].justBroken = true; }
   }

   // Pass 2: credit opposite active levels
   for(int i = 0; i < levTotal; i++)
   {
      if(!levList[i].justBroken) continue;

      if(levList[i].type == TYPE_SUPPORT)
      {
         double   bSup  = levList[i].level;
         datetime bTime = levList[i].levelTime;
         for(int j = 0; j < levTotal; j++)
         {
            if(levList[j].type   != TYPE_RESISTANCE) continue;
            if(levList[j].broken || levList[j].swept) continue;
            if(levList[j].confirmTime >= t)          continue;
            if(levList[j].level <= bSup)             continue;
            levList[j].sweepCount++;
            if(levList[j].sweptN < MAX_SWEPT)
            {
               levList[j].sweptPrices[levList[j].sweptN] = bSup;
               levList[j].sweptTimes [levList[j].sweptN] = bTime;
               levList[j].sweptN++;
            }
            if(levList[j].sweepCount >= InpMinBreaks)
               { FireSignal(j, -1, sh, t); levList[j].swept = true; }
         }
      }
      else
      {
         double   bRes  = levList[i].level;
         datetime bTime = levList[i].levelTime;
         for(int j = 0; j < levTotal; j++)
         {
            if(levList[j].type   != TYPE_SUPPORT) continue;
            if(levList[j].broken || levList[j].swept) continue;
            if(levList[j].confirmTime >= t)       continue;
            if(levList[j].level >= bRes)          continue;
            levList[j].sweepCount++;
            if(levList[j].sweptN < MAX_SWEPT)
            {
               levList[j].sweptPrices[levList[j].sweptN] = bRes;
               levList[j].sweptTimes [levList[j].sweptN] = bTime;
               levList[j].sweptN++;
            }
            if(levList[j].sweepCount >= InpMinBreaks)
               { FireSignal(j, 1, sh, t); levList[j].swept = true; }
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
   levTotal = 0; nextId = 0;
   int scan = MathMin(InpLookback, iBars(_Symbol, InpTF) - 2);
   if(scan < 2) return;
   for(int sh = scan; sh >= 1; sh--)
   { DetectLevels(sh + 1, sh); CheckSweeps(sh); AgeLevels(); }
}

//+------------------------------------------------------------------+
int OnInit()  { lastBarTime = 0; Rebuild(); return INIT_SUCCEEDED; }
void OnDeinit(const int reason) { ObjectsDeleteAll(0, OBJ_PREFIX); }

int OnCalculate(const int rates_total, const int prev_calculated,
                const datetime &time[], const double &open[],
                const double &high[], const double &low[],
                const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
{
   datetime curBar = iTime(_Symbol, InpTF, 0);
   if(curBar != lastBarTime)
   { lastBarTime = curBar; DetectLevels(2, 1); CheckSweeps(1); AgeLevels(); }
   return rates_total;
}
`;
}
