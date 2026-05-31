/**
 * SMC Combination Detector — OB + FVG v1.0.0
 *
 * A high-probability confluence: an Order Block that has a Fair Value Gap
 * created by the SAME displacement.
 *   Bullish OB → bullish FVG sits ABOVE the OB.
 *   Bearish OB → bearish FVG sits BELOW the OB.
 * Entry is at the BODY of the OB.
 *
 * DETECTION (single displacement produces both):
 *   1. Displacement candle d: |close-open| >= InpDispMult x ATR.
 *   2. OB candle = last opposing candle before d (Bull OB = last bearish, etc.).
 *   3. FVG of the displacement: C1=d+1, C3=d-1
 *        Bullish: high(d+1) < low(d-1)  → gap = [high(d+1), low(d-1)]
 *        Bearish: low(d+1)  > high(d-1) → gap = [high(d-1), low(d+1)]
 *   Only when BOTH the OB and the FVG exist is a setup created.
 *
 * LIFECYCLE:
 *   ACTIVE → MITIGATED (price taps OB body) → INVALIDATED (close through OB) / EXPIRED
 */

export const OB_FVG_DETECTOR_VERSION = "1.0.0";
export const OB_FVG_DETECTOR_MODULE  = "OB_FVG_Detector";

export function generateObFvgDetector(): string {
  return `//+------------------------------------------------------------------+
//| OB_FVG_Detector.mq5                                            |
//| SMC Combination v${OB_FVG_DETECTOR_VERSION} — Order Block + FVG          |
//|                                                                  |
//| An OB paired with an FVG from the same displacement.           |
//| Bull: FVG above OB. Bear: FVG below OB. Entry at OB body.       |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SMC Combination"
#property version   "1.00"
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
input double          InpDispMult    = 1.5;            // Displacement body >= N x ATR
input int             InpDispAtrPer  = 14;
input int             InpObScanBack  = 5;              // Bars back from displacement for OB candle
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
   double   obTop;        // OB body top
   double   obBot;        // OB body bottom (entry zone = body)
   double   obLo;         // OB candle low  (invalidation ref)
   double   obHi;         // OB candle high (invalidation ref)
   double   fvgTop;
   double   fvgBot;
   datetime obTime;       // OB candle time (box left edge)
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

double CalcATR(int sh, int period)
{
   int avail = iBars(_Symbol, InpTF);
   if(avail < sh + period + 2) return 0.0;
   double sum = 0.0;
   for(int k = sh + 1; k <= sh + period; k++)
   {
      double h = iHigh(_Symbol, InpTF, k), l = iLow(_Symbol, InpTF, k);
      double pc = iClose(_Symbol, InpTF, k + 1);
      sum += MathMax(h - l, MathMax(MathAbs(h - pc), MathAbs(l - pc)));
   }
   return sum / (double)period;
}

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
// Treat bar d as a displacement candle; require BOTH an OB and an FVG.
void DetectAtDisplacement(int d)
{
   if(d < 2) return;                  // need C3 = d-1 closed
   double atr = CalcATR(d, InpDispAtrPer);
   if(atr <= 0.0) return;
   double dOpn = iOpen (_Symbol, InpTF, d);
   double dCls = iClose(_Symbol, InpTF, d);
   if(MathAbs(dCls - dOpn) < InpDispMult * atr) return;
   int dispDir = (dCls > dOpn) ? DIR_BULL : DIR_BEAR;

   // ── FVG of the displacement (C1=d+1, C3=d-1) ──────────────────
   double c1h = iHigh(_Symbol, InpTF, d + 1);
   double c1l = iLow (_Symbol, InpTF, d + 1);
   double c3h = iHigh(_Symbol, InpTF, d - 1);
   double c3l = iLow (_Symbol, InpTF, d - 1);
   double fvgTop = 0, fvgBot = 0;
   bool   hasFvg = false;
   if(dispDir == DIR_BULL && c1h < c3l) { fvgTop = c3l; fvgBot = c1h; hasFvg = true; }
   if(dispDir == DIR_BEAR && c1l > c3h) { fvgTop = c1l; fvgBot = c3h; hasFvg = true; }
   if(!hasFvg) return;

   // ── OB candle: last opposing candle before d ──────────────────
   int available = iBars(_Symbol, InpTF);
   int scanEnd   = d + InpObScanBack;
   if(scanEnd >= available - 1) scanEnd = available - 2;
   for(int j = d + 1; j <= scanEnd; j++)
   {
      double jOpn = iOpen (_Symbol, InpTF, j);
      double jCls = iClose(_Symbol, InpTF, j);
      if(dispDir == DIR_BULL && jCls < jOpn)   // bull OB = last bearish candle
      {
         AddCombo(DIR_BULL, jOpn, jCls, iLow(_Symbol,InpTF,j), iHigh(_Symbol,InpTF,j),
                  fvgTop, fvgBot, iTime(_Symbol,InpTF,j), iTime(_Symbol,InpTF,d - 1));
         return;
      }
      if(dispDir == DIR_BEAR && jCls > jOpn)   // bear OB = last bullish candle
      {
         AddCombo(DIR_BEAR, jCls, jOpn, iLow(_Symbol,InpTF,j), iHigh(_Symbol,InpTF,j),
                  fvgTop, fvgBot, iTime(_Symbol,InpTF,j), iTime(_Symbol,InpTF,d - 1));
         return;
      }
   }
}

//+------------------------------------------------------------------+
void Lifecycle(int sh)
{
   double hi = iHigh (_Symbol, InpTF, sh);
   double lo = iLow  (_Symbol, InpTF, sh);
   double cl = iClose(_Symbol, InpTF, sh);
   datetime t = iTime(_Symbol, InpTF, sh);

   for(int i = 0; i < cmbTotal; i++)
   {
      if(cmb[i].dead) continue;
      if(cmb[i].confirmTime >= t) continue;
      ExtendCombo(i, t);

      if(cmb[i].dir == DIR_BULL)
      {
         if(cl < cmb[i].obLo) { KillCombo(i); continue; }          // OB violated
         if(cmb[i].state == ST_ACTIVE && lo <= cmb[i].obTop)        // tapped OB body
         {
            cmb[i].state = ST_MITIG;
            if(InpShowLog) PrintFormat("OBFVG_BULL_ENTRY | body=%.5f | %s", cmb[i].obTop, TimeToString(t,TIME_DATE|TIME_MINUTES));
         }
      }
      else
      {
         if(cl > cmb[i].obHi) { KillCombo(i); continue; }
         if(cmb[i].state == ST_ACTIVE && hi >= cmb[i].obBot)
         {
            cmb[i].state = ST_MITIG;
            if(InpShowLog) PrintFormat("OBFVG_BEAR_ENTRY | body=%.5f | %s", cmb[i].obBot, TimeToString(t,TIME_DATE|TIME_MINUTES));
         }
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
   int scan = MathMin(InpLookback, iBars(_Symbol, InpTF) - InpObScanBack - 2);
   if(scan < 3) return;
   for(int sh = scan; sh >= 1; sh--)
      { DetectAtDisplacement(sh); Lifecycle(sh); AgeLevels(); }
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
      { lastBarTime = curBar; DetectAtDisplacement(2); Lifecycle(1); AgeLevels(); }
   return rates_total;
}
`;
}
