// ─── FVG Inversion State Module ──────────────────────────────────────────────
// Phase 2 State Module — EAbuilder2
//
// Two-layer embedded detection:
//   Layer 1 — FVG detection: 3-candle gap pattern (same as FVG State Module)
//   Layer 2 — Inversion detection: FVG closed through on the far side → IFVG born
//
// IFVG lifecycle is identical to FVG State Module:
//   ACTIVE → RETESTED → CONFIRMED (Phase 3 signal)
//   ACTIVE → MITIGATED | INVALIDATED | EXPIRED (terminal)
//   Post-CONFIRMED → re-RETESTED → CONFIRMED (repeatable until terminal)
//
// Bullish IFVG  (from inverted bearish FVG):
//   Zone: UL = original C1.Low  LL = original C3.High
//   Zone flipped to support — price should return and close above UL.
//
// Bearish IFVG  (from inverted bullish FVG):
//   Zone: UL = original C3.Low  LL = original C1.High
//   Zone flipped to resistance — price should return and close below LL.
//
// Standard 4-buffer Phase 3 contract:
//   [0] BullConfirmBuf  [1] BearConfirmBuf  [2] BullSLBuf  [3] BearSLBuf

export const FVG_INVERSION_STATE_MODULE_VERSION = "1.00";
export const FVG_INVERSION_STATE_MODULE = "FVG_Inversion_State_Module";

