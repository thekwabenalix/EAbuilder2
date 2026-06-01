/**
 * Inline EMA State Machine Generator (cross → retest → confirmation sequence)
 *
 * The canonical EMA pullback setup, as a verified state machine so the AI WIRES
 * it instead of hand-writing (and collapsing) the phases:
 *
 *   IDLE
 *     → CROSSED   : the fast/slow EMA CROSSES in the bias direction (12 crosses
 *                   48 up for bull / down for bear). This arms the setup.
 *                   (Skipped when requireCross = false.)
 *     → ARMED     : after the cross, price RETESTS the slow EMA (within
 *                   retestPoints). The retest bar only arms — it never fires.
 *     → CONFIRMED : a LATER bar CLOSES outside the fast EMA in the bias
 *                   direction → entry next bar. SL = pullback swing.
 *   After a confirmation, the machine returns to IDLE — a NEW cross is required
 *   for the next trade (prevents repeated entries off one move).
 *   Invalidation: bias flips, an opposite cross, or a bar closes back through
 *   the slow EMA while armed.
 *
 * Direction is supplied externally (the higher-TF gBias) so the lower-TF instance
 * aligns with the trend. Bias() is exposed for the Direction Brain role.
 *
 * Roles → API:
 *   Direction : EMASM_{id}_Bias()
 *   Setup     : EMASM_{id}_SetupActive()  (cross happened — setup live)
 *   Execution : EMASM_{id}_JustConfirmed() (close outside fast after retest)
 *
 * EMAs are real iMA handles drawn via B4_MA, read with a GUARDED copy (never the
 * 0.0 fallback) so unready buffers can't produce phantom signals.
 *
 * Full API:
 *   EMASM_{id}_Reset()
 *   EMASM_{id}_Tick(int bias)
 *   EMASM_{id}_Bias()           — own fast/slow alignment (Direction)
 *   EMASM_{id}_SetupActive()    — CROSSED or ARMED (Setup)
 *   EMASM_{id}_RetestActive()   — ARMED only (retest in progress)
 *   EMASM_{id}_ActiveDir()      — direction of the live setup
 *   EMASM_{id}_ActiveSL()       — swing SL hint while live
 *   EMASM_{id}_JustConfirmed()  — entry fired this bar (Execution)
 *   EMASM_{id}_ConfirmDir()     — direction of the confirmation
 *   EMASM_{id}_ConfirmSL()      — swing SL at confirmation
 */

