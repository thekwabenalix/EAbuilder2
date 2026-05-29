/**
 * Phase 2 State Modules — Breakout / RBS / SBR State Module
 *
 * Breakout_State_Module v1.0.0
 * ─────────────────────────────────────────────────────────────────
 * Embeds Classic SNR detection + breakout detection and manages
 * the full RBS / SBR flip-zone lifecycle per breakout event.
 *
 * EMBEDDED DETECTION:
 *   Classic SNR: candle-pair direction reversal (same as Breakout_Detector).
 *   Breakout:    close > resistance → Bullish BO
 *                close < support    → Bearish BO
 *   Wick breaks do NOT count (close-only confirmation by default).
 *
 * STATE MACHINE (7 internal states):
 *   STATE_ACTIVE     (0) — breakout bar fired, waiting for flip confirmation
 *   STATE_FLIP       (6) — first hold confirmed → RBS / SBR zone is live
 *   STATE_RETESTED   (1) — price wicked back to the level from correct side
 *                          Bull (RBS): barLow  ≤ level
 *                          Bear (SBR): barHigh ≥ level
 *   STATE_CONFIRMED  (2) — retest held → close back on correct side
 *                          Bull: close > level  |  Bear: close < level
 *                          ← Phase 3 buffer written here
 *   STATE_INVALIDATED(4) — close back through broken level [terminal]
 *   STATE_EXPIRED    (5) — barsAlive ≥ InpExpiryBars [terminal]
 *
 * State cycle:
 *   ACTIVE → FLIP → RETESTED → CONFIRMED → (re-RETESTED → CONFIRMED ...)*
 *   Any live state → INVALIDATED / EXPIRED
 *
 *   CONFIRMED fires the Phase 3 signal buffer.
 *   The SL is the retest wick (retestLow for bull, retestHigh for bear).
 *
 * PHASE 3 BUFFERS (same 4-buffer contract):
 *   Buffer 0  BullConfirmBuf[sh] = 1.0 when bull RBS retest is confirmed
 *   Buffer 1  BearConfirmBuf[sh] = 1.0 when bear SBR retest is confirmed
 *   Buffer 2  BullSLBuf[sh]      = retestLow  at confirm bar
 *   Buffer 3  BearSLBuf[sh]      = retestHigh at confirm bar
 *
 * VISUALS:
 *   OBJ_TREND line at the broken level (snrOriginTime → right / endTime).
 *   State → colour + width:
 *     ACTIVE:      original breakout colour, width 1
 *     FLIP:        RBS=MediumSeaGreen / SBR=OrangeRed, width 2
 *     RETESTED:    Gold, width 1
 *     CONFIRMED:   LimeGreen / OrangeRed, width 2  (same as FLIP but signals "held")
 *     INVALIDATED / EXPIRED: DimGray, STYLE_DASH, width 1
 *
 * JOURNAL:
 *   BREAKOUT_CREATED | RBS_FLIP | SBR_FLIP
 *   RBS_RETESTED | SBR_RETESTED | RBS_CONFIRMED | SBR_CONFIRMED
 *   RBS_INVALIDATED | SBR_INVALIDATED | RBS_EXPIRED | SBR_EXPIRED
 *   BREAKOUT_INVALIDATED | BREAKOUT_EXPIRED  (never reached FLIP state)
 *
 * NO trading logic. State tracking and visualisation only.
 */

export const BREAKOUT_STATE_MODULE_VERSION = "1.0.0";
export const BREAKOUT_STATE_MODULE         = "Breakout_State_Module";

