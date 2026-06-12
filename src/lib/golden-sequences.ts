/**
 * Phase 4 — canonical ordered strategy sequences.
 *
 * Each case is a trader-realistic 4-Brain config with proofs for:
 *   - StrategyFlow step order, events, and dependencies
 *   - Router path (flow vs assembler vs legacy)
 *   - Generated MQL5 markers (compile anchors + runtime gates)
 */

import type { FourBrainConfig, StrategyBlueprint } from "@/types/blueprint";
import { DEFAULT_BLUEPRINT } from "@/types/blueprint";
import type { StrategyEventType } from "@/lib/strategy-events";
import type { EaGenerationPath } from "@/lib/generate-ea-router";

export interface GoldenFlowStepProof {
  id: string;
  role: "direction" | "setup" | "entry";
  module: string;
  timeframe: string;
  event: StrategyEventType;
  /** Required upstream step ids (subset — order enforced separately). */
  dependsOn?: string[];
}

export interface GoldenSequenceCase {
  id: string;
  name: string;
  description: string;
  fourBrain: FourBrainConfig;
  expectedPath: EaGenerationPath;
  steps: GoldenFlowStepProof[];
  codeMarkers: string[];
  /** When set, verify script emits verify/mql5/golden/{emitFile} for MetaEditor compile. */
  emitFile?: string;
}

const mgmt = { riskPercent: 1, rewardRisk: 3, stopBuffer: 20, maxOpenTrades: 1 };

