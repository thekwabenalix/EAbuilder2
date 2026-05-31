/**
 * SNR Module Library — Phase 1: RSS / SRR Detector v4.0.0
 *
 * RSS: Classic Resistance R (wick high = R's Candle A high) drives price to
 *      close-break ≥ InpMinBreaks Supports below it.
 * SRR: Classic Support S (wick low = S's Candle A low) rallies price to
 *      close-break ≥ InpMinBreaks Resistances above it.
 *
 * INVALIDATION:
 *   An RSS setup is eliminated when price CLOSES ABOVE the wick high of the
 *   driving Resistance R's formation candle.
 *   An SRR setup is eliminated when price CLOSES BELOW the wick low of the
 *   driving Support S's formation candle.
 *   Invalidation works both before and after the sweep fires:
 *   - Before: the level is excluded from sweep counting (drawings never appear)
 *   - After:  existing drawings are deleted
 */

export const RSS_SRR_DETECTOR_VERSION = "4.0.0";
export const RSS_SRR_DETECTOR_MODULE  = "RSS_SRR_Detector";

export function generateRssSrrDetector(): string {
  return `//+------------------------------------------------------------------+
//| RSS_SRR_Detector.mq5                                           |
//| SNR Module Library v${RSS_SRR_DETECTOR_VERSION} — Phase 1: Detection Only  |
//|                                                                  |
//| RSS: R drives 2+ S close-breaks below it.                      |
//| SRR: S drives 2+ R close-breaks above it.                      |
//| Setups eliminated when price closes beyond the driving level's  |
//| formation wick (above R wick high / below S wick low).          |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SNR Module Library"
#property version   "4.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define TYPE_SUPPORT      1
#define TYPE_RESISTANCE   2
#define LVL_MAX           600
#define MAX_SWEPT         10
#define OBJ_PREFIX        "SMCRSS_"

input ENUM_TIMEFRAMES InpTF          = PERIOD_CURRENT;
input int             InpLookback    = 500;
input int             InpMinBreaks   = 2;
input int             InpExpiryBars  = 150;
input bool            InpIgnoreDoji  = true;
input color           InpRSSColor    = clrTomato;
input color           InpSRRColor    = clrMediumSeaGreen;
input color           InpSweptColor  = clrDimGray;
input int             InpDrivWidth   = 2;
input int             InpSwpWidth    = 1;
input int             InpExtBars     = 20;
input int             InpFontSize    = 9;
input int             InpNoteFontSz  = 7;
input bool            InpShowLog     = true;

//+------------------------------------------------------------------+
struct LevelRec
{
   int      id;
   int      type;
   double   level;          // Candle A close (the SNR price)
   double   wickExtreme;    // Candle A high (for R) or low (for S)
                            // Close beyond this → setup invalidated
   datetime levelTime;
   datetime confirmTime;
   bool     broken;         // close-broke the level price
   bool     justBroken;
   bool     swept;          // already fired RSS/SRR signal
   bool     invalidated;    // wick extreme crossed → drawings removed
   int      ageCounter;
   int      sweepCount;
   double   sweptPrices[MAX_SWEPT];
   datetime sweptTimes [MAX_SWEPT];
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
void AddLevel(int type, double level, double wickExt, datetime tA, datetime tB)
{
   for(int i = 0; i < levTotal; i++)
      if(levList[i].levelTime == tA && levList[i].type == type) return;
   int idx = -1;
   for(int i = 0; i < levTotal; i++)
      if(levList[i].broken && !levList[i].swept) { idx = i; break; }
   if(idx < 0 && levTotal < LVL_MAX) idx = levTotal++;
   if(idx < 0) return;
   levList[idx].id           = nextId++;
   levList[idx].type         = type;
   levList[idx].level        = level;
   levList[idx].wickExtreme  = wickExt;
   levList[idx].levelTime    = tA;
   levList[idx].confirmTime  = tB;
   levList[idx].broken       = false;
   levList[idx].justBroken   = false;
   levList[idx].swept        = false;
   levList[idx].invalidated  = false;
   levList[idx].ageCounter   = 0;
   levList[idx].sweepCount   = 0;
   levList[idx].sweptN       = 0;
}

//+------------------------------------------------------------------+
void DetectLevels(int shA, int shB)
{
   int avail = iBars(_Symbol, InpTF);
   if(shA >= avail || shB < 0) return;
   int dirA = CandleDir(shA);
   int dirB = CandleDir(shB);
   if(dirA == 0 || dirB == 0) return;
   double   lvl  = iClose(_Symbol, InpTF, shA);
   double   wick = (dirA > 0) ? iHigh(_Symbol, InpTF, shA)  // Bull A → R: wick = high
                               : iLow (_Symbol, InpTF, shA); // Bear A → S: wick = low
   datetime tA   = iTime (_Symbol, InpTF, shA);
   datetime tB   = iTime (_Symbol, InpTF, shB);
   if(dirA > 0 && dirB < 0) AddLevel(TYPE_RESISTANCE, lvl, wick, tA, tB);
   if(dirA < 0 && dirB > 0) AddLevel(TYPE_SUPPORT,    lvl, wick, tA, tB);
}

//+------------------------------------------------------------------+
void DeleteSignalObjects(int id, int sweptN)
{
   ObjectDelete(0, DrvLine(id));
   ObjectDelete(0, DrvLbl (id));
   ObjectDelete(0, DrvNote(id));
   for(int k = 0; k < sweptN; k++)
   { ObjectDelete(0, SwpLine(id,k)); ObjectDelete(0, SwpLbl(id,k)); }
}

//+------------------------------------------------------------------+
// Mark levels invalid when price closes beyond their wick extreme.
// Before sweep: just flag — prevents the signal from ever drawing.
// After sweep:  flag + delete existing drawings.
void CheckInvalidations(int sh)
{
   double   c = iClose(_Symbol, InpTF, sh);
   datetime t = iTime (_Symbol, InpTF, sh);
   for(int j = 0; j < levTotal; j++)
   {
      if(levList[j].invalidated) continue;
      if(levList[j].confirmTime >= t) continue;
      bool hit = false;
      if(levList[j].type == TYPE_RESISTANCE && c > levList[j].wickExtreme) hit = true;
      if(levList[j].type == TYPE_SUPPORT    && c < levList[j].wickExtreme) hit = true;
      if(!hit) continue;
      levList[j].invalidated = true;
      if(levList[j].swept)   // drawings exist — delete them
         DeleteSignalObjects(levList[j].id, levList[j].sweptN);
   }
}

//+------------------------------------------------------------------+
void FireSignal(int drivIdx, int dir, int sh, datetime sigT)
{
   int    id    = levList[drivIdx].id;
   double drivL = levList[drivIdx].level;
   color  drivC = (dir < 0) ? InpRSSColor : InpSRRColor;

   string drivLabelTxt = (dir < 0) ? "R"             : "S";
   string noteTxt      = (dir < 0) ? "Possible Sell" : "Possible Buy";
   string swpLabelTxt  = (dir < 0) ? "S"             : "R";

   datetime tEnd = sigT + (datetime)(PeriodSeconds(InpTF) * InpExtBars);

   if(ObjectCreate(0, DrvLine(id), OBJ_TREND, 0, levList[drivIdx].levelTime, drivL, tEnd, drivL))
   {
      ObjectSetInteger(0, DrvLine(id), OBJPROP_COLOR,      drivC);
      ObjectSetInteger(0, DrvLine(id), OBJPROP_WIDTH,      InpDrivWidth);
      ObjectSetInteger(0, DrvLine(id), OBJPROP_STYLE,      STYLE_SOLID);
      ObjectSetInteger(0, DrvLine(id), OBJPROP_RAY_RIGHT,  false);
      ObjectSetInteger(0, DrvLine(id), OBJPROP_SELECTABLE, false);
   }
   if(ObjectCreate(0, DrvLbl(id), OBJ_TEXT, 0, tEnd, drivL))
   {
      ObjectSetString (0, DrvLbl(id), OBJPROP_TEXT,       drivLabelTxt);
      ObjectSetInteger(0, DrvLbl(id), OBJPROP_COLOR,      drivC);
      ObjectSetInteger(0, DrvLbl(id), OBJPROP_FONTSIZE,   InpFontSize);
      ObjectSetInteger(0, DrvLbl(id), OBJPROP_ANCHOR,     dir < 0 ? ANCHOR_LEFT_UPPER : ANCHOR_LEFT_LOWER);
      ObjectSetInteger(0, DrvLbl(id), OBJPROP_SELECTABLE, false);
   }
   if(ObjectCreate(0, DrvNote(id), OBJ_TEXT, 0, tEnd, drivL))
   {
      ObjectSetString (0, DrvNote(id), OBJPROP_TEXT,       noteTxt);
      ObjectSetInteger(0, DrvNote(id), OBJPROP_COLOR,      drivC);
      ObjectSetInteger(0, DrvNote(id), OBJPROP_FONTSIZE,   InpNoteFontSz);
      ObjectSetInteger(0, DrvNote(id), OBJPROP_ANCHOR,     dir < 0 ? ANCHOR_LEFT_LOWER : ANCHOR_LEFT_UPPER);
      ObjectSetInteger(0, DrvNote(id), OBJPROP_SELECTABLE, false);
   }
   for(int k = 0; k < levList[drivIdx].sweptN; k++)
   {
      double sp = levList[drivIdx].sweptPrices[k]; datetime st = levList[drivIdx].sweptTimes[k];
      if(ObjectCreate(0, SwpLine(id,k), OBJ_TREND, 0, st, sp, tEnd, sp))
      {
         ObjectSetInteger(0, SwpLine(id,k), OBJPROP_COLOR,      InpSweptColor);
         ObjectSetInteger(0, SwpLine(id,k), OBJPROP_WIDTH,      InpSwpWidth);
         ObjectSetInteger(0, SwpLine(id,k), OBJPROP_STYLE,      STYLE_SOLID);
         ObjectSetInteger(0, SwpLine(id,k), OBJPROP_RAY_RIGHT,  false);
         ObjectSetInteger(0, SwpLine(id,k), OBJPROP_SELECTABLE, false);
      }
      if(ObjectCreate(0, SwpLbl(id,k), OBJ_TEXT, 0, tEnd, sp))
      {
         ObjectSetString (0, SwpLbl(id,k), OBJPROP_TEXT,       swpLabelTxt);
         ObjectSetInteger(0, SwpLbl(id,k), OBJPROP_COLOR,      InpSweptColor);
         ObjectSetInteger(0, SwpLbl(id,k), OBJPROP_FONTSIZE,   InpFontSize);
         ObjectSetInteger(0, SwpLbl(id,k), OBJPROP_ANCHOR,     dir < 0 ? ANCHOR_LEFT_LOWER : ANCHOR_LEFT_UPPER);
         ObjectSetInteger(0, SwpLbl(id,k), OBJPROP_SELECTABLE, false);
      }
   }
   if(InpShowLog)
      PrintFormat("%s | driving=%.5f | wick=%.5f | swept=%d | time=%s",
         dir < 0 ? "RSS" : "SRR", drivL, levList[drivIdx].wickExtreme,
         levList[drivIdx].sweepCount, TimeToString(sigT, TIME_DATE|TIME_MINUTES));
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
      if(levList[i].broken || levList[i].invalidated) continue;
      if(levList[i].confirmTime >= t) continue;
      if(levList[i].type == TYPE_SUPPORT && barClose < levList[i].level)
         { levList[i].broken = true; levList[i].justBroken = true; }
      else if(levList[i].type == TYPE_RESISTANCE && barClose > levList[i].level)
         { levList[i].broken = true; levList[i].justBroken = true; }
   }

   // Pass 2: credit opposite active levels (not broken, not swept, not invalidated)
   for(int i = 0; i < levTotal; i++)
   {
      if(!levList[i].justBroken) continue;
      if(levList[i].type == TYPE_SUPPORT)
      {
         double bSup = levList[i].level; datetime bTime = levList[i].levelTime;
         for(int j = 0; j < levTotal; j++)
         {
            if(levList[j].type != TYPE_RESISTANCE) continue;
            if(levList[j].broken || levList[j].swept || levList[j].invalidated) continue;
            if(levList[j].confirmTime >= t || levList[j].level <= bSup) continue;
            levList[j].sweepCount++;
            if(levList[j].sweptN < MAX_SWEPT)
               { levList[j].sweptPrices[levList[j].sweptN]=bSup; levList[j].sweptTimes[levList[j].sweptN]=bTime; levList[j].sweptN++; }
            if(levList[j].sweepCount >= InpMinBreaks)
               { FireSignal(j, -1, sh, t); levList[j].swept = true; }
         }
      }
      else
      {
         double bRes = levList[i].level; datetime bTime = levList[i].levelTime;
         for(int j = 0; j < levTotal; j++)
         {
            if(levList[j].type != TYPE_SUPPORT) continue;
            if(levList[j].broken || levList[j].swept || levList[j].invalidated) continue;
            if(levList[j].confirmTime >= t || levList[j].level >= bRes) continue;
            levList[j].sweepCount++;
            if(levList[j].sweptN < MAX_SWEPT)
               { levList[j].sweptPrices[levList[j].sweptN]=bRes; levList[j].sweptTimes[levList[j].sweptN]=bTime; levList[j].sweptN++; }
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
      if(levList[i].broken || levList[i].swept || levList[i].invalidated) continue;
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
   {
      DetectLevels(sh + 1, sh);
      CheckInvalidations(sh);   // must run before CheckSweeps
      CheckSweeps(sh);
      AgeLevels();
   }
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
   {
      lastBarTime = curBar;
      DetectLevels(2, 1);
      CheckInvalidations(1);
      CheckSweeps(1);
      AgeLevels();
   }
   return rates_total;
}
`;
}