export function generateBreakoutStateModule(): string {
  return `//+------------------------------------------------------------------+
//| Breakout_State_Module.mq5                                        |
//| Phase 2: Breakout / RBS / SBR State Module v${BREAKOUT_STATE_MODULE_VERSION}        |
//|                                                                  |
//| Embeds Classic SNR detection + breakout detection.              |
//| Tracks full RBS / SBR flip-zone lifecycle.                      |
//|                                                                  |
//| Phase 3 signal: retest of a confirmed flip zone holds           |
//| Buffer 0/1: BullConfirm / BearConfirm at retest-held bar.      |
//| Buffer 2/3: BullSL / BearSL (retest wick price).               |
//| NO trading logic. State tracking and visualisation only.        |
//+------------------------------------------------------------------+
#property copyright "EA Builder — Phase 2 State Module"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_buffers 4
#property indicator_plots   0

// ── Embedded Classic SNR types ────────────────────────────────────
#define SNR_SUPPORT      1
#define SNR_RESISTANCE   2

// ── Lifecycle states ──────────────────────────────────────────────
#define STATE_ACTIVE       0   // breakout bar, waiting for flip confirmation
#define STATE_FLIP         6   // flip confirmed (RBS / SBR live) — internal
#define STATE_RETESTED     1   // price wicked to level from correct side
#define STATE_CONFIRMED    2   // retest held — Phase 3 signal fires
#define STATE_INVALIDATED  4   // close back through level [terminal]
#define STATE_EXPIRED      5   // aged out [terminal]
#define STATE_UNDRAWN     -1

#define SNR_MAX  600
#define BO_MAX   300
#define FAR_FUTURE ((datetime)4102444800)

//+------------------------------------------------------------------+
//| Embedded Classic SNR record                                      |
//+------------------------------------------------------------------+
struct SnrLevel
{
   int      id;
   int      type;
   double   price;
   datetime candleATime;
   datetime candleBTime;
   bool     broken;
};

//+------------------------------------------------------------------+
//| Breakout / flip-zone state record                                |
//+------------------------------------------------------------------+
struct BoStateRecord
{
   int      id;
   int      snrId;
   int      dir;             // +1 Bull (RBS), -1 Bear (SBR)
   int      state;
   int      drawnState;
   int      barsAlive;
   double   level;           // broken S/R price
   datetime snrOriginTime;   // Classic SNR candle A — left anchor of line
   datetime breakoutTime;    // bar when breakout fired
   datetime retestTime;
   double   retestHigh;
   double   retestLow;
   datetime confirmTime;
   datetime endTime;
};

//+------------------------------------------------------------------+
//| Phase 3 indicator buffers                                        |
//+------------------------------------------------------------------+
double BullConfirmBuf[];
double BearConfirmBuf[];
double BullSLBuf[];
double BearSLBuf[];

//--- Inputs — Timeframe & history
input ENUM_TIMEFRAMES InpTF       = PERIOD_CURRENT; // Timeframe
input int             InpLookback = 500;            // Historical bars to scan

//--- Inputs — Classic SNR / Breakout Detection
input bool InpIgnoreDoji  = true;   // Skip doji / neutral candles
input int  InpDojiPoints  = 0;      // Doji body threshold in points (0 = exact)
input bool InpShowBull    = true;   // Track bullish breakouts (RBS)
input bool InpShowBear    = true;   // Track bearish breakouts (SBR)

//--- Inputs — Breakout Filters
input int    InpMinBodyPts   = 0;     // Min breakout candle body (points, 0 = off)
input int    InpMinBreakDist = 0;     // Min close distance beyond level (points, 0 = off)
input bool   InpUseAtrFilt   = false; // Use ATR-based minimum distance filter
input double InpAtrMult      = 0.5;   // ATR multiplier (when InpUseAtrFilt = true)
input int    InpAtrPeriod    = 14;    // ATR period

//--- Inputs — Lifecycle
input int  InpExpiryBars    = 100;   // Bars until expired (0 = never)
input bool InpRemoveTerminal = true; // Delete objects on terminal state
input int  InpMaxZones      = 100;   // Max live breakouts

//--- Inputs — Colours
input color InpBullColor   = clrDodgerBlue;      // ACTIVE bull breakout
input color InpBearColor   = clrCrimson;          // ACTIVE bear breakout
input color InpRbsColor    = clrMediumSeaGreen;   // FLIP: RBS zone
input color InpSbrColor    = clrOrangeRed;         // FLIP: SBR zone
input color InpRetestColor = clrGold;              // RETESTED level
input color InpConfirmBull = clrLimeGreen;         // CONFIRMED bull (retest held)
input color InpConfirmBear = clrOrangeRed;         // CONFIRMED bear (retest held)
input color InpInvalidColor = clrDimGray;          // INVALIDATED / EXPIRED
input int   InpActiveOpacity = 85;                 // Active line opacity 0-100
input int   InpFadeOpacity   = 30;                 // Terminal line opacity 0-100

//--- Inputs — Logging
input bool InpShowLog = true;

SnrLevel      snrList[SNR_MAX];
BoStateRecord boList [BO_MAX];
int      snrTotal    = 0;
int      boTotal     = 0;
int      nextSnrId   = 0;
int      nextBoId    = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
string DirStr (int d) { return d > 0 ? "BULL" : "BEAR"; }
string ZoneName(int d) { return d > 0 ? "RBS" : "SBR"; }
string ObjLine (int id) { return "SMCBOS_" + IntegerToString(id) + "_ln"; }
string ObjLbl  (int id) { return "SMCBOS_" + IntegerToString(id) + "_lb"; }

color BlendWithBg(color base, int opacityPct)
{
   color  bg = (color)ChartGetInteger(0, CHART_COLOR_BACKGROUND);
   double t  = MathMax(0.0, MathMin(100.0, (double)opacityPct)) / 100.0;
   int r = (int)(((int)( base        & 0xFF)) * t + ((int)( bg        & 0xFF)) * (1.0 - t));
   int g = (int)(((int)((base >>  8) & 0xFF)) * t + ((int)((bg >>  8) & 0xFF)) * (1.0 - t));
   int b = (int)(((int)((base >> 16) & 0xFF)) * t + ((int)((bg >> 16) & 0xFF)) * (1.0 - t));
   return (color)(r | (g << 8) | (b << 16));
}

double CalcATR(int sh, int period)
{
   int avail = iBars(_Symbol, InpTF);
   if(sh + period + 1 >= avail || period <= 0) return _Point;
   double sum = 0.0;
   for(int i = 0; i < period; i++)
   {
      double h  = iHigh (_Symbol, InpTF, sh + i);
      double l  = iLow  (_Symbol, InpTF, sh + i);
      double pc = iClose(_Symbol, InpTF, sh + i + 1);
      sum += MathMax(h - l, MathMax(MathAbs(h - pc), MathAbs(l - pc)));
   }
   return sum / period;
}

int CandleDir(int sh)
{
   double c    = iClose(_Symbol, InpTF, sh);
   double o    = iOpen (_Symbol, InpTF, sh);
   double body = MathAbs(c - o);
   if(InpIgnoreDoji)
   {
      double thr = (InpDojiPoints > 0) ? InpDojiPoints * _Point : 0.0;
      if(body <= thr) return 0;
   }
   return (c > o) ? 1 : (c < o) ? -1 : 0;
}

//+------------------------------------------------------------------+
//| Breakout quality filters                                         |
//+------------------------------------------------------------------+
bool BreakoutFilter(int sh, double level, int dir)
{
   double closeP = iClose(_Symbol, InpTF, sh);
   double dist   = dir > 0 ? (closeP - level) : (level - closeP);

   if(InpMinBodyPts > 0 &&
      MathAbs(closeP - iOpen(_Symbol, InpTF, sh)) < InpMinBodyPts * _Point)
      return false;

   if(InpMinBreakDist > 0 && dist < InpMinBreakDist * _Point)
      return false;

   if(InpUseAtrFilt && dist < InpAtrMult * CalcATR(sh, InpAtrPeriod))
      return false;

   return true;
}

//+------------------------------------------------------------------+
//| Classic SNR detection — candle-pair direction reversal          |
//| shA = older candle (A), shB = newer candle (B)                  |
//+------------------------------------------------------------------+
void AddSnrLevel(int shA, int shB)
{
   int avail = iBars(_Symbol, InpTF);
   if(shA >= avail || shB < 0) return;

   int dirA = CandleDir(shA);
   int dirB = CandleDir(shB);
   if(dirA == 0 || dirB == 0) return;

   int snrType = 0;
   if(dirA > 0 && dirB < 0) snrType = SNR_RESISTANCE;
   if(dirA < 0 && dirB > 0) snrType = SNR_SUPPORT;
   if(snrType == 0) return;

   double   lvl   = iClose(_Symbol, InpTF, shA);
   datetime timeA = iTime (_Symbol, InpTF, shA);
   datetime timeB = iTime (_Symbol, InpTF, shB);

   // Dedup: skip broken levels — their slot can be recycled
   for(int i = 0; i < snrTotal; i++)
   {
      if(snrList[i].broken) continue;
      if(snrList[i].candleATime == timeA && snrList[i].type == snrType) return;
   }

   // Slot allocation: recycle a broken SNR slot before appending
   int idx = -1;
   for(int i = 0; i < snrTotal; i++)
      if(snrList[i].broken) { idx = i; break; }
   if(idx < 0)
   {
      if(snrTotal >= SNR_MAX) return;
      idx = snrTotal++;
   }
   snrList[idx].id          = nextSnrId++;
   snrList[idx].type        = snrType;
   snrList[idx].price       = lvl;
   snrList[idx].candleATime = timeA;
   snrList[idx].candleBTime = timeB;
   snrList[idx].broken      = false;
}

//+------------------------------------------------------------------+
//| Check bar sh for breakouts of Classic SNR levels                 |
//+------------------------------------------------------------------+
void CheckBreakout(int sh)
{
   double   cl   = iClose(_Symbol, InpTF, sh);
   datetime barT = iTime (_Symbol, InpTF, sh);

   for(int i = 0; i < snrTotal; i++)
   {
      if(snrList[i].broken) continue;
      if(snrList[i].candleBTime >= barT) continue;

      double lvl      = snrList[i].price;
      bool   isResist = (snrList[i].type == SNR_RESISTANCE);

      bool boBull = isResist  && cl > lvl;
      bool boBear = !isResist && cl < lvl;
      if(!boBull && !boBear) continue;

      int dir = boBull ? +1 : -1;
      if(dir == +1 && !InpShowBull) { snrList[i].broken = true; continue; }
      if(dir == -1 && !InpShowBear) { snrList[i].broken = true; continue; }

      if(!BreakoutFilter(sh, lvl, dir)) continue;

      snrList[i].broken = true;

      // Recycle a terminal BO slot before appending
      int boIdx = -1;
      for(int j = 0; j < boTotal; j++)
      {
         if(boList[j].state == STATE_INVALIDATED || boList[j].state == STATE_EXPIRED)
            { boIdx = j; break; }
      }
      if(boIdx < 0)
      {
         if(boTotal >= BO_MAX) continue;
         boIdx = boTotal++;
      }
      int idx = boIdx;
      boList[idx].id            = nextBoId++;
      boList[idx].snrId         = snrList[i].id;
      boList[idx].dir           = dir;
      boList[idx].state         = STATE_ACTIVE;
      boList[idx].drawnState    = STATE_UNDRAWN;
      boList[idx].barsAlive     = 0;
      boList[idx].level         = lvl;
      boList[idx].snrOriginTime = snrList[i].candleATime;
      boList[idx].breakoutTime  = barT;
      boList[idx].retestTime    = 0;
      boList[idx].retestHigh    = 0.0;
      boList[idx].retestLow     = 0.0;
      boList[idx].confirmTime   = 0;
      boList[idx].endTime       = 0;

      if(InpShowLog)
         PrintFormat("BREAKOUT_CREATED | id=%d | snr_id=%d | dir=%s | level=%.5f | time=%s",
            boList[idx].id, boList[idx].snrId, DirStr(dir), lvl,
            TimeToString(barT, TIME_DATE|TIME_MINUTES));
   }
}

//+------------------------------------------------------------------+
//| Lifecycle update for all live breakout records at bar sh.       |
//|                                                                  |
//| Priority (high → low):                                           |
//|   1. EXPIRED                                                     |
//|   2. INVALIDATED (close back through level)                     |
//|   3. FLIP confirmation (ACTIVE → FLIP on first hold)            |
//|   4. CONFIRMED (RETESTED → close correct side → Phase 3 signal) |
//|   5. RETESTED (wick returns to level from FLIP / CONFIRMED)     |
//+------------------------------------------------------------------+
void UpdateBoStates(int sh)
{
   double   barHigh  = iHigh (_Symbol, InpTF, sh);
   double   barLow   = iLow  (_Symbol, InpTF, sh);
   double   barClose = iClose(_Symbol, InpTF, sh);
   datetime barT     = iTime (_Symbol, InpTF, sh);

   for(int i = 0; i < boTotal; i++)
   {
      int st = boList[i].state;
      if(st == STATE_INVALIDATED || st == STATE_EXPIRED) continue;

      // Zone must have been created before this bar
      if(boList[i].breakoutTime >= barT) continue;

      boList[i].barsAlive++;

      bool   isBull = (boList[i].dir > 0);
      double lvl    = boList[i].level;
      bool   wasRbs = (st >= STATE_FLIP); // STATE_FLIP=6, STATE_RETESTED=1, STATE_CONFIRMED=2
                                          // Only 6,1,2 are post-flip; 0 is pre-flip
      // Note: wasRbs for logging prefix
      // States 6, 1, 2 are all "post flip" — use ZoneName prefix in logs
      // State 0 is pre-flip — use BREAKOUT_ prefix

      // ── 1. EXPIRED ────────────────────────────────────────────────
      if(InpExpiryBars > 0 && boList[i].barsAlive >= InpExpiryBars)
      {
         boList[i].state   = STATE_EXPIRED;
         boList[i].endTime = barT;
         if(InpShowLog)
         {
            if(wasRbs)
               PrintFormat("%s_EXPIRED | id=%d | snr_id=%d | level=%.5f | bars=%d | time=%s",
                  ZoneName(boList[i].dir), boList[i].id, boList[i].snrId, lvl,
                  boList[i].barsAlive, TimeToString(barT, TIME_DATE|TIME_MINUTES));
            else
               PrintFormat("BREAKOUT_EXPIRED | id=%d | snr_id=%d | dir=%s | level=%.5f | bars=%d | time=%s",
                  boList[i].id, boList[i].snrId, DirStr(boList[i].dir), lvl,
                  boList[i].barsAlive, TimeToString(barT, TIME_DATE|TIME_MINUTES));
         }
         continue;
      }

      // ── 2. INVALIDATED: close back through the broken level ───────
      //    Bull (RBS): close < level (closed below former resistance)
      //    Bear (SBR): close > level (closed above former support)
      bool invalidated = isBull ? (barClose < lvl) : (barClose > lvl);
      if(invalidated)
      {
         boList[i].state   = STATE_INVALIDATED;
         boList[i].endTime = barT;
         if(InpShowLog)
         {
            if(wasRbs)
               PrintFormat("%s_INVALIDATED | id=%d | snr_id=%d | level=%.5f | close=%.5f | time=%s",
                  ZoneName(boList[i].dir), boList[i].id, boList[i].snrId, lvl,
                  barClose, TimeToString(barT, TIME_DATE|TIME_MINUTES));
            else
               PrintFormat("BREAKOUT_INVALIDATED | id=%d | snr_id=%d | dir=%s | level=%.5f | close=%.5f | time=%s",
                  boList[i].id, boList[i].snrId, DirStr(boList[i].dir), lvl,
                  barClose, TimeToString(barT, TIME_DATE|TIME_MINUTES));
         }
         continue;
      }

      // ── 3. FLIP: ACTIVE → FLIP on first hold ──────────────────────
      //    Bull: close > level (held above)
      //    Bear: close < level (held below)
      //    Note: invalidation was already checked above, so we know
      //    the close is on the correct side here.
      if(st == STATE_ACTIVE)
      {
         boList[i].state = STATE_FLIP;
         if(InpShowLog)
            PrintFormat("%s_FLIP | id=%d | snr_id=%d | level=%.5f | time=%s",
               ZoneName(boList[i].dir), boList[i].id, boList[i].snrId, lvl,
               TimeToString(barT, TIME_DATE|TIME_MINUTES));
         // Fall through — state is now STATE_FLIP, check for immediate retest
      }

      // Re-read updated state
      st = boList[i].state;

      // ── 4. CONFIRMED: RETESTED → close on correct side ────────────
      //    Bull (RBS): close > level → zone held during retest
      //    Bear (SBR): close < level → zone held during retest
      if(st == STATE_RETESTED)
      {
         bool confirmed = isBull ? (barClose > lvl) : (barClose < lvl);
         if(confirmed)
         {
            boList[i].state       = STATE_CONFIRMED;
            boList[i].confirmTime = barT;

            // Phase 3 signal buffers
            if(sh >= 0)
            {
               if(isBull)
               {
                  if(sh < ArraySize(BullConfirmBuf)) BullConfirmBuf[sh] = 1.0;
                  if(sh < ArraySize(BullSLBuf))     BullSLBuf[sh]     = boList[i].retestLow;
               }
               else
               {
                  if(sh < ArraySize(BearConfirmBuf)) BearConfirmBuf[sh] = 1.0;
                  if(sh < ArraySize(BearSLBuf))     BearSLBuf[sh]     = boList[i].retestHigh;
               }
            }

            if(InpShowLog)
               PrintFormat("%s_CONFIRMED | id=%d | snr_id=%d | level=%.5f | retest=%s | confirm=%s | sl=%.5f",
                  ZoneName(boList[i].dir), boList[i].id, boList[i].snrId, lvl,
                  TimeToString(boList[i].retestTime, TIME_DATE|TIME_MINUTES),
                  TimeToString(barT, TIME_DATE|TIME_MINUTES),
                  isBull ? boList[i].retestLow : boList[i].retestHigh);
            continue;
         }
      }

      // ── 5. RETESTED: wick returns to level from correct side ───────
      //    Only from STATE_FLIP or STATE_CONFIRMED (re-retest cycle).
      //    Bull (RBS): barLow  ≤ level (wick dips down to former resistance)
      //    Bear (SBR): barHigh ≥ level (wick rises up to former support)
      if(st == STATE_FLIP || st == STATE_CONFIRMED)
      {
         bool retested = isBull ? (barLow <= lvl) : (barHigh >= lvl);
         if(retested)
         {
            boList[i].state      = STATE_RETESTED;
            boList[i].retestTime = barT;
            boList[i].retestHigh = barHigh;
            boList[i].retestLow  = barLow;
            if(InpShowLog)
               PrintFormat("%s_RETESTED | id=%d | snr_id=%d | level=%.5f | low=%.5f | high=%.5f | time=%s",
                  ZoneName(boList[i].dir), boList[i].id, boList[i].snrId, lvl,
                  barLow, barHigh, TimeToString(barT, TIME_DATE|TIME_MINUTES));
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Prune oldest live zones when count > InpMaxZones                 |
//+------------------------------------------------------------------+
void EnforceMaxZones()
{
   if(InpMaxZones <= 0) return;
   int cnt = 0;
   for(int i = 0; i < boTotal; i++)
      if(boList[i].state != STATE_INVALIDATED && boList[i].state != STATE_EXPIRED) cnt++;

   while(cnt > InpMaxZones)
   {
      int oldest = -1; datetime oldT = (datetime)LONG_MAX;
      for(int i = 0; i < boTotal; i++)
      {
         if(boList[i].state == STATE_INVALIDATED || boList[i].state == STATE_EXPIRED) continue;
         if(boList[i].breakoutTime < oldT) { oldT = boList[i].breakoutTime; oldest = i; }
      }
      if(oldest < 0) break;
      ObjectDelete(0, ObjLine(boList[oldest].id));
      ObjectDelete(0, ObjLbl (boList[oldest].id));
      boList[oldest].state      = STATE_EXPIRED;
      boList[oldest].endTime    = boList[oldest].breakoutTime;
      boList[oldest].drawnState = STATE_EXPIRED;
      cnt--;
   }
}

//+------------------------------------------------------------------+
//| Draw / redraw one breakout line + label                          |
//+------------------------------------------------------------------+
void BO_DrawOne(int idx)
{
   int      st     = boList[idx].state;
   bool     isBull = (boList[idx].dir > 0);
   bool     isLive = (st != STATE_INVALIDATED && st != STATE_EXPIRED);
   datetime tLeft  = boList[idx].snrOriginTime;
   datetime tRight = isLive ? FAR_FUTURE
                             : (boList[idx].endTime > 0 ? boList[idx].endTime : tLeft);

   ObjectDelete(0, ObjLine(boList[idx].id));
   ObjectDelete(0, ObjLbl (boList[idx].id));

   if(!isLive && InpRemoveTerminal) { boList[idx].drawnState = st; return; }

   // ── Visual per state ──────────────────────────────────────────
   color rawClr;
   int   opacity;
   int   lwidth = 1;
   int   lstyle = STYLE_SOLID;

   switch(st)
   {
      case STATE_ACTIVE:
         rawClr  = isBull ? InpBullColor : InpBearColor;
         opacity = InpActiveOpacity;
         break;
      case STATE_FLIP:
         rawClr  = isBull ? InpRbsColor : InpSbrColor;
         opacity = InpActiveOpacity;
         lwidth  = 2;
         break;
      case STATE_RETESTED:
         rawClr  = InpRetestColor;
         opacity = InpActiveOpacity;
         break;
      case STATE_CONFIRMED:
         rawClr  = isBull ? InpConfirmBull : InpConfirmBear;
         opacity = InpActiveOpacity;
         lwidth  = 2;
         break;
      default: // INVALIDATED / EXPIRED
         rawClr  = InpInvalidColor;
         opacity = InpFadeOpacity;
         lstyle  = STYLE_DASH;
         break;
   }

   color clr = BlendWithBg(rawClr, opacity);
   double lvl = boList[idx].level;

   // OBJ_TREND line at the level — RAY_RIGHT extends to far future while live
   if(ObjectCreate(0, ObjLine(boList[idx].id), OBJ_TREND, 0, tLeft, lvl, tRight, lvl))
   {
      ObjectSetInteger(0, ObjLine(boList[idx].id), OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, ObjLine(boList[idx].id), OBJPROP_STYLE,      lstyle);
      ObjectSetInteger(0, ObjLine(boList[idx].id), OBJPROP_WIDTH,      lwidth);
      ObjectSetInteger(0, ObjLine(boList[idx].id), OBJPROP_RAY_RIGHT,  isLive ? 1 : 0);
      ObjectSetInteger(0, ObjLine(boList[idx].id), OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, ObjLine(boList[idx].id), OBJPROP_HIDDEN,     true);
   }

   // Label at breakout bar
   string lbl;
   switch(st)
   {
      case STATE_ACTIVE:    lbl = isBull ? "BO↑"  : "BO↓";  break;
      case STATE_FLIP:      lbl = isBull ? "RBS"  : "SBR";  break;
      case STATE_RETESTED:  lbl = isBull ? "RBS-T" : "SBR-T"; break;
      case STATE_CONFIRMED: lbl = isBull ? "RBS-C" : "SBR-C"; break;
      default:              lbl = isBull ? "RBS-X" : "SBR-X"; break;
   }
   if(ObjectCreate(0, ObjLbl(boList[idx].id), OBJ_TEXT, 0, boList[idx].breakoutTime, lvl))
   {
      ObjectSetString( 0, ObjLbl(boList[idx].id), OBJPROP_TEXT,       lbl);
      ObjectSetInteger(0, ObjLbl(boList[idx].id), OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, ObjLbl(boList[idx].id), OBJPROP_FONTSIZE,   7);
      ObjectSetInteger(0, ObjLbl(boList[idx].id), OBJPROP_ANCHOR,     ANCHOR_LEFT);
      ObjectSetInteger(0, ObjLbl(boList[idx].id), OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, ObjLbl(boList[idx].id), OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, ObjLbl(boList[idx].id), OBJPROP_BACK,       false);
   }

   boList[idx].drawnState = st;
}

//+------------------------------------------------------------------+
void BO_DrawAll()
{
   for(int i = 0; i < boTotal; i++)
      if(boList[i].drawnState != boList[i].state)
         BO_DrawOne(i);
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
void DeleteAllObjects()
{
   for(int i = ObjectsTotal(0) - 1; i >= 0; i--)
   {
      string nm = ObjectName(0, i);
      if(StringFind(nm, "SMCBOS_") == 0) ObjectDelete(0, nm);
   }
}

//+------------------------------------------------------------------+
int OnInit()
{
   SetIndexBuffer(0, BullConfirmBuf, INDICATOR_DATA);
   SetIndexBuffer(1, BearConfirmBuf, INDICATOR_DATA);
   SetIndexBuffer(2, BullSLBuf,     INDICATOR_DATA);
   SetIndexBuffer(3, BearSLBuf,     INDICATOR_DATA);
   PlotIndexSetString(0, PLOT_LABEL, "Bull RBS Confirmed");
   PlotIndexSetString(1, PLOT_LABEL, "Bear SBR Confirmed");
   PlotIndexSetString(2, PLOT_LABEL, "Bull RBS SL");
   PlotIndexSetString(3, PLOT_LABEL, "Bear SBR SL");
   ArrayInitialize(BullConfirmBuf, 0.0);
   ArrayInitialize(BearConfirmBuf, 0.0);
   ArrayInitialize(BullSLBuf,     0.0);
   ArrayInitialize(BearSLBuf,     0.0);

   DeleteAllObjects();
   snrTotal = 0; boTotal = 0; nextSnrId = 0; nextBoId = 0;

   int avail = iBars(_Symbol, InpTF);
   if(avail < 4) { Print("Breakout_State_Module: not enough bars."); return INIT_FAILED; }

   int limit = MathMin(InpLookback, avail - 3);

   // ── Chronological scan: oldest → newest ─────────────────────────
   // For each bar sh (high shift = older):
   //   AddSnrLevel(sh+1, sh): register Classic SNR from the pair
   //                          (sh+1 = candle A, sh = candle B)
   //   CheckBreakout(sh):     test if bar sh broke any unbroken SNR level
   //   UpdateBoStates(sh):    advance all breakout records whose
   //                          breakoutTime < iTime(sh)
   for(int sh = limit; sh >= 1; sh--)
   {
      AddSnrLevel(sh + 1, sh);
      CheckBreakout(sh);
      UpdateBoStates(sh);
   }

   EnforceMaxZones();
   BO_DrawAll();

   int nA=0,nF=0,nR=0,nC=0,nI=0,nE=0;
   for(int i = 0; i < boTotal; i++)
   {
      switch(boList[i].state)
      {
         case STATE_ACTIVE:      nA++; break;
         case STATE_FLIP:        nF++; break;
         case STATE_RETESTED:    nR++; break;
         case STATE_CONFIRMED:   nC++; break;
         case STATE_INVALIDATED: nI++; break;
         default:                nE++; break;
      }
   }
   PrintFormat("Breakout_State_Module v1 ready | active=%d flip=%d retested=%d confirmed=%d invalidated=%d expired=%d | %s %s",
      nA, nF, nR, nC, nI, nE, _Symbol, EnumToString(InpTF));
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason) { DeleteAllObjects(); ChartRedraw(0); }

//+------------------------------------------------------------------+
int OnCalculate(const int rates_total, const int prev_calculated,
                const datetime &time[], const double &open[],
                const double &high[], const double &low[],
                const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
{
   // ── First call: backfill Phase 3 signal buffers ───────────────
   if(prev_calculated == 0)
   {
      ArrayInitialize(BullConfirmBuf, 0.0);
      ArrayInitialize(BearConfirmBuf, 0.0);
      ArrayInitialize(BullSLBuf,     0.0);
      ArrayInitialize(BearSLBuf,     0.0);
      for(int i = 0; i < boTotal; i++)
      {
         if(boList[i].confirmTime == 0) continue;
         int si = iBarShift(_Symbol, InpTF, boList[i].confirmTime, false);
         if(si < 0 || si >= rates_total) continue;
         if(boList[i].dir > 0)
         {
            BullConfirmBuf[si] = 1.0;
            BullSLBuf[si]      = boList[i].retestLow;
         }
         else
         {
            BearConfirmBuf[si] = 1.0;
            BearSLBuf[si]      = boList[i].retestHigh;
         }
      }
      lastBarTime = iTime(_Symbol, InpTF, 0);
      return rates_total;
   }

   // ── Bar-open guard ────────────────────────────────────────────
   datetime currentBar = iTime(_Symbol, InpTF, 0);
   if(currentBar == lastBarTime) return rates_total;
   lastBarTime = currentBar;

   // Bars 1 and 2 = the two candles that may form a new Classic SNR pair
   AddSnrLevel(2, 1);
   CheckBreakout(1);
   UpdateBoStates(1);

   EnforceMaxZones();
   BO_DrawAll();

   return rates_total;
}
`;
}
