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
import { buildBlueprintWiring } from "../src/generators/gen-blueprint-wiring";
import { generateEA } from "../src/generators/gen-ea";
import { smcZoneRejectionEventLabel } from "../src/lib/smc-zone-rejection-display";
import { STRATEGY_EVENT_CONTRACTS } from "../src/lib/strategy-events";
import { pickerModulesForBrain } from "../src/lib/strategy-family";
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

try {
  assertEq(
    STRATEGY_EVENT_CONTRACTS.FVG_CONFIRMED.label,
    "SMC Zone Rejection — FVG",
    "FVG confirmed event label",
  );
  assertEq(
    smcZoneRejectionEventLabel("unicorn"),
    "SMC Zone Rejection — Unicorn",
    "unicorn zone rejection label",
  );
  assertOk(
    !pickerModulesForBrain("smc_ict", "execution").some((m) => m.id === "rejection"),
    "SMC execution picker hides SNR Rejection",
  );
  assertOk(
    pickerModulesForBrain("snr_snd", "execution").some((m) => m.id === "rejection"),
    "SnD execution picker includes SNR Rejection",
  );
  assertOk(
    pickerModulesForBrain("hybrid", "execution", ["unicorn"]).every((m) => m.id !== "rejection"),
    "hybrid hides SNR Rejection when unicorn setup selected",
  );
  console.log("[OK  ] SMC vs SNR naming and picker filters");
} catch (error) {
  console.log("[FAIL] SMC vs SNR naming and picker filters");
  console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

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

    const aiWiring: AiBrainWiring | undefined =
      test.wiring === "ema_ifvg"
        ? buildEmaTestThenIfvgFormationWiring(test.prompt, config)
        : undefined;
    const code = generateEA({
      eaName: test.name.replace(/[^\w]+/g, "_"),
      config,
      globalSymbol: "EURUSD",
      globalMagic: 260604,
      aiWiring,
    });
    if (!aiWiring) {
      assertIncludes(code, "(blueprint SM)", "blueprint generation mode");
    }
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
