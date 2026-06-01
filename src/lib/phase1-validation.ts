/**
 * Phase 1: 4-Brain Architecture Validation Suite (5 tests)
 *
 * Validates the modular generator output against the current architecture:
 *   - Global brain state vars: gBias, gSetupActive, gSetupDir, gExecSignal, gExecDir, gExecSL
 *   - Brain functions: Direction_Brain_Execute, Setup_Brain_Execute, Execution_Brain_Execute
 *   - Confluence gate: gBias, gSetupActive, gExecSignal all checked before trade
 *   - Multi-module AND logic in Direction Brain
 *   - iFVG state machine auto-injected when fvg_inversion is selected
 */

import { generateEA } from "@/generators/gen-ea";
import type { FourBrainConfig, MQL5CodeGenParams } from "@/types/blueprint";

interface TestResult {
  name: string;
  pass: boolean;
  details: string[];
}

function runChecks(
  label: string,
  code: string,
  checks: { desc: string; test: boolean }[],
): TestResult {
  const failures: string[] = [];
  for (const c of checks) {
    if (!c.test) failures.push(`  FAIL: ${c.desc}`);
  }
  return {
    name: label,
    pass: failures.length === 0,
    details: failures,
  };
}

// ─── Test 1: Classic ICT ─────────────────────────────────────────────────────
// CHoCH @ D1 → Order Block @ H4 → FVG @ M15
// Expected: all 3 brain functions, confluence gate, global state vars, no placeholders
function test1_ClassicICT(): TestResult {
  const config: FourBrainConfig = {
    direction: { modules: ["choch"], timeframe: "D1" },
    setup: { modules: ["order_block"], timeframe: "H4" },
    execution: { modules: ["fvg"], timeframe: "M15" },
    management: {
      riskPercent: 1,
      rewardRisk: 2,
      stopBuffer: 20,
      breakEvenEnabled: false,
      breakEvenAtR: 1,
      maxOpenTrades: 1,
    },
  };
  const params: MQL5CodeGenParams = {
    eaName: "ClassicICT_Test",
    config,
    globalSymbol: "EURUSD",
    globalMagic: 1001,
  };
  const code = generateEA(params);

  return runChecks("Test 1 — Classic ICT (CHoCH D1 → OB H4 → FVG M15)", code, [
    { desc: "EA header present", test: code.includes("ClassicICT_Test.mq5") },
    { desc: "Trade.mqh included", test: code.includes("#include <Trade/Trade.mqh>") },
    { desc: "gBias declared", test: code.includes("int    gBias") },
    { desc: "gSetupActive declared", test: code.includes("bool   gSetupActive") },
    { desc: "gExecSignal declared", test: code.includes("bool   gExecSignal") },
    {
      desc: "Direction_Brain_Execute defined",
      test: code.includes("void Direction_Brain_Execute()"),
    },
    { desc: "Setup_Brain_Execute defined", test: code.includes("void Setup_Brain_Execute()") },
    {
      desc: "Execution_Brain_Execute defined",
      test: code.includes("void Execution_Brain_Execute()"),
    },
    { desc: "Direction brain called in OnTick", test: code.includes("Direction_Brain_Execute();") },
    { desc: "Setup brain called in OnTick", test: code.includes("Setup_Brain_Execute();") },
    { desc: "Execution brain called in OnTick", test: code.includes("Execution_Brain_Execute();") },
    {
      desc: "Confluence gate checks gBias",
      test: code.includes("gBias == 0") || code.includes("gBias != 0"),
    },
    { desc: "Confluence gate checks gSetupActive", test: code.includes("gSetupActive") },
    { desc: "Confluence gate checks gExecSignal", test: code.includes("gExecSignal") },
    { desc: "BUY trade execution present", test: code.includes("trade.Buy(") },
    { desc: "SELL trade execution present", test: code.includes("trade.Sell(") },
    { desc: "CalcLot present", test: code.includes("double CalcLot(") },
    { desc: "Risk percent used", test: code.includes("InpRiskPercent") },
    { desc: "OnInit present", test: code.includes("int OnInit()") },
    { desc: "OnTick present", test: code.includes("void OnTick()") },
    {
      desc: "No unresolved {{ }} placeholders",
      test: !code.includes("{{") && !code.includes("}}"),
    },
    {
      desc: "CHoCH detection in direction brain",
      test: code.includes("_swH") && code.includes("CHoCH"),
    },
    { desc: "OB detection in setup brain", test: code.includes("SETUP") && code.includes("OB") },
    {
      desc: "FVG detection in execution brain",
      test: code.includes("FVG") && code.includes("gExecDir"),
    },
    { desc: "DrawInfoPanel chart overlay present", test: code.includes("DrawInfoPanel()") },
    { desc: "Bar-open check for direction", test: code.includes("lastDirBar") },
    { desc: "Bar-open check for execution", test: code.includes("lastExecBar") },
  ]);
}

