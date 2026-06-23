//+------------------------------------------------------------------+
//| Unicorn_Pocket_Preset.mq5  —  Strategy Flow runtime over verified SMs         |
//| 3 instances; entries gated on ordered, timestamped events.     |
//+------------------------------------------------------------------+
#property copyright "EA Builder — Strategy Flow runtime"
#property version   "1.00"
#property strict
#include <Trade/Trade.mqh>
CTrade trade;

input long   InpMagic         = 770120;
input double InpRiskPct        = 1;
input double InpRewardRisk     = 2;
input int    InpMaxStopPts     = 0;
input int    InpMaxOpenTrades  = 1;
input int    InpSetupExpiryBars = 100;
input bool   InpAudit         = true;

string InpSymbol;

#define STEP_COUNT 3
string          gStepName[STEP_COUNT];
ENUM_TIMEFRAMES gTF[STEP_COUNT];
bool            gFired[STEP_COUNT];
int             gDir[STEP_COUNT];
datetime        gTime[STEP_COUNT];
double          gSL[STEP_COUNT];
datetime        gLastTraded[STEP_COUNT];
bool            gPrevA[STEP_COUNT];
bool            gPrevB[STEP_COUNT];
datetime        gLastBar[1];
int             gExpirySec = 0;
string          gLastGate = "idle";
int             gTradeCount = 0;

string DirTxt(int d) { return d == 1 ? "BULL" : d == -1 ? "BEAR" : "-"; }

void RegisterEvent(int step, int dir, datetime t, double price, double sl)
{
   gFired[step] = true; gDir[step] = dir; gTime[step] = t; gSL[step] = sl;
   if(InpAudit) PrintFormat("[EVENT] %s | dir=%d | %s | sl=%.5f",
                  gStepName[step], dir, TimeToString(t, TIME_DATE|TIME_MINUTES), sl);
}

int OpenPositions()
{
   int c = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      ulong tk = PositionGetTicket(i);
      if(!PositionSelectByTicket(tk)) continue;
      if(PositionGetString(POSITION_SYMBOL) != InpSymbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      c++;
   }
   return c;
}

double LotsForRisk(double slDistance)
{
   if(slDistance <= 0) return 0.0;
   double risk  = AccountInfoDouble(ACCOUNT_BALANCE) * InpRiskPct / 100.0;
   double tick  = SymbolInfoDouble(InpSymbol, SYMBOL_TRADE_TICK_VALUE);
   double tsize = SymbolInfoDouble(InpSymbol, SYMBOL_TRADE_TICK_SIZE);
   if(tick <= 0 || tsize <= 0) return 0.0;
   double lossPerLot = (slDistance / tsize) * tick;
   if(lossPerLot <= 0) return 0.0;
   double lots = risk / lossPerLot;
   double minL = SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_MIN);
   double stepL= SymbolInfoDouble(InpSymbol, SYMBOL_VOLUME_STEP);
   if(stepL > 0) lots = MathFloor(lots / stepL) * stepL;
   if(lots < minL) lots = minL;
   return lots;
}

bool OpenTrade(int entryIdx, int dir)
{
   double entryPx = (dir == 1) ? SymbolInfoDouble(InpSymbol, SYMBOL_ASK)
                               : SymbolInfoDouble(InpSymbol, SYMBOL_BID);
   double sl = gSL[entryIdx];
   if(sl <= 0) { gLastGate = "BLOCKED: no SL"; return false; }
   double slDist = MathAbs(entryPx - sl);
   double pt = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   if(InpMaxStopPts > 0 && pt > 0 && (slDist / pt) > InpMaxStopPts)
   { gLastGate = "SKIP: SL too wide"; return false; }
   double tp = (dir == 1) ? entryPx + InpRewardRisk * slDist : entryPx - InpRewardRisk * slDist;
   double lots = LotsForRisk(slDist);
   if(lots <= 0) { gLastGate = "BLOCKED: lot calc"; return false; }
   bool ok = (dir == 1) ? trade.Buy(lots, InpSymbol, entryPx, sl, tp)
                        : trade.Sell(lots, InpSymbol, entryPx, sl, tp);
   if(ok) {
      gLastTraded[entryIdx] = gTime[entryIdx];
      gTradeCount++;
      gLastGate = "TRADE " + (dir == 1 ? "BUY" : "SELL") + " @ " + TimeToString(gTime[entryIdx], TIME_DATE|TIME_MINUTES);
      if(InpAudit) {
         Print("===== TRADE AUDIT =====");
         for(int s = 0; s < STEP_COUNT; s++)
            if(gFired[s])
               PrintFormat("  %s : %s @ %s", gStepName[s], DirTxt(gDir[s]), TimeToString(gTime[s], TIME_DATE|TIME_MINUTES));
         PrintFormat("  ENTRY %s lots=%.2f SL=%.5f TP=%.5f", dir == 1 ? "BUY" : "SELL", lots, sl, tp);
         Print("=======================");
      }
   }
   return ok;
}


