// ─── MTF Types ───────────────────────────────────────────────────────────────
// Multi-Timeframe Orchestration Layer — EAbuilder2
// Types only — no generation logic in this file.

export const MTF_ORCHESTRATOR_VERSION = "1.0.0";

// ── Step lifecycle ────────────────────────────────────────────────────────────

export type MtfStepStatus =
  | "WAITING"    // awaiting prior step to reach CONFIRMED
  | "ACTIVE"     // dependency satisfied — monitoring for own signal
  | "CONFIRMED"  // signal received — acts as dependency for next step
  | "EXPIRED";   // barsAlive exceeded expiryBars — full chain resets

// ── Strategy direction ────────────────────────────────────────────────────────

export type MtfDirection = "BULL" | "BEAR";

// ── Supported MQL5 timeframe enums ────────────────────────────────────────────

export type MqlTimeframe =
  | "PERIOD_M1"  | "PERIOD_M2"  | "PERIOD_M3"  | "PERIOD_M4"
  | "PERIOD_M5"  | "PERIOD_M6"  | "PERIOD_M10" | "PERIOD_M12"
  | "PERIOD_M15" | "PERIOD_M20" | "PERIOD_M30"
  | "PERIOD_H1"  | "PERIOD_H2"  | "PERIOD_H3"  | "PERIOD_H4"
  | "PERIOD_H6"  | "PERIOD_H8"  | "PERIOD_H12"
  | "PERIOD_D1"  | "PERIOD_W1"  | "PERIOD_MN1"
  | "PERIOD_CURRENT";

// ── Per-step configuration ────────────────────────────────────────────────────

export interface MtfStepConfig {
  /**
   * Human-readable label shown in the MQL5 input group header
   * e.g. "D1 FVG Bull Confirm"
   */
  label: string;

  /**
   * State module filename without .mq5 extension.
   * Must be accessible in MQL5/Indicators/ on the target platform.
   * e.g. "FVG_State_Module"
   */
  moduleName: string;

  /**
   * Timeframe on which this step's module is loaded.
   * The module detects / tracks zones on this timeframe.
   */
  timeframe: MqlTimeframe;

  /**
   * Number of bars the module should analyse on its timeframe.
   * Passed as the second iCustom() parameter (after tf).
   */
  lookback: number;

  /**
   * Index of the buffer inside the module to read for the signal.
   * FVG_State_Module standard:
   *   0 = BullConfirmBuf   1 = BearConfirmBuf
   *   2 = BullSLBuf        3 = BearSLBuf
   */
  bufIdx: number;

  /**
   * Buffer value that marks this step as CONFIRMED.
   * Almost always 1.0 for signal buffers.
   */
  triggerValue: number;

  /**
   * How many bars on the EXECUTION timeframe may pass while this step is
   * ACTIVE before the entire chain resets to WAITING from this step.
   */
  expiryBars: number;
}

// ── Execution configuration ───────────────────────────────────────────────────

export interface MtfExecutionConfig {
  /**
   * Buffer index in the FINAL step's module that provides the SL price.
   * FVG_State_Module standard: 2 = BullSLBuf, 3 = BearSLBuf
   */
  slBufIdx: number;

  /** EA magic number — identifies this strategy's open positions */
  magic: number;

  /** Risk per trade as a percentage of account balance (e.g. 1.0 = 1%) */
  riskPct: number;

  /** Fixed reward-to-risk ratio used to place the take profit */
  rr: number;

  /**
   * Move SL to breakeven when floating profit reaches N × initial-risk.
   * Set to 0 to disable breakeven management.
   */
  breakevenR: number;

  /** Maximum number of concurrent positions this EA may hold */
  maxTrades: number;

  /** Maximum allowed spread in points before a trade is blocked */
  maxSpreadPts: number;

  /** Maximum allowed slippage in points */
  slippage: number;
}

// ── Orchestrator configuration (full strategy definition) ─────────────────────

export interface MtfOrchestratorConfig {
  /** Unique identifier used in module registry */
  id: string;

  /**
   * Base name for the generated EA filename (without .mq5).
   * e.g. "MTF_FVG_3TF_Bull"
   */
  name: string;

  /** Human-readable strategy description shown in the UI */
  description: string;

  /**
   * Direction this orchestrator instance trades.
   *
   * BULL → triggers a BUY when all steps confirm.
   * BEAR → triggers a SELL when all steps confirm.
   *
   * To trade both directions, download and run two separate orchestrators
   * (one BULL, one BEAR) with independent magic numbers.
   */
  direction: MtfDirection;

  /**
   * Ordered list of steps.
   *
   * Dependency is always linear: step[i] depends on step[i-1] being CONFIRMED.
   * Minimum 2 steps, maximum 6 steps.
   *
   * The FINAL step also provides the SL price buffer used for execution.
   */
  steps: MtfStepConfig[];

  /** Trade management parameters applied when all steps are CONFIRMED */
  execution: MtfExecutionConfig;
}
