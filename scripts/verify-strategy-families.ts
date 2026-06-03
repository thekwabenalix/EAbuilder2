/**
 * Strategy-family regression suite.
 *
 * These fixtures start from trader-style text, normalize it into a
 * StrategyBlueprint/FourBrainConfig, then generate an EA through verified
 * state-machine wiring. The goal is to catch intent drift across full families,
 * not just one-off module contracts.
 */
import { normalizeBlueprint } from "../netlify/functions/parse-strategy.mts";
import { buildEmaTestThenIfvgFormationWiring } from "../netlify/functions/gen-4brain-ai.mts";
import { generateEA } from "../src/generators/gen-ea";
import type { AiBrainWiring } from "../src/lib/api-client";
import type { FourBrainConfig, StrategyBlueprint } from "../src/types/blueprint";

interface StrategyFamilyCase {
  name: string;
  prompt: string;
  expected: {
    direction?: string;
    setup?: string;
    execution: string;
    contract?: string[];
    code: string[];
  };
  wiring?: "ema_ifvg" | "generic";
}

function assertOk(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEq<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertIncludes(haystack: string, needle: string, message: string) {
  if (!haystack.includes(needle)) throw new Error(`${message}: missing "${needle}"`);
}

const baseBlueprint: StrategyBlueprint = {
  version: "2.0",
  name: "Strategy Family Fixture",
  strategyType: [],
  marketPhilosophy: "",
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
    symbol: "ANY",
    setupTimeframe: "H4",
    entryTimeframe: "M5",
    entryTiming: "bar_close",
    orderType: "market",
    maxSpreadPoints: 25,
    slippagePoints: 5,
    magicNumber: 260604,
    oneTradePerSignal: true,
  },
  compilable: true,
  confidence: 1,
};

const smMeta: Record<string, { prefix: string; type: string }> = {
  bos: { prefix: "BOSSM", type: "bos" },
  choch: { prefix: "BOSSM", type: "choch" },
  bos_choch: { prefix: "BOSSM", type: "bos_choch" },
  fvg: { prefix: "FVGSM", type: "fvg" },
  fvg_inversion: { prefix: "IFVGSM", type: "fvg_inversion" },
  order_block: { prefix: "OBSM", type: "ob" },
  ob_fvg: { prefix: "OBFVGSM", type: "ob_fvg" },
  liqsweep: { prefix: "LSSM", type: "liqsweep" },
  snr: { prefix: "SNRSM", type: "snr" },
  gap_snr: { prefix: "GSNRSM", type: "gap_snr" },
  breakout: { prefix: "BRKSM", type: "breakout" },
  rejection: { prefix: "REJSM", type: "rejection" },
  miss: { prefix: "MISSSM", type: "miss" },
  rsi_hd: { prefix: "RSIHDSM", type: "rsi_hd" },
  engulfing: { prefix: "EGSM", type: "engulfing" },
};

function period(tf: string): string {
  return tf === "MN" ? "PERIOD_MN1" : `PERIOD_${tf}`;
}

function brainModule(config: FourBrainConfig, role: "direction" | "setup" | "execution") {
  const brain = config[role];
  const module = brain?.modules?.[0];
  assertOk(module, `${role} module missing`);
  return { module, tf: brain?.timeframe ?? "M5", params: brain?.params ?? {} };
}

function smConfig(module: string, tf: string, params: Record<string, unknown>) {
  const meta = smMeta[module];
  assertOk(meta, `No SM metadata for ${module}`);
  return {
    type: meta.type,
    id: tf,
    TF: period(tf),
    tf,
    params,
  };
}