// ── Embedded verified state machines ──────────────────────────────────────────

//+------------------------------------------------------------------+
//| Unicorn State Machine — H1 (H1)                           |
//| Breaker Block overlapping same-direction FVG — overlap pocket. |
//+------------------------------------------------------------------+
#define UNISMSM_H1_PHASE_OB  0
#define UNISMSM_H1_PHASE_BB  1

struct UNISMSM_H1_ObRec
{
   int      phase;
   int      dir;
   double   hi;
   double   lo;
   datetime obTime;
   datetime confirmTime;
   datetime breakTime;
   bool     matched;
   bool     dead;
   int      obAge;
   int      uniAge;
   double   uTop;
   double   uBot;
};

struct UNISMSM_H1_FvgRec
{
   int      dir;
   double   top;
   double   bot;
   datetime confirmTime;
   bool     used;
};

struct UNISMSM_H1_UniRec
{
   int      dir;
   double   brkHi;
   double   brkLo;
   double   ovTop;
   double   ovBot;
   datetime matchTime;
   int      state;
   double   retestLow;
   double   retestHigh;
   bool     dead;
   int      barsAlive;
};

#define UNISMSM_H1_MAX_OBS 120
#define UNISMSM_H1_MAX_FVGS 120
#define UNISMSM_H1_MAX_UNI 120
UNISMSM_H1_ObRec  UNISMSM_H1_obList[UNISMSM_H1_MAX_OBS];
UNISMSM_H1_FvgRec UNISMSM_H1_fvgList[UNISMSM_H1_MAX_FVGS];
UNISMSM_H1_UniRec UNISMSM_H1_uniList[UNISMSM_H1_MAX_UNI];
int       UNISMSM_H1_obCount  = 0;
int       UNISMSM_H1_fvgCount = 0;
int       UNISMSM_H1_uniCount = 0;
bool      UNISMSM_H1__bullConfirmed = false;
bool      UNISMSM_H1__bearConfirmed = false;
bool      UNISMSM_H1__bullJustRetested = false;
bool      UNISMSM_H1__bearJustRetested = false;
double    UNISMSM_H1__bullSL = 0.0;
double    UNISMSM_H1__bearSL = 0.0;

void UNISMSM_H1_Reset()
{
   UNISMSM_H1_obCount  = 0;
   UNISMSM_H1_fvgCount = 0;
   UNISMSM_H1_uniCount = 0;
   UNISMSM_H1__bullConfirmed = false;
   UNISMSM_H1__bearConfirmed = false;
   UNISMSM_H1__bullJustRetested = false;
   UNISMSM_H1__bearJustRetested = false;
   UNISMSM_H1__bullSL = 0.0;
   UNISMSM_H1__bearSL = 0.0;
}

double UNISMSM_H1_CalcATR(int sh)
{
   int total = iBars(InpSymbol, PERIOD_H1);
   if(sh + 14 + 1 >= total) return 0.0;
   double sum = 0.0;
   for(int k = sh + 1; k <= sh + 14; k++)
   {
      double h = iHigh(InpSymbol, PERIOD_H1, k);
      double l = iLow (InpSymbol, PERIOD_H1, k);
      double pc = iClose(InpSymbol, PERIOD_H1, k + 1);
      sum += MathMax(h - l, MathMax(MathAbs(h - pc), MathAbs(l - pc)));
   }
   return sum / (double)14;
}

#define UNISMSM_H1_OBJ_PREFIX "EAUNI_H1_"

