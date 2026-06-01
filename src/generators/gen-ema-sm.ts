/**
 * Inline EMA State Machine Generator (retest + confirmation sequence)
 *
 * Encodes the multi-bar EMA pullback sequence as a verified state machine so the
 * AI WIRES it instead of hand-writing (and collapsing) the phases:
 *
 *   IDLE
 *     → ARMED       : price RETESTS the slow EMA (within retestPoints) in the
 *                     bias direction. The retest bar only ARMS — it never fires.
 *     → (stay ARMED): later pullback bars update the swing extreme (SL ref).
 *     → CONFIRMED   : a LATER bar CLOSES outside the fast EMA in the bias
 *                     direction → entry signal (enter next bar). SL = swing.
 *   Invalidation: bias flips, or a bar closes back through the slow EMA.
 *
 * Direction is supplied externally (the higher-TF gBias) so the M5 instance
 * aligns with the H1 trend. The SM also exposes Bias() for use as a Direction
 * Brain on its own timeframe.
 *
 * EMAs are real iMA handles drawn via B4_MA. Values are read with a GUARDED
 * copy (never the 0.0 fallback), so unready buffers can't produce phantom signals.
 *
 * Standard API:
 *   EMASM_{id}_Reset()
 *   EMASM_{id}_Tick(int bias)        — advance once per bar for the given bias
 *   EMASM_{id}_Bias()                — own fast/slow alignment (Direction role)
 *   EMASM_{id}_RetestActive()        — ARMED: a retest is waiting (Setup role)
 *   EMASM_{id}_ActiveDir()           — direction of the armed pullback
 *   EMASM_{id}_ActiveSL()            — current swing SL hint while armed
 *   EMASM_{id}_JustConfirmed()       — confirmation fired THIS bar (Execution)
 *   EMASM_{id}_ConfirmDir()          — direction of the confirmation
 *   EMASM_{id}_ConfirmSL()           — swing SL at confirmation
 */

