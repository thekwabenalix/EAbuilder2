/**
 * SNR Module Library — Phase 2: Rejection State Module
 *
 * Rejection_State_Module v1.0.0
 * ────────────────────────────────────────────────
 * Embeds Classic + Gap S/R level detection and fires a CONFIRMED signal when a
 * candle rejects a level (wick pierces it, close holds on the origin side, long
 * rejection wick). Two-candle SNR guard — never reacts on the formation's own
 * Candle B.
 *
 * Phase 3 buffer contract (read via iCustom):
 *   0 : BullConfirmBuf — 1.0 at a bullish rejection bar (off support)
 *   1 : BearConfirmBuf — 1.0 at a bearish rejection bar (off resistance)
 *   2 : BullSLBuf      — rejection wick low  (SL for bull entries)
 *   3 : BearSLBuf      — rejection wick high (SL for bear entries)
 *
 * Visual: the SNR level line (origin → reject candle) + a timeframe label
 *   (DRD/WRW/4R4/1R1/MRM/Rej) on the reject candle.
 *
 * NO trading logic — state tracking, signal buffers, and visualisation only.
 */

export const REJECTION_STATE_MODULE_VERSION = "1.0.0";
export const REJECTION_STATE_MODULE  = "Rejection_State_Module";

export function generateRejectionStateModule(): string {
  return `//+------------------------------------------------------------------+
//| Rejection_State_Module.mq5                                     |
//| SNR Module Library v${REJECTION_STATE_MODULE_VERSION} — Phase 2: State + Buffers |
//|                                                                  |
//| Wick pierces an S/R level, close holds → rejection CONFIRMED.   |
//| Buffers 0/1 = bull/bear confirm, 2/3 = bull/bear SL.            |
//| Levels = Classic (reversal) + Gap (continuation). Two-candle    |
//| guard — Candle B is never a rejection.                          |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SNR Module Library"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_buffers 4
#property indicator_plots   0

//--- Buffers (Phase 3 iCustom contract)
double BullConfirmBuf[];
double BearConfirmBuf[];
double BullSLBuf[];
double BearSLBuf[];

#define TYPE_SUPPORT      1
#define TYPE_RESISTANCE   2
#define LVL_MAX           600
#define OBJ_PREFIX        "SMCREJS_"

//--- Inputs — Detection
input ENUM_TIMEFRAMES InpTF           = PERIOD_CURRENT; // Timeframe
input int             InpLookback     = 500;            // Historical bars to scan
input double          InpMinWickRatio = 0.5;            // Rejection wick >= this fraction of range
input int             InpExpiryBars   = 150;            // Bars until a level expires (0 = never)
input bool            InpUseClassic   = true;           // Use Classic (reversal-pair) levels
input bool            InpUseGap       = true;           // Use Gap (continuation-pair) levels
//--- Inputs — Drawing
input bool            InpDraw         = true;           // Draw level lines + labels
input int             InpLineBars     = 6;              // Level line right extension (bars)
input int             InpLineWidth    = 2;              // Level line width
input string          InpLabelOverride= "";             // Custom label ("" = auto)
input int             InpFontSize     = 8;              // Label font size
input color           InpBullColor    = clrMediumSeaGreen; // Bullish rejection (support held)
input color           InpBearColor    = clrTomato;          // Bearish rejection (resistance held)
input bool            InpShowLog      = true;           // Print events to journal

//+------------------------------------------------------------------+
struct LevelRec
{
   int      id;
   int      type;        // TYPE_SUPPORT or TYPE_RESISTANCE
   double   level;       // Candle A close
   datetime levelTime;   // Candle A time (price origin)
   datetime confirmTime; // Candle B time — valid only AFTER this
   bool     broken;
   int      ageCounter;
};

LevelRec levList[LVL_MAX];
int      levTotal = 0;
int      nextId   = 0;

//+------------------------------------------------------------------+
string ObjLine(int id) { return OBJ_PREFIX + IntegerToString(id) + "_ln"; }
string ObjLbl (int id) { return OBJ_PREFIX + IntegerToString(id) + "_lb"; }

int CandleDir(int sh)
{
   double c = iClose(_Symbol, InpTF, sh);
   double o = iOpen (_Symbol, InpTF, sh);
   if(c > o) return  1;
   if(c < o) return -1;
   return 0;
}

string RejName()
{
   if(StringLen(InpLabelOverride) > 0) return InpLabelOverride;
   ENUM_TIMEFRAMES tf = (InpTF == PERIOD_CURRENT) ? (ENUM_TIMEFRAMES)Period() : InpTF;
   switch(tf)
   {
      case PERIOD_H1:  return "1R1";
      case PERIOD_H4:  return "4R4";
      case PERIOD_D1:  return "DRD";
      case PERIOD_W1:  return "WRW";
      case PERIOD_MN1: return "MRM";
      default:         return "Rej";
   }
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

   if(InpUseClassic)
   {
      if(dirA > 0 && dirB < 0) AddLevel(TYPE_RESISTANCE, lvl, tA, tB);
      if(dirA < 0 && dirB > 0) AddLevel(TYPE_SUPPORT,    lvl, tA, tB);
   }
   if(InpUseGap)
   {
      if(dirA > 0 && dirB > 0) AddLevel(TYPE_SUPPORT,    lvl, tA, tB);
      if(dirA < 0 && dirB < 0) AddLevel(TYPE_RESISTANCE, lvl, tA, tB);
   }
}

//+------------------------------------------------------------------+
void DrawRejection(int dir, double wickExtreme, datetime levelTime, datetime rejTime, double lvl)
{
   if(!InpDraw) return;
   int id = nextId++;
   string ln  = ObjLine(id);
   string lbl = ObjLbl(id);
   color c = (dir > 0) ? InpBullColor : InpBearColor;

   datetime tLeft  = (levelTime > 0 && levelTime < rejTime) ? levelTime : rejTime;
   datetime tRight = rejTime + (datetime)(PeriodSeconds(InpTF) * InpLineBars);
   if(ObjectCreate(0, ln, OBJ_TREND, 0, tLeft, lvl, tRight, lvl))
   {
      ObjectSetInteger(0, ln, OBJPROP_COLOR, c);
      ObjectSetInteger(0, ln, OBJPROP_WIDTH, InpLineWidth);
      ObjectSetInteger(0, ln, OBJPROP_RAY_RIGHT, false);
      ObjectSetInteger(0, ln, OBJPROP_RAY_LEFT,  false);
      ObjectSetInteger(0, ln, OBJPROP_BACK, false);
      ObjectSetInteger(0, ln, OBJPROP_SELECTABLE, false);
   }
   if(ObjectCreate(0, lbl, OBJ_TEXT, 0, rejTime, wickExtreme))
   {
      ObjectSetString (0, lbl, OBJPROP_TEXT, RejName());
      ObjectSetInteger(0, lbl, OBJPROP_COLOR, c);
      ObjectSetInteger(0, lbl, OBJPROP_FONTSIZE, InpFontSize);
      ObjectSetInteger(0, lbl, OBJPROP_ANCHOR, dir > 0 ? ANCHOR_UPPER : ANCHOR_LOWER);
      ObjectSetInteger(0, lbl, OBJPROP_SELECTABLE, false);
   }
}

//+------------------------------------------------------------------+
//| Check bar sh for a rejection; write buffers + draw.             |
//+------------------------------------------------------------------+
void CheckRejection(int sh)
{
   double o = iOpen (_Symbol, InpTF, sh);
   double c = iClose(_Symbol, InpTF, sh);
   double h = iHigh (_Symbol, InpTF, sh);
   double l = iLow  (_Symbol, InpTF, sh);
   datetime t = iTime(_Symbol, InpTF, sh);
   double range = h - l;
   if(range <= 0) return;
   double lowerWick = MathMin(o, c) - l;
   double upperWick = h - MathMax(o, c);
   int    bufN = ArraySize(BullConfirmBuf);

   for(int i = 0; i < levTotal; i++)
   {
      if(levList[i].broken) continue;
      // Two-candle guard — rejection must be AFTER Candle B.
      if(levList[i].confirmTime >= t) continue;
      double lvl = levList[i].level;

      if(levList[i].type == TYPE_SUPPORT)
      {
         if(l <= lvl && c > lvl && lowerWick >= range * InpMinWickRatio)
         {
            if(sh < bufN) { BullConfirmBuf[sh] = 1.0; BullSLBuf[sh] = l; }
            DrawRejection(1, l, levList[i].levelTime, t, lvl);
            if(InpShowLog)
               PrintFormat("REJECTION_BULL | %s | level=%.5f | sl=%.5f | time=%s",
                  RejName(), lvl, l, TimeToString(t, TIME_DATE|TIME_MINUTES));
         }
         if(c < lvl) levList[i].broken = true;
      }
      else // RESISTANCE
      {
         if(h >= lvl && c < lvl && upperWick >= range * InpMinWickRatio)
         {
            if(sh < bufN) { BearConfirmBuf[sh] = 1.0; BearSLBuf[sh] = h; }
            DrawRejection(-1, h, levList[i].levelTime, t, lvl);
            if(InpShowLog)
               PrintFormat("REJECTION_BEAR | %s | level=%.5f | sl=%.5f | time=%s",
                  RejName(), lvl, h, TimeToString(t, TIME_DATE|TIME_MINUTES));
         }
         if(c > lvl) levList[i].broken = true;
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
   levTotal = 0;
   nextId   = 0;
   ObjectsDeleteAll(0, OBJ_PREFIX);
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
   IndicatorSetString(INDICATOR_SHORTNAME, "Rejection_State v${REJECTION_STATE_MODULE_VERSION}");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   ObjectsDeleteAll(0, OBJ_PREFIX);
}

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

   // ── Full recalculation ──────────────────────────────────────────
   if(prev_calculated == 0)
   {
      ResetState();
      int limit = (int)MathMin((long)(rates_total - 2), (long)InpLookback);
      if(limit < 1) return rates_total;
      for(int sh = limit; sh >= 1; sh--)
      {
         DetectLevels(sh + 1, sh);
         CheckRejection(sh);
         AgeLevels();
      }
      return rates_total;
   }

   // ── Live: one bar just closed ───────────────────────────────────
   if(sh1IsNewBar())
   {
      DetectLevels(2, 1);
      CheckRejection(1);
      AgeLevels();
   }
   return rates_total;
}

//+------------------------------------------------------------------+
//| True once per newly-closed bar.                                 |
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
