/**
 * MQL5 emit + static-lint verification.
 *
 *   npx tsx scripts/verify-mql5.ts
 *
 * Emits every recently-built generator's output to verify/mql5/*.mq5 so they can
 * be dropped into MetaEditor, and runs a static lint pass for the MQL5 pitfalls
 * listed in CLAUDE.md (MQL4-isms, brace/paren balance, bare Ask/Bid, etc.).
 *
 * Static lint is NOT a compiler — a clean report means "no obvious red flags",
 * the real gate is still MetaEditor F7. But it catches the cheap mistakes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Standalone full-indicator generators (each returns a complete .mq5)
import { generateMissDetector } from "../src/lib/smc-modules/miss-detector";
import { generateMissStateModule } from "../src/lib/smc-modules/miss-state-module";
import { generateRssSrrDetector } from "../src/lib/smc-modules/rss-srr-detector";
import { generateRssSrrStateModule } from "../src/lib/smc-modules/rss-srr-state-module";
import { generateFvgLiquidityDetector } from "../src/lib/smc-modules/fvg-liquidity-detector";
import { generateObLiquidityDetector } from "../src/lib/smc-modules/ob-liquidity-detector";
import { generateBbLiquidityDetector } from "../src/lib/smc-modules/bb-liquidity-detector";
import { generateZoneLiquiditySetupIndicator } from "../src/lib/smc-modules/zone-liquidity-setup-indicator";
import { generateZoneLiqStateModule } from "../src/lib/smc-modules/zone-liq-state-module";
import { generateObFvgDetector } from "../src/lib/smc-modules/ob-fvg-detector";
import { generateUnicornDetector } from "../src/lib/smc-modules/unicorn-detector";
import { generateUnicornStateModule } from "../src/lib/smc-modules/unicorn-state-module";
import { generatePinBarDetector } from "../src/lib/smc-modules/pin-bar-detector";
import { generatePinBarStateModule } from "../src/lib/smc-modules/pin-bar-state-module";
import { generateBollingerDetector } from "../src/lib/indicator-modules/bollinger-detector";
import { generateBollingerStateModule } from "../src/lib/indicator-modules/bollinger-state-module";
import { generateSwingStructureDetector } from "../src/lib/smc-modules/swing-structure-detector";
import { generateSwingStructureStateModule } from "../src/lib/smc-modules/swing-structure-state-module";
import { generateRsiHiddenDivergenceDetector } from "../src/lib/indicator-modules/rsi-hidden-divergence-detector";
import { generateRsiHiddenDivergenceStateModule } from "../src/lib/indicator-modules/rsi-hidden-divergence-state-module";
import { generateEngulfingDetector } from "../src/lib/smc-modules/engulfing-detector";
import { generateStrongEngulfingDetector } from "../src/lib/smc-modules/strong-engulfing-detector";
import { generateRbrDbdDetector } from "../src/lib/smc-modules/rbr-dbd-detector";
import { generateRbrDbdStateModule } from "../src/lib/smc-modules/rbr-dbd-state-module";
import { generateMefDetector } from "../src/lib/smc-modules/mef-detector";
import { generateMefStateModule } from "../src/lib/smc-modules/mef-state-module";
import { generateQmMefDetector } from "../src/lib/smc-modules/qm-mef-detector";
import { generateQmMefStateModule } from "../src/lib/smc-modules/qm-mef-state-module";
import { generateSnrc2Detector } from "../src/lib/smc-modules/snrc2-detector";
import { generateSnrc2StateModule } from "../src/lib/smc-modules/snrc2-state-module";
import { generateStrongSnrDetector } from "../src/lib/smc-modules/strong-snr-detector";
import { generateSnrc1Detector } from "../src/lib/smc-modules/snrc1-detector";

// Strategy Flow runtime (instance event gate) — proof-of-feasibility EA
import { generateFlowDemoEA, tryGenerateFlowEAFromFourBrain } from "../src/generators/gen-flow-ea";

// Inline state-machine fragment generators
import { genRsiHdSM } from "../src/generators/gen-rsi-hd-sm";
import { genObFvgSM } from "../src/generators/gen-obfvg-sm";
import { genEgSM } from "../src/generators/gen-eg-sm";

// Full 4-brain assembler (AI path)
import { generateEA } from "../src/generators/gen-ea";
import type { FourBrainConfig, MQL5CodeGenParams, StrategyBlueprint } from "../src/types/blueprint";
import type { AiBrainWiring } from "../src/lib/api-client";
import { generateMql5FromBlueprint } from "../src/lib/mql5-template-generator";
import { buildEmaTestThenIfvgFormationWiring } from "../netlify/functions/gen-4brain-ai.mts";
import { MODULE_LIBRARY, MODULE_UI_PARAMS } from "../src/lib/module-library";
import {
  MODULE_CONTRACTS,
  getModuleContract,
  moduleContractAllowsSmFunction,
} from "../src/lib/module-contracts";
import {
  MODULE_SEMANTIC_EVENT_TYPES,
  STRATEGY_EVENT_CONTRACTS,
  resolveModuleSemanticEventType,
  strategyEventSupportsRole,
} from "../src/lib/strategy-events";
import { fourBrainToStrategyFlow, validateStrategyFlowSchema } from "../src/lib/strategy-flow";
import { lintMql5 } from "../src/lib/mql5-static-lint";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "verify", "mql5");
mkdirSync(OUT, { recursive: true });

// ── Wrap the inline SM fragment in a minimal compilable test indicator ────────
function wrapInlineSM(name: string, fragment: string, resetCall: string, tickCall: string): string {
  return `//+------------------------------------------------------------------+
//| ${name} — inline-SM compile harness (generated by verify-mql5)  |
//+------------------------------------------------------------------+
#property strict
#property indicator_chart_window
#property indicator_plots 0

string InpSymbol = "EURUSD";   // the real EA supplies this as an input
${fragment}
int OnInit() { InpSymbol = _Symbol; ${resetCall} return INIT_SUCCEEDED; }
void OnDeinit(const int reason) {}
int OnCalculate(const int rates_total, const int prev_calculated,
                const datetime &time[], const double &open[],
                const double &high[], const double &low[],
                const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
{
   static datetime _last = 0;
   datetime _t = iTime(InpSymbol, PERIOD_CURRENT, 0);
   if(_t != _last) { _last = _t; ${tickCall} }
   return rates_total;
}
`;
}

interface Item {
  file: string;
  code: string;
}
const items: Item[] = [
  { file: "Miss_Detector.mq5", code: generateMissDetector() },
  { file: "Miss_State_Module.mq5", code: generateMissStateModule() },
  { file: "RSS_SRR_Detector.mq5", code: generateRssSrrDetector() },
  { file: "RSS_SRR_State_Module.mq5", code: generateRssSrrStateModule() },
  // Legacy standalone liquidity detectors (superseded by Liquidity_Buildup + ZLSM — compile regression only)
  { file: "FVG_Liquidity_Detector.mq5", code: generateFvgLiquidityDetector() },
  { file: "OB_Liquidity_Detector.mq5", code: generateObLiquidityDetector() },
  { file: "BB_Liquidity_Detector.mq5", code: generateBbLiquidityDetector() },
  { file: "Liquidity_Buildup.mq5", code: generateZoneLiquiditySetupIndicator() },
  { file: "Liquidity_Buildup_State_Module.mq5", code: generateZoneLiqStateModule() },
  { file: "OB_FVG_Detector.mq5", code: generateObFvgDetector() },
  { file: "Unicorn_Detector.mq5", code: generateUnicornDetector() },
  { file: "Unicorn_State_Module.mq5", code: generateUnicornStateModule() },
  { file: "Pin_Bar_Detector.mq5", code: generatePinBarDetector() },
  { file: "Pin_Bar_State_Module.mq5", code: generatePinBarStateModule() },
  { file: "Bollinger_Detector.mq5", code: generateBollingerDetector() },
  { file: "Bollinger_State_Module.mq5", code: generateBollingerStateModule() },
  {
    file: "Swing_Structure_Detector.mq5",
    code: generateSwingStructureDetector(),
  },
  {
    file: "Swing_Structure_State_Module.mq5",
    code: generateSwingStructureStateModule(),
  },
  { file: "RSI_Hidden_Divergence_Detector.mq5", code: generateRsiHiddenDivergenceDetector() },
  {
    file: "RSI_Hidden_Divergence_State_Module.mq5",
    code: generateRsiHiddenDivergenceStateModule(),
  },
  {
    file: "ENG_Detector.mq5",
    code: generateEngulfingDetector(),
  },
  {
    file: "SEG_Detector.mq5",
    code: generateStrongEngulfingDetector(),
  },
  {
    file: "RBR_DBD_Detector.mq5",
    code: generateRbrDbdDetector(),
  },
  {
    file: "RBR_DBD_State_Module.mq5",
    code: generateRbrDbdStateModule(),
  },
  {
    file: "MEF_Detector.mq5",
    code: generateMefDetector(),
  },
  {
    file: "MEF_State_Module.mq5",
    code: generateMefStateModule(),
  },
  {
    file: "QM_MEF_Detector.mq5",
    code: generateQmMefDetector(),
  },
  {
    file: "QM_MEF_State_Module.mq5",
    code: generateQmMefStateModule(),
  },
  {
    file: "SNRC2_Detector.mq5",
    code: generateSnrc2Detector(),
  },
  {
    file: "SNRC2_State_Module.mq5",
    code: generateSnrc2StateModule(),
  },
  {
    file: "Strong_SNR_Detector.mq5",
    code: generateStrongSnrDetector(),
  },
  {
    file: "SNRC1_Detector.mq5",
    code: generateSnrc1Detector(),
  },
  {
    file: "FLOW_BOS_FVG_BOS_Demo.mq5",
    code: generateFlowDemoEA(),
  },
  {
    // EMA direction -> iFVG setup -> iFVG entry: proves the flow engine covers
    // EMA + iFVG via their verified SMs (the strategy the UI rejected before).
    file: "FLOW_EMA_IFVG_Demo.mq5",
    code: tryGenerateFlowEAFromFourBrain(
      {
        direction: {
          modules: ["ema"],
          timeframe: "M5",
          params: { fastPeriod: 12, slowPeriod: 48 },
        },
        setup: { modules: ["fvg_inversion"], timeframe: "M5", params: { expiryBars: 100 } },
        execution: { modules: ["fvg_inversion"], timeframe: "M5", params: {} },
        management: { riskPercent: 1, rewardRisk: 2, maxOpenTrades: 1 },
      } as unknown as Parameters<typeof tryGenerateFlowEAFromFourBrain>[0],
      "FLOW_EMA_IFVG_Demo",
    )!,
  },
  {
    // BOS -> Liquidity Sweep setup -> Engulfing entry (no-HasActive setup + EG SM)
    file: "FLOW_BOS_LIQ_ENG_Demo.mq5",
    code: tryGenerateFlowEAFromFourBrain(
      {
        direction: { modules: ["bos"], timeframe: "H1", params: { lookback: 20 } },
        setup: { modules: ["liqsweep"], timeframe: "M15", params: {} },
        execution: { modules: ["engulfing"], timeframe: "M5", params: {} },
        management: { riskPercent: 1, rewardRisk: 2, maxOpenTrades: 1 },
      } as unknown as Parameters<typeof tryGenerateFlowEAFromFourBrain>[0],
      "FLOW_BOS_LIQ_ENG_Demo",
    )!,
  },
  {
    // EMA -> S/R setup -> RSI Hidden Divergence entry (B4_MA + SNRSM + RSIHDSM/iRSI)
    file: "FLOW_EMA_SNR_RSI_Demo.mq5",
    code: tryGenerateFlowEAFromFourBrain(
      {
        direction: {
          modules: ["ema"],
          timeframe: "M15",
          params: { fastPeriod: 12, slowPeriod: 48 },
        },
        setup: { modules: ["snr"], timeframe: "M15", params: {} },
        execution: { modules: ["rsi_hd"], timeframe: "M5", params: {} },
        management: { riskPercent: 1, rewardRisk: 2, maxOpenTrades: 1 },
      } as unknown as Parameters<typeof tryGenerateFlowEAFromFourBrain>[0],
      "FLOW_EMA_SNR_RSI_Demo",
    )!,
  },
  {
    file: "_TEST_RSIHDSM_M15.mq5",
    code: wrapInlineSM(
      "RSIHDSM M15",
      genRsiHdSM("M15", "PERIOD_M15", "M15"),
      "RSIHDSM_M15_Reset();",
      "RSIHDSM_M15_Tick(50);",
    ),
  },
  {
    file: "_TEST_OBFVGSM_M15.mq5",
    code: wrapInlineSM(
      "OBFVGSM M15",
      genObFvgSM("M15", "PERIOD_M15", "M15"),
      "OBFVGSM_M15_Reset();",
      "OBFVGSM_M15_Tick(50);",
    ),
  },
  // ── EG+EF (Engulfing / Engulfing Failed) — M5 instance ─────────────────────
  {
    file: "_TEST_EGSM_M5.mq5",
    code: wrapInlineSM(
      "EGSM M5 (Engulfing + Engulfing Failed)",
      genEgSM("M5", "PERIOD_M5", "M5", 3, 100),
      "EGSM_M5_Reset();",
      "EGSM_M5_Tick(10);",
    ),
  },
  // ── EG+EF — H4 instance (Direction / Setup role) ───────────────────────────
  {
    file: "_TEST_EGSM_H4.mq5",
    code: wrapInlineSM(
      "EGSM H4 (Engulfing + Engulfing Failed)",
      genEgSM("H4", "PERIOD_H4", "H4", 3, 200),
      "EGSM_H4_Reset();",
      "EGSM_H4_Tick(20);",
    ),
  },
];

function lint(code: string): string[] {
  return lintMql5(code).warnings;
}

// ── Integration test: a full 4-brain EA using rsi_hd via the AI path ──────────
// sm_configs is EMPTY on purpose — reconcileStateMachines() must auto-embed
// RSIHDSM_M15 from the setup_brain reference, and OnInit must auto-call Reset.
function buildAiEa(): { code: string; checks: Array<[string, boolean]> } {
  const config: FourBrainConfig = {
    direction: { modules: ["bos"], timeframe: "H4" },
    setup: { modules: ["rsi_hd"], timeframe: "M15" },
    execution: { modules: ["fvg_inversion"], timeframe: "M5" },
    management: {
      riskPercent: 1.0,
      rewardRisk: 3.0,
      stopBuffer: 50,
      breakEvenEnabled: true,
      breakEvenAtR: 1.5,
      maxOpenTrades: 3,
    },
  };
  const aiWiring: AiBrainWiring = {
    direction_brain: `void Direction_Brain_Execute() { gBias = 1; }`,
    setup_brain: `void Setup_Brain_Execute() {
   RSIHDSM_M15_Tick(50);
   if(RSIHDSM_M15_BullJustConfirmed()) { gSetupActive = true; gSetupDir = 1; gSetupSLHint = RSIHDSM_M15_BullConfirmSL(); }
   else if(RSIHDSM_M15_BearJustConfirmed()) { gSetupActive = true; gSetupDir = -1; gSetupSLHint = RSIHDSM_M15_BearConfirmSL(); }
}`,
    execution_brain: `void Execution_Brain_Execute() {
   if(gSetupActive) { gExecSignal = true; gExecDir = gSetupDir; gExecSL = gSetupSLHint; }
}`,
    required_sms: ["RSIHDSM_M15"],
    sm_configs: {}, // intentionally empty → must be reconciled
  };
  const params: MQL5CodeGenParams = {
    eaName: "RSI_HD_Continuation_Test",
    config,
    globalSymbol: "EURUSD",
    globalMagic: 990777,
    aiWiring,
  };
  const code = generateEA(params);
  const checks: Array<[string, boolean]> = [
    ["SM auto-embedded (reconcile)", code.includes("void RSIHDSM_M15_Tick")],
    ["SM Reset auto-called in OnInit", code.includes("RSIHDSM_M15_Reset();")],
    ["RSI handle present", code.includes("iRSI(InpSymbol, PERIOD_M15")],
    ["setup brain wired", code.includes("RSIHDSM_M15_BullJustConfirmed()")],
  ];
  return { code, checks };
}

let totalWarn = 0;
console.log(`\nEmitting ${items.length} files → ${OUT}\n`);
for (const it of items) {
  writeFileSync(resolve(OUT, it.file), it.code, "utf8");
  const w = lint(it.code);
  totalWarn += w.length;
  const tag = w.length === 0 ? "OK  " : "WARN";
  console.log(`[${tag}] ${it.file}  (${it.code.split("\n").length} lines)`);
  for (const m of w) console.log(`        • ${m}`);
}
// ── AI-path integration: OB+FVG as Setup→Execution via the AI path ────────────
function buildObFvgAiEa(): { code: string; checks: Array<[string, boolean]> } {
  const config: FourBrainConfig = {
    direction: { modules: ["bos"], timeframe: "H4" },
    setup: { modules: ["ob_fvg"], timeframe: "M15" },
    execution: { modules: ["ob_fvg"], timeframe: "M15" },
    management: {
      riskPercent: 1.0,
      rewardRisk: 3.0,
      stopBuffer: 50,
      breakEvenEnabled: true,
      breakEvenAtR: 1.5,
      maxOpenTrades: 3,
    },
  };
  const aiWiring: AiBrainWiring = {
    direction_brain: `void Direction_Brain_Execute() { gBias = 1; }`,
    setup_brain: `void Setup_Brain_Execute() {
   OBFVGSM_M15_Tick(80);
   if(OBFVGSM_M15_HasActiveBull()) { gSetupActive = true; gSetupDir = 1; gSetupSLHint = OBFVGSM_M15_ActiveBullSL(); }
   else if(OBFVGSM_M15_HasActiveBear()) { gSetupActive = true; gSetupDir = -1; gSetupSLHint = OBFVGSM_M15_ActiveBearSL(); }
}`,
    execution_brain: `void Execution_Brain_Execute() {
   if(OBFVGSM_M15_BullJustConfirmed()) { gExecSignal = true; gExecDir = 1;  gExecSL = OBFVGSM_M15_BullConfirmSL(); }
   else if(OBFVGSM_M15_BearJustConfirmed()) { gExecSignal = true; gExecDir = -1; gExecSL = OBFVGSM_M15_BearConfirmSL(); }
}`,
    required_sms: ["OBFVGSM_M15"],
    sm_configs: {},
  };
  const code = generateEA({
    eaName: "OB_FVG_Setup_Test",
    config,
    globalSymbol: "EURUSD",
    globalMagic: 990778,
    aiWiring,
  });
  const checks: Array<[string, boolean]> = [
    ["SM auto-embedded (reconcile)", code.includes("void OBFVGSM_M15_Tick")],
    ["SM Reset auto-called in OnInit", code.includes("OBFVGSM_M15_Reset();")],
    ["setup brain wired", code.includes("OBFVGSM_M15_HasActiveBull()")],
    ["execution entry wired", code.includes("OBFVGSM_M15_BullJustConfirmed()")],
  ];
  return { code, checks };
}

// ── Run the AI-path integration tests ─────────────────────────────────────────
function runAiTest(
  title: string,
  file: string,
  build: () => { code: string; checks: Array<[string, boolean]> },
) {
  console.log(`\n── AI-path integration: ${title} ──`);
  try {
    const { code, checks } = build();
    writeFileSync(resolve(OUT, file), code, "utf8");
    const lw = lint(code);
    console.log(`[${lw.length ? "WARN" : "OK  "}] ${file}  (${code.split("\n").length} lines)`);
    for (const m of lw) console.log(`        • ${m}`);
    totalWarn += lw.length;
    for (const [name, ok] of checks) console.log(`        ${ok ? "✓" : "✗"} ${name}`);
    if (checks.some(([, ok]) => !ok)) totalWarn++;
  } catch (e) {
    console.log(`[FAIL] assembler threw: ${(e as Error).message}`);
    totalWarn++;
  }
}
runAiTest("RSI HD as Setup Brain", "RSI_HD_Continuation_Test.mq5", buildAiEa);
runAiTest("OB+FVG as Setup→Execution", "OB_FVG_Setup_Test.mq5", buildObFvgAiEa);

type SmConfig = AiBrainWiring["sm_configs"][string];

function sm(type: string, id: string, params: Record<string, unknown> = {}): SmConfig {
  return { type, id, TF: id === "MN" ? "PERIOD_MN1" : `PERIOD_${id}`, tf: id, params };
}

function buildContractCoverageEa(
  eaName: string,
  config: FourBrainConfig,
  aiWiring: AiBrainWiring,
  requiredSnippets: string[],
): { code: string; checks: Array<[string, boolean]> } {
  const code = generateEA({
    eaName,
    config,
    globalSymbol: "EURUSD",
    globalMagic: 990800,
    aiWiring,
  });
  const checks: Array<[string, boolean]> = requiredSnippets.map((snippet) => [
    `contains ${snippet}`,
    code.includes(snippet),
  ]);
  checks.push(["no unknown SM placeholders", !code.includes("// Unknown SM type:")]);
  return { code, checks };
}

const phase3CoverageCases: Array<{
  title: string;
  file: string;
  config: FourBrainConfig;
  aiWiring: AiBrainWiring;
  requiredSnippets: string[];
}> = [
  {
    title: "CHoCH direction → liquidity sweep setup → IFVG execution",
    file: "Phase3_CHOCH_LiqSweep_IFVG_Test.mq5",
    config: {
      direction: { modules: ["choch"], timeframe: "D1" },
      setup: { modules: ["liqsweep"], timeframe: "H4" },
      execution: { modules: ["fvg_inversion"], timeframe: "M5" },
      management: { riskPercent: 1, rewardRisk: 3, stopBuffer: 20, maxOpenTrades: 1 },
    },
    aiWiring: {
      direction_brain: `void Direction_Brain_Execute() {
  if(BOSSM_D1_BullBias()) gBias = 1;
  else if(BOSSM_D1_BearBias()) gBias = -1;
  else gBias = 0;
}`,
      setup_brain: `void Setup_Brain_Execute() {
  if(gBias == 1 && LSSM_H4_BullJustConfirmed()) { gSetupActive = true; gSetupDir = 1; gSetupSLHint = LSSM_H4_BullConfirmSL(); }
  else if(gBias == -1 && LSSM_H4_BearJustConfirmed()) { gSetupActive = true; gSetupDir = -1; gSetupSLHint = LSSM_H4_BearConfirmSL(); }
}`,
      execution_brain: `void Execution_Brain_Execute() {
  if(!gSetupActive) return;
  if(gSetupDir == 1 && IFVGSM_M5_BullJustInverted()) { gExecSignal = true; gExecDir = 1; gExecSL = IFVGSM_M5_BullConfirmSL(); }
  else if(gSetupDir == -1 && IFVGSM_M5_BearJustInverted()) { gExecSignal = true; gExecDir = -1; gExecSL = IFVGSM_M5_BearConfirmSL(); }
}`,
      required_sms: ["BOSSM_D1", "LSSM_H4", "IFVGSM_M5"],
      sm_configs: {
        choch_D1: sm("choch", "D1", { swingLen: 5, lookback: 60 }),
        liqsweep_H4: sm("liqsweep", "H4", { swingLen: 4, lookback: 30 }),
        ifvg_M5: sm("fvg_inversion", "M5", { expiryBars: 80 }),
      },
    },
    requiredSnippets: [
      "void BOSSM_D1_Tick",
      "void LSSM_H4_Tick",
      "void IFVGSM_M5_Tick",
      "LSSM_H4_BullJustConfirmed()",
      "IFVGSM_M5_BullJustInverted()",
    ],
  },
  {
    title: "Gap S/R setup → breakout execution",
    file: "Phase3_GapSNR_Breakout_Test.mq5",
    config: {
      setup: { modules: ["gap_snr"], timeframe: "H1" },
      execution: { modules: ["breakout"], timeframe: "M5" },
      management: { riskPercent: 1, rewardRisk: 2, stopBuffer: 20, maxOpenTrades: 1 },
    },
    aiWiring: {
      direction_brain: `void Direction_Brain_Execute() { gBias = 0; }`,
      setup_brain: `void Setup_Brain_Execute() {
  if(GSNRSM_H1_HasActiveBull()) { gSetupActive = true; gSetupDir = 1; gSetupSLHint = GSNRSM_H1_BullConfirmSL(); }
  else if(GSNRSM_H1_HasActiveBear()) { gSetupActive = true; gSetupDir = -1; gSetupSLHint = GSNRSM_H1_BearConfirmSL(); }
}`,
      execution_brain: `void Execution_Brain_Execute() {
  if(!gSetupActive) return;
  if(gSetupDir == 1 && BRKSM_M5_BullJustConfirmed()) { gExecSignal = true; gExecDir = 1; gExecSL = BRKSM_M5_BullConfirmSL(); }
  else if(gSetupDir == -1 && BRKSM_M5_BearJustConfirmed()) { gExecSignal = true; gExecDir = -1; gExecSL = BRKSM_M5_BearConfirmSL(); }
}`,
      required_sms: ["GSNRSM_H1", "BRKSM_M5"],
      sm_configs: {
        gap_H1: sm("gap_snr", "H1", { lookback: 70, expiryBars: 120 }),
        breakout_M5: sm("breakout", "M5", { lookback: 25 }),
      },
    },
    requiredSnippets: [
      "void GSNRSM_H1_Tick",
      "void BRKSM_M5_Tick",
      "GSNRSM_H1_HasActiveBull()",
      "BRKSM_M5_BullJustConfirmed()",
    ],
  },
  {
    title: "Missed level setup → rejection execution",
    file: "Phase3_Miss_Rejection_Test.mq5",
    config: {
      setup: { modules: ["miss"], timeframe: "H1" },
      execution: { modules: ["rejection"], timeframe: "M5" },
      management: { riskPercent: 1, rewardRisk: 3, stopBuffer: 20, maxOpenTrades: 1 },
    },
    aiWiring: {
      direction_brain: `void Direction_Brain_Execute() { gBias = 0; }`,
      setup_brain: `void Setup_Brain_Execute() {
  if(MISSSM_H1_HasActiveBull()) { gSetupActive = true; gSetupDir = 1; gSetupSLHint = MISSSM_H1_BullConfirmSL(); }
  else if(MISSSM_H1_HasActiveBear()) { gSetupActive = true; gSetupDir = -1; gSetupSLHint = MISSSM_H1_BearConfirmSL(); }
}`,
      execution_brain: `void Execution_Brain_Execute() {
  if(!gSetupActive) return;
  if(gSetupDir == 1 && REJSM_M5_BullJustConfirmed()) { gExecSignal = true; gExecDir = 1; gExecSL = REJSM_M5_BullConfirmSL(); }
  else if(gSetupDir == -1 && REJSM_M5_BearJustConfirmed()) { gExecSignal = true; gExecDir = -1; gExecSL = REJSM_M5_BearConfirmSL(); }
}`,
      required_sms: ["MISSSM_H1", "REJSM_M5"],
      sm_configs: {
        miss_H1: sm("miss", "H1", { lookback: 90, swingLen: 5, nearPoints: 60 }),
        rejection_M5: sm("rejection", "M5", { lookback: 25 }),
      },
    },
    requiredSnippets: [
      "void MISSSM_H1_Tick",
      "void REJSM_M5_Tick",
      "MISSSM_H1_HasActiveBull()",
      "REJSM_M5_BullJustConfirmed()",
    ],
  },
  {
    title: "Liquidity buildup → engulfing execution",
    file: "Phase3_LiqBuildup_Engulfing_Test.mq5",
    config: {
      direction: { modules: ["bos"], timeframe: "H4" },
      setup: { modules: ["zone_liq"], timeframe: "H1" },
      execution: { modules: ["engulfing"], timeframe: "M15" },
      management: { riskPercent: 1, rewardRisk: 2, stopBuffer: 20, maxOpenTrades: 1 },
    },
    aiWiring: {
      direction_brain: `void Direction_Brain_Execute() {
  if(BOSSM_H4_IsBull()) gBias = 1;
  else if(BOSSM_H4_IsBear()) gBias = -1;
}`,
      setup_brain: `void Setup_Brain_Execute() {
  if(ZLSM_H1_HasActiveBull() && (gBias == 0 || gBias == 1)) {
    gSetupActive = true; gSetupDir = 1; gSetupSLHint = ZLSM_H1_ActiveBullSL();
  } else if(ZLSM_H1_HasActiveBear() && (gBias == 0 || gBias == -1)) {
    gSetupActive = true; gSetupDir = -1; gSetupSLHint = ZLSM_H1_ActiveBearSL();
  }
}`,
      execution_brain: `void Execution_Brain_Execute() {
  if(!gSetupActive) return;
  if(gSetupDir == 1 && ZLSM_H1_BullJustConfirmed() && EGSM_M15_BullJustConfirmed()) {
    gExecSignal = true; gExecDir = 1; gExecSL = ZLSM_H1_BullConfirmSL();
  } else if(gSetupDir == -1 && ZLSM_H1_BearJustConfirmed() && EGSM_M15_BearJustConfirmed()) {
    gExecSignal = true; gExecDir = -1; gExecSL = ZLSM_H1_BearConfirmSL();
  }
}`,
      required_sms: ["BOSSM_H4", "ZLSM_H1", "EGSM_M15"],
      sm_configs: {
        bos_H4: sm("bos", "H4", { lookback: 20 }),
        zone_liq_H1: sm("zone_liq", "H1", { lookback: 200, minLiqBars: 1, nearATR: 0.2 }),
        engulfing_M15: sm("engulfing", "M15", { scanBack: 3 }),
      },
    },
    requiredSnippets: [
      "void ZLSM_H1_Tick",
      "ZLSM_H1_HasActiveBull()",
      "ZLSM_H1_BullJustConfirmed()",
      "ZLSM_H1_ActiveBullSL()",
    ],
  },
  {
    title: "SNRC2 setup → engulfing execution",
    file: "Phase3_SNRC2_Engulfing_Test.mq5",
    config: {
      direction: { modules: ["bos"], timeframe: "H4" },
      setup: { modules: ["snrc2"], timeframe: "H1" },
      execution: { modules: ["engulfing"], timeframe: "M15" },
      management: { riskPercent: 1, rewardRisk: 2, stopBuffer: 20, maxOpenTrades: 1 },
    },
    aiWiring: {
      direction_brain: `void Direction_Brain_Execute() {
  if(BOSSM_H4_IsBull()) gBias = 1;
  else if(BOSSM_H4_IsBear()) gBias = -1;
}`,
      setup_brain: `void Setup_Brain_Execute() {
  if(SNRC2SM_H1_HasActiveBull() && (gBias == 0 || gBias == 1)) {
    gSetupActive = true; gSetupDir = 1; gSetupSLHint = SNRC2SM_H1_ActiveBullSL();
  } else if(SNRC2SM_H1_HasActiveBear() && (gBias == 0 || gBias == -1)) {
    gSetupActive = true; gSetupDir = -1; gSetupSLHint = SNRC2SM_H1_ActiveBearSL();
  }
}`,
      execution_brain: `void Execution_Brain_Execute() {
  if(!gSetupActive) return;
  if(gSetupDir == 1 && SNRC2SM_H1_BullJustConfirmed() && EGSM_M15_BullJustConfirmed()) {
    gExecSignal = true; gExecDir = 1; gExecSL = SNRC2SM_H1_BullConfirmSL();
  } else if(gSetupDir == -1 && SNRC2SM_H1_BearJustConfirmed() && EGSM_M15_BearJustConfirmed()) {
    gExecSignal = true; gExecDir = -1; gExecSL = SNRC2SM_H1_BearConfirmSL();
  }
}`,
      required_sms: ["BOSSM_H4", "SNRC2SM_H1", "EGSM_M15"],
      sm_configs: {
        bos_H4: sm("bos", "H4", { lookback: 20 }),
        snrc2_H1: sm("snrc2", "H1", { lookback: 400, swingStrength: 2, htfTf: "H4", htfLookback: 4 }),
        engulfing_M15: sm("engulfing", "M15", { scanBack: 3 }),
      },
    },
    requiredSnippets: [
      "void SNRC2SM_H1_Tick",
      "SNRC2SM_H1_HasActiveBull()",
      "SNRC2SM_H1_BullJustConfirmed()",
      "SNRC2SM_H1_ActiveBullSL()",
    ],
  },
  {
    title: "Breaker block setup → engulfing execution",
    file: "Phase3_BreakerBlock_Engulfing_Test.mq5",
    config: {
      direction: { modules: ["bos"], timeframe: "H4" },
      setup: { modules: ["breaker_block"], timeframe: "H1" },
      execution: { modules: ["engulfing"], timeframe: "M15" },
      management: { riskPercent: 1, rewardRisk: 2, stopBuffer: 20, maxOpenTrades: 1 },
    },
    aiWiring: {
      direction_brain: `void Direction_Brain_Execute() {
  if(BOSSM_H4_IsBull()) gBias = 1;
  else if(BOSSM_H4_IsBear()) gBias = -1;
}`,
      setup_brain: `void Setup_Brain_Execute() {
  if(BBSM_H1_HasActiveBull() && (gBias == 0 || gBias == 1)) {
    gSetupActive = true; gSetupDir = 1; gSetupSLHint = BBSM_H1_ActiveBullSL();
  } else if(BBSM_H1_HasActiveBear() && (gBias == 0 || gBias == -1)) {
    gSetupActive = true; gSetupDir = -1; gSetupSLHint = BBSM_H1_ActiveBearSL();
  }
}`,
      execution_brain: `void Execution_Brain_Execute() {
  if(!gSetupActive) return;
  if(gSetupDir == 1 && BBSM_H1_BullJustConfirmed() && EGSM_M15_BullJustConfirmed()) {
    gExecSignal = true; gExecDir = 1; gExecSL = BBSM_H1_BullConfirmSL();
  } else if(gSetupDir == -1 && BBSM_H1_BearJustConfirmed() && EGSM_M15_BearJustConfirmed()) {
    gExecSignal = true; gExecDir = -1; gExecSL = BBSM_H1_BearConfirmSL();
  }
}`,
      required_sms: ["BOSSM_H4", "BBSM_H1", "EGSM_M15"],
      sm_configs: {
        bos_H4: sm("bos", "H4", { lookback: 20 }),
        breaker_block_H1: sm("breaker_block", "H1", { lookback: 500, dispMult: 1.5, scanBack: 5 }),
        engulfing_M15: sm("engulfing", "M15", { scanBack: 3 }),
      },
    },
    requiredSnippets: [
      "void BBSM_H1_Tick",
      "BBSM_H1_HasActiveBull()",
      "BBSM_H1_BullJustConfirmed()",
      "BBSM_H1_ActiveBullSL()",
    ],
  },
  {
    title: "RSS/SRR setup → rejection execution",
    file: "Phase3_RSSSRR_Rejection_Test.mq5",
    config: {
      direction: { modules: ["bos"], timeframe: "H4" },
      setup: { modules: ["rss_srr"], timeframe: "H1" },
      execution: { modules: ["rejection"], timeframe: "M15" },
      management: { riskPercent: 1, rewardRisk: 2, stopBuffer: 20, maxOpenTrades: 1 },
    },
    aiWiring: {
      direction_brain: `void Direction_Brain_Execute() {
  if(BOSSM_H4_IsBull()) gBias = 1;
  else if(BOSSM_H4_IsBear()) gBias = -1;
}`,
      setup_brain: `void Setup_Brain_Execute() {
  if(RSSSRRSM_H1_HasActiveBull() && (gBias == 0 || gBias == 1)) {
    gSetupActive = true; gSetupDir = 1; gSetupSLHint = RSSSRRSM_H1_ActiveBullSL();
  } else if(RSSSRRSM_H1_HasActiveBear() && (gBias == 0 || gBias == -1)) {
    gSetupActive = true; gSetupDir = -1; gSetupSLHint = RSSSRRSM_H1_ActiveBearSL();
  }
}`,
      execution_brain: `void Execution_Brain_Execute() {
  if(!gSetupActive) return;
  if(gSetupDir == 1 && RSSSRRSM_H1_BullJustConfirmed() && REJSM_M15_BullJustConfirmed()) {
    gExecSignal = true; gExecDir = 1; gExecSL = RSSSRRSM_H1_BullConfirmSL();
  } else if(gSetupDir == -1 && RSSSRRSM_H1_BearJustConfirmed() && REJSM_M15_BearJustConfirmed()) {
    gExecSignal = true; gExecDir = -1; gExecSL = RSSSRRSM_H1_BearConfirmSL();
  }
}`,
      required_sms: ["BOSSM_H4", "RSSSRRSM_H1", "REJSM_M15"],
      sm_configs: {
        bos_H4: sm("bos", "H4", { lookback: 20 }),
        rss_srr_H1: sm("rss_srr", "H1", { lookback: 500, minBreaks: 2 }),
        rejection_M15: sm("rejection", "M15", { lookback: 30 }),
      },
    },
    requiredSnippets: [
      "void RSSSRRSM_H1_Tick",
      "RSSSRRSM_H1_HasActiveBull()",
      "RSSSRRSM_H1_BullJustConfirmed()",
      "RSSSRRSM_H1_ActiveBullSL()",
    ],
  },
  {
    title: "MEF setup → engulfing execution",
    file: "Phase3_MEF_Engulfing_Test.mq5",
    config: {
      direction: { modules: ["bos"], timeframe: "H4" },
      setup: { modules: ["mef"], timeframe: "H4" },
      execution: { modules: ["engulfing"], timeframe: "M30" },
      management: { riskPercent: 1, rewardRisk: 2, stopBuffer: 20, maxOpenTrades: 1 },
    },
    aiWiring: {
      direction_brain: `void Direction_Brain_Execute() {
  if(BOSSM_H4_IsBull()) gBias = 1;
  else if(BOSSM_H4_IsBear()) gBias = -1;
}`,
      setup_brain: `void Setup_Brain_Execute() {
  if(MEFSM_H4_HasActiveBull() && (gBias == 0 || gBias == 1)) {
    gSetupActive = true; gSetupDir = 1; gSetupSLHint = MEFSM_H4_ActiveBullSL();
  } else if(MEFSM_H4_HasActiveBear() && (gBias == 0 || gBias == -1)) {
    gSetupActive = true; gSetupDir = -1; gSetupSLHint = MEFSM_H4_ActiveBearSL();
  }
}`,
      execution_brain: `void Execution_Brain_Execute() {
  if(!gSetupActive) return;
  if(gSetupDir == 1 && MEFSM_H4_BullJustConfirmed() && EGSM_M30_BullJustConfirmed()) {
    gExecSignal = true; gExecDir = 1; gExecSL = MEFSM_H4_BullConfirmSL();
  } else if(gSetupDir == -1 && MEFSM_H4_BearJustConfirmed() && EGSM_M30_BearJustConfirmed()) {
    gExecSignal = true; gExecDir = -1; gExecSL = MEFSM_H4_BearConfirmSL();
  }
}`,
      required_sms: ["BOSSM_H4", "MEFSM_H4", "EGSM_M30"],
      sm_configs: {
        bos_H4: sm("bos", "H4", { lookback: 20 }),
        mef_H4: sm("mef", "H4", { lookback: 300, gapTf: "H1", baseTf: "M30" }),
        engulfing_M30: sm("engulfing", "M30", { scanBack: 3 }),
      },
    },
    requiredSnippets: [
      "void MEFSM_H4_Tick",
      "MEFSM_H4_HasActiveBull()",
      "MEFSM_H4_BullJustConfirmed()",
      "MEFSM_H4_ActiveBullSL()",
    ],
  },
  {
    title: "QM MEF setup → engulfing execution",
    file: "Phase3_QMMEF_Engulfing_Test.mq5",
    config: {
      direction: { modules: ["bos"], timeframe: "H4" },
      setup: { modules: ["qm_mef"], timeframe: "H4" },
      execution: { modules: ["engulfing"], timeframe: "M15" },
      management: { riskPercent: 1, rewardRisk: 2, stopBuffer: 20, maxOpenTrades: 1 },
    },
    aiWiring: {
      direction_brain: `void Direction_Brain_Execute() {
  if(BOSSM_H4_IsBull()) gBias = 1;
  else if(BOSSM_H4_IsBear()) gBias = -1;
}`,
      setup_brain: `void Setup_Brain_Execute() {
  if(QMMEFSM_H4_HasActiveBull() && (gBias == 0 || gBias == 1)) {
    gSetupActive = true; gSetupDir = 1; gSetupSLHint = QMMEFSM_H4_ActiveBullSL();
  } else if(QMMEFSM_H4_HasActiveBear() && (gBias == 0 || gBias == -1)) {
    gSetupActive = true; gSetupDir = -1; gSetupSLHint = QMMEFSM_H4_ActiveBearSL();
  }
}`,
      execution_brain: `void Execution_Brain_Execute() {
  if(!gSetupActive) return;
  if(gSetupDir == 1 && QMMEFSM_H4_BullJustConfirmed() && EGSM_M15_BullJustConfirmed()) {
    gExecSignal = true; gExecDir = 1; gExecSL = QMMEFSM_H4_BullConfirmSL();
  } else if(gSetupDir == -1 && QMMEFSM_H4_BearJustConfirmed() && EGSM_M15_BearJustConfirmed()) {
    gExecSignal = true; gExecDir = -1; gExecSL = QMMEFSM_H4_BearConfirmSL();
  }
}`,
      required_sms: ["BOSSM_H4", "QMMEFSM_H4", "EGSM_M15"],
      sm_configs: {
        bos_H4: sm("bos", "H4", { lookback: 20 }),
        qm_mef_H4: sm("qm_mef", "H4", { lookback: 300, qmTf: "M15", confTf: "M5" }),
        engulfing_M15: sm("engulfing", "M15", { scanBack: 3 }),
      },
    },
    requiredSnippets: [
      "void QMMEFSM_H4_Tick",
      "QMMEFSM_H4_HasActiveBull()",
      "QMMEFSM_H4_BullJustConfirmed()",
      "QMMEFSM_H4_ActiveBullSL()",
    ],
  },
  {
    title: "RBR/DBD setup → rejection execution",
    file: "Phase3_RBRDBD_Rejection_Test.mq5",
    config: {
      direction: { modules: ["bos"], timeframe: "H4" },
      setup: { modules: ["rbr_dbd"], timeframe: "H1" },
      execution: { modules: ["rejection"], timeframe: "M15" },
      management: { riskPercent: 1, rewardRisk: 2, stopBuffer: 20, maxOpenTrades: 1 },
    },
    aiWiring: {
      direction_brain: `void Direction_Brain_Execute() {
  if(BOSSM_H4_IsBull()) gBias = 1;
  else if(BOSSM_H4_IsBear()) gBias = -1;
}`,
      setup_brain: `void Setup_Brain_Execute() {
  if(RBRDBDSM_H1_HasActiveBull() && (gBias == 0 || gBias == 1)) {
    gSetupActive = true; gSetupDir = 1; gSetupSLHint = RBRDBDSM_H1_ActiveBullSL();
  } else if(RBRDBDSM_H1_HasActiveBear() && (gBias == 0 || gBias == -1)) {
    gSetupActive = true; gSetupDir = -1; gSetupSLHint = RBRDBDSM_H1_ActiveBearSL();
  }
}`,
      execution_brain: `void Execution_Brain_Execute() {
  if(!gSetupActive) return;
  if(gSetupDir == 1 && RBRDBDSM_H1_BullJustConfirmed() && REJSM_M15_BullJustConfirmed()) {
    gExecSignal = true; gExecDir = 1; gExecSL = RBRDBDSM_H1_BullConfirmSL();
  } else if(gSetupDir == -1 && RBRDBDSM_H1_BearJustConfirmed() && REJSM_M15_BearJustConfirmed()) {
    gExecSignal = true; gExecDir = -1; gExecSL = RBRDBDSM_H1_BearConfirmSL();
  }
}`,
      required_sms: ["BOSSM_H4", "RBRDBDSM_H1", "REJSM_M15"],
      sm_configs: {
        bos_H4: sm("bos", "H4", { lookback: 20 }),
        rbr_dbd_H1: sm("rbr_dbd", "H1", { lookback: 400, expiryBars: 200 }),
        rejection_M15: sm("rejection", "M15", { lookback: 30 }),
      },
    },
    requiredSnippets: [
      "void RBRDBDSM_H1_Tick",
      "RBRDBDSM_H1_HasActiveBull()",
      "RBRDBDSM_H1_BullJustConfirmed()",
      "RBRDBDSM_H1_ActiveBullSL()",
    ],
  },
  {
    title: "Swing structure direction → FVG setup → engulfing execution",
    file: "Phase3_SwingStructure_FVG_Engulfing_Test.mq5",
    config: {
      direction: { modules: ["swing_structure"], timeframe: "D1" },
      setup: { modules: ["fvg"], timeframe: "H4" },
      execution: { modules: ["engulfing"], timeframe: "M15" },
      management: { riskPercent: 1, rewardRisk: 2, stopBuffer: 20, maxOpenTrades: 1 },
    },
    aiWiring: {
      direction_brain: `void Direction_Brain_Execute() {
  if(SWINGSM_D1_IsBull()) gBias = 1;
  else if(SWINGSM_D1_IsBear()) gBias = -1;
}`,
      setup_brain: `void Setup_Brain_Execute() {
  if(FVGSM_H4_HasActiveBull() && (gBias == 0 || gBias == 1)) {
    gSetupActive = true; gSetupDir = 1; gSetupSLHint = FVGSM_H4_ActiveBullSL();
  } else if(FVGSM_H4_HasActiveBear() && (gBias == 0 || gBias == -1)) {
    gSetupActive = true; gSetupDir = -1; gSetupSLHint = FVGSM_H4_ActiveBearSL();
  }
}`,
      execution_brain: `void Execution_Brain_Execute() {
  if(!gSetupActive) return;
  if(gSetupDir == 1 && EGSM_M15_BullJustConfirmed()) {
    gExecSignal = true; gExecDir = 1; gExecSL = FVGSM_H4_BullConfirmSL();
  } else if(gSetupDir == -1 && EGSM_M15_BearJustConfirmed()) {
    gExecSignal = true; gExecDir = -1; gExecSL = FVGSM_H4_BearConfirmSL();
  }
}`,
      required_sms: ["SWINGSM_D1", "FVGSM_H4", "EGSM_M15"],
      sm_configs: {
        swing_D1: sm("swing_structure", "D1", { lookback: 500, swingLeft: 3, swingRight: 3 }),
        fvg_H4: sm("fvg", "H4", { lookback: 50, expiryBars: 100 }),
        engulfing_M15: sm("engulfing", "M15", { scanBack: 3 }),
      },
    },
    requiredSnippets: [
      "void SWINGSM_D1_Tick",
      "SWINGSM_D1_IsBull()",
      "void FVGSM_H4_Tick",
      "FVGSM_H4_HasActiveBull()",
    ],
  },
  {
    title: "Unicorn setup → engulfing execution",
    file: "Phase3_Unicorn_Engulfing_Test.mq5",
    config: {
      direction: { modules: ["bos"], timeframe: "D1" },
      setup: { modules: ["unicorn"], timeframe: "H4" },
      execution: { modules: ["engulfing"], timeframe: "M15" },
      management: { riskPercent: 1, rewardRisk: 2, stopBuffer: 20, maxOpenTrades: 1 },
    },
    aiWiring: {
      direction_brain: `void Direction_Brain_Execute() {
  if(BOSSM_D1_IsBull()) gBias = 1;
  else if(BOSSM_D1_IsBear()) gBias = -1;
}`,
      setup_brain: `void Setup_Brain_Execute() {
  if(UNISMSM_H4_HasActiveBull() && (gBias == 0 || gBias == 1)) {
    gSetupActive = true; gSetupDir = 1; gSetupSLHint = UNISMSM_H4_ActiveBullSL();
  } else if(UNISMSM_H4_HasActiveBear() && (gBias == 0 || gBias == -1)) {
    gSetupActive = true; gSetupDir = -1; gSetupSLHint = UNISMSM_H4_ActiveBearSL();
  }
}`,
      execution_brain: `void Execution_Brain_Execute() {
  if(!gSetupActive) return;
  if(gSetupDir == 1 && EGSM_M15_BullJustConfirmed()) {
    gExecSignal = true; gExecDir = 1; gExecSL = UNISMSM_H4_BullConfirmSL();
  } else if(gSetupDir == -1 && EGSM_M15_BearJustConfirmed()) {
    gExecSignal = true; gExecDir = -1; gExecSL = UNISMSM_H4_BearConfirmSL();
  }
}`,
      required_sms: ["BOSSM_D1", "UNISMSM_H4", "EGSM_M15"],
      sm_configs: {
        bos_D1: sm("bos", "D1", { lookback: 50, swingLen: 5 }),
        unicorn_H4: sm("unicorn", "H4", { lookback: 500, pairWindow: 15, uniExpiry: 250 }),
        engulfing_M15: sm("engulfing", "M15", { scanBack: 3 }),
      },
    },
    requiredSnippets: [
      "void UNISMSM_H4_Tick",
      "UNISMSM_H4_HasActiveBull()",
      "UNISMSM_H4_BullJustConfirmed()",
      "UNISMSM_H4_ActiveBullSL()",
    ],
  },
  {
    title: "FVG setup → pin bar execution",
    file: "Phase3_FVG_PinBar_Test.mq5",
    config: {
      direction: { modules: ["bos"], timeframe: "D1" },
      setup: { modules: ["fvg"], timeframe: "H4" },
      execution: { modules: ["pin_bar"], timeframe: "M15" },
      management: { riskPercent: 1, rewardRisk: 2, stopBuffer: 20, maxOpenTrades: 1 },
    },
    aiWiring: {
      direction_brain: `void Direction_Brain_Execute() {
  if(BOSSM_D1_IsBull()) gBias = 1;
  else if(BOSSM_D1_IsBear()) gBias = -1;
}`,
      setup_brain: `void Setup_Brain_Execute() {
  if(FVGSM_H4_HasActiveBull() && (gBias == 0 || gBias == 1)) {
    gSetupActive = true; gSetupDir = 1; gSetupSLHint = FVGSM_H4_ActiveBullSL();
  } else if(FVGSM_H4_HasActiveBear() && (gBias == 0 || gBias == -1)) {
    gSetupActive = true; gSetupDir = -1; gSetupSLHint = FVGSM_H4_ActiveBearSL();
  }
}`,
      execution_brain: `void Execution_Brain_Execute() {
  if(!gSetupActive) return;
  if(gSetupDir == 1 && PINSM_M15_BullJustConfirmed()) {
    gExecSignal = true; gExecDir = 1; gExecSL = PINSM_M15_BullConfirmSL();
  } else if(gSetupDir == -1 && PINSM_M15_BearJustConfirmed()) {
    gExecSignal = true; gExecDir = -1; gExecSL = PINSM_M15_BearConfirmSL();
  }
}`,
      required_sms: ["BOSSM_D1", "FVGSM_H4", "PINSM_M15"],
      sm_configs: {
        bos_D1: sm("bos", "D1", { lookback: 50, swingLen: 5 }),
        fvg_H4: sm("fvg", "H4", { lookback: 50, expiryBars: 100 }),
        pin_M15: sm("pin_bar", "M15", { wickRatio: 0.6, bodyMaxRatio: 0.35 }),
      },
    },
    requiredSnippets: [
      "void PINSM_M15_Tick",
      "PINSM_M15_BullJustConfirmed()",
      "PINSM_M15_BullConfirmSL()",
      "void FVGSM_H4_Tick",
    ],
  },
  {
    title: "BB midline direction → FVG setup → band touch execution",
    file: "Phase3_BB_FVG_Touch_Test.mq5",
    config: {
      direction: { modules: ["bb"], timeframe: "H4", params: { period: 20, deviation: 2 } },
      setup: { modules: ["fvg"], timeframe: "H1" },
      execution: { modules: ["bb"], timeframe: "M15", params: { period: 20, deviation: 2, mode: "touch" } },
      management: { riskPercent: 1, rewardRisk: 2, stopBuffer: 20, maxOpenTrades: 1 },
    },
    aiWiring: {
      direction_brain: `void Direction_Brain_Execute() {
  if(BOLLSM_H4_IsBull()) gBias = 1;
  else if(BOLLSM_H4_IsBear()) gBias = -1;
}`,
      setup_brain: `void Setup_Brain_Execute() {
  if(FVGSM_H1_HasActiveBull() && (gBias == 0 || gBias == 1)) {
    gSetupActive = true; gSetupDir = 1; gSetupSLHint = FVGSM_H1_ActiveBullSL();
  } else if(FVGSM_H1_HasActiveBear() && (gBias == 0 || gBias == -1)) {
    gSetupActive = true; gSetupDir = -1; gSetupSLHint = FVGSM_H1_ActiveBearSL();
  }
}`,
      execution_brain: `void Execution_Brain_Execute() {
  if(!gSetupActive) return;
  if(gSetupDir == 1 && BOLLSM_M15_BullJustConfirmed()) {
    gExecSignal = true; gExecDir = 1; gExecSL = BOLLSM_M15_BullConfirmSL();
  } else if(gSetupDir == -1 && BOLLSM_M15_BearJustConfirmed()) {
    gExecSignal = true; gExecDir = -1; gExecSL = BOLLSM_M15_BearConfirmSL();
  }
}`,
      required_sms: ["BOLLSM_H4", "FVGSM_H1", "BOLLSM_M15"],
      sm_configs: {
        bb_H4: sm("bb", "H4", { period: 20, deviation: 2, mode: "midline" }),
        fvg_H1: sm("fvg", "H1", { lookback: 50, expiryBars: 100 }),
        bb_M15: sm("bb", "M15", { period: 20, deviation: 2, mode: "touch" }),
      },
    },
    requiredSnippets: [
      "void BOLLSM_H4_Tick",
      "BOLLSM_H4_IsBull()",
      "void BOLLSM_M15_Tick",
      "BOLLSM_M15_BullJustConfirmed()",
      "void FVGSM_H1_Tick",
    ],
  },
  {
    title: "RSI hidden divergence setup → OB+FVG execution",
    file: "Phase3_RSIHD_OBFVG_Test.mq5",
    config: {
      setup: { modules: ["rsi_hd"], timeframe: "H4" },
      execution: { modules: ["ob_fvg"], timeframe: "M15" },
      management: { riskPercent: 1, rewardRisk: 3, stopBuffer: 20, maxOpenTrades: 1 },
    },
    aiWiring: {
      direction_brain: `void Direction_Brain_Execute() { gBias = 0; }`,
      setup_brain: `void Setup_Brain_Execute() {
  if(RSIHDSM_H4_HasActiveBull()) { gSetupActive = true; gSetupDir = 1; gSetupSLHint = RSIHDSM_H4_ActiveBullSL(); }
  else if(RSIHDSM_H4_HasActiveBear()) { gSetupActive = true; gSetupDir = -1; gSetupSLHint = RSIHDSM_H4_ActiveBearSL(); }
}`,
      execution_brain: `void Execution_Brain_Execute() {
  if(!gSetupActive) return;
  if(gSetupDir == 1 && OBFVGSM_M15_BullJustConfirmed()) { gExecSignal = true; gExecDir = 1; gExecSL = OBFVGSM_M15_BullConfirmSL(); }
  else if(gSetupDir == -1 && OBFVGSM_M15_BearJustConfirmed()) { gExecSignal = true; gExecDir = -1; gExecSL = OBFVGSM_M15_BearConfirmSL(); }
}`,
      required_sms: ["RSIHDSM_H4", "OBFVGSM_M15"],
      sm_configs: {
        rsi_H4: sm("rsi_hd", "H4", { rsiPeriod: 21, pivotLeft: 4, pivotRight: 4, lookback: 80 }),
        obfvg_M15: sm("ob_fvg", "M15", { lookback: 50, expiryBars: 60 }),
      },
    },
    requiredSnippets: [
      "void RSIHDSM_H4_Tick",
      "void OBFVGSM_M15_Tick",
      "RSIHDSM_H4_HasActiveBull()",
      "OBFVGSM_M15_BullJustConfirmed()",
    ],
  },
];

for (const test of phase3CoverageCases) {
  runAiTest(test.title, test.file, () =>
    buildContractCoverageEa(
      test.title.replace(/[^\w]+/g, "_"),
      test.config,
      test.aiWiring,
      test.requiredSnippets,
    ),
  );
}

// ── EMA cross→retest sequence (M15 cross → M5 cross setup → M5 retest/confirm) ─
runAiTest(
  "EMA cross→retest SM (M15 bias → M5 cross → retest → confirm)",
  "EMA_CrossRetest_SM_Test.mq5",
  () => {
    const config: FourBrainConfig = {
      direction: { modules: ["ema"], timeframe: "M15" },
      setup: { modules: ["ema"], timeframe: "M5" },
      execution: { modules: ["ema"], timeframe: "M5" },
      management: {
        riskPercent: 1.0,
        rewardRisk: 2.0,
        stopBuffer: 20,
        breakEvenEnabled: true,
        breakEvenAtR: 1.0,
        maxOpenTrades: 3,
      },
    };
    const aiWiring: AiBrainWiring = {
      direction_brain: `void Direction_Brain_Execute() {
   int nb = EMASM_M15_Bias();
   if(nb != gBias && nb != 0) { gBias = nb; gSetupActive = false; }
}`,
      setup_brain: `void Setup_Brain_Execute() {
   EMASM_M5_Tick(gBias);
   if(EMASM_M5_SetupActive()) { gSetupActive = true; gSetupDir = EMASM_M5_ActiveDir(); gSetupSLHint = EMASM_M5_ActiveSL(); }
   else { gSetupActive = false; }
}`,
      execution_brain: `void Execution_Brain_Execute() {
   EMASM_M5_Tick(gBias);
   if(EMASM_M5_JustConfirmed()) { gExecSignal = true; gExecDir = EMASM_M5_ConfirmDir(); gExecSL = EMASM_M5_ConfirmSL(); }
}`,
      required_sms: ["EMASM_M15", "EMASM_M5"],
      sm_configs: {
        ema_M5: {
          type: "ema",
          id: "M5",
          TF: "PERIOD_M5",
          tf: "M5",
          params: { fastPeriod: 12, slowPeriod: 48, retestPoints: 0, requireCross: true },
        },
      },
    };
    const code = generateEA({
      eaName: "EMA_CrossRetest_SM_Test",
      config,
      globalSymbol: "EURUSD",
      globalMagic: 990780,
      aiWiring,
    });
    const checks: Array<[string, boolean]> = [
      ["M15 bias SM embedded", code.includes("int EMASM_M15_Bias()")],
      ["M5 SM embedded", code.includes("void EMASM_M5_Tick(")],
      [
        "both SMs reset in OnInit",
        code.includes("EMASM_M15_Reset();") && code.includes("EMASM_M5_Reset();"),
      ],
      ["CROSSED gate present", code.includes("EMASM_M5_CROSSED") && code.includes("bullCross")],
      [
        "setup uses SetupActive",
        code.includes("EMASM_M5_SetupActive()") && code.includes("EMASM_M5_JustConfirmed()"),
      ],
      ["direction alignment gate", code.includes("disagrees with bias")],
    ];
    return { code, checks };
  },
);

// ── Template-mode EMA EA: confirm the MA helper is emitted AND used (drawn) ────
runAiTest("EMA cross (template, drawn MAs)", "EMA_Cross_Template_Test.mq5", () => {
  const config: FourBrainConfig = {
    direction: {
      modules: ["ema"],
      timeframe: "H1",
      parameters: { fastPeriod: 12, slowPeriod: 48 },
    },
    setup: { modules: ["ema"], timeframe: "M5", parameters: { fastPeriod: 12, slowPeriod: 48 } },
    execution: { modules: ["engulfing"], timeframe: "M5" },
    management: {
      riskPercent: 1.0,
      rewardRisk: 2.0,
      stopBuffer: 50,
      breakEvenEnabled: true,
      breakEvenAtR: 1.5,
      maxOpenTrades: 3,
    },
  } as FourBrainConfig;
  const code = generateEA({
    eaName: "EMA_Cross_Template_Test",
    config,
    globalSymbol: "EURUSD",
    globalMagic: 990779,
  });
  const checks: Array<[string, boolean]> = [
    ["B4_MA helper emitted", code.includes("int B4_MA(")],
    ["B4_Buf generic buffer helper emitted", code.includes("double B4_Buf(")],
    ["B4_RSI helper emitted", code.includes("int B4_RSI(")],
    ["B4_ATR helper emitted", code.includes("int B4_ATR(")],
    ["B4_MACD helper emitted", code.includes("int B4_MACD(")],
    ["B4_Bands helper emitted", code.includes("int B4_Bands(")],
    ["B4_Stochastic helper emitted", code.includes("int B4_Stochastic(")],
    ["B4_ADX helper emitted", code.includes("int B4_ADX(")],
    ["B4_Ichimoku helper emitted", code.includes("int B4_Ichimoku(")],
    ["B4_SAR helper emitted", code.includes("int B4_SAR(")],
    ["B4_Fractals helper emitted", code.includes("int B4_Fractals(")],
    ["indicator key cache emitted", code.includes("string         B4_indKey[]")],
    ["ChartIndicatorAdd present", code.includes("ChartIndicatorAdd(")],
    ["direction uses B4_MA", /B4_MA\(PERIOD_H1, \d+, MODE_EMA\)/.test(code)],
    ["setup uses B4_MA", /B4_MA\(PERIOD_M5, \d+, MODE_EMA\)/.test(code)],
    ["no fake summation EMA", !code.includes("fastSum")],
  ];
  return { code, checks };
});

// ── Template-mode MES EA: engulfing on ALL 3 brains uses the verified EGSM ─────
// Proves Phase 2B wiring: Direction/Setup/Execution brains call EGSM_*_ functions
// (NOT a simplified inline body-engulf), and the assembler embeds + ticks + resets
// one EGSM per brain timeframe.
runAiTest("RSI HD setup template embeds verified SM", "RSI_HD_Template_Setup_Test.mq5", () => {
  const config: FourBrainConfig = {
    direction: { modules: ["engulfing"], timeframe: "M5" },
    setup: {
      modules: ["rsi_hd"],
      timeframe: "M5",
      params: { rsiPeriod: 21, pivotLeft: 4, pivotRight: 4, maxBars: 80, expiryBars: 70 },
    },
    execution: {
      modules: ["engulfing", "rsi_hd"],
      timeframe: "M5",
      params: { rsiPeriod: 21, pivotLeft: 4, pivotRight: 4, maxBars: 80, expiryBars: 70 },
    },
    management: {
      riskPercent: 1,
      rewardRisk: 2,
      stopBuffer: 20,
      breakEvenEnabled: true,
      breakEvenAtR: 1,
      maxOpenTrades: 3,
    },
  };
  const code = generateEA({
    eaName: "RSI_HD_Template_Setup_Test",
    config,
    globalSymbol: "EURUSD",
    globalMagic: 990792,
  });
  const checks: Array<[string, boolean]> = [
    ["RSIHDSM M5 embedded", code.includes("void RSIHDSM_M5_Tick(")],
    ["RSIHDSM reset emitted", code.includes("RSIHDSM_M5_Reset();")],
    ["RSIHDSM ticked", code.includes("RSIHDSM_M5_Tick(50);")],
    ["RSI params preserved", code.includes("iRSI(InpSymbol, PERIOD_M5, 21, PRICE_CLOSE)")],
    ["setup uses active bull", code.includes("RSIHDSM_M5_HasActiveBull()")],
    ["setup uses active bear", code.includes("RSIHDSM_M5_HasActiveBear()")],
    ["setup SL hint from RSI HD", code.includes("RSIHDSM_M5_ActiveBullSL()")],
    ["execution can use RSI HD", code.includes("RSIHDSM_M5_BullJustConfirmed()")],
    ["RSI HD has active state", code.includes("ST_ACTIVE")],
    ["RSI HD confirms beyond mid level", code.includes("cl > RSIHDSM_M5_rec[i].midLevel")],
    ["RSI HD invalidates beyond second swing", code.includes("cl < RSIHDSM_M5_rec[i].swing2")],
    ["no RSI setup placeholder", !code.includes("Module 'rsi_hd' on M5: not yet implemented")],
  ];
  return { code, checks };
});

runAiTest("EMA CTC sequence (template, verified EMASM)", "EMA_CTC_Template_Test.mq5", () => {
  const config: FourBrainConfig = {
    direction: { modules: ["ema"], timeframe: "M30", params: { fastPeriod: 12, slowPeriod: 48 } },
    setup: {
      modules: ["ema"],
      timeframe: "M30",
      params: {
        fastPeriod: 12,
        slowPeriod: 48,
        retestTarget: "slow",
        sequenceMode: "cross_test_close",
        requireCross: true,
      },
    },
    execution: {
      modules: ["ema"],
      timeframe: "M30",
      params: {
        fastPeriod: 12,
        slowPeriod: 48,
        retestTarget: "slow",
        sequenceMode: "cross_test_close",
        requireCross: true,
      },
    },
    management: {
      riskPercent: 1,
      rewardRisk: 3,
      stopBuffer: 20,
      breakEvenEnabled: true,
      breakEvenAtR: 1.5,
      maxOpenTrades: 1,
    },
  };
  const code = generateEA({
    eaName: "EMA_CTC_Template_Test",
    config,
    globalSymbol: "EURUSD",
    globalMagic: 990787,
  });
  const checks: Array<[string, boolean]> = [
    ["EMASM M30 embedded", code.includes("void EMASM_M30_Tick(")],
    ["EMASM reset emitted", code.includes("EMASM_M30_Reset();")],
    ["EMASM ticked with bias", code.includes("EMASM_M30_Tick(gBias);")],
    ["setup reads EMASM active phase", code.includes("EMASM_M30_SetupActive()")],
    ["setup SL hint from EMASM", code.includes("EMASM_M30_ActiveSL()")],
    ["execution waits for confirmation", code.includes("EMASM_M30_JustConfirmed()")],
    ["execution SL from pullback extreme", code.includes("EMASM_M30_ConfirmSL()")],
    ["CTC retest defaults to exact touch", code.includes("retest=0pts requireCross=true")],
    ["CTC cross stays active for repeat entries", code.includes("repeat=true")],
    ["slow EMA close-through does not invalidate bull setup", !code.includes("cl < s1")],
    ["historical cross bootstrap only runs once", code.includes("bool   EMASM_M30_bootstrapUsed")],
    [
      "repeated historical bootstrap blocked after consume",
      code.includes("requireCross && !EMASM_M30_bootstrapUsed"),
    ],
    ["slow retest log present", code.includes("BULL retest of slow")],
    ["close confirmation log present", code.includes("BULL CONFIRMED")],
    ["old simple EMA entry not used", !code.includes("EMA GOLDEN CROSS")],
  ];
  return { code, checks };
});

runAiTest("EMA CTC repeated retests after one cross", "EMA_CTC_Repeat_Test.mq5", () => {
  const config: FourBrainConfig = {
    direction: { modules: ["ema"], timeframe: "M30", params: { fastPeriod: 12, slowPeriod: 48 } },
    setup: {
      modules: ["ema"],
      timeframe: "M30",
      params: {
        fastPeriod: 12,
        slowPeriod: 48,
        retestTarget: "slow",
        sequenceMode: "cross_test_close",
        requireCross: true,
        repeatAfterConfirmation: true,
      },
    },
    execution: {
      modules: ["ema"],
      timeframe: "M30",
      params: {
        fastPeriod: 12,
        slowPeriod: 48,
        retestTarget: "slow",
        sequenceMode: "cross_test_close",
        requireCross: true,
        repeatAfterConfirmation: true,
      },
    },
    management: {
      riskPercent: 1,
      rewardRisk: 3,
      stopBuffer: 20,
      breakEvenEnabled: true,
      breakEvenAtR: 1.5,
      maxOpenTrades: 1,
    },
  };
  const code = generateEA({
    eaName: "EMA_CTC_Repeat_Test",
    config,
    globalSymbol: "EURUSD",
    globalMagic: 990788,
  });
  const checks: Array<[string, boolean]> = [
    ["repeat mode emitted in EMASM header", code.includes("repeat=true")],
    [
      "confirmation returns to waiting-for-retest phase",
      code.includes("if(true && EMASM_M30_confirmDir == bias && bias != 0)") &&
        code.includes("EMASM_M30_phase = EMASM_M30_CROSSED;"),
    ],
    ["still requires a fresh slow EMA retest", code.includes("else if(bearRetestSlow)")],
    ["does not use simple EMA cross entry", !code.includes("EMA GOLDEN CROSS")],
  ];
  return { code, checks };
});

runAiTest("Template built-in filters route by role", "Template_Filter_Gates_Test.mq5", () => {
  const config: FourBrainConfig = {
    direction: { modules: ["ema"], timeframe: "M5" },
    setup: { modules: ["ema"], timeframe: "M5" },
    execution: { modules: ["fvg_inversion"], timeframe: "M5" },
    management: { riskPercent: 1, rewardRisk: 2, stopBuffer: 20, maxOpenTrades: 1 },
  };
  const code = generateEA({
    eaName: "Template_Filter_Gates_Test",
    config,
    globalSymbol: "EURUSD",
    globalMagic: 990783,
    filterRefs: [
      {
        id: "rsi_level_filter",
        label: "RSI Level Filter",
        indicatorId: "rsi",
        role: "filter",
        appliesTo: "setup",
        timeframe: "M5",
        params: { period: 14, level: 50, operator: "directional" },
        status: "builtin_filter",
        note: "test",
      },
      {
        id: "atr_volatility_filter",
        label: "ATR Volatility Filter",
        indicatorId: "atr",
        role: "filter",
        appliesTo: "execution",
        timeframe: "M5",
        params: { period: 14, minAtrPoints: 100, operator: "above" },
        status: "builtin_filter",
        note: "test",
      },
      {
        id: "macd_histogram_filter",
        label: "MACD Histogram Filter",
        indicatorId: "macd",
        role: "filter",
        appliesTo: "execution",
        timeframe: "M5",
        params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, operator: "directional" },
        status: "builtin_filter",
        note: "test",
      },
    ],
  });
  const checks: Array<[string, boolean]> = [
    ["template RSI filter emitted", code.includes("B4_RSI(PERIOD_M5, 14)")],
    ["template ATR filter emitted", code.includes("B4_ATR(PERIOD_M5, 14)")],
    ["template MACD filter emitted", code.includes("B4_MACD(PERIOD_M5, 12, 26, 9)")],
    ["template ATR converts points", code.includes("SYMBOL_POINT")],
    ["template setup filters block setup", code.includes("gSetupActive = false")],
    ["template filters block execution", code.includes("gExecSignal = false")],
  ];
  return { code, checks };
});

runAiTest("Blueprint template carries filter refs", "Blueprint_Template_Filter_Test.mq5", () => {
  const blueprint: StrategyBlueprint = {
    version: "2.0",
    name: "Blueprint Template Filter Test",
    strategyType: [],
    marketPhilosophy: "Template filter regression",
    rules: [],
    risk: {
      riskPercent: 1,
      rewardRisk: 2,
      lotSizingMethod: "equity_percent",
      stopType: "candle_extreme",
      stopBufferPoints: 20,
      trailingStop: false,
      breakevenEnabled: false,
      partialClose: false,
      maxOpenTrades: 1,
    },
    execution: {
      symbol: "EURUSD",
      setupTimeframe: "M5",
      entryTimeframe: "M5",
      orderType: "market",
      setupExpiryBars: 24,
      sessionFilter: [],
      spreadFilterPoints: 25,
      magicNumber: 990784,
    },
    compilable: true,
    compilableRuleIds: [],
    subjectiveRuleIds: [],
    pendingClarifications: [],
    confidence: 100,
    filterRefs: [
      {
        id: "rsi_level_filter",
        label: "RSI Level Filter",
        indicatorId: "rsi",
        role: "filter",
        appliesTo: "setup",
        timeframe: "M5",
        params: { period: 14, level: 50, operator: "above" },
        status: "builtin_filter",
        note: "test",
      },
    ],
    fourBrain: {
      direction: { modules: ["ema"], timeframe: "M5" },
      setup: { modules: ["ema"], timeframe: "M5" },
      execution: { modules: ["fvg_inversion"], timeframe: "M5" },
      management: { riskPercent: 1, rewardRisk: 2, stopBuffer: 20, maxOpenTrades: 1 },
    },
  };
  const code = generateMql5FromBlueprint(blueprint);
  const checks: Array<[string, boolean]> = [
    ["blueprint filterRef reaches template generator", code.includes("B4_RSI(PERIOD_M5, 14)")],
    ["blueprint template setup filter blocks setup", code.includes("gSetupActive = false")],
  ];
  return { code, checks };
});

runAiTest("MES engulfing (template, verified EGSM)", "MES_Engulfing_Template_Test.mq5", () => {
  const config: FourBrainConfig = {
    direction: { modules: ["engulfing"], timeframe: "D1" },
    setup: { modules: ["engulfing"], timeframe: "H4" },
    execution: { modules: ["engulfing"], timeframe: "M30" },
    management: {
      riskPercent: 1.0,
      rewardRisk: 2.0,
      stopBuffer: 30,
      maxOpenTrades: 1,
    },
  } as FourBrainConfig;
  const code = generateEA({
    eaName: "MES_Engulfing_Template_Test",
    config,
    globalSymbol: "XAUUSD",
    globalMagic: 770077,
  });
  const checks: Array<[string, boolean]> = [
    ["EGSM D1 embedded", code.includes("void EGSM_D1_Tick(")],
    ["EGSM H4 embedded", code.includes("void EGSM_H4_Tick(")],
    ["EGSM M30 embedded", code.includes("void EGSM_M30_Tick(")],
    ["direction uses EGSM confirm", code.includes("EGSM_D1_BullJustConfirmed()")],
    ["setup uses EGSM active zone", code.includes("EGSM_H4_HasActiveBull()")],
    ["setup SL hint from zone", code.includes("EGSM_H4_LatestBullLL()")],
    ["exec uses EGSM confirm+SL", code.includes("EGSM_M30_BullConfirmSL()")],
    ["EGSM ticked (D1)", code.includes("EGSM_D1_Tick(")],
    ["EGSM ticked (H4)", code.includes("EGSM_H4_Tick(")],
    ["EGSM ticked (M30)", code.includes("EGSM_M30_Tick(")],
    ["EGSM reset (D1)", code.includes("EGSM_D1_Reset();")],
    ["EGSM reset (H4)", code.includes("EGSM_H4_Reset();")],
    ["EGSM reset (M30)", code.includes("EGSM_M30_Reset();")],
    ["multi-candle detect present", code.includes("took %d candle(s)")],
    ["NO fake inline body-engulf", !code.includes("c1 >= o2 && o1 <= c2")],
    ["roadblock query emitted", code.includes("double EGSM_D1_RoadblockBull()")],
    ["path-clear query emitted", code.includes("bool EGSM_D1_PathClearBull()")],
  ];
  return { code, checks };
});

runAiTest("EMA test gates later iFVG", "EMA_Test_Then_IFVG_Test.mq5", () => {
  const config: FourBrainConfig = {
    direction: { modules: ["ema"], timeframe: "M5" },
    setup: { modules: ["ema", "fvg_inversion"], timeframe: "M5" },
    execution: { modules: ["fvg_inversion"], timeframe: "M5" },
    management: {
      riskPercent: 1,
      rewardRisk: 3,
      stopBuffer: 20,
      breakEvenEnabled: true,
      breakEvenAtR: 1.5,
      maxOpenTrades: 1,
      maxStopPoints: 70,
    },
  };
  const aiWiring: AiBrainWiring = {
    direction_brain: `int gEmaIfvgSeqBias_M5 = 0;
datetime gEmaIfvgCrossTime_M5 = 0;
datetime gEmaIfvgTestTime_M5 = 0;

void Direction_Brain_Execute() {
   static int _lastBias = 0;
   int hFast = B4_MA(PERIOD_M5, 12, MODE_EMA);
   int hSlow = B4_MA(PERIOD_M5, 48, MODE_EMA);
   datetime barTime = iTime(InpSymbol, PERIOD_M5, 1);
   double f1 = B4_MAval(hFast, 1), s1 = B4_MAval(hSlow, 1);
   double f2 = B4_MAval(hFast, 2), s2 = B4_MAval(hSlow, 2);
   bool bullCross = (f2 <= s2 && f1 > s1);
   bool bearCross = (f2 >= s2 && f1 < s1);
   if(bullCross) {
      gBias = 1; gEmaIfvgSeqBias_M5 = 1; gEmaIfvgCrossTime_M5 = barTime; gEmaIfvgTestTime_M5 = 0;
   } else if(bearCross) {
      gBias = -1; gEmaIfvgSeqBias_M5 = -1; gEmaIfvgCrossTime_M5 = barTime; gEmaIfvgTestTime_M5 = 0;
   }
   if(gBias != _lastBias) { _lastBias = gBias; gSetupActive = false; }
}`,
    setup_brain: `void Setup_Brain_Execute() {
   gSetupActive = false; gSetupDir = 0; gSetupSLHint = 0.0;
   datetime barTime = iTime(InpSymbol, PERIOD_M5, 1);
   if(gBias == 0) { gEmaIfvgSeqBias_M5 = 0; gEmaIfvgCrossTime_M5 = 0; gEmaIfvgTestTime_M5 = 0; return; }
   if(gBias != gEmaIfvgSeqBias_M5) return;
   int hFast = B4_MA(PERIOD_M5, 12, MODE_EMA);
   int hSlow = B4_MA(PERIOD_M5, 48, MODE_EMA);
   double fast = B4_MAval(hFast, 1), slow = B4_MAval(hSlow, 1);
   double hi = iHigh(InpSymbol, PERIOD_M5, 1), lo = iLow(InpSymbol, PERIOD_M5, 1);
   bool touchedFast = (lo <= fast && hi >= fast);
   bool touchedSlow = (lo <= slow && hi >= slow);
   if(gEmaIfvgTestTime_M5 == 0 && gEmaIfvgCrossTime_M5 > 0 && barTime > gEmaIfvgCrossTime_M5 && touchedSlow)
      gEmaIfvgTestTime_M5 = barTime;
   IFVGSM_M5_Tick(1);
   datetime invTime = (gBias == 1) ? IFVGSM_M5_BullInversionTime() : IFVGSM_M5_BearInversionTime();
   if(gEmaIfvgTestTime_M5 > 0 && invTime > gEmaIfvgTestTime_M5) { gSetupActive = true; gSetupDir = gBias; }
}`,
    execution_brain: `void Execution_Brain_Execute() {
   gExecSignal = false; gExecDir = 0; gExecSL = 0.0;
   IFVGSM_M5_Tick(1);
   datetime bullInv = IFVGSM_M5_BullInversionTime();
   datetime bearInv = IFVGSM_M5_BearInversionTime();
   if(gSetupActive && gSetupDir == 1 && gBias == 1 && IFVGSM_M5_BullJustInverted() && bullInv > gEmaIfvgTestTime_M5) {
      gExecSignal = true; gExecDir = 1; gExecSL = IFVGSM_M5_BullInversionSL();
   } else if(gSetupActive && gSetupDir == -1 && gBias == -1 && IFVGSM_M5_BearJustInverted() && bearInv > gEmaIfvgTestTime_M5) {
      gExecSignal = true; gExecDir = -1; gExecSL = IFVGSM_M5_BearInversionSL();
   }
}`,
    semantics: {
      version: 1,
      source: "deterministic_adapter",
      timeframe: "M5",
      modules: ["ema", "fvg_inversion"],
      direction: {
        module: "ema",
        event: "cross",
        fastPeriod: 12,
        slowPeriod: 48,
        resetPolicy: "opposite_cross",
      },
      setup: {
        gate: "ema_retest",
        target: "slow",
        targetLabel: "slow EMA (48)",
        mustOccurAfter: "direction_event",
      },
      execution: {
        module: "fvg_inversion",
        entryEvent: "formation",
        mustOccurAfter: "setup_gate",
      },
      assumptions: [],
    },
    validation: {
      status: "pass",
      errors: [],
      warnings: [],
    },
    sm_configs: {
      ifvg_M5: {
        type: "fvg_inversion",
        id: "M5",
        TF: "PERIOD_M5",
        tf: "M5",
        params: { expiryBars: 24 },
      },
    },
  };
  const code = generateEA({
    eaName: "EMA_Test_Then_IFVG_Test",
    config,
    globalSymbol: "EURUSD",
    globalMagic: 990781,
    aiWiring,
  });
  const checks: Array<[string, boolean]> = [
    ["IFVG time accessors emitted", code.includes("LatestBullInversionTime")],
    [
      "setup compares just-formed IFVG after EMA test",
      code.includes("invTime > gEmaIfvgTestTime_M5"),
    ],
    [
      "slow-only EMA retest gate is preserved",
      code.includes("&& touchedSlow") && !code.includes("touchedFast || touchedSlow"),
    ],
    ["execution uses iFVG formation signal", code.includes("BullJustInverted()")],
    [
      "execution rechecks bias/setup/time gate",
      code.includes("gBias == 1") && code.includes("bullInv > gEmaIfvgTestTime_M5"),
    ],
    ["execution uses formation SL", code.includes("BullInversionSL()")],
    ["uses just-closed bar tick", code.includes("IFVGSM_M5_Tick(1)")],
    ["AI audit header emitted", code.includes("AI validation: pass")],
    ["AI audit repair status emitted", code.includes("AI repair    : not_needed")],
    ["AI audit shows slow EMA target", code.includes("AI setup") && code.includes("slow EMA (48)")],
  ];
  return { code, checks };
});

runAiTest("EMA test tolerance reaches generated EA", "EMA_Tolerance_IFVG_Test.mq5", () => {
  const config: FourBrainConfig = {
    direction: { modules: ["ema"], timeframe: "M5" },
    setup: { modules: ["ema"], timeframe: "M5", params: { retestPoints: 3, retestTarget: "slow" } },
    execution: { modules: ["fvg_inversion"], timeframe: "M5" },
    management: { riskPercent: 1, rewardRisk: 3, stopBuffer: 20, maxOpenTrades: 1 },
  };
  const aiWiring = buildEmaTestThenIfvgFormationWiring(
    "M5 only. 12 EMA crosses 48 EMA. Price must test only the 48 EMA within 3 points. IFVG forms after the EMA test and triggers entry.",
    config,
  ) as AiBrainWiring;
  const code = generateEA({
    eaName: "EMA_Tolerance_IFVG_Test",
    config,
    globalSymbol: "EURUSD",
    globalMagic: 990786,
    aiWiring,
  });
  const checks: Array<[string, boolean]> = [
    ["retest tolerance emitted", code.includes("double retestTol = 3")],
    ["tolerance converted to points", code.includes("SYMBOL_POINT")],
    ["slow target still preserved", code.includes("&& touchedSlow")],
    ["either target not introduced", !code.includes("touchedFast || touchedSlow")],
  ];
  return { code, checks };
});

runAiTest("Built-in filters gate execution", "BuiltIn_Filter_Gates_Test.mq5", () => {
  const config: FourBrainConfig = {
    direction: { modules: ["ema"], timeframe: "M5" },
    setup: { modules: ["ema"], timeframe: "M5" },
    execution: { modules: ["fvg_inversion"], timeframe: "M5" },
    management: { riskPercent: 1, rewardRisk: 2, stopBuffer: 20, maxOpenTrades: 1 },
  };
  const aiWiring: AiBrainWiring = {
    direction_brain: "void Direction_Brain_Execute() { gBias = 1; }",
    setup_brain: "void Setup_Brain_Execute() { gSetupActive = true; gSetupDir = gBias; }",
    execution_brain: `void Execution_Brain_Execute() {
   gExecSignal = true; gExecDir = gBias; gExecSL = iLow(InpSymbol, PERIOD_M5, 1);
   int hRsi = B4_RSI(PERIOD_M5, 14);
   double rsi = B4_Buf(hRsi, 0, 1);
   if(gExecSignal && gExecDir == 1 && rsi <= 50.0) gExecSignal = false;
   int hAtr = B4_ATR(PERIOD_M5, 14);
   double atrPts = B4_Buf(hAtr, 0, 1) / SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   if(gExecSignal && atrPts < 100.0) gExecSignal = false;
   int hMacd = B4_MACD(PERIOD_M5, 12, 26, 9);
   double macdMain = B4_Buf(hMacd, 0, 1);
   double macdSignal = B4_Buf(hMacd, 1, 1);
   double macdHist = macdMain - macdSignal;
   if(gExecSignal && gExecDir == 1 && macdHist <= 0.0) gExecSignal = false;
}`,
    semantics: {
      version: 1,
      source: "ai",
      timeframe: "M5",
      modules: ["ema", "fvg_inversion"],
      filters: [
        {
          id: "rsi_level_filter",
          role: "execution",
          indicator: "rsi",
          timeframe: "M5",
          params: { period: 14, level: 50, operator: "directional" },
        },
        {
          id: "atr_volatility_filter",
          role: "execution",
          indicator: "atr",
          timeframe: "M5",
          params: { period: 14, minAtrPoints: 100, operator: "above" },
        },
        {
          id: "macd_histogram_filter",
          role: "execution",
          indicator: "macd",
          timeframe: "M5",
          params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, operator: "directional" },
        },
      ],
      assumptions: [],
    },
    validation: { status: "pass", errors: [], warnings: [] },
    required_sms: [],
    sm_configs: {},
    notes: "Built-in filters gate execution.",
  };
  const code = generateEA({
    eaName: "BuiltIn_Filter_Gates_Test",
    config,
    globalSymbol: "EURUSD",
    globalMagic: 990782,
    aiWiring,
  });
  const checks: Array<[string, boolean]> = [
    ["RSI helper used by filter", code.includes("B4_RSI(PERIOD_M5, 14)")],
    ["ATR helper used by filter", code.includes("B4_ATR(PERIOD_M5, 14)")],
    ["MACD helper used by filter", code.includes("B4_MACD(PERIOD_M5, 12, 26, 9)")],
    ["ATR converts to points", code.includes("SYMBOL_POINT")],
    ["MACD histogram derived", code.includes("macdMain - macdSignal")],
    ["filters block execution signal", code.includes("gExecSignal = false")],
    ["AI audit lists filters", code.includes("AI filters")],
  ];
  return { code, checks };
});

// ── EG+EF (Engulfing / Engulfing Failed) as Setup→Execution via AI path ─────
runAiTest("EG+EF as Setup→Execution (MES)", "EG_EF_Setup_Exec_Test.mq5", () => {
  const config: FourBrainConfig = {
    direction: { modules: ["bos"], timeframe: "H4" },
    setup: { modules: ["engulfing"], timeframe: "H4" },
    execution: { modules: ["engulfing"], timeframe: "M30" },
    management: {
      riskPercent: 1.0,
      rewardRisk: 3.0,
      stopBuffer: 20,
      breakEvenEnabled: true,
      breakEvenAtR: 1.5,
      maxOpenTrades: 1,
    },
  };
  const aiWiring: AiBrainWiring = {
    direction_brain: `void Direction_Brain_Execute() {
  if(BOSSM_H4_BullBias()) { gBias = 1; }
  else if(BOSSM_H4_BearBias()) { gBias = -1; }
  else { gBias = 0; }
}`,
    setup_brain: `void Setup_Brain_Execute() {
  gSetupActive = false; gSetupDir = 0; gSetupSLHint = 0.0;
  if(gBias == 1 && EGSM_H4_HasActiveBull()) {
    gSetupActive = true; gSetupDir = 1; gSetupSLHint = EGSM_H4_LatestBullLL();
  } else if(gBias == -1 && EGSM_H4_HasActiveBear()) {
    gSetupActive = true; gSetupDir = -1; gSetupSLHint = EGSM_H4_LatestBearUL();
  }
}`,
    execution_brain: `void Execution_Brain_Execute() {
  gExecSignal = false; gExecDir = 0; gExecSL = 0.0;
  if(!gSetupActive) return;
  if(gSetupDir == 1 && EGSM_M30_BullJustConfirmed()) {
    gExecSignal = true; gExecDir = 1; gExecSL = EGSM_M30_BullConfirmSL();
  } else if(gSetupDir == -1 && EGSM_M30_BearJustConfirmed()) {
    gExecSignal = true; gExecDir = -1; gExecSL = EGSM_M30_BearConfirmSL();
  }
}`,
    required_sms: ["BOSSM_H4", "EGSM_H4", "EGSM_M30"],
    sm_configs: {
      bos_H4: {
        type: "bos",
        id: "H4",
        TF: "PERIOD_H4",
        tf: "H4",
        params: { swingLen: 5, lookback: 20 },
      },
      eg_H4: {
        type: "engulfing",
        id: "H4",
        TF: "PERIOD_H4",
        tf: "H4",
        params: { scanBack: 3, expiryBars: 200 },
      },
      eg_M30: {
        type: "engulfing",
        id: "M30",
        TF: "PERIOD_M30",
        tf: "M30",
        params: { scanBack: 3, expiryBars: 100 },
      },
    },
  };
  const code = generateEA({
    eaName: "EG_EF_Setup_Exec_Test",
    config,
    globalSymbol: "EURUSD",
    globalMagic: 990790,
    aiWiring,
  });
  const checks: Array<[string, boolean]> = [
    ["EGSM_H4 SM embedded", code.includes("EGSM_H4_Reset()")],
    ["EGSM_M30 SM embedded", code.includes("EGSM_M30_Reset()")],
    ["EG detection fn present", code.includes("EGSM_H4_Detect(")],
    ["EF flip logic present — BULL→BEAR", code.includes("BULL EG FAILED")],
    ["EF flip logic present — BEAR→BULL", code.includes("BEAR EG FAILED")],
    ["BullJustConfirmed accessor present", code.includes("EGSM_M30_BullJustConfirmed()")],
    ["BearJustConfirmed accessor present", code.includes("EGSM_M30_BearJustConfirmed()")],
    ["HasActiveBull setup gate", code.includes("EGSM_H4_HasActiveBull()")],
    ["LatestBullLL SL hint", code.includes("EGSM_H4_LatestBullLL()")],
    ["Assembler controls Tick — EGSM_H4_Tick(3)", code.includes("EGSM_H4_Tick(3)")],
    ["Assembler controls Tick — EGSM_M30_Tick(3)", code.includes("EGSM_M30_Tick(3)")],
  ];
  return { code, checks };
});

function runModuleContractAudit() {
  console.log(`\n── Module contract registry audit ──`);

  const checks: Array<[string, boolean, string?]> = [];
  const libraryIds = MODULE_LIBRARY.map((m) => m.id);
  const uiIds = Object.keys(MODULE_UI_PARAMS);
  const contractIds = Object.keys(MODULE_CONTRACTS);
  const knownIds = [...new Set([...libraryIds, ...uiIds])];

  const missingContracts = knownIds.filter((id) => !getModuleContract(id));
  checks.push([
    "every library/UI module has a contract",
    missingContracts.length === 0,
    missingContracts.join(", "),
  ]);

  const orphanContracts = contractIds.filter((id) => !knownIds.includes(id));
  checks.push([
    "contract ids are backed by library or UI vocabulary",
    orphanContracts.length === 0,
    orphanContracts.join(", "),
  ]);
  checks.push([
    "registered SM function is allowed",
    moduleContractAllowsSmFunction("IFVGSM", "IFVGSM_M5_BullJustInverted("),
  ]);
  checks.push([
    "invented SM function is rejected",
    !moduleContractAllowsSmFunction("IFVGSM", "IFVGSM_M5_DoMagicThing("),
  ]);

  for (const [id, contract] of Object.entries(MODULE_CONTRACTS)) {
    const eventless = contract.semanticEvents.length === 0;
    checks.push([`${id}: has semantic events`, !eventless]);

    const roleless = contract.supportedRoles.length === 0;
    checks.push([`${id}: has supported roles`, !roleless]);

    const eventsOutsideRoles = contract.semanticEvents.filter((event) =>
      event.roles.some((role) => !contract.supportedRoles.includes(role)),
    );
    checks.push([
      `${id}: event roles are supported`,
      eventsOutsideRoles.length === 0,
      eventsOutsideRoles.map((event) => event.id).join(", "),
    ]);

    const eventsWithoutQueries = contract.semanticEvents.filter(
      (event) => event.queryFunctions.length === 0,
    );
    checks.push([
      `${id}: events expose query functions`,
      eventsWithoutQueries.length === 0,
      eventsWithoutQueries.map((event) => event.id).join(", "),
    ]);

    const eventsWithoutCanonicalType = contract.semanticEvents.filter(
      (event) => !resolveModuleSemanticEventType(id, event.id),
    );
    checks.push([
      `${id}: events map to strategy event contracts`,
      eventsWithoutCanonicalType.length === 0,
      eventsWithoutCanonicalType.map((event) => event.id).join(", "),
    ]);

    const roleMismatches = contract.semanticEvents.filter((event) => {
      const eventType = resolveModuleSemanticEventType(id, event.id);
      if (!eventType) return false;
      return event.roles.some((role) => !strategyEventSupportsRole(eventType, role));
    });
    checks.push([
      `${id}: strategy event roles cover module roles`,
      roleMismatches.length === 0,
      roleMismatches.map((event) => event.id).join(", "),
    ]);

    if (contract.implementation === "state_machine") {
      checks.push([`${id}: state-machine prefix declared`, Boolean(contract.smPrefix)]);
      checks.push([`${id}: state-machine type declared`, Boolean(contract.smType)]);
      checks.push([`${id}: state-machine tick policy declared`, contract.tickArgPolicy !== "none"]);
    }
  }

  const eventTypes = Object.keys(STRATEGY_EVENT_CONTRACTS);
  const mappedTypes = [
    ...new Set(
      Object.values(MODULE_SEMANTIC_EVENT_TYPES).flatMap((events) => Object.values(events)),
    ),
  ];
  const missingEventContracts = mappedTypes.filter((eventType) => !eventTypes.includes(eventType));
  checks.push([
    "every mapped strategy event type has a contract",
    missingEventContracts.length === 0,
    missingEventContracts.join(", "),
  ]);

  const payloadlessEvents = Object.values(STRATEGY_EVENT_CONTRACTS).filter(
    (event) => !event.carriesDirection && !event.carriesPrice && !event.carriesZone,
  );
  checks.push([
    "strategy event contracts declare runtime payload",
    payloadlessEvents.length === 0,
    payloadlessEvents.map((event) => event.id).join(", "),
  ]);

  for (const [name, ok, detail] of checks) {
    console.log(`        ${ok ? "✓" : "✗"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
  }
  if (checks.some(([, ok]) => !ok)) totalWarn++;
}

runModuleContractAudit();

function runStrategyFlowSchemaAudit() {
  console.log(`\n── Strategy flow schema audit ──`);

  const checks: Array<[string, boolean, string?]> = [];
  const flow = fourBrainToStrategyFlow({
    direction: {
      modules: ["bos"],
      timeframe: "H1",
      params: { lookback: 20, swingLen: 5 },
      description: "H1 BOS sets directional bias.",
    },
    setup: {
      modules: ["fvg"],
      timeframe: "H1",
      params: { expiryBars: 100 },
      description: "Price pulls back into an H1 fair value gap.",
    },
    execution: {
      modules: ["bos"],
      timeframe: "M5",
      params: { lookback: 20, swingLen: 5 },
      description: "After the H1 FVG, wait for M5 BOS and enter next candle.",
    },
    management: { riskPercent: 1, rewardRisk: 3, stopBuffer: 20, maxOpenTrades: 2 },
  });
  const result = validateStrategyFlowSchema(flow);
  checks.push([
    "4-Brain adapter creates a valid strategy flow",
    result.ok,
    result.errors.join(", "),
  ]);
  checks.push(["flow has three ordered steps", flow.steps.length === 3]);
  checks.push(["direction step uses BOS bias event", flow.steps[0]?.event === "BOS_BIAS"]);
  checks.push(["setup step uses FVG event", flow.steps[1]?.event === "FVG_CREATED"]);
  checks.push(["entry step uses BOS confirmed event", flow.steps[2]?.event === "BOS_CONFIRMED"]);
  checks.push([
    "setup depends on direction",
    flow.steps[1]?.dependsOn?.[0]?.stepId === "step_direction",
  ]);
  checks.push(["entry depends on setup", flow.steps[2]?.dependsOn?.[0]?.stepId === "step_setup"]);

  const broken = validateStrategyFlowSchema({
    ...flow,
    steps: [
      {
        ...flow.steps[2],
        dependsOn: [{ stepId: "missing_step", relation: "after", required: true }],
      },
    ],
  });
  checks.push(["validator rejects missing dependencies", !broken.ok]);

  for (const [name, ok, detail] of checks) {
    console.log(`        ${ok ? "✓" : "✗"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
  }
  if (checks.some(([, ok]) => !ok)) totalWarn++;
}

runStrategyFlowSchemaAudit();

console.log(`\n${items.length + 1} files emitted, ${totalWarn} static warning(s).`);
console.log(`Next: open verify/mql5/*.mq5 in MetaEditor and compile (F7).\n`);