/** Ordered trader sequences the SaaS must preserve end-to-end. */
export const GOLDEN_SEQUENCE_CASES: GoldenSequenceCase[] = [
  {
    id: "bos_fvg_bos",
    name: "H1 BOS → H1 FVG → M5 BOS",
    description: "North-star SMC sequence: HTF bias, HTF zone setup, LTF structure break entry.",
    fourBrain: {
      direction: { modules: ["bos"], timeframe: "H1", params: { lookback: 20, swingLen: 5 } },
      setup: { modules: ["fvg"], timeframe: "H1", params: { expiryBars: 100 } },
      execution: { modules: ["bos"], timeframe: "M5", params: { lookback: 20, swingLen: 5 } },
      management: mgmt,
    },
    expectedPath: "flow_engine",
    steps: [
      {
        id: "step_direction",
        role: "direction",
        module: "bos",
        timeframe: "H1",
        event: "BOS_BIAS",
      },
      {
        id: "step_setup",
        role: "setup",
        module: "fvg",
        timeframe: "H1",
        event: "FVG_CREATED",
        dependsOn: ["step_direction"],
      },
      {
        id: "step_entry",
        role: "entry",
        module: "bos",
        timeframe: "M5",
        event: "BOS_CONFIRMED",
        dependsOn: ["step_setup"],
      },
    ],
    codeMarkers: [
      "RegisterEvent",
      "EvaluateEntry_2",
      "void BOSSM_H1_Tick",
      "void FVGSM_H1_Tick",
      "void BOSSM_M5_Tick",
      "BLOCKED:",
      "EA_BUILDER_EQUITY",
    ],
    emitFile: "GOLDEN_BOS_FVG_BOS.mq5",
  },
  {
    id: "choch_liq_ifvg",
    name: "D1 CHoCH → H4 Liquidity Sweep → M5 IFVG",
    description: "Bias flip, sweep setup, inverted FVG execution on verified SMs.",
    fourBrain: {
      direction: { modules: ["choch"], timeframe: "D1", params: { lookback: 20, swingLen: 5 } },
      setup: { modules: ["liqsweep"], timeframe: "H4", params: { lookback: 30, swingLen: 4 } },
      execution: { modules: ["fvg_inversion"], timeframe: "M5", params: { expiryBars: 100 } },
      management: { ...mgmt, rewardRisk: 2 },
    },
    expectedPath: "flow_engine",
    steps: [
      {
        id: "step_direction",
        role: "direction",
        module: "choch",
        timeframe: "D1",
        event: "CHOCH_BIAS_FLIP",
      },
      {
        id: "step_setup",
        role: "setup",
        module: "liqsweep",
        timeframe: "H4",
        event: "LIQUIDITY_SWEEP",
        dependsOn: ["step_direction"],
      },
      {
        id: "step_entry",
        role: "entry",
        module: "fvg_inversion",
        timeframe: "M5",
        event: "IFVG_FORMED",
        dependsOn: ["step_setup"],
      },
    ],
    codeMarkers: [
      "RegisterEvent",
      "void BOSSM_D1_Tick",
      "void LSSM_H4_Tick",
      "void IFVGSM_M5_Tick",
      "LSSM_H4_BullJustConfirmed",
      "IFVGSM_M5_BullJustInverted",
    ],
    emitFile: "GOLDEN_CHOCH_LIQ_IFVG.mq5",
  },
  {
    id: "bos_ob_eng",
    name: "D1 BOS → H4 Order Block → M5 Engulfing",
    description: "Multi-TF institutional sequence through flow ordered gate.",
    fourBrain: {
      direction: { modules: ["bos"], timeframe: "D1", params: { lookback: 20 } },
      setup: { modules: ["order_block"], timeframe: "H4", params: { expiryBars: 80 } },
      execution: { modules: ["engulfing"], timeframe: "M5", params: { expiryBars: 100 } },
      management: { ...mgmt, rewardRisk: 2 },
    },
    expectedPath: "flow_engine",
    steps: [
      {
        id: "step_direction",
        role: "direction",
        module: "bos",
        timeframe: "D1",
        event: "BOS_BIAS",
      },
      {
        id: "step_setup",
        role: "setup",
        module: "order_block",
        timeframe: "H4",
        event: "OB_CREATED",
        dependsOn: ["step_direction"],
      },
      {
        id: "step_entry",
        role: "entry",
        module: "engulfing",
        timeframe: "M5",
        event: "ENGULFING_CONFIRMED",
        dependsOn: ["step_setup"],
      },
    ],
    codeMarkers: [
      "void BOSSM_D1_Tick",
      "void OBSM_H4_Tick",
      "void EGSM_M5_Tick",
      "EvaluateEntry_2",
    ],
    emitFile: "GOLDEN_BOS_OB_ENG.mq5",
  },
  {
    id: "ema_snr_rsi",
    name: "M15 EMA → M15 S/R → M5 RSI HD",
    description: "Trend bias, level setup, divergence entry — includes B4_MA helper.",
    fourBrain: {
      direction: { modules: ["ema"], timeframe: "M15", params: { fastPeriod: 12, slowPeriod: 48 } },
      setup: { modules: ["snr"], timeframe: "M15", params: { lookback: 20, expiryBars: 100 } },
      execution: {
        modules: ["rsi_hd"],
        timeframe: "M5",
        params: { rsiPeriod: 14, expiryBars: 60 },
      },
      management: { ...mgmt, rewardRisk: 2 },
    },
    expectedPath: "flow_engine",
    steps: [
      {
        id: "step_direction",
        role: "direction",
        module: "ema",
        timeframe: "M15",
        event: "EMA_BIAS",
      },
      {
        id: "step_setup",
        role: "setup",
        module: "snr",
        timeframe: "M15",
        event: "SNR_TOUCH",
        dependsOn: ["step_direction"],
      },
      {
        id: "step_entry",
        role: "entry",
        module: "rsi_hd",
        timeframe: "M5",
        event: "RSI_HD_CONFIRMED",
        dependsOn: ["step_setup"],
      },
    ],
    codeMarkers: [
      "void EMASM_M15_Tick",
      "void SNRSM_M15_Tick",
      "void RSIHDSM_M5_Tick",
      "B4_MA(",
      "EvaluateEntry_2",
    ],
    emitFile: "GOLDEN_EMA_SNR_RSI.mq5",
  },
  {
    id: "bos_engulfing_direct",
    name: "H1 BOS → M5 Engulfing (no setup brain)",
    description: "Direction + execution only — setup brain omitted, entry depends on direction.",
    fourBrain: {
      direction: { modules: ["bos"], timeframe: "H1", params: { lookback: 20 } },
      execution: { modules: ["engulfing"], timeframe: "M5", params: {} },
      management: { ...mgmt, rewardRisk: 2 },
    },
    expectedPath: "flow_engine",
    steps: [
      {
        id: "step_direction",
        role: "direction",
        module: "bos",
        timeframe: "H1",
        event: "BOS_BIAS",
      },
      {
        id: "step_entry",
        role: "entry",
        module: "engulfing",
        timeframe: "M5",
        event: "ENGULFING_CONFIRMED",
        dependsOn: ["step_direction"],
      },
    ],
    codeMarkers: ["void BOSSM_H1_Tick", "void EGSM_M5_Tick", "EvaluateEntry_1"],
    emitFile: "GOLDEN_BOS_ENG_DIRECT.mq5",
  },
  {
    id: "dual_entry_or",
    name: "H1 BOS → H1 FVG → M5 BOS OR Engulfing",
    description: "Multi-module execution brain expands to parallel entry steps (OR semantics).",
    fourBrain: {
      direction: { modules: ["bos"], timeframe: "H1", params: { lookback: 20 } },
      setup: { modules: ["fvg"], timeframe: "H1", params: { expiryBars: 100 } },
      execution: { modules: ["bos", "engulfing"], timeframe: "M5", params: { lookback: 20 } },
      management: { ...mgmt, rewardRisk: 2 },
    },
    expectedPath: "flow_engine",
    steps: [
      {
        id: "step_direction",
        role: "direction",
        module: "bos",
        timeframe: "H1",
        event: "BOS_BIAS",
      },
      {
        id: "step_setup",
        role: "setup",
        module: "fvg",
        timeframe: "H1",
        event: "FVG_CREATED",
        dependsOn: ["step_direction"],
      },
      {
        id: "step_entry_0",
        role: "entry",
        module: "bos",
        timeframe: "M5",
        event: "BOS_CONFIRMED",
        dependsOn: ["step_setup"],
      },
      {
        id: "step_entry_1",
        role: "entry",
        module: "engulfing",
        timeframe: "M5",
        event: "ENGULFING_CONFIRMED",
        dependsOn: ["step_setup"],
      },
    ],
    codeMarkers: ["EvaluateEntry_2", "EvaluateEntry_3", "void EGSM_M5_Tick", "void BOSSM_M5_Tick"],
    emitFile: "GOLDEN_DUAL_ENTRY_OR.mq5",
  },
  {
    id: "gap_snr_rejection",
    name: "H4 Gap S/R → M5 Rejection",
    description: "Reactive SNR family without direction brain.",
    fourBrain: {
      setup: { modules: ["gap_snr"], timeframe: "H4", params: { lookback: 70, expiryBars: 100 } },
      execution: {
        modules: ["rejection"],
        timeframe: "M5",
        params: { lookback: 25, expiryBars: 150 },
      },
      management: { ...mgmt, rewardRisk: 2 },
    },
    expectedPath: "flow_engine",
    steps: [
      {
        id: "step_setup",
        role: "setup",
        module: "gap_snr",
        timeframe: "H4",
        event: "GAP_SNR_TOUCH",
      },
      {
        id: "step_entry",
        role: "entry",
        module: "rejection",
        timeframe: "M5",
        event: "REJECTION_CONFIRMED",
        dependsOn: ["step_setup"],
      },
    ],
    codeMarkers: ["void GSNRSM_H4_Tick", "void REJSM_M5_Tick", "EvaluateEntry_1"],
    emitFile: "GOLDEN_GAP_SNR_REJECTION.mq5",
  },
  {
    id: "rsi_obfvg_flow",
    name: "RSI HD setup → OB+FVG execution (flow path)",
    description: "Reactive setup with confluence entry — flow engine ordered gate.",
    fourBrain: {
      setup: { modules: ["rsi_hd"], timeframe: "H4", params: { rsiPeriod: 21, expiryBars: 80 } },
      execution: { modules: ["ob_fvg"], timeframe: "M15", params: { expiryBars: 60 } },
      management: { ...mgmt, rewardRisk: 2 },
    },
    expectedPath: "flow_engine",
    steps: [
      {
        id: "step_setup",
        role: "setup",
        module: "rsi_hd",
        timeframe: "H4",
        event: "RSI_HD_CONFIRMED",
      },
      {
        id: "step_entry",
        role: "entry",
        module: "ob_fvg",
        timeframe: "M15",
        event: "OB_FVG_CONFIRMED",
        dependsOn: ["step_setup"],
      },
    ],
    codeMarkers: ["void RSIHDSM_H4_Tick", "void OBFVGSM_M15_Tick", "RegisterEvent"],
    emitFile: "GOLDEN_RSI_OBFVG.mq5",
  },
  {
    id: "legacy_pin_bar",
    name: "BOS + Pin Bar (legacy heuristic fallback)",
    description: "Router must fall back when execution module has no verified SM.",
    fourBrain: {
      direction: { modules: ["bos"], timeframe: "H1", params: { lookback: 20 } },
      execution: { modules: ["pin_bar"], timeframe: "M5", params: {} },
      management: { ...mgmt, rewardRisk: 2 },
    },
    expectedPath: "legacy_heuristic",
    steps: [
      {
        id: "step_direction",
        role: "direction",
        module: "bos",
        timeframe: "H1",
        event: "BOS_BIAS",
      },
      {
        id: "step_entry",
        role: "entry",
        module: "pin_bar",
        timeframe: "M5",
        event: "PIN_BAR_CONFIRMED",
        dependsOn: ["step_direction"],
      },
    ],
    codeMarkers: ["legacy heuristic", "PIN_BAR", "gExecSignal", "4-Brain Architecture"],
  },
];

export function goldenSequenceBlueprint(testCase: GoldenSequenceCase): StrategyBlueprint {
  return {
    ...DEFAULT_BLUEPRINT,
    name: testCase.name,
    fourBrain: testCase.fourBrain,
  };
}

export function getGoldenSequenceCase(id: string): GoldenSequenceCase | undefined {
  return GOLDEN_SEQUENCE_CASES.find((c) => c.id === id);
}