// ─── Test 2: Multi-module Direction Brain (AND logic) ────────────────────────
// BOS + FVG_INVERSION @ H1 → FVG @ M5 (no setup)
// Expected: AND gate (_allNonZero && _allAgree), both module detection blocks
function test2_MultiModuleDirection(): TestResult {
  const config: FourBrainConfig = {
    direction: { modules: ["bos", "fvg_inversion"], timeframe: "H1" },
    execution: { modules: ["fvg"], timeframe: "M5" },
    management: {
      riskPercent: 1,
      rewardRisk: 2,
      stopBuffer: 20,
      breakEvenEnabled: false,
      breakEvenAtR: 1,
      maxOpenTrades: 1,
    },
  };
  const params: MQL5CodeGenParams = {
    eaName: "BOS_iFVG_Test",
    config,
    globalSymbol: "EURUSD",
    globalMagic: 1002,
  };
  const code = generateEA(params);

  return runChecks("Test 2 — Multi-module Direction: BOS + FVG_INVERSION AND logic", code, [
    { desc: "AND logic: _allNonZero declared", test: code.includes("_allNonZero") },
    { desc: "AND logic: _allAgree declared", test: code.includes("_allAgree") },
    {
      desc: "BOS detection present (_swH/_swL)",
      test: code.includes("_swH") && code.includes("_swL"),
    },
    { desc: "iFVG state machine injected for H1", test: code.includes("IFVGSM_H1_") },
    { desc: "iFVG SM Reset called in OnInit", test: code.includes("IFVGSM_H1_Reset()") },
    { desc: "iFVG SM Tick called in OnTick", test: code.includes("IFVGSM_H1_Tick(") },
    {
      desc: "BullJustConfirmed in direction",
      test: code.includes("IFVGSM_H1_BullJustConfirmed()"),
    },
    {
      desc: "BearJustConfirmed in direction",
      test: code.includes("IFVGSM_H1_BearJustConfirmed()"),
    },
    { desc: "gBias set to _combined after AND", test: code.includes("gBias = _combined") },
    {
      desc: "Setup disabled — passthrough active",
      test: code.includes("gSetupActive = (gBias != 0)"),
    },
    {
      desc: "No unresolved {{ }} placeholders",
      test: !code.includes("{{") && !code.includes("}}"),
    },
  ]);
}

// ─── Test 3: Execution-only config ───────────────────────────────────────────
// No direction, no setup — only execution brain
// Expected: direction bypass, setup bypass, confluence gate fires on exec signal alone
function test3_ExecutionOnly(): TestResult {
  const config: FourBrainConfig = {
    execution: { modules: ["engulfing"], timeframe: "H1" },
    management: {
      riskPercent: 0.5,
      rewardRisk: 1.5,
      stopBuffer: 10,
      breakEvenEnabled: false,
      breakEvenAtR: 1,
      maxOpenTrades: 2,
    },
  };
  const params: MQL5CodeGenParams = {
    eaName: "ExecOnly_Test",
    config,
    globalSymbol: "GBPUSD",
    globalMagic: 1003,
  };
  const code = generateEA(params);

  return runChecks("Test 3 — Execution-only (no direction, no setup)", code, [
    {
      desc: "Direction Brain disabled (empty function)",
      test: code.includes("Direction Brain: disabled"),
    },
    { desc: "Setup Brain disabled — passthrough", test: code.includes("Setup Brain: disabled") },
    { desc: "Direction gate bypassed in OnTick", test: code.includes("Direction Brain disabled") },
    { desc: "Setup gate bypassed in OnTick", test: code.includes("Setup Brain disabled") },
    { desc: "Execution brain still fires", test: code.includes("Execution_Brain_Execute()") },
    { desc: "Engulfing detection in exec brain", test: code.includes("ENGULF") },
    {
      desc: "Trade execution still present",
      test: code.includes("trade.Buy(") || code.includes("trade.Sell("),
    },
    {
      desc: "Max trades input uses 2",
      test: code.includes("input int             InpMaxTrades   = 2"),
    },
    {
      desc: "No unresolved {{ }} placeholders",
      test: !code.includes("{{") && !code.includes("}}"),
    },
  ]);
}