void UNISMSM_H1_DrawRect(string nm, datetime t1, double p1, datetime t2, double p2, color c, int style, bool fill, int width)
{
   if(ObjectFind(0, nm) >= 0) return;
   if(ObjectCreate(0, nm, OBJ_RECTANGLE, 0, t1, p1, t2, p2))
   {
      ObjectSetInteger(0, nm, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, nm, OBJPROP_STYLE,      style);
      ObjectSetInteger(0, nm, OBJPROP_WIDTH,      width);
      ObjectSetInteger(0, nm, OBJPROP_FILL,       fill);
      ObjectSetInteger(0, nm, OBJPROP_BACK,       true);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, nm, OBJPROP_HIDDEN,     true);
   }
}

void UNISMSM_H1_DrawUni(int dir, datetime obT, double brkHi, double brkLo, double ovTop, double ovBot, datetime matchT)
{
   string key = IntegerToString((long)matchT);
   color c = (dir == 1) ? clrMediumSeaGreen : clrTomato;
   UNISMSM_H1_DrawRect(UNISMSM_H1_OBJ_PREFIX + "brk_" + key, obT, brkHi, matchT, brkLo, c, STYLE_DASH, false, 1);
   UNISMSM_H1_DrawRect(UNISMSM_H1_OBJ_PREFIX + "ovl_" + key, obT, ovTop, matchT, ovBot, c, STYLE_SOLID, true, 2);
   string lbl = UNISMSM_H1_OBJ_PREFIX + "lbl_" + key;
   double anchor = (dir == 1) ? ovBot : ovTop;
   if(ObjectFind(0, lbl) < 0 && ObjectCreate(0, lbl, OBJ_TEXT, 0, obT, anchor))
   {
      ObjectSetString (0, lbl, OBJPROP_TEXT,       "Unicorn");
      ObjectSetInteger(0, lbl, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, lbl, OBJPROP_FONTSIZE,   9);
      ObjectSetInteger(0, lbl, OBJPROP_ANCHOR,     dir == 1 ? ANCHOR_UPPER : ANCHOR_LOWER);
      ObjectSetInteger(0, lbl, OBJPROP_SELECTABLE, false);
   }
}


void UNISMSM_H1_AddOb(int dir, double hi, double lo, datetime obT, datetime confT)
{
   for(int i = 0; i < UNISMSM_H1_obCount; i++)
      if(UNISMSM_H1_obList[i].obTime == obT && !UNISMSM_H1_obList[i].dead) return;
   int idx = -1;
   for(int i = 0; i < UNISMSM_H1_obCount; i++)
      if(UNISMSM_H1_obList[i].dead) { idx = i; break; }
   if(idx < 0) {
      if(UNISMSM_H1_obCount >= UNISMSM_H1_MAX_OBS) return;
      idx = UNISMSM_H1_obCount++;
   }
   UNISMSM_H1_obList[idx].phase       = UNISMSM_H1_PHASE_OB;
   UNISMSM_H1_obList[idx].dir         = dir;
   UNISMSM_H1_obList[idx].hi          = hi;
   UNISMSM_H1_obList[idx].lo          = lo;
   UNISMSM_H1_obList[idx].obTime      = obT;
   UNISMSM_H1_obList[idx].confirmTime = confT;
   UNISMSM_H1_obList[idx].breakTime   = 0;
   UNISMSM_H1_obList[idx].matched     = false;
   UNISMSM_H1_obList[idx].dead        = false;
   UNISMSM_H1_obList[idx].obAge       = 0;
   UNISMSM_H1_obList[idx].uniAge      = 0;
   UNISMSM_H1_obList[idx].uTop        = 0.0;
   UNISMSM_H1_obList[idx].uBot        = 0.0;
}

void UNISMSM_H1_AddFvg(int dir, double top, double bot, datetime confT)
{
   int idx = -1;
   for(int i = 0; i < UNISMSM_H1_fvgCount; i++)
      if(UNISMSM_H1_fvgList[i].used) { idx = i; break; }
   if(idx < 0) {
      if(UNISMSM_H1_fvgCount >= UNISMSM_H1_MAX_FVGS) return;
      idx = UNISMSM_H1_fvgCount++;
   }
   UNISMSM_H1_fvgList[idx].dir         = dir;
   UNISMSM_H1_fvgList[idx].top         = top;
   UNISMSM_H1_fvgList[idx].bot         = bot;
   UNISMSM_H1_fvgList[idx].confirmTime = confT;
   UNISMSM_H1_fvgList[idx].used        = false;
}