export function genEmaSM(
  id: string,
  TF: string,
  tf: string,
  fast = 12,
  slow = 48,
  retestPoints = 100,   // retest tolerance in POINTS (≈10 pips on a 5-digit symbol)
): string {
  const P = `EMASM_${id}_`;

  return `
//+------------------------------------------------------------------+
//| EMA Retest State Machine — ${tf} (${id})                        |
//| fast=${fast}  slow=${slow}  retest tol=${retestPoints} pts                  |
//| IDLE → ARMED (retest slow EMA) → CONFIRMED (close outside fast)  |
//+------------------------------------------------------------------+
#define ${P}IDLE  0
#define ${P}ARMED 1

int    ${P}phase        = ${P}IDLE;
int    ${P}activeDir    = 0;        //  1 bull pullback,  -1 bear pullback
double ${P}swingLow     = 0.0;
double ${P}swingHigh    = 0.0;
bool   ${P}justConfirmed = false;
int    ${P}confirmDir   = 0;
double ${P}confirmSL    = 0.0;
bool   ${P}consume      = false;    // reset on the tick AFTER a confirmation
datetime ${P}lastBar    = 0;

void ${P}Reset()
{
   ${P}phase         = ${P}IDLE;
   ${P}activeDir     = 0;
   ${P}swingLow      = 0.0;
   ${P}swingHigh     = 0.0;
   ${P}justConfirmed = false;
   ${P}confirmDir    = 0;
   ${P}confirmSL     = 0.0;
   ${P}consume       = false;
   ${P}lastBar       = 0;
}

// Guarded EMA read — returns false (not 0.0) when the buffer is not ready.
bool ${P}Val(int handle, int shift, double &out)
{
   double _b[];
   if(handle == INVALID_HANDLE || CopyBuffer(handle, 0, shift, 1, _b) != 1) return false;
   out = _b[0];
   return true;
}

// Own fast/slow alignment (Direction Brain role). Draws the EMAs via B4_MA.
int ${P}Bias()
{
   double f, s;
   int hF = B4_MA(${TF}, ${fast}, MODE_EMA);
   int hS = B4_MA(${TF}, ${slow}, MODE_EMA);
   if(!${P}Val(hF, 1, f) || !${P}Val(hS, 1, s)) return 0;
   return (f > s) ? 1 : (f < s ? -1 : 0);
}

// Advance the retest sequence once per bar for the supplied bias direction.
void ${P}Tick(int bias)
{
   datetime _bt = iTime(InpSymbol, ${TF}, 0);
   if(_bt == ${P}lastBar) return;          // once per bar (safe if Setup+Exec both call)
   ${P}lastBar = _bt;
   ${P}justConfirmed = false;

   // Reset state on the tick after a confirmation was reported.
   if(${P}consume) { ${P}phase = ${P}IDLE; ${P}activeDir = 0; ${P}consume = false; }

   double f, s;
   int hF = B4_MA(${TF}, ${fast}, MODE_EMA);
   int hS = B4_MA(${TF}, ${slow}, MODE_EMA);
   if(!${P}Val(hF, 1, f) || !${P}Val(hS, 1, s)) return;   // buffers not ready — do nothing

   double hi = iHigh (InpSymbol, ${TF}, 1);
   double lo = iLow  (InpSymbol, ${TF}, 1);
   double cl = iClose(InpSymbol, ${TF}, 1);
   double tol = ${retestPoints} * SymbolInfoDouble(InpSymbol, SYMBOL_POINT);

   if(bias == 0) { ${P}phase = ${P}IDLE; ${P}activeDir = 0; return; }   // no trend
   if(${P}phase == ${P}ARMED && ${P}activeDir != bias) { ${P}phase = ${P}IDLE; ${P}activeDir = 0; }

   if(bias == 1)                                   // ── BULL pullback ──────────
   {
      if(${P}phase == ${P}IDLE)
      {
         // Retest: the bar's low came within tol of the slow EMA. ARM only.
         if(lo <= s + tol)
         {
            ${P}phase = ${P}ARMED; ${P}activeDir = 1; ${P}swingLow = lo;
            PrintFormat("[EMASM_${tf}] BULL retest armed @ slow=%.5f low=%.5f", s, lo);
         }
      }
      else                                          // ARMED
      {
         if(lo < ${P}swingLow) ${P}swingLow = lo;    // track pullback low for SL
         if(cl < s)                                  // closed below slow → invalidated
         {
            ${P}phase = ${P}IDLE; ${P}activeDir = 0;
            PrintFormat("[EMASM_${tf}] BULL retest invalidated (close %.5f < slow %.5f)", cl, s);
         }
         else if(cl > f)                             // confirmation: closed above fast
         {
            ${P}justConfirmed = true; ${P}confirmDir = 1; ${P}confirmSL = ${P}swingLow;
            ${P}consume = true;                       // stay ARMED this bar; reset next tick
            PrintFormat("[EMASM_${tf}] BULL CONFIRMED close=%.5f > fast=%.5f SL=%.5f", cl, f, ${P}swingLow);
         }
      }
   }
   else                                            // ── BEAR pullback ──────────
   {
      if(${P}phase == ${P}IDLE)
      {
         if(hi >= s - tol)
         {
            ${P}phase = ${P}ARMED; ${P}activeDir = -1; ${P}swingHigh = hi;
            PrintFormat("[EMASM_${tf}] BEAR retest armed @ slow=%.5f high=%.5f", s, hi);
         }
      }
      else
      {
         if(hi > ${P}swingHigh) ${P}swingHigh = hi;
         if(cl > s)
         {
            ${P}phase = ${P}IDLE; ${P}activeDir = 0;
            PrintFormat("[EMASM_${tf}] BEAR retest invalidated (close %.5f > slow %.5f)", cl, s);
         }
         else if(cl < f)
         {
            ${P}justConfirmed = true; ${P}confirmDir = -1; ${P}confirmSL = ${P}swingHigh;
            ${P}consume = true;
            PrintFormat("[EMASM_${tf}] BEAR CONFIRMED close=%.5f < fast=%.5f SL=%.5f", cl, f, ${P}swingHigh);
         }
      }
   }
}

bool   ${P}RetestActive() { return ${P}phase == ${P}ARMED; }
int    ${P}ActiveDir()    { return ${P}activeDir; }
double ${P}ActiveSL()     { return (${P}activeDir == 1) ? ${P}swingLow : ${P}swingHigh; }
bool   ${P}JustConfirmed(){ return ${P}justConfirmed; }
int    ${P}ConfirmDir()   { return ${P}confirmDir; }
double ${P}ConfirmSL()    { return ${P}confirmSL; }
`;
}