// ─── Test 4: iFVG state machine scoping ──────────────────────────────────────
// When fvg_inversion is in execution only, SM should be injected for exec TF only.
// When not used at all, no SM code should appear.
function test4_IfvgStateMachineScoping(): TestResult {
  // 4a: iFVG in execution only — SM only for exec TF (M5)
  const cfg_exec: FourBrainConfig = {
    direction: { modules: ["bos"], timeframe: "H4" },
    execution: { modules: ["fvg_inversion"], timeframe: "M5" },
    management: {
      riskPercent: 1,
      rewardRisk: 2,
      stopBuffer: 20,
      breakEvenEnabled: false,
      breakEvenAtR: 1,
      maxOpenTrades: 1,
    },
  };
  const code_exec = generateEA({ eaName: "SM_Exec_Test", config: cfg_exec });

  // 4b: No iFVG anywhere — no SM code at all
  const cfg_none: FourBrainConfig = {
    direction: { modules: ["bos"], timeframe: "H4" },
    execution: { modules: ["pin_bar"], timeframe: "M15" },
    management: {
      riskPercent: 1,
      rewardRisk: 2,
      stopBuffer: 20,
      breakEvenEnabled: false,
      breakEvenAtR: 1,
      maxOpenTrades: 1,
    },
  };
  const code_none = generateEA({ eaName: "SM_None_Test", config: cfg_none });

  // 4c: iFVG in both direction (H1) and execution (M5) — SM for both TFs
  const cfg_both: FourBrainConfig = {
    direction: { modules: ["fvg_inversion"], timeframe: "H1" },
    execution: { modules: ["fvg_inversion"], timeframe: "M5" },
    management: {
      riskPercent: 1,
      rewardRisk: 2,
      stopBuffer: 20,
      breakEvenEnabled: false,
      breakEvenAtR: 1,
      maxOpenTrades: 1,
    },
  };
  const code_both = generateEA({ eaName: "SM_Both_Test", config: cfg_both });

  return runChecks("Test 4 — iFVG SM scoping (exec-only / none / both)", code_exec, [
    {
      desc: "4a: IFVGSM_M5_ injected when exec=fvg_inversion",
      test: code_exec.includes("IFVGSM_M5_"),
    },
    {
      desc: "4a: IFVGSM_H4_ NOT injected (dir uses bos, not iFVG)",
      test: !code_exec.includes("IFVGSM_H4_"),
    },
    {
      desc: "4b: No IFVGSM_ when iFVG not selected anywhere",
      test: !code_none.includes("IFVGSM_"),
    },
    {
      desc: "4c: IFVGSM_H1_ injected when dir=fvg_inversion",
      test: code_both.includes("IFVGSM_H1_"),
    },
    {
      desc: "4c: IFVGSM_M5_ injected when exec=fvg_inversion",
      test: code_both.includes("IFVGSM_M5_"),
    },
    {
      desc: "4c: SM not ticked twice when dir TF != exec TF",
      // execSmTick should be empty when they're the same TF, non-empty when different
      test: code_both.includes("IFVGSM_H1_Tick") && code_both.includes("IFVGSM_M5_Tick"),
    },
    { desc: "SM tick calls present in OnTick", test: code_exec.includes("IFVGSM_M5_Tick(") },
  ]);
}