void UNISMSM_H1_AddUni(int dir, double brkHi, double brkLo, double ovTop, double ovBot, datetime matchT)
{
   int idx = -1;
   for(int i = 0; i < UNISMSM_H1_uniCount; i++)
      if(UNISMSM_H1_uniList[i].dead) { idx = i; break; }
   if(idx < 0) {
      if(UNISMSM_H1_uniCount >= UNISMSM_H1_MAX_UNI) return;
      idx = UNISMSM_H1_uniCount++;
   }
   UNISMSM_H1_uniList[idx].dir       = dir;
   UNISMSM_H1_uniList[idx].brkHi     = brkHi;
   UNISMSM_H1_uniList[idx].brkLo     = brkLo;
   UNISMSM_H1_uniList[idx].ovTop     = ovTop;
   UNISMSM_H1_uniList[idx].ovBot     = ovBot;
   UNISMSM_H1_uniList[idx].matchTime = matchT;
   UNISMSM_H1_uniList[idx].state     = 0;
   UNISMSM_H1_uniList[idx].retestLow = 0.0;
   UNISMSM_H1_uniList[idx].retestHigh = 0.0;
   UNISMSM_H1_uniList[idx].dead      = false;
   UNISMSM_H1_uniList[idx].barsAlive = 0;
}

void UNISMSM_H1_DetectOb(int sh)
{
   if(sh < 1) return;
   double atr = UNISMSM_H1_CalcATR(sh);
   if(atr <= 0.0) return;
   double dOpn = iOpen (InpSymbol, PERIOD_H1, sh);
   double dCls = iClose(InpSymbol, PERIOD_H1, sh);
   if(MathAbs(dCls - dOpn) < 1.5 * atr) return;
   int dispDir = (dCls > dOpn) ? 1 : -1;
   int total = iBars(InpSymbol, PERIOD_H1);
   int scanEnd = sh + 5;
   if(scanEnd >= total - 1) scanEnd = total - 2;
   for(int j = sh + 1; j <= scanEnd; j++)
   {
      double jOpn = iOpen (InpSymbol, PERIOD_H1, j);
      double jCls = iClose(InpSymbol, PERIOD_H1, j);
      if(dispDir == 1 && jCls < jOpn) {
         UNISMSM_H1_AddOb(1, iHigh(InpSymbol, PERIOD_H1, j), iLow(InpSymbol, PERIOD_H1, j),
                   iTime(InpSymbol, PERIOD_H1, j), iTime(InpSymbol, PERIOD_H1, sh));
         return;
      }
      if(dispDir == -1 && jCls > jOpn) {
         UNISMSM_H1_AddOb(-1, iHigh(InpSymbol, PERIOD_H1, j), iLow(InpSymbol, PERIOD_H1, j),
                   iTime(InpSymbol, PERIOD_H1, j), iTime(InpSymbol, PERIOD_H1, sh));
         return;
      }
   }
}

void UNISMSM_H1_DetectFvg(int sh)
{
   int total = iBars(InpSymbol, PERIOD_H1);
   if(sh + 2 >= total) return;
   double c1h = iHigh(InpSymbol, PERIOD_H1, sh + 2);
   double c1l = iLow (InpSymbol, PERIOD_H1, sh + 2);
   double c3h = iHigh(InpSymbol, PERIOD_H1, sh);
   double c3l = iLow (InpSymbol, PERIOD_H1, sh);
   datetime t3 = iTime(InpSymbol, PERIOD_H1, sh);
   if(c1h < c3l) UNISMSM_H1_AddFvg(1, c3l, c1h, t3);
   if(c1l > c3h) UNISMSM_H1_AddFvg(-1, c1l, c3h, t3);
}

