/**
 * Phase 5 — strict static syntax gate for golden + emitted MQL5 fixtures.
 *
 *   npm run verify:mql5-syntax
 *
 * Run after verify:golden and verify:mql5 in CI. Fails on any lint issue.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBlessedAdapterWiring } from "../src/lib/blessed-ema-adapters";
import { generateEaFromAiWiring } from "../src/lib/generate-ea-from-ai-wiring";
import { formatLintFailures, lintExpertAdvisor, lintMql5 } from "../src/lib/mql5-static-lint";
import { generateEaFromBlueprint } from "../src/lib/generate-ea-router";
import { GOLDEN_SEQUENCE_CASES, goldenSequenceBlueprint } from "../src/lib/golden-sequences";
import { DEFAULT_BLUEPRINT } from "../src/types/blueprint";
import type { StrategyBlueprint } from "../src/types/blueprint";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MQL5_ROOT = resolve(__dirname, "..", "verify", "mql5");
const GOLDEN_DIR = join(MQL5_ROOT, "golden");
const BLESSED_DIR = join(MQL5_ROOT, "blessed");

function assertOk(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function collectMq5Files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collectMq5Files(full));
    else if (entry.toLowerCase().endsWith(".mq5")) out.push(full);
  }
  return out;
}

function ensureGoldenFixtures(): void {
  mkdirSync(GOLDEN_DIR, { recursive: true });
  for (const testCase of GOLDEN_SEQUENCE_CASES) {
    if (!testCase.emitFile) continue;
    const outPath = join(GOLDEN_DIR, testCase.emitFile);
    if (existsSync(outPath)) continue;
    const bp = goldenSequenceBlueprint(testCase);
    const result = generateEaFromBlueprint(bp);
    writeFileSync(outPath, result.code, "utf8");
    console.log(`[emit] ${testCase.emitFile} (${result.path})`);
  }
}

function ensureBlessedFlowFixtures(): void {
  mkdirSync(BLESSED_DIR, { recursive: true });

  const emaIfvgPrompt = `On M5, wait for 12 EMA to cross above 48 EMA. After the cross, price must test the 48 EMA only.
Only after that EMA test, watch for an iFVG to form. Enter when the iFVG inverts (formation), not on retest.`;

  const emaCtcPrompt =
    "M5 EMA cross test close: 12/48 EMA cross, slow EMA retest, then close back beyond fast EMA for entry.";

  const cases: Array<{
    file: string;
    bp: StrategyBlueprint;
    wiring: ReturnType<typeof buildBlessedAdapterWiring>;
  }> = [
    {
      file: "BLESSED_EMA_IFVG_FLOW.mq5",
      bp: {
        ...DEFAULT_BLUEPRINT,
        name: "Blessed EMA IFVG Flow",
        fourBrain: {
          direction: {
            modules: ["ema"],
            timeframe: "M5",
            params: { fastPeriod: 12, slowPeriod: 48 },
          },
          setup: { modules: ["fvg_inversion"], timeframe: "M5", params: { expiryBars: 100 } },
          execution: { modules: ["fvg_inversion"], timeframe: "M5", params: {} },
          management: { riskPercent: 1, rewardRisk: 2, maxOpenTrades: 1 },
        },
      },
      wiring: buildBlessedAdapterWiring("ema_ifvg", emaIfvgPrompt),
    },
    {
      file: "BLESSED_EMA_CTC_FLOW.mq5",
      bp: {
        ...DEFAULT_BLUEPRINT,
        name: "Blessed EMA CTC Flow",
        fourBrain: {
          direction: {
            modules: ["ema"],
            timeframe: "M5",
            params: { fastPeriod: 12, slowPeriod: 48 },
          },
          setup: { modules: ["ema"], timeframe: "M5", params: {} },
          execution: { modules: ["ema"], timeframe: "M5", params: {} },
          management: { riskPercent: 1, rewardRisk: 2, maxOpenTrades: 1 },
        },
      },
      wiring: buildBlessedAdapterWiring("ema_ctc", emaCtcPrompt),
    },
  ];

  for (const testCase of cases) {
    const outPath = join(BLESSED_DIR, testCase.file);
    const result = generateEaFromAiWiring(testCase.bp, testCase.wiring);
    assertOk(result.path === "flow_engine", `${testCase.file} must use flow_engine`);
    writeFileSync(outPath, result.code, "utf8");
    console.log(`[emit] blessed/${testCase.file} (${result.aiMode})`);
  }
}

console.log("\nMQL5 syntax gate (Phase 5)\n");

ensureGoldenFixtures();
ensureBlessedFlowFixtures();

const files = collectMq5Files(MQL5_ROOT);
assertOk(files.length > 0, `No .mq5 fixtures under ${MQL5_ROOT} — run npm run verify:mql5 first`);

const results = files.map((filePath) => {
  const rel = filePath.slice(MQL5_ROOT.length + 1).replace(/\\/g, "/");
  const code = readFileSync(filePath, "utf8");
  const isHarness =
    rel.includes("_TEST_") || rel.includes("Detector") || rel.includes("State_Module");
  const isExpert =
    !isHarness &&
    (rel.startsWith("golden/") ||
      rel.startsWith("blessed/") ||
      rel.endsWith("_Test.mq5") ||
      /FLOW|GOLDEN|BLESSED|EA|Strategy/i.test(rel));

  const result = isExpert
    ? lintExpertAdvisor(code, { label: rel })
    : lintMql5(code, { label: rel });

  const tag = result.ok ? "OK  " : "FAIL";
  console.log(`[${tag}] ${rel} (${code.split("\n").length} lines)`);
  for (const w of result.warnings) console.log(`        • ${w}`);
  return result;
});

const goldenCount = collectMq5Files(GOLDEN_DIR).length;
assertOk(goldenCount >= 1, "golden compile anchors missing — expected verify/mql5/golden/*.mq5");

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.error(`\n${failed.length} MQL5 syntax failure(s):\n`);
  console.error(formatLintFailures(failed));
  process.exit(1);
}

console.log(
  `\n${results.length} MQL5 fixture(s) passed static syntax gate (${goldenCount} golden).\n`,
);