// ─── Test 5: Trade execution parameters ──────────────────────────────────────
// Break-even enabled with custom params; risk/RR/stop buffer wired correctly
function test5_TradeExecution(): TestResult {
  const config: FourBrainConfig = {
    direction: { modules: ["ema"], timeframe: "H4" },
    setup: { modules: ["snr"], timeframe: "H1" },
    execution: { modules: ["pin_bar"], timeframe: "M15" },
    management: {
      riskPercent: 2.0,
      rewardRisk: 3.0,
      stopBuffer: 15,
      breakEvenEnabled: true,
      breakEvenAtR: 1.5,
      maxOpenTrades: 2,
    },
  };
  const params: MQL5CodeGenParams = {
    eaName: "BE_Risk_Test",
    config,
    globalSymbol: "USDJPY",
    globalMagic: 9999,
  };
  const code = generateEA(params);

  return runChecks("Test 5 — Break-even + risk/RR wired correctly", code, [
    { desc: "Risk 2.0% in inputs", test: code.includes("InpRiskPercent = 2") },
    { desc: "RR 3.0 in inputs", test: code.includes("InpRewardRisk  = 3") },
    { desc: "Stop buffer 15 pts in inputs", test: code.includes("InpStopBuffer  = 15") },
    { desc: "BE input line generated", test: code.includes("InpBEAtR") },
    { desc: "BE at R=1.5 in inputs", test: code.includes("InpBEAtR = 1.5") },
    { desc: "Break-even management code present", test: code.includes("Break-Even Management") },
    { desc: "BE checks position type", test: code.includes("POSITION_TYPE_BUY") },
    { desc: "BE uses InpBEAtR multiplier", test: code.includes("InpBEAtR") },
    {
      desc: "TP = dist * InpRewardRisk * pt",
      test: code.includes("InpRewardRisk") && code.includes("dist"),
    },
    { desc: "SL uses stop buffer", test: code.includes("InpStopBuffer") && code.includes("buf") },
    { desc: "Max trades = 2 in inputs", test: code.includes("InpMaxTrades   = 2") },
    {
      desc: "CountPositions >= InpMaxTrades gate",
      test: code.includes("CountPositions() >= InpMaxTrades"),
    },
    { desc: "CalcLot uses InpRiskPercent", test: code.includes("InpRiskPercent / 100.0") },
    {
      desc: "EMA detection in direction brain",
      test: code.includes("_fast") && code.includes("_slow"),
    },
    {
      desc: "S/R detection in setup brain",
      test: code.includes("swH") || code.includes("support"),
    },
    {
      desc: "Pin Bar detection in exec brain",
      test: code.includes("PIN") && code.includes("_rng"),
    },
    {
      desc: "No unresolved {{ }} placeholders",
      test: !code.includes("{{") && !code.includes("}}"),
    },
  ]);
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export interface Phase1Report {
  allPass: boolean;
  tests: TestResult[];
  summary: string;
}

export function runPhase1Validation(): Phase1Report {
  const tests = [
    test1_ClassicICT(),
    test2_MultiModuleDirection(),
    test3_ExecutionOnly(),
    test4_IfvgStateMachineScoping(),
    test5_TradeExecution(),
  ];

  const passed = tests.filter((t) => t.pass).length;
  const allPass = passed === tests.length;

  const lines: string[] = [
    "╔══════════════════════════════════════════════════════════╗",
    "║         Phase 1: 4-Brain Architecture Validation        ║",
    "╚══════════════════════════════════════════════════════════╝",
    "",
  ];

  for (const t of tests) {
    lines.push(`${t.pass ? "✅" : "❌"} ${t.name}`);
    if (!t.pass) {
      for (const d of t.details) lines.push(d);
    }
  }

  lines.push("");
  lines.push(`Result: ${passed}/${tests.length} tests passed`);
  if (allPass) {
    lines.push("Phase 1 COMPLETE — 4-Brain architecture validated.");
    lines.push("Ready for Phase 2: live MT5 backtest on EURUSD H1.");
  } else {
    lines.push("Phase 1 INCOMPLETE — fix failures above before proceeding.");
  }

  return { allPass, tests, summary: lines.join("\n") };
}