void UNISMSM_H1_CheckBreaks(int sh)
{
   double cl = iClose(InpSymbol, PERIOD_H1, sh);
   datetime t = iTime(InpSymbol, PERIOD_H1, sh);
   for(int i = 0; i < UNISMSM_H1_obCount; i++)
   {
      if(UNISMSM_H1_obList[i].dead || UNISMSM_H1_obList[i].phase != UNISMSM_H1_PHASE_OB) continue;
      if(UNISMSM_H1_obList[i].confirmTime >= t) continue;
      if(UNISMSM_H1_obList[i].dir == 1 && cl < UNISMSM_H1_obList[i].lo) {
         UNISMSM_H1_obList[i].phase     = UNISMSM_H1_PHASE_BB;
         UNISMSM_H1_obList[i].dir       = -1;
         UNISMSM_H1_obList[i].breakTime = t;
         UNISMSM_H1_obList[i].uniAge    = 0;
      }
      else if(UNISMSM_H1_obList[i].dir == -1 && cl > UNISMSM_H1_obList[i].hi) {
         UNISMSM_H1_obList[i].phase     = UNISMSM_H1_PHASE_BB;
         UNISMSM_H1_obList[i].dir       = 1;
         UNISMSM_H1_obList[i].breakTime = t;
         UNISMSM_H1_obList[i].uniAge    = 0;
      }
   }
}

void UNISMSM_H1_MatchPass(int sh)
{
   datetime barT = iTime(InpSymbol, PERIOD_H1, sh);
   long windowSecs = (long)PeriodSeconds(PERIOD_H1) * (long)15;
   for(int i = 0; i < UNISMSM_H1_obCount; i++)
   {
      if(UNISMSM_H1_obList[i].dead || UNISMSM_H1_obList[i].phase != UNISMSM_H1_PHASE_BB || UNISMSM_H1_obList[i].matched) continue;
      for(int f = 0; f < UNISMSM_H1_fvgCount; f++)
      {
         if(UNISMSM_H1_fvgList[f].used) continue;
         if(UNISMSM_H1_fvgList[f].dir != UNISMSM_H1_obList[i].dir) continue;
         long dt = (long)(UNISMSM_H1_fvgList[f].confirmTime - UNISMSM_H1_obList[i].breakTime);
         if(dt < 0) dt = -dt;
         if(dt > windowSecs) continue;
         double ovTop = MathMin(UNISMSM_H1_obList[i].hi, UNISMSM_H1_fvgList[f].top);
         double ovBot = MathMax(UNISMSM_H1_obList[i].lo, UNISMSM_H1_fvgList[f].bot);
         if(ovBot >= ovTop) continue;
         UNISMSM_H1_obList[i].uTop    = ovTop;
         UNISMSM_H1_obList[i].uBot    = ovBot;
         UNISMSM_H1_obList[i].matched = true;
         UNISMSM_H1_fvgList[f].used   = true;
         UNISMSM_H1_AddUni(UNISMSM_H1_obList[i].dir, UNISMSM_H1_obList[i].hi, UNISMSM_H1_obList[i].lo, ovTop, ovBot, barT);
         UNISMSM_H1_DrawUni(UNISMSM_H1_obList[i].dir, UNISMSM_H1_obList[i].obTime, UNISMSM_H1_obList[i].hi, UNISMSM_H1_obList[i].lo, ovTop, ovBot, barT);
         break;
      }
   }
}

void UNISMSM_H1_Lifecycle(int sh)
{
   double cl = iClose(InpSymbol, PERIOD_H1, sh);
   datetime t = iTime(InpSymbol, PERIOD_H1, sh);
   for(int i = 0; i < UNISMSM_H1_uniCount; i++)
   {
      if(UNISMSM_H1_uniList[i].dead) continue;
      if(UNISMSM_H1_uniList[i].matchTime > t) continue;
      if(UNISMSM_H1_uniList[i].dir == 1 && cl < UNISMSM_H1_uniList[i].brkLo) UNISMSM_H1_uniList[i].dead = true;
      else if(UNISMSM_H1_uniList[i].dir == -1 && cl > UNISMSM_H1_uniList[i].brkHi) UNISMSM_H1_uniList[i].dead = true;
   }
}