function setupSnippet(module: string, tf: string): string {
  const prefix = smMeta[module]?.prefix;
  assertOk(prefix, `No setup prefix for ${module}`);
  if (module === "order_block") {
    return `if((gBias == 0 || gBias == 1) && ${prefix}_${tf}_HasActiveBull()) { gSetupActive = true; gSetupDir = 1; gSetupSLHint = ${prefix}_${tf}_LatestBullLL(); }
  else if((gBias == 0 || gBias == -1) && ${prefix}_${tf}_HasActiveBear()) { gSetupActive = true; gSetupDir = -1; gSetupSLHint = ${prefix}_${tf}_LatestBearUL(); }`;
  }
  if (module === "rsi_hd" || module === "ob_fvg") {
    return `if((gBias == 0 || gBias == 1) && ${prefix}_${tf}_HasActiveBull()) { gSetupActive = true; gSetupDir = 1; gSetupSLHint = ${prefix}_${tf}_ActiveBullSL(); }
  else if((gBias == 0 || gBias == -1) && ${prefix}_${tf}_HasActiveBear()) { gSetupActive = true; gSetupDir = -1; gSetupSLHint = ${prefix}_${tf}_ActiveBearSL(); }`;
  }
  if (module === "liqsweep") {
    return `if((gBias == 0 || gBias == 1) && ${prefix}_${tf}_BullJustConfirmed()) { gSetupActive = true; gSetupDir = 1; gSetupSLHint = ${prefix}_${tf}_BullConfirmSL(); }
  else if((gBias == 0 || gBias == -1) && ${prefix}_${tf}_BearJustConfirmed()) { gSetupActive = true; gSetupDir = -1; gSetupSLHint = ${prefix}_${tf}_BearConfirmSL(); }`;
  }
  return `if((gBias == 0 || gBias == 1) && ${prefix}_${tf}_HasActiveBull()) { gSetupActive = true; gSetupDir = 1; gSetupSLHint = ${prefix}_${tf}_BullConfirmSL(); }
  else if((gBias == 0 || gBias == -1) && ${prefix}_${tf}_HasActiveBear()) { gSetupActive = true; gSetupDir = -1; gSetupSLHint = ${prefix}_${tf}_BearConfirmSL(); }`;
}

function executionSnippet(module: string, tf: string): string {
  const prefix = smMeta[module]?.prefix;
  assertOk(prefix, `No execution prefix for ${module}`);
  const bullEvent = module === "fvg_inversion" ? "BullJustInverted" : "BullJustConfirmed";
  const bearEvent = module === "fvg_inversion" ? "BearJustInverted" : "BearJustConfirmed";
  return `if(!gSetupActive) return;
  if((gSetupDir == 0 || gSetupDir == 1) && ${prefix}_${tf}_${bullEvent}()) { gExecSignal = true; gExecDir = 1; gExecSL = ${prefix}_${tf}_BullConfirmSL(); }
  else if((gSetupDir == 0 || gSetupDir == -1) && ${prefix}_${tf}_${bearEvent}()) { gExecSignal = true; gExecDir = -1; gExecSL = ${prefix}_${tf}_BearConfirmSL(); }`;
}

function buildGenericWiring(config: FourBrainConfig): AiBrainWiring {
  const smConfigs: AiBrainWiring["sm_configs"] = {};
  const requiredSms: string[] = [];
  const addSm = (
    module: string | undefined,
    tf: string | undefined,
    params: Record<string, unknown> | undefined,
  ) => {
    if (!module || !tf) return;
    const meta = smMeta[module];
    if (!meta) return;
    const key = `${meta.type}_${tf}`;
    smConfigs[key] = smConfig(module, tf, params ?? {});
    requiredSms.push(`${meta.prefix}_${tf}`);
  };

  const direction = config.direction ? brainModule(config, "direction") : undefined;
  const setup = config.setup ? brainModule(config, "setup") : undefined;
  const execution = brainModule(config, "execution");
  addSm(direction?.module, direction?.tf, direction?.params);
  addSm(setup?.module, setup?.tf, setup?.params);
  addSm(execution.module, execution.tf, execution.params);

  const directionBrain =
    direction && smMeta[direction.module]?.prefix === "BOSSM"
      ? `void Direction_Brain_Execute() {
  if(BOSSM_${direction.tf}_IsBull()) gBias = 1;
  else if(BOSSM_${direction.tf}_IsBear()) gBias = -1;
}`
      : `void Direction_Brain_Execute() { gBias = 0; }`;

  const setupBrain = setup
    ? `void Setup_Brain_Execute() {
  gSetupActive = false; gSetupDir = 0; gSetupSLHint = 0.0;
  ${setupSnippet(setup.module, setup.tf)}
}`
    : `void Setup_Brain_Execute() { gSetupActive = true; gSetupDir = gBias; }`;

  return {
    direction_brain: directionBrain,
    setup_brain: setupBrain,
    execution_brain: `void Execution_Brain_Execute() {
  gExecSignal = false; gExecDir = 0; gExecSL = 0.0;
  ${executionSnippet(execution.module, execution.tf)}
}`,
    required_sms: [...new Set(requiredSms)],
    sm_configs: smConfigs,
  };
}

function normalizePrompt(prompt: string): StrategyBlueprint {
  return normalizeBlueprint({ ...baseBlueprint, summary: prompt }, prompt) as StrategyBlueprint;
}