export function generateFvgInversionStateModule(): string {
  return `
//+------------------------------------------------------------------+
//| FVG_Inversion_State_Module.mq5                                   |
//| Phase 2 FVG Inversion State Module — EAbuilder2                  |
//| v${FVG_INVERSION_STATE_MODULE_VERSION}                                               |
//|                                                                  |
//| Buffers (read via iCustom()):                                    |
//|   0 : BullConfirmBuf — 1.0 at bull IFVG CONFIRMED bar           |
//|   1 : BearConfirmBuf — 1.0 at bear IFVG CONFIRMED bar           |
//|   2 : BullSLBuf      — retestLow at bull confirmation bar       |
//|   3 : BearSLBuf      — retestHigh at bear confirmation bar      |
//+------------------------------------------------------------------+
#property copyright   "EAbuilder2"
#property version     "${FVG_INVERSION_STATE_MODULE_VERSION}"
#property strict
#property indicator_chart_window
#property indicator_buffers 4
#property indicator_plots   0

// ─── Indicator Buffers ────────────────────────────────────────────
double BullConfirmBuf[];
double BearConfirmBuf[];
double BullSLBuf[];
double BearSLBuf[];

// ─── Inputs ───────────────────────────────────────────────────────
input ENUM_TIMEFRAMES InpTimeframe      = PERIOD_CURRENT;    // Timeframe
input int             InpLookback       = 500;               // Bars to scan
input int             InpExpiryBars     = 100;               // Bars before EXPIRED
input bool            InpShowBull       = true;              // Show bull IFVG zones
input bool            InpShowBear       = true;              // Show bear IFVG zones
input bool            InpShowTerminal   = false;             // Show terminal zones
input color           InpBullColor      = clrMediumAquamarine; // Bull IFVG colour
input color           InpBearColor      = clrOrchid;           // Bear IFVG colour
input int             InpActiveFillAlpha   = 70;             // Active fill opacity 0–255
input int             InpTerminalFillAlpha = 25;             // Terminal fill opacity 0–255

// ─── States ───────────────────────────────────────────────────────
#define STATE_ACTIVE       0
#define STATE_RETESTED     1
#define STATE_CONFIRMED    2
#define STATE_MITIGATED    3
#define STATE_INVALIDATED  4
#define STATE_EXPIRED      5
#define STATE_UNDRAWN     -1

// ─── Object prefix (distinct from FVG State: SMCFVGS_) ───────────
#define OBJ_PREFIX   "SMCIFVGS_"
#define FAR_FUTURE   ((datetime)4102444800)

// ─── Internal FVG struct (detection layer only) ───────────────────
//  dir: 1 = bullish FVG   (UL=C3.Low, LL=C1.High)
//       -1 = bearish FVG  (UL=C1.Low, LL=C3.High)
struct FvgInternal
  {
   int      id;
   int      dir;
   double   ul;
   double   ll;
   datetime c1Time;    // C1 bar time — left edge, used for dedup and skip guard
   bool     inverted;
  };

// ─── IFVG record ──────────────────────────────────────────────────
struct IfvgRecord
  {
   int      id;
   int      dir;           // 1 = bull IFVG (support zone)  -1 = bear IFVG (resistance)
   double   ul;
   double   ll;
   int      state;
   int      drawnState;
   int      barsAlive;
   datetime fvgTime;       // original FVG C1 bar time (rectangle left edge)
   datetime inversionTime; // bar where FVG was inverted (skip guard for state update)
   datetime retestTime;
   double   retestHigh;
   double   retestLow;
   datetime confirmTime;
   datetime endTime;
  };

#define MAX_FVGS  1000
#define MAX_IFVGS  500

FvgInternal fvgList[MAX_FVGS];
int         fvgCount  = 0;
int         gNextFId  = 1;

IfvgRecord  ifvgList[MAX_IFVGS];
int         ifvgCount = 0;
int         gNextIId  = 1;

// ─── Inline bar accessors ─────────────────────────────────────────
double   Hi(int sh) { return iHigh (_Symbol, InpTimeframe, sh); }
double   Lo(int sh) { return iLow  (_Symbol, InpTimeframe, sh); }
double   Cl(int sh) { return iClose(_Symbol, InpTimeframe, sh); }
datetime Tm(int sh) { return iTime (_Symbol, InpTimeframe, sh); }

// ─── BlendWithBg ──────────────────────────────────────────────────
color BlendWithBg(color fg, int alpha)
  {
   color bg = (color)ChartGetInteger(0, CHART_COLOR_BACKGROUND);
   int r = (int)(((fg >> 16) & 0xFF) * alpha / 255 + ((bg >> 16) & 0xFF) * (255 - alpha) / 255);
   int g = (int)(((fg >>  8) & 0xFF) * alpha / 255 + ((bg >>  8) & 0xFF) * (255 - alpha) / 255);
   int b = (int)(( fg        & 0xFF) * alpha / 255 + ( bg        & 0xFF) * (255 - alpha) / 255);
   return (color)((r << 16) | (g << 8) | b);
  }

// ─── OnInit ───────────────────────────────────────────────────────
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

   for(int i = 0; i < 4; i++)
      PlotIndexSetDouble(i, PLOT_EMPTY_VALUE, 0.0);

   IndicatorSetString(INDICATOR_SHORTNAME,
                      "FVG_Inv_State v${FVG_INVERSION_STATE_MODULE_VERSION}");
   return(INIT_SUCCEEDED);
  }

// ─── OnDeinit ─────────────────────────────────────────────────────
void OnDeinit(const int reason)
  {
   ObjectsDeleteAll(0, OBJ_PREFIX);
  }

// ─── ResetState ───────────────────────────────────────────────────
void ResetState()
  {
   fvgCount  = 0;  gNextFId = 1;
   ifvgCount = 0;  gNextIId = 1;
   ObjectsDeleteAll(0, OBJ_PREFIX);
  }

// ─── DetectFvg ────────────────────────────────────────────────────
// At scan position sh, C3=sh, C2=sh+1, C1=sh+2.
// A gap exists when C3.Low > C1.High (bull) or C3.High < C1.Low (bear).
void DetectFvg(int sh)
  {
   int totalBars = Bars(_Symbol, InpTimeframe);
   if(sh + 2 >= totalBars) return;

   datetime c1T = Tm(sh + 2);

   // Dedup: skip inverted FVGs — their slot can be recycled
   for(int k = 0; k < fvgCount; k++)
     {
      if(fvgList[k].inverted) continue;
      if(fvgList[k].c1Time == c1T) return;
     }

   double c3Lo = Lo(sh);
   double c1Hi = Hi(sh + 2);
   double c3Hi = Hi(sh);
   double c1Lo = Lo(sh + 2);

   bool isBullGap = (c3Lo > c1Hi);
   bool isBearGap = (c3Hi < c1Lo);
   if(!isBullGap && !isBearGap) return;

   // Slot allocation: recycle an inverted FVG slot before appending
   int idx = -1;
   for(int k = 0; k < fvgCount; k++)
      if(fvgList[k].inverted) { idx = k; break; }
   if(idx < 0)
     {
      if(fvgCount >= MAX_FVGS) return;
      idx = fvgCount++;
     }

   // ── Bullish FVG ───────────────────────────────────────────
   if(isBullGap)
     {
      fvgList[idx].id       = gNextFId++;
      fvgList[idx].dir      = 1;
      fvgList[idx].ul       = c3Lo;  // C3.Low = top of gap
      fvgList[idx].ll       = c1Hi;  // C1.High = bottom of gap
      fvgList[idx].c1Time   = c1T;
      fvgList[idx].inverted = false;
      return;  // a 3-bar set can only produce one FVG type
     }

   // ── Bearish FVG ───────────────────────────────────────────
   fvgList[idx].id       = gNextFId++;
   fvgList[idx].dir      = -1;
   fvgList[idx].ul       = c1Lo;  // C1.Low = top of gap
   fvgList[idx].ll       = c3Hi;  // C3.High = bottom of gap
   fvgList[idx].c1Time   = c1T;
   fvgList[idx].inverted = false;
  }

// ─── CheckFvgInversion ────────────────────────────────────────────
// Close through the far edge of a non-inverted FVG → IFVG born.
//   Bullish FVG (UL=C3.Low, LL=C1.High): inverted when close < LL → Bear IFVG
//   Bearish FVG (UL=C1.Low, LL=C3.High): inverted when close > UL → Bull IFVG
void CheckFvgInversion(int sh)
  {
   double   closeV = Cl(sh);
   datetime barT   = Tm(sh);

   for(int k = 0; k < fvgCount; k++)
     {
      if(fvgList[k].inverted)          continue;
      if(fvgList[k].c1Time >= barT)    continue;  // FVG must pre-date bar

      bool doInvert = (fvgList[k].dir == 1  && closeV < fvgList[k].ll)
                   || (fvgList[k].dir == -1 && closeV > fvgList[k].ul);
      if(!doInvert) continue;

      // Recycle a terminal IFVG slot before appending
      int iIdx = -1;
      for(int m = 0; m < ifvgCount; m++)
        {
         int ist = ifvgList[m].state;
         if(ist == STATE_MITIGATED || ist == STATE_INVALIDATED || ist == STATE_EXPIRED)
            { iIdx = m; break; }
        }
      if(iIdx < 0)
        {
         if(ifvgCount >= MAX_IFVGS) { fvgList[k].inverted = true; continue; }
         iIdx = ifvgCount++;
        }

      ifvgList[iIdx].id             = gNextIId++;
      ifvgList[iIdx].dir            = (fvgList[k].dir == 1) ? -1 : 1;
      ifvgList[iIdx].ul             = fvgList[k].ul;
      ifvgList[iIdx].ll             = fvgList[k].ll;
      ifvgList[iIdx].state          = STATE_ACTIVE;
      ifvgList[iIdx].drawnState     = STATE_UNDRAWN;
      ifvgList[iIdx].barsAlive      = 0;
      ifvgList[iIdx].fvgTime        = fvgList[k].c1Time;
      ifvgList[iIdx].inversionTime  = barT;
      ifvgList[iIdx].retestTime     = 0;
      ifvgList[iIdx].retestHigh     = 0.0;
      ifvgList[iIdx].retestLow      = 0.0;
      ifvgList[iIdx].confirmTime    = 0;
      ifvgList[iIdx].endTime        = FAR_FUTURE;

      fvgList[k].inverted = true;
      PrintFormat(ifvgList[iIdx].dir == -1
                  ? "IFVG_BEAR_ACTIVE | id=%d | ul=%.5f | ll=%.5f | inv=%s"
                  : "IFVG_BULL_ACTIVE | id=%d | ul=%.5f | ll=%.5f | inv=%s",
                  gNextIId - 1, fvgList[k].ul, fvgList[k].ll, TimeToString(barT));
     }
  }

// ─── UpdateIfvgStates ─────────────────────────────────────────────
void UpdateIfvgStates(int sh)
  {
   double   barHigh  = Hi(sh);
   double   barLow   = Lo(sh);
   double   barClose = Cl(sh);
   datetime barT     = Tm(sh);

   for(int i = 0; i < ifvgCount; i++)
     {
      int st = ifvgList[i].state;
      if(st == STATE_MITIGATED || st == STATE_INVALIDATED || st == STATE_EXPIRED)
         continue;

      // Skip guard: don't process IFVG on the inversion bar itself
      if(ifvgList[i].inversionTime >= barT) continue;

      bool   isBull = (ifvgList[i].dir == 1);
      double ul     = ifvgList[i].ul;
      double ll     = ifvgList[i].ll;

      ifvgList[i].barsAlive++;

      // ── Expiry ───────────────────────────────────────────
      if(ifvgList[i].barsAlive >= InpExpiryBars)
        {
         ifvgList[i].state   = STATE_EXPIRED;
         ifvgList[i].endTime = barT;
         PrintFormat(isBull ? "IFVG_BULL_EXPIRED | id=%d"
                            : "IFVG_BEAR_EXPIRED | id=%d",
                     ifvgList[i].id);
         DrawOne(i);
         continue;
        }

      // ── State transitions ─────────────────────────────────
      if(isBull)
        {
         // Invalidation: close below LL
         if(barClose < ll)
           {
            ifvgList[i].state   = STATE_INVALIDATED;
            ifvgList[i].endTime = barT;
            PrintFormat("IFVG_BULL_INVALIDATED | id=%d", ifvgList[i].id);
            DrawOne(i);
            continue;
           }
         // Mitigation: close inside zone
         if(barClose >= ll && barClose <= ul)
           {
            ifvgList[i].state   = STATE_MITIGATED;
            ifvgList[i].endTime = barT;
            PrintFormat("IFVG_BULL_MITIGATED | id=%d", ifvgList[i].id);
            DrawOne(i);
            continue;
           }
         // CONFIRMED from RETESTED: close above UL
         if(st == STATE_RETESTED && barClose > ul)
           {
            ifvgList[i].state       = STATE_CONFIRMED;
            ifvgList[i].confirmTime = barT;
            if(sh < ArraySize(BullConfirmBuf)) BullConfirmBuf[sh] = 1.0;
            if(sh < ArraySize(BullSLBuf))
               BullSLBuf[sh] = ifvgList[i].retestLow;
            PrintFormat("IFVG_BULL_CONFIRMED | id=%d | retestLow=%.5f | sh=%d",
                        ifvgList[i].id, ifvgList[i].retestLow, sh);
            DrawOne(i);
            continue;
           }
         // RETESTED (from ACTIVE or re-RETESTED from CONFIRMED):
         // wick enters zone from above
         if(barLow <= ul)
           {
            if(st != STATE_RETESTED)
              {
               ifvgList[i].state      = STATE_RETESTED;
               ifvgList[i].retestTime = barT;
               ifvgList[i].retestLow  = barLow;
               ifvgList[i].retestHigh = barHigh;
               PrintFormat("IFVG_BULL_RETESTED | id=%d | retestLow=%.5f",
                           ifvgList[i].id, barLow);
               DrawOne(i);
              }
            else
              {
               // Accumulate wick extremes
               if(barLow  < ifvgList[i].retestLow)  ifvgList[i].retestLow  = barLow;
               if(barHigh > ifvgList[i].retestHigh) ifvgList[i].retestHigh = barHigh;
              }
           }
        }
      else // isBear
        {
         // Invalidation: close above UL
         if(barClose > ul)
           {
            ifvgList[i].state   = STATE_INVALIDATED;
            ifvgList[i].endTime = barT;
            PrintFormat("IFVG_BEAR_INVALIDATED | id=%d", ifvgList[i].id);
            DrawOne(i);
            continue;
           }
         // Mitigation: close inside zone
         if(barClose >= ll && barClose <= ul)
           {
            ifvgList[i].state   = STATE_MITIGATED;
            ifvgList[i].endTime = barT;
            PrintFormat("IFVG_BEAR_MITIGATED | id=%d", ifvgList[i].id);
            DrawOne(i);
            continue;
           }
         // CONFIRMED from RETESTED: close below LL
         if(st == STATE_RETESTED && barClose < ll)
           {
            ifvgList[i].state       = STATE_CONFIRMED;
            ifvgList[i].confirmTime = barT;
            if(sh < ArraySize(BearConfirmBuf)) BearConfirmBuf[sh] = 1.0;
            if(sh < ArraySize(BearSLBuf))
               BearSLBuf[sh] = ifvgList[i].retestHigh;
            PrintFormat("IFVG_BEAR_CONFIRMED | id=%d | retestHigh=%.5f | sh=%d",
                        ifvgList[i].id, ifvgList[i].retestHigh, sh);
            DrawOne(i);
            continue;
           }
         // RETESTED: wick enters zone from below
         if(barHigh >= ll)
           {
            if(st != STATE_RETESTED)
              {
               ifvgList[i].state      = STATE_RETESTED;
               ifvgList[i].retestTime = barT;
               ifvgList[i].retestLow  = barLow;
               ifvgList[i].retestHigh = barHigh;
               PrintFormat("IFVG_BEAR_RETESTED | id=%d | retestHigh=%.5f",
                           ifvgList[i].id, barHigh);
               DrawOne(i);
              }
            else
              {
               if(barLow  < ifvgList[i].retestLow)  ifvgList[i].retestLow  = barLow;
               if(barHigh > ifvgList[i].retestHigh) ifvgList[i].retestHigh = barHigh;
              }
           }
        }
     }
  }

// ─── DrawOne ──────────────────────────────────────────────────────
void DrawOne(int idx)
  {
   if(idx < 0 || idx >= ifvgCount) return;

   bool  isBull   = (ifvgList[idx].dir == 1);
   int   st       = ifvgList[idx].state;
   bool  terminal = (st == STATE_MITIGATED || st == STATE_INVALIDATED || st == STATE_EXPIRED);

   if(terminal)
     {
      string _nm  = OBJ_PREFIX + IntegerToString(ifvgList[idx].id);
      string _lnm = OBJ_PREFIX + "L" + IntegerToString(ifvgList[idx].id);
      ObjectDelete(0, _nm);
      ObjectDelete(0, _lnm);
      ifvgList[idx].drawnState = st;
      if(!InpShowTerminal) return;
     }
   if( isBull  && !InpShowBull)     return;
   if(!isBull  && !InpShowBear)     return;
   if(st == ifvgList[idx].drawnState) return;

   color baseColor = isBull ? InpBullColor : InpBearColor;

   color fillColor;
   ENUM_LINE_STYLE borderStyle = STYLE_SOLID;
   int   borderWidth = 1;

   if(terminal)
     {
      fillColor   = BlendWithBg(baseColor, InpTerminalFillAlpha);
      borderStyle = STYLE_DOT;
     }
   else if(st == STATE_RETESTED)
     {
      fillColor = BlendWithBg(clrGold, InpActiveFillAlpha);
     }
   else if(st == STATE_CONFIRMED)
     {
      fillColor   = BlendWithBg(baseColor, InpActiveFillAlpha);
      borderWidth = 2;
     }
   else
     {
      fillColor = BlendWithBg(baseColor, InpActiveFillAlpha);
     }

   string   name  = OBJ_PREFIX + IntegerToString(ifvgList[idx].id);
   string   lname = OBJ_PREFIX + "L" + IntegerToString(ifvgList[idx].id);
   datetime right = terminal ? ifvgList[idx].endTime : FAR_FUTURE;

   // ── Rectangle ─────────────────────────────────────────────
   if(ObjectFind(0, name) < 0)
      ObjectCreate(0, name, OBJ_RECTANGLE, 0,
                   ifvgList[idx].fvgTime, ifvgList[idx].ul,
                   right,                 ifvgList[idx].ll);
   else
      ObjectSetInteger(0, name, OBJPROP_TIME, 1, right);

   ObjectSetInteger(0, name, OBJPROP_COLOR,      baseColor);
   ObjectSetInteger(0, name, OBJPROP_BGCOLOR,    fillColor);
   ObjectSetInteger(0, name, OBJPROP_STYLE,      borderStyle);
   ObjectSetInteger(0, name, OBJPROP_WIDTH,      borderWidth);
   ObjectSetInteger(0, name, OBJPROP_BACK,       1);
   ObjectSetInteger(0, name, OBJPROP_FILL,       1);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, 0);
   ObjectSetInteger(0, name, OBJPROP_HIDDEN,     1);

   // ── Label ─────────────────────────────────────────────────
   string ltext;
   if(st == STATE_ACTIVE)         ltext = isBull ? "IFVG↑" : "IFVG↓";
   else if(st == STATE_RETESTED)  ltext = "IFVG-T";
   else if(st == STATE_CONFIRMED) ltext = "IFVG-C";
   else if(st == STATE_MITIGATED) ltext = "IFVG-M";
   else if(st == STATE_INVALIDATED) ltext = "IFVG-X";
   else                           ltext = "IFVG-E";

   if(ObjectFind(0, lname) < 0)
      ObjectCreate(0, lname, OBJ_TEXT, 0,
                   ifvgList[idx].fvgTime, ifvgList[idx].ul);
   ObjectSetString (0, lname, OBJPROP_TEXT,       ltext);
   ObjectSetInteger(0, lname, OBJPROP_COLOR,      baseColor);
   ObjectSetInteger(0, lname, OBJPROP_ANCHOR,     ANCHOR_LEFT);
   ObjectSetInteger(0, lname, OBJPROP_FONTSIZE,   8);
   ObjectSetInteger(0, lname, OBJPROP_SELECTABLE, 0);
   ObjectSetInteger(0, lname, OBJPROP_HIDDEN,     1);

   ifvgList[idx].drawnState = st;
  }

// ─── DrawAll ──────────────────────────────────────────────────────
void DrawAll()
  {
   for(int i = 0; i < ifvgCount; i++) DrawOne(i);
  }

// ─── OnCalculate ──────────────────────────────────────────────────
int OnCalculate(const int rates_total,
                const int prev_calculated,
                const datetime& time[],
                const double& open[],
                const double& high[],
                const double& low[],
                const double& close[],
                const long& tick_volume[],
                const long& volume[],
                const int& spread[])
  {
   if(rates_total < 4) return(0);

   // ── Full recalculation ────────────────────────────────────
   if(prev_calculated == 0)
     {
      ResetState();
      int limit = (int)MathMin((long)(rates_total - 3), (long)InpLookback);
      if(limit < 1) return(rates_total);

      // Chronological loop oldest → newest.
      // DetectFvg at sh: C3=sh, C2=sh+1, C1=sh+2.
      // CheckFvgInversion at sh: tests close against all non-inverted FVGs.
      // UpdateIfvgStates at sh: advances IFVG state machine.
      for(int sh = limit; sh >= 1; sh--)
        {
         DetectFvg(sh);
         CheckFvgInversion(sh);
         UpdateIfvgStates(sh);
        }

      DrawAll();
      return(rates_total);
     }

   // ── Live: one bar just closed ─────────────────────────────
   DetectFvg(1);
   CheckFvgInversion(1);
   UpdateIfvgStates(1);
   for(int i = ifvgCount - 1; i >= 0; i--)
     {
      if(ifvgList[i].drawnState != ifvgList[i].state) DrawOne(i);
     }

   return(rates_total);
  }
`.trim();
}