void UNISMSM_H1_AgeLevels()
{
   for(int i = 0; i < UNISMSM_H1_obCount; i++)
   {
      if(UNISMSM_H1_obList[i].dead) continue;
      if(UNISMSM_H1_obList[i].phase == UNISMSM_H1_PHASE_OB) {
         if(300 <= 0) continue;
         UNISMSM_H1_obList[i].obAge++;
         if(UNISMSM_H1_obList[i].obAge >= 300) UNISMSM_H1_obList[i].dead = true;
      }
      else if(!UNISMSM_H1_obList[i].matched) {
         if(250 <= 0) continue;
         UNISMSM_H1_obList[i].uniAge++;
         if(UNISMSM_H1_obList[i].uniAge >= 250) UNISMSM_H1_obList[i].dead = true;
      }
   }
   for(int i = 0; i < UNISMSM_H1_uniCount; i++)
   {
      if(UNISMSM_H1_uniList[i].dead) continue;
      if(250 <= 0) continue;
      UNISMSM_H1_uniList[i].barsAlive++;
      if(UNISMSM_H1_uniList[i].barsAlive >= 250) UNISMSM_H1_uniList[i].dead = true;
   }
}

void UNISMSM_H1_UpdateUniPocket(int sh)
{
   double lo = iLow (InpSymbol, PERIOD_H1, sh);
   double hi = iHigh(InpSymbol, PERIOD_H1, sh);
   double cl = iClose(InpSymbol, PERIOD_H1, sh);
   datetime t = iTime(InpSymbol, PERIOD_H1, sh);

   for(int i = 0; i < UNISMSM_H1_uniCount; i++)
   {
      if(UNISMSM_H1_uniList[i].dead) continue;
      if(UNISMSM_H1_uniList[i].matchTime >= t) continue;
      if(UNISMSM_H1_uniList[i].state >= 2) continue;

      double ovTop = UNISMSM_H1_uniList[i].ovTop;
      double ovBot = UNISMSM_H1_uniList[i].ovBot;

      if(UNISMSM_H1_uniList[i].dir == 1)
      {
         if(cl >= ovBot && cl <= ovTop) { UNISMSM_H1_uniList[i].dead = true; continue; }
         if(UNISMSM_H1_uniList[i].state == 0 && lo <= ovTop)
         {
            UNISMSM_H1_uniList[i].state = 1;
            UNISMSM_H1_uniList[i].retestLow = lo;
            if(sh == 1) UNISMSM_H1__bullJustRetested = true;
         }
         if(UNISMSM_H1_uniList[i].state == 1)
         {
            if(lo < UNISMSM_H1_uniList[i].retestLow) UNISMSM_H1_uniList[i].retestLow = lo;
            if(cl > ovTop)
            {
               UNISMSM_H1_uniList[i].state = 2;
               UNISMSM_H1_uniList[i].dead = true;
               UNISMSM_H1__bullSL = UNISMSM_H1_uniList[i].retestLow;
               if(sh == 1) UNISMSM_H1__bullConfirmed = true;
            }
         }
      }
      else
      {
         if(cl >= ovBot && cl <= ovTop) { UNISMSM_H1_uniList[i].dead = true; continue; }
         if(UNISMSM_H1_uniList[i].state == 0 && hi >= ovBot)
         {
            UNISMSM_H1_uniList[i].state = 1;
            UNISMSM_H1_uniList[i].retestHigh = hi;
            if(sh == 1) UNISMSM_H1__bearJustRetested = true;
         }
         if(UNISMSM_H1_uniList[i].state == 1)
         {
            if(hi > UNISMSM_H1_uniList[i].retestHigh) UNISMSM_H1_uniList[i].retestHigh = hi;
            if(cl < ovBot)
            {
               UNISMSM_H1_uniList[i].state = 2;
               UNISMSM_H1_uniList[i].dead = true;
               UNISMSM_H1__bearSL = UNISMSM_H1_uniList[i].retestHigh;
               if(sh == 1) UNISMSM_H1__bearConfirmed = true;
            }
         }
      }
   }
}

void UNISMSM_H1_Tick(int lookback)
{
   UNISMSM_H1_Reset();
   int total = iBars(InpSymbol, PERIOD_H1);
   int minBars = 14 + 5 + 4;
   int limit = (int)MathMin((long)lookback, (long)(total - minBars));
   if(limit < 1) return;
   for(int sh = limit; sh >= 1; sh--)
   {
      UNISMSM_H1_DetectOb(sh);
      UNISMSM_H1_DetectFvg(sh);
      UNISMSM_H1_CheckBreaks(sh);
      UNISMSM_H1_MatchPass(sh);
      UNISMSM_H1_Lifecycle(sh);
      UNISMSM_H1_UpdateUniPocket(sh);
      UNISMSM_H1_AgeLevels();
   }
}