const cases: StrategyFamilyCase[] = [
  {
    name: "EMA retest then IFVG formation",
    wiring: "ema_ifvg",
    prompt: `
      M5 only. 12 EMA crosses 48 EMA for direction.
      Price must test only the 48 EMA after the cross.
      Only IFVGs that form after the EMA test are valid.
      Enter when the IFVG forms. Take profit 1:3.
    `,
    expected: {
      direction: "ema",
      setup: "ema",
      execution: "fvg_inversion",
      contract: ["ema_retest_target", "ifvg_entry_event", "reward_risk"],
      code: ["gEmaIfvgTestTime_M5", "IFVGSM_M5_BullJustInverted()", "slow EMA (48)"],
    },
  },
  {
    name: "BOS direction, order block setup, engulfing execution",
    prompt: `
      D1 BOS sets direction.
      H4 order block setup expires after 80 bars.
      M5 engulfing entry triggers the trade.
    `,
    expected: {
      direction: "bos",
      setup: "order_block",
      execution: "engulfing",
      code: ["void BOSSM_D1_Tick", "void OBSM_H4_Tick", "void EGSM_M5_Tick"],
    },
  },
  {
    name: "CHoCH direction, liquidity sweep setup, IFVG execution",
    prompt: `
      D1 CHoCH sets direction.
      H4 liquidity sweep setup uses swing length 4 and lookback 30 bars.
      M5 IFVG entry forms after the setup.
    `,
    expected: {
      direction: "choch",
      setup: "liqsweep",
      execution: "fvg_inversion",
      contract: ["ifvg_entry_event"],
      code: ["void BOSSM_D1_Tick", "void LSSM_H4_Tick", "void IFVGSM_M5_Tick"],
    },
  },
  {
    name: "Gap S/R setup with rejection execution",
    prompt: `
      H4 gap support setup with lookback 70 bars.
      M5 wick rejection entry from support with lookback 25 bars.
    `,
    expected: {
      setup: "gap_snr",
      execution: "rejection",
      code: ["void GSNRSM_H4_Tick", "void REJSM_M5_Tick"],
    },
  },
  {
    name: "RSI hidden divergence setup with OB+FVG execution",
    prompt: `
      H4 RSI 21 hidden divergence setup using pivot strength 4 and lookback 80 bars.
      M15 order block with FVG entry expires after 60 bars.
    `,
    expected: {
      setup: "rsi_hd",
      execution: "ob_fvg",
      code: ["void RSIHDSM_H4_Tick", "void OBFVGSM_M15_Tick"],
    },
  },
  {
    name: "Supply demand setup with breakout execution",
    prompt: `
      H1 demand zone setup expires after 90 bars.
      M5 breakout entry triggers the trade.
    `,
    expected: {
      setup: "order_block",
      execution: "breakout",
      code: ["void OBSM_H1_Tick", "void BRKSM_M5_Tick"],
    },
  },
  {
    name: "Missed level setup with rejection execution",
    prompt: `
      H1 missed level setup within 6 pips using swing length 5 and lookback 90 bars.
      M5 wick rejection entry from the level with lookback 25 bars.
    `,
    expected: {
      setup: "miss",
      execution: "rejection",
      code: ["void MISSSM_H1_Tick", "void REJSM_M5_Tick"],
    },
  },
];

console.log("\nStrategy family regression tests\n");
let failed = 0;
for (const test of cases) {
  try {
    const blueprint = normalizePrompt(test.prompt);
    const config = blueprint.fourBrain;
    assertOk(config, "fourBrain missing");
    if (test.expected.direction) {
      assertEq(config.direction?.modules[0], test.expected.direction, "direction module");
    }
    if (test.expected.setup) {
      assertEq(config.setup?.modules[0], test.expected.setup, "setup module");
    }
    assertEq(config.execution.modules[0], test.expected.execution, "execution module");

    const contractCodes = (blueprint.intentContract?.constraints ?? []).map((item) => item.code);
    for (const code of test.expected.contract ?? []) {
      assertOk(contractCodes.includes(code), `contract missing ${code}`);
    }

    const aiWiring =
      test.wiring === "ema_ifvg"
        ? buildEmaTestThenIfvgFormationWiring(test.prompt, config)
        : buildGenericWiring(config);
    const code = generateEA({
      eaName: test.name.replace(/[^\w]+/g, "_"),
      config,
      globalSymbol: "EURUSD",
      globalMagic: 260604,
      aiWiring,
    });
    for (const snippet of test.expected.code) {
      assertIncludes(code, snippet, "generated EA");
    }
    assertOk(!code.includes("// Unknown SM type:"), "unknown SM placeholder emitted");
    console.log(`[OK  ] ${test.name}`);
  } catch (error) {
    failed++;
    console.log(`[FAIL] ${test.name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failed > 0) {
  console.log(`\n${failed} strategy family test(s) failed.`);
  process.exit(1);
}

console.log(`\n${cases.length} strategy family test(s) passed.`);
