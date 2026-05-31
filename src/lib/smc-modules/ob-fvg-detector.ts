/**
 * SMC Combination Detector — OB + FVG v2.0.0
 *
 * An OB+FVG is simply a Fair Value Gap whose FIRST candle is the opposite
 * colour to the gap direction — that first candle IS the order block.
 *
 *   Bullish OB+FVG: a BULLISH FVG whose first candle (C1) is BEARISH.
 *   Bearish OB+FVG: a BEARISH FVG whose first candle (C1) is BULLISH.
 *
 * 3-candle FVG (C1 = oldest, C3 = newest):
 *   Bullish FVG: high(C1) < low(C3)  → gap = [high(C1), low(C3)]
 *   Bearish FVG: low(C1)  > high(C3) → gap = [high(C3), low(C1)]
 *
 * The OB is C1's body; entry is at the OB body.
 *
 * LIFECYCLE:
 *   ACTIVE → MITIGATED (price taps OB body) → INVALIDATED (close through OB) / EXPIRED
 */

export const OB_FVG_DETECTOR_VERSION = "2.0.0";
export const OB_FVG_DETECTOR_MODULE  = "OB_FVG_Detector";

export function generateObFvgDetector(): string {
  return `//+------------------------------------------------------------------+
//| OB_FVG_Detector.mq5                                            |
//| SMC Combination v${OB_FVG_DETECTOR_VERSION} — Order Block + FVG          |
//|                                                                  |
//| An FVG whose first candle is the opposite colour = the OB.     |
//| Bull OB+FVG: bullish FVG, bearish C1. Bear: bearish FVG, bull C1.|
//| Entry at the OB (C1) body.                                     |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SMC Combination"
#property version   "2.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define DIR_BULL    1
#define DIR_BEAR   -1
#define ST_ACTIVE   0
#define ST_MITIG    1
#define LVL_MAX    400
#define OBJ_PREFIX "SMCOBFVG_"

input ENUM_TIMEFRAMES InpTF          = PERIOD_CURRENT;
input int             InpLookback    = 500;
input int             InpExpiryBars  = 250;
input bool            InpDraw        = true;
input string          InpLabel       = "OB+FVG";
input int             InpFontSize    = 8;
input color           InpBullColor   = clrMediumSeaGreen;
input color           InpBearColor   = clrTomato;
input color           InpFvgColor    = clrSlateGray;   // FVG box tint
input bool            InpShowLog     = true;

struct ComboRec
{
   int      id;
   int      dir;
   int      state;
   double   obTop;        // OB (C1) body top
   double   obBot;        // OB (C1) body bottom (entry zone)
   double   obLo;         // C1 low  (invalidation ref)
   double   obHi;         // C1 high (invalidation ref)
   double   fvgTop;
   double   fvgBot;
   datetime obTime;       // C1 time (box left edge)
   datetime confirmTime;  // C3 time — valid only after this
   bool     dead;
   int      ageCounter;
};

ComboRec cmb[LVL_MAX];
int      cmbTotal   = 0;
int      nextId     = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
string ObBox(int id) { return OBJ_PREFIX + IntegerToString(id) + "_ob"; }
string FvBox(int id) { return OBJ_PREFIX + IntegerToString(id) + "_fv"; }
string Lbl  (int id) { return OBJ_PREFIX + IntegerToString(id) + "_lb"; }

//+------------------------------------------------------------------+
void Rect(string nm, datetime t1, double p1, datetime t2, double p2, color c, int style, bool fill)
{
   if(ObjectCreate(0, nm, OBJ_RECTANGLE, 0, t1, p1, t2, p2))
   {
      ObjectSetInteger(0, nm, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, nm, OBJPROP_STYLE,      style);
      ObjectSetInteger(0, nm, OBJPROP_WIDTH,      1);
      ObjectSetInteger(0, nm, OBJPROP_FILL,       fill);
      ObjectSetInteger(0, nm, OBJPROP_BACK,       true);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, nm, OBJPROP_HIDDEN,     true);
   }
}

void DrawCombo(int i)
{
   if(!InpDraw) return;
   color c = (cmb[i].dir == DIR_BULL) ? InpBullColor : InpBearColor;
   Rect(ObBox(cmb[i].id), cmb[i].obTime, cmb[i].obTop, cmb[i].confirmTime, cmb[i].obBot, c, STYLE_SOLID, true);
   Rect(FvBox(cmb[i].id), cmb[i].obTime, cmb[i].fvgTop, cmb[i].confirmTime, cmb[i].fvgBot, InpFvgColor, STYLE_DOT, true);
   double anchor = (cmb[i].dir == DIR_BULL) ? cmb[i].obBot : cmb[i].obTop;
   if(ObjectCreate(0, Lbl(cmb[i].id), OBJ_TEXT, 0, cmb[i].obTime, anchor))
   {
      ObjectSetString (0, Lbl(cmb[i].id), OBJPROP_TEXT,       InpLabel);
      ObjectSetInteger(0, Lbl(cmb[i].id), OBJPROP_COLOR,      c);
      ObjectSetInteger(0, Lbl(cmb[i].id), OBJPROP_FONTSIZE,   InpFontSize);
      ObjectSetInteger(0, Lbl(cmb[i].id), OBJPROP_ANCHOR,     cmb[i].dir == DIR_BULL ? ANCHOR_UPPER : ANCHOR_LOWER);
      ObjectSetInteger(0, Lbl(cmb[i].id), OBJPROP_SELECTABLE, false);
   }
}

void ExtendCombo(int i, datetime t)
{
   if(!InpDraw) return;
   if(ObjectFind(0, ObBox(cmb[i].id)) >= 0) ObjectSetInteger(0, ObBox(cmb[i].id), OBJPROP_TIME, 1, t);
   if(ObjectFind(0, FvBox(cmb[i].id)) >= 0) ObjectSetInteger(0, FvBox(cmb[i].id), OBJPROP_TIME, 1, t);
}

void KillCombo(int i)
{
   ObjectDelete(0, ObBox(cmb[i].id));
   ObjectDelete(0, FvBox(cmb[i].id));
   ObjectDelete(0, Lbl(cmb[i].id));
   cmb[i].dead = true;
}

//+------------------------------------------------------------------+
void AddCombo(int dir, double obTop, double obBot, double obLo, double obHi,
              double fvgTop, double fvgBot, datetime obT, datetime confT)
{
   for(int i = 0; i < cmbTotal; i++)
      if(cmb[i].obTime == obT && cmb[i].dir == dir && !cmb[i].dead) return;
   int idx = -1;
   for(int i = 0; i < cmbTotal; i++)
      if(cmb[i].dead) { idx = i; break; }
   if(idx < 0 && cmbTotal < LVL_MAX) idx = cmbTotal++;
   if(idx < 0) return;
   cmb[idx].id          = nextId++;
   cmb[idx].dir         = dir;
   cmb[idx].state       = ST_ACTIVE;
   cmb[idx].obTop       = obTop;
   cmb[idx].obBot       = obBot;
   cmb[idx].obLo        = obLo;
   cmb[idx].obHi        = obHi;
   cmb[idx].fvgTop      = fvgTop;
   cmb[idx].fvgBot      = fvgBot;
   cmb[idx].obTime      = obT;
   cmb[idx].confirmTime = confT;
   cmb[idx].dead        = false;
   cmb[idx].ageCounter  = 0;
   DrawCombo(idx);
   if(InpShowLog)
      PrintFormat("OBFVG_%s | obBody=[%.5f,%.5f] | fvg=[%.5f,%.5f] | %s",
         dir == DIR_BULL ? "BULL" : "BEAR", obBot, obTop, fvgBot, fvgTop,
         TimeToString(confT, TIME_DATE|TIME_MINUTES));
}

//+------------------------------------------------------------------+
// 3-candle FVG at C3 = sh (C2 = sh+1, C1 = sh+2).
// OB+FVG = FVG whose first candle C1 is the opposite colour.
void DetectObFvg(int sh)
{
   int avail = iBars(_Symbol, InpTF);
   if(sh + 2 >= avail) return;

   double c1o = iOpen (_Symbol, InpTF, sh + 2);
   double c1c = iClose(_Symbol, InpTF, sh + 2);
   double c1h = iHigh (_Symbol, InpTF, sh + 2);
   double c1l = iLow  (_Symbol, InpTF, sh + 2);
   double c3h = iHigh (_Symbol, InpTF, sh);
   double c3l = iLow  (_Symbol, InpTF, sh);
   datetime t1 = iTime(_Symbol, InpTF, sh + 2);  // C1 time
   datetime t3 = iTime(_Symbol, InpTF, sh);      // C3 time

   bool c1Bear = (c1c < c1o);
   bool c1Bull = (c1c > c1o);

   // Bullish OB+FVG: bullish FVG (gap up) with a BEARISH first candle
   if(c1h < c3l && c1Bear)
      AddCombo(DIR_BULL, c1o, c1c, c1l, c1h, c3l, c1h, t1, t3);

   // Bearish OB+FVG: bearish FVG (gap down) with a BULLISH first candle
   if(c1l > c3h && c1Bull)
      AddCombo(DIR_BEAR, c1c, c1o, c1l, c1h, c1l, c3h, t1, t3);
}

//+------------------------------------------------------------------+
// Fresh-zone rule: a setup is shown only while price has NOT returned to the OB.
// The instant price tests the OB body (wick into it) or trades through it, the
// zone is consumed and removed.
void Lifecycle(int sh)
{
   double hi = iHigh (_Symbol, InpTF, sh);
   double lo = iLow  (_Symbol, InpTF, sh);
   datetime t = iTime(_Symbol, InpTF, sh);

   for(int i = 0; i < cmbTotal; i++)
   {
      if(cmb[i].dead) continue;
      if(cmb[i].confirmTime >= t) continue;
      ExtendCombo(i, t);

      // Bull OB sits below: first contact is a wick reaching the body top.
      if(cmb[i].dir == DIR_BULL && lo <= cmb[i].obTop)
      {
         if(InpShowLog) PrintFormat("OBFVG_BULL_TESTED | body=%.5f | %s", cmb[i].obTop, TimeToString(t,TIME_DATE|TIME_MINUTES));
         KillCombo(i); continue;
      }
      // Bear OB sits above: first contact is a wick reaching the body bottom.
      if(cmb[i].dir == DIR_BEAR && hi >= cmb[i].obBot)
      {
         if(InpShowLog) PrintFormat("OBFVG_BEAR_TESTED | body=%.5f | %s", cmb[i].obBot, TimeToString(t,TIME_DATE|TIME_MINUTES));
         KillCombo(i); continue;
      }
   }
}

//+------------------------------------------------------------------+
void AgeLevels()
{
   if(InpExpiryBars <= 0) return;
   for(int i = 0; i < cmbTotal; i++)
   {
      if(cmb[i].dead) continue;
      cmb[i].ageCounter++;
      if(cmb[i].ageCounter >= InpExpiryBars) KillCombo(i);
   }
}

//+------------------------------------------------------------------+
void Rebuild()
{
   ObjectsDeleteAll(0, OBJ_PREFIX);
   cmbTotal = 0; nextId = 0;
   int scan = MathMin(InpLookback, iBars(_Symbol, InpTF) - 3);
   if(scan < 3) return;
   for(int sh = scan; sh >= 1; sh--)
      { DetectObFvg(sh); Lifecycle(sh); AgeLevels(); }
}

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
      { lastBarTime = curBar; DetectObFvg(1); Lifecycle(1); AgeLevels(); }
   return rates_total;
}
`;
}