bool   UNISMSM_H1_BullJustConfirmed() { return UNISMSM_H1__bullConfirmed; }
bool   UNISMSM_H1_BearJustConfirmed() { return UNISMSM_H1__bearConfirmed; }
bool   UNISMSM_H1_BullJustRetested()  { return UNISMSM_H1__bullJustRetested; }
bool   UNISMSM_H1_BearJustRetested()  { return UNISMSM_H1__bearJustRetested; }
double UNISMSM_H1_BullConfirmSL()     { return UNISMSM_H1__bullSL; }
double UNISMSM_H1_BearConfirmSL()     { return UNISMSM_H1__bearSL; }

bool UNISMSM_H1_HasActiveBull()
{
   for(int i = UNISMSM_H1_uniCount - 1; i >= 0; i--)
      if(!UNISMSM_H1_uniList[i].dead && UNISMSM_H1_uniList[i].dir == 1 && UNISMSM_H1_uniList[i].state < 2) return true;
   return false;
}

bool UNISMSM_H1_HasActiveBear()
{
   for(int i = UNISMSM_H1_uniCount - 1; i >= 0; i--)
      if(!UNISMSM_H1_uniList[i].dead && UNISMSM_H1_uniList[i].dir == -1 && UNISMSM_H1_uniList[i].state < 2) return true;
   return false;
}

double UNISMSM_H1_ActiveBullSL()
{
   for(int i = UNISMSM_H1_uniCount - 1; i >= 0; i--)
      if(!UNISMSM_H1_uniList[i].dead && UNISMSM_H1_uniList[i].dir == 1) return UNISMSM_H1_uniList[i].brkLo;
   return 0.0;
}

double UNISMSM_H1_ActiveBearSL()
{
   for(int i = UNISMSM_H1_uniCount - 1; i >= 0; i--)
      if(!UNISMSM_H1_uniList[i].dead && UNISMSM_H1_uniList[i].dir == -1) return UNISMSM_H1_uniList[i].brkHi;
   return 0.0;
}


// ── Per-instance detection ────────────────────────────────────────────────────
void DetectStep_0()
{
   int _bias = 0;
   bool _ab = UNISMSM_H1_HasActiveBull();
   bool _bb = UNISMSM_H1_HasActiveBear();
   if((_bias == 0 || _bias == 1) && _ab && !gPrevA[0]) RegisterEvent(0, 1, iTime(InpSymbol, gTF[0], 1), iClose(InpSymbol, gTF[0], 1), 0.0);
   else if((_bias == 0 || _bias == -1) && _bb && !gPrevB[0]) RegisterEvent(0, -1, iTime(InpSymbol, gTF[0], 1), iClose(InpSymbol, gTF[0], 1), 0.0);
   gPrevA[0] = _ab; gPrevB[0] = _bb;
}

void DetectStep_1()
{
   if(UNISMSM_H1_BullJustConfirmed())      RegisterEvent(1, 1, iTime(InpSymbol, gTF[1], 1), iClose(InpSymbol, gTF[1], 1), UNISMSM_H1_BullConfirmSL());
   else if(UNISMSM_H1_BearJustConfirmed()) RegisterEvent(1, -1, iTime(InpSymbol, gTF[1], 1), iClose(InpSymbol, gTF[1], 1), UNISMSM_H1_BearConfirmSL());
}

void DetectStep_2()
{
   if(!gFired[1]) return;
   if(!gFired[1]) return;
   datetime _confT = gTime[1];
   if(_confT <= 0 || iTime(InpSymbol, gTF[2], 1) <= _confT) return;
   int _bias = gDir[1];
   if(_bias != 0 && !gPrevA[2]) {
      RegisterEvent(2, _bias, iTime(InpSymbol, gTF[2], 1), iClose(InpSymbol, gTF[2], 1), gSL[1]);
      gPrevA[2] = true;
   } else if(_bias == 0) {
      gPrevA[2] = false;
   }
}