export function genEmaSM(
  id: string,
  TF: string,
  tf: string,
  fast = 12,
  slow = 48,
  retestPoints = 100, // retest tolerance in POINTS (≈10 pips on a 5-digit symbol)
  requireCross = true, // require an aligned fast/slow cross before the retest
): string {
  const P = `EMASM_${id}_`;
  const RC = requireCross ? "true" : "false";

  return `
//+------------------------------------------------------------------+
//| EMA Cross→Retest State Machine — ${tf} (${id})                  |
//| fast=${fast} slow=${slow} retest=${retestPoints}pts requireCross=${RC}        |
//| IDLE → CROSSED → ARMED (retest) → CONFIRMED (close outside fast) |
//+------------------------------------------------------------------+
#define ${P}IDLE    0
#define ${P}CROSSED 1
#define ${P}ARMED   2

int    ${P}phase        = ${P}IDLE;
int    ${P}activeDir    = 0;        //  1 bull setup,  -1 bear setup
double ${P}swingLow     = 0.0;
double ${P}swingHigh    = 0.0;
bool   ${P}justConfirmed = false;
int    ${P}confirmDir   = 0;
double ${P}confirmSL    = 0.0;
bool   ${P}consume      = false;
datetime ${P}lastBar    = 0;

void ${P}Reset()
{
   ${P}phase = ${P}IDLE; ${P}activeDir = 0;
   ${P}swingLow = 0.0; ${P}swingHigh = 0.0;
   ${P}justConfirmed = false; ${P}confirmDir = 0; ${P}confirmSL = 0.0;
   ${P}consume = false; ${P}lastBar = 0;
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

void ${P}Tick(int bias)
{
   datetime _bt = iTime(InpSymbol, ${TF}, 0);
   if(_bt == ${P}lastBar) return;          // once per bar (safe if Setup+Exec both call)
   ${P}lastBar = _bt;
   ${P}justConfirmed = false;
   if(${P}consume) { ${P}phase = ${P}IDLE; ${P}activeDir = 0; ${P}consume = false; }

   double f1, s1, f2, s2;
   int hF = B4_MA(${TF}, ${fast}, MODE_EMA);
   int hS = B4_MA(${TF}, ${slow}, MODE_EMA);
   if(!${P}Val(hF, 1, f1) || !${P}Val(hS, 1, s1)) return;   // buffers not ready
   if(!${P}Val(hF, 2, f2) || !${P}Val(hS, 2, s2)) return;

   double hi = iHigh (InpSymbol, ${TF}, 1);
   double lo = iLow  (InpSymbol, ${TF}, 1);
   double cl = iClose(InpSymbol, ${TF}, 1);
   double tol = ${retestPoints} * SymbolInfoDouble(InpSymbol, SYMBOL_POINT);

   bool bullCross = (f2 <= s2 && f1 > s1);   // 12 crossed ABOVE 48 on the last bar
   bool bearCross = (f2 >= s2 && f1 < s1);   // 12 crossed BELOW 48 on the last bar
   bool requireCross = ${RC};

   if(bias == 0) { ${P}phase = ${P}IDLE; ${P}activeDir = 0; return; }   // no trend
   if(${P}activeDir != 0 && ${P}activeDir != bias) { ${P}phase = ${P}IDLE; ${P}activeDir = 0; }

   if(bias == 1)                                   // ── BULL ───────────────────
   {
      if(${P}phase == ${P}IDLE)
      {
         if(!requireCross && lo <= s1 + tol)        // retest-only mode: arm directly
         { ${P}phase = ${P}ARMED; ${P}activeDir = 1; ${P}swingLow = lo; }
         else if(requireCross && bullCross)         // cross arms the setup
         { ${P}phase = ${P}CROSSED; ${P}activeDir = 1;
           PrintFormat("[EMASM_${tf}] BULL cross — setup armed (12 over 48)"); }
      }
      else if(${P}phase == ${P}CROSSED)
      {
         if(bearCross) { ${P}phase = ${P}IDLE; ${P}activeDir = 0; }      // regime flipped
         else if(lo <= s1 + tol)                    // retest of the slow EMA
         { ${P}phase = ${P}ARMED; ${P}swingLow = lo;
           PrintFormat("[EMASM_${tf}] BULL retest of slow=%.5f low=%.5f", s1, lo); }
      }
      else                                          // ARMED
      {
         if(lo < ${P}swingLow) ${P}swingLow = lo;
         if(bearCross || cl < s1) { ${P}phase = ${P}IDLE; ${P}activeDir = 0;
            PrintFormat("[EMASM_${tf}] BULL setup invalidated"); }
         else if(cl > f1)                           // confirmation: close above fast
         { ${P}justConfirmed = true; ${P}confirmDir = 1; ${P}confirmSL = ${P}swingLow; ${P}consume = true;
           PrintFormat("[EMASM_${tf}] BULL CONFIRMED close=%.5f > fast=%.5f SL=%.5f", cl, f1, ${P}swingLow); }
      }
   }
   else                                            // ── BEAR ───────────────────
   {
      if(${P}phase == ${P}IDLE)
      {
         if(!requireCross && hi >= s1 - tol)
         { ${P}phase = ${P}ARMED; ${P}activeDir = -1; ${P}swingHigh = hi; }
         else if(requireCross && bearCross)
         { ${P}phase = ${P}CROSSED; ${P}activeDir = -1;
           PrintFormat("[EMASM_${tf}] BEAR cross — setup armed (12 under 48)"); }
      }
      else if(${P}phase == ${P}CROSSED)
      {
         if(bullCross) { ${P}phase = ${P}IDLE; ${P}activeDir = 0; }
         else if(hi >= s1 - tol)
         { ${P}phase = ${P}ARMED; ${P}swingHigh = hi;
           PrintFormat("[EMASM_${tf}] BEAR retest of slow=%.5f high=%.5f", s1, hi); }
      }
      else
      {
         if(hi > ${P}swingHigh) ${P}swingHigh = hi;
         if(bullCross || cl > s1) { ${P}phase = ${P}IDLE; ${P}activeDir = 0;
            PrintFormat("[EMASM_${tf}] BEAR setup invalidated"); }
         else if(cl < f1)
         { ${P}justConfirmed = true; ${P}confirmDir = -1; ${P}confirmSL = ${P}swingHigh; ${P}consume = true;
           PrintFormat("[EMASM_${tf}] BEAR CONFIRMED close=%.5f < fast=%.5f SL=%.5f", cl, f1, ${P}swingHigh); }
      }
   }
}

bool   ${P}SetupActive()  { return ${P}phase == ${P}CROSSED || ${P}phase == ${P}ARMED; }
bool   ${P}RetestActive() { return ${P}phase == ${P}ARMED; }
int    ${P}ActiveDir()    { return ${P}activeDir; }
double ${P}ActiveSL()     { return (${P}activeDir == 1) ? ${P}swingLow : ${P}swingHigh; }
bool   ${P}JustConfirmed(){ return ${P}justConfirmed; }
int    ${P}ConfirmDir()   { return ${P}confirmDir; }
double ${P}ConfirmSL()    { return ${P}confirmSL; }
`;
}
