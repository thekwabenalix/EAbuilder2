/**
 * Module admission registry.
 *
 * This is the project-level status board for every module-like concept that can
 * appear in the builder, AI vocabulary, contract registry, or verifier output.
 */

export type ModuleAdmissionStatus =
  | "verified_state_machine"
  | "template_only"
  | "not_verified"
  | "detector_only";

export interface ModuleAdmissionRecord {
  id: string;
  label: string;
  status: ModuleAdmissionStatus;
  aiVocabulary: boolean;
  contractRequired: boolean;
  notes: string;
}

export const MODULE_ADMISSION_STATUS_META: Record<
  ModuleAdmissionStatus,
  {
    label: string;
    shortLabel: string;
    tone: string;
    description: string;
  }
> = {
  verified_state_machine: {
    label: "Verified State Machine",
    shortLabel: "Verified",
    tone: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    description: "Safe for AI 4-Brain wiring through a verified inline state machine.",
  },
  template_only: {
    label: "Template Only",
    shortLabel: "Template",
    tone: "bg-sky-500/10 text-sky-300 border-sky-500/20",
    description: "Deterministic template primitive, but not yet an inline state machine.",
  },
  not_verified: {
    label: "Not Verified",
    shortLabel: "Guarded",
    tone: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    description: "Known vocabulary only. Guarded from reliable live EA wiring.",
  },
  detector_only: {
    label: "Detector Only",
    shortLabel: "Detector",
    tone: "bg-muted text-muted-foreground border-border/60",
    description: "Standalone detector or indicator. Not admitted to AI EA wiring.",
  },
};

export function getModuleAdmission(moduleId: string): ModuleAdmissionRecord | undefined {
  return MODULE_ADMISSION[moduleId] ?? MODULE_ADMISSION[moduleId.replace(/^ob$/, "order_block")];
}

export const MODULE_ADMISSION: Record<string, ModuleAdmissionRecord> = {
  ema: {
    id: "ema",
    label: "EMA",
    status: "verified_state_machine",
    aiVocabulary: true,
    contractRequired: true,
    notes: "Verified EMA alignment and cross-retest contract.",
  },
  fvg_inversion: {
    id: "fvg_inversion",
    label: "Inversion FVG",
    status: "verified_state_machine",
    aiVocabulary: true,
    contractRequired: true,
    notes: "Verified IFVG state machine. Formation and retest semantics are distinct.",
  },
  fvg: {
    id: "fvg",
    label: "Fair Value Gap",
    status: "verified_state_machine",
    aiVocabulary: true,
    contractRequired: true,
    notes: "Verified FVG state machine.",
  },
  order_block: {
    id: "order_block",
    label: "Order Block",
    status: "verified_state_machine",
    aiVocabulary: true,
    contractRequired: true,
    notes: "Also receives supply/demand-style intake mapping until a separate S/D SM exists.",
  },
  ob_fvg: {
    id: "ob_fvg",
    label: "Order Block + FVG",
    status: "verified_state_machine",
    aiVocabulary: true,
    contractRequired: true,
    notes: "Verified confluence state machine.",
  },
  bos: {
    id: "bos",
    label: "Break of Structure",
    status: "verified_state_machine",
    aiVocabulary: true,
    contractRequired: true,
    notes: "Verified structure state machine.",
  },
  choch: {
    id: "choch",
    label: "Change of Character",
    status: "verified_state_machine",
    aiVocabulary: true,
    contractRequired: true,
    notes: "Verified structure state machine using BOSSM family.",
  },
  bos_choch: {
    id: "bos_choch",
    label: "BOS + CHoCH",
    status: "verified_state_machine",
    aiVocabulary: true,
    contractRequired: true,
    notes: "Combined structure contract using BOSSM family.",
  },
  liqsweep: {
    id: "liqsweep",
    label: "Liquidity Sweep",
    status: "verified_state_machine",
    aiVocabulary: true,
    contractRequired: true,
    notes: "Verified sweep state machine.",
  },
  snr: {
    id: "snr",
    label: "Support and Resistance",
    status: "verified_state_machine",
    aiVocabulary: true,
    contractRequired: true,
    notes: "Verified classic S/R state machine.",
  },
  gap_snr: {
    id: "gap_snr",
    label: "Gap S/R",
    status: "verified_state_machine",
    aiVocabulary: true,
    contractRequired: true,
    notes: "Verified gap-derived S/R state machine.",
  },
  rejection: {
    id: "rejection",
    label: "Rejection",
    status: "verified_state_machine",
    aiVocabulary: true,
    contractRequired: true,
    notes: "Verified reactive S/R rejection state machine.",
  },
  miss: {
    id: "miss",
    label: "Missed Level",
    status: "verified_state_machine",
    aiVocabulary: true,
    contractRequired: true,
    notes: "Verified reactive S/R missed-level state machine.",
  },
  breakout: {
    id: "breakout",
    label: "Breakout",
    status: "verified_state_machine",
    aiVocabulary: true,
    contractRequired: true,
    notes: "Verified breakout state machine.",
  },
  rsi_hd: {
    id: "rsi_hd",
    label: "RSI Hidden Divergence",
    status: "verified_state_machine",
    aiVocabulary: true,
    contractRequired: true,
    notes: "Verified RSI hidden divergence state machine.",
  },
  engulfing: {
    id: "engulfing",
    label: "Engulfing / Engulfing Failed",
    status: "verified_state_machine",
    aiVocabulary: true,
    contractRequired: true,
    notes: "Verified EG/EF state machine.",
  },
  bb: {
    id: "bb",
    label: "Bollinger Bands",
    status: "template_only",
    aiVocabulary: true,
    contractRequired: true,
    notes: "Deterministic template primitive; not yet an inline state machine.",
  },
  pin_bar: {
    id: "pin_bar",
    label: "Pin Bar",
    status: "template_only",
    aiVocabulary: true,
    contractRequired: true,
    notes: "Template-level candle primitive.",
  },
  swing_structure: {
    id: "swing_structure",
    label: "Swing Structure",
    status: "not_verified",
    aiVocabulary: true,
    contractRequired: true,
    notes: "Visual-builder vocabulary only until backed by a verified inline state machine.",
  },
  rbr_dbd: {
    id: "rbr_dbd",
    label: "RBR / DBD Supply-Demand Detector",
    status: "detector_only",
    aiVocabulary: false,
    contractRequired: false,
    notes:
      "Standalone detector currently emitted by verifier. Not admitted to AI wiring until a contract and state machine are added.",
  },
};