// ── Entry gate(s) ─────────────────────────────────────────────────────────────
void EvaluateEntry_2()
{
   if(!gFired[2]) return;
   if(gTime[2] != iTime(InpSymbol, gTF[2], 1)) return;
   if(gLastTraded[2] == gTime[2]) return;
   int dir = gDir[2];
   if(!gFired[1]) { gLastGate = "BLOCKED: Confirmation Unicorn H1 not fired"; return; }
   if(!(gTime[1] < gTime[2])) { gLastGate = "BLOCKED: Confirmation Unicorn H1 not before entry"; return; }
   if(gDir[1] != dir) { gLastGate = "BLOCKED: direction mismatch"; return; }

   if(InpSetupExpiryBars > 0 && (int)(gTime[2] - gTime[1]) > gExpirySec) { gLastGate = "BLOCKED: setup expired"; return; }

   if(OpenPositions() >= InpMaxOpenTrades) return;
   if(OpenTrade(2, dir))
   {
         gFired[1] = false; gPrevA[1] = false; gPrevB[1] = false;
   }
}

void UpdatePanel()
{
   string s = "Unicorn_Pocket_Preset (flow over verified SMs)\n";
   s += "Setup Unicorn H1: " + (gFired[0] ? DirTxt(gDir[0]) + " @ " + TimeToString(gTime[0], TIME_DATE|TIME_MINUTES) : "waiting") + "\n";
   s += "Confirmation Unicorn H1: " + (gFired[1] ? DirTxt(gDir[1]) + " @ " + TimeToString(gTime[1], TIME_DATE|TIME_MINUTES) : "waiting") + "\n";
   s += "Entry Unicorn H1: " + (gFired[2] ? DirTxt(gDir[2]) + " @ " + TimeToString(gTime[2], TIME_DATE|TIME_MINUTES) : "waiting") + "\n";
   s += "Last gate: " + gLastGate + "\n";
   s += "Trades opened: " + IntegerToString(gTradeCount) + "\n";
   s += "Risk " + DoubleToString(InpRiskPct,1) + "%  R:R " + DoubleToString(InpRewardRisk,1) + "x";
   Comment(s);
}

int OnInit()
{
   InpSymbol = _Symbol;
   trade.SetExpertMagicNumber((ulong)InpMagic);
   gTF[0] = PERIOD_H1;
   gTF[1] = PERIOD_H1;
   gTF[2] = PERIOD_H1;
   gStepName[0] = "Setup Unicorn H1";
   gStepName[1] = "Confirmation Unicorn H1";
   gStepName[2] = "Entry Unicorn H1";
   for(int i = 0; i < STEP_COUNT; i++) { gFired[i]=false; gDir[i]=0; gTime[i]=0; gLastTraded[i]=0; gPrevA[i]=false; gPrevB[i]=false; }
   for(int b = 0; b < 1; b++) gLastBar[b] = 0;
   gExpirySec = InpSetupExpiryBars > 0 ? InpSetupExpiryBars * PeriodSeconds(PERIOD_H1) : 0;
   UNISMSM_H1_Reset();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { Comment(""); }

void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
{
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;
   ulong ticket = trans.deal;
   if(ticket == 0 || !HistoryDealSelect(ticket)) return;
   if((long)HistoryDealGetInteger(ticket, DEAL_MAGIC) != InpMagic) return;
   if(HistoryDealGetInteger(ticket, DEAL_ENTRY) != DEAL_ENTRY_OUT) return;
   double profit  = HistoryDealGetDouble(ticket, DEAL_PROFIT)
                  + HistoryDealGetDouble(ticket, DEAL_SWAP)
                  + HistoryDealGetDouble(ticket, DEAL_COMMISSION);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity  = AccountInfoDouble(ACCOUNT_EQUITY);
   datetime dt    = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
   PrintFormat("EA_BUILDER_EQUITY|time=%s|balance=%.2f|equity=%.2f|profit=%.2f|deal=%I64u",
               TimeToString(dt, TIME_DATE|TIME_MINUTES), balance, equity, profit, ticket);
}

void OnTick()
{
   { datetime b = iTime(InpSymbol, PERIOD_H1, 0); if(b != gLastBar[0]) { gLastBar[0] = b; UNISMSM_H1_Tick(500); DetectStep_0(); DetectStep_1(); DetectStep_2(); EvaluateEntry_2(); } }
   UpdatePanel();
}
