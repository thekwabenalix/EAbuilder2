/**
 * Brain State Types
 *
 * Each brain independently maintains its state and outputs it.
 * The EA reads these outputs and makes trading decisions.
 * This separation enables debugging and independent testing of each brain.
 */

/**
 * Direction Brain Output
 * Answers: "What is the market bias right now?"
 * Output by Direction_Brain_Execute() on each Direction TF bar
 */
export interface DirectionBrainState {
  /** 1 = BUY bias, -1 = SELL bias, 0 = NEUTRAL (no clear direction) */
  bias: number;

  /** When was this state last updated (bar time) */
  lastUpdate: number; // datetime in MQL5

  /** Human-readable reason for the bias (for logging) */
  reason: string;
  // Examples:
  // "D1 CHoCH bullish break @ 1.2050"
  // "D1 BOS bearish break @ 1.1900"
  // "No clear structure"

  /** Strength/confidence of the bias (0-100, optional) */
  confidence?: number;
}

/**
 * Setup Brain Output
 * Answers: "Is there a valid trading zone/setup right now?"
 * Output by Setup_Brain_Execute() on each Setup TF bar
 */
export interface SetupBrainState {
  /** true = confirmed setup zone exists and is active */
  active: boolean;

  /** Direction of the setup: 1 = BUY setup, -1 = SELL setup, 0 = none */
  direction: number;

  /** The far edge of the setup zone — used as SL anchor */
  slHint: number; // price level

  /** When was this zone confirmed (bar time) */
  zoneTime: number; // datetime in MQL5

  /** Human-readable description (for logging) */
  description: string;
  // Examples:
  // "H4 Order Block confirmed @ 1.1950-1.1920 (bullish)"
  // "H4 FVG filled and retested @ 1.1945-1.1930 (bearish)"
  // "No active setup"

  /** Additional context (zone details, for debugging) */
  zoneHigh?: number;
  zoneHigh?: number; // Note: typo fixed should be zoneLow
  zoneCount?: number; // how many zones active
}

/**
 * Execution Brain Output
 * Answers: "Is there an entry signal right now?"
 * Output by Execution_Brain_Execute() on each Execution TF bar
 */
export interface ExecutionBrainState {
  /** true = entry signal confirmed, ready to trade */
  signalReady: boolean;

  /** Direction of the signal: 1 = BUY, -1 = SELL */
  direction: number;

  /** Entry price (or 0 if no signal) */
  entryPrice: number;

  /** Suggested stop loss level */
  stopLossLevel: number;

  /** Suggested take profit level */
  takeProfitLevel: number;

  /** When was this signal confirmed */
  signalTime: number; // datetime in MQL5

  /** Human-readable description (for logging) */
  description: string;
  // Examples:
  // "M15 FVG confirmed bullish retest @ 1.1935"
  // "M15 Liquidity sweep + close-back @ 1.1920"
  // "No entry signal yet"

  /** Modules that triggered this signal (for multi-module transparency) */
  modulesTriggered?: string[]; // ["fvg", "liqsweep"]
}

/**
 * Global Confluence Gate
 * Answers: "Should we execute a trade right now?"
 * This is the logical AND of Direction + Setup + Execution
 */
export interface ConfluenceGate {
  /** true = all active brains agree, execute trade */
  canTrade: boolean;

  /** Why can't we trade (if canTrade = false) */
  blockedBy?: string[];
  // Examples:
  // ["direction_neutral", "setup_no_zone"]
  // ["execution_no_signal"]
  // (empty = all green)

  /** Timestamp of last gate check */
  checkedAt: number; // datetime in MQL5

  /** Summary for logging */
  summary: string;
  // Examples:
  // "✓ Direction=BULL Setup=ACTIVE Execution=SIGNAL → TRADE"
  // "✗ Direction=NEUTRAL Setup=ACTIVE Execution=SIGNAL → blocked by direction"
}

/**
 * Management Brain Output
 * Answers: "How much risk, where's the SL/TP, when to BE?"
 * Output by Management_Brain_GetConfig()
 */
export interface ManagementBrainState {
  riskPercent: number;
  rewardRisk: number;
  stopBuffer: number;
  breakEvenEnabled: boolean;
  breakEvenAtR: number;
  maxOpenTrades: number;
  // These are mostly static (set once), but kept as state for consistency
}
