/**
 * Brain State Types Generator
 *
 * Generates the struct definitions for all brain states.
 * These are the explicit outputs that each brain produces.
 */

export function genBrainStateTypes(): string {
  return `
//+------------------------------------------------------------------+
//| Brain State Type Definitions                                     |
//+------------------------------------------------------------------+

// Direction Brain: outputs market bias (BULL/BEAR/NEUTRAL)
struct DirectionBrainState
{
   int    bias;         // 1 = BULL, -1 = BEAR, 0 = NEUTRAL
   datetime lastUpdate; // when this state was last updated
   string reason;       // human-readable description (e.g., "CHOCH BULL break @ 1.0850")
   double confidence;   // placeholder for future confidence metric (0-1)
};

// Setup Brain: outputs active zones and entry conditions
struct SetupBrainState
{
   bool   active;          // true if a valid zone is active
   int    direction;       // 1 = BULL zone, -1 = BEAR zone, 0 = none
   double slHint;          // suggested stop-loss level (from zone)
   datetime zoneTime;      // when the zone was detected
   string description;     // human-readable zone description
   double zoneHigh;        // zone upper bound
   double zoneLow;         // zone lower bound
   int    zoneCount;       // number of active zones
};

// Execution Brain: outputs entry signal and trade parameters
struct ExecutionBrainState
{
   bool   signalReady;      // true if entry signal is active
   int    direction;        // 1 = BUY signal, -1 = SELL signal, 0 = none
   double entryPrice;       // market entry price
   double stopLossLevel;    // calculated stop-loss
   double takeProfitLevel;  // calculated take-profit
   datetime signalTime;     // when the signal was generated
   string description;      // human-readable signal description
   string modulesTriggered; // which modules triggered (e.g., "BULL_ENGULF")
};

// Management Brain: risk and exit configuration
struct ManagementBrainState
{
   double riskPercent;      // risk per trade (%)
   double rewardRisk;       // R:R ratio (1.5 = 1:1.5)
   double stopBuffer;       // buffer beyond zone (pips)
   bool   breakEvenEnabled; // enable break-even management?
   double breakEvenAtR;     // move to BE when profit reaches this R value
   int    maxOpenTrades;    // max simultaneous positions
};

// Confluence Gate: result of checking all brains
struct ConfluenceGate
{
   bool   canTrade;       // true if all brains agree to trade
   string blockedBy[];    // list of brains blocking the trade (if any)
   datetime checkedAt;    // when the gate was last evaluated
   string summary;        // human-readable gate status
};
`;
}
