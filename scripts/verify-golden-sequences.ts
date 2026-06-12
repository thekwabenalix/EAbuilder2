/**
 * Phase 4 — golden ordered-sequence proofs for CI.
 *
 *   npm run verify:golden
 *
 * Exercises the full pipeline:
 *   4-Brain config → StrategyFlow adapter → router → MQL5
 * and asserts step order, events, dependencies, path, and code markers.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateEaFromBlueprint, type EaGenerationPath } from "../src/lib/generate-ea-router";
import { validateStrategyFlowSchema } from "../src/lib/strategy-flow";
import {
  GOLDEN_SEQUENCE_CASES,
  goldenSequenceBlueprint,
  type GoldenSequenceCase,
} from "../src/lib/golden-sequences";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "verify", "mql5", "golden");

function assertOk(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEq<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertIncludes(haystack: string, needle: string, message: string) {
  if (!haystack.includes(needle)) {
    throw new Error(`${message}: missing "${needle}"`);
  }
}

function proveFlowSteps(
  testCase: GoldenSequenceCase,
  flowSteps: NonNullable<ReturnType<typeof generateEaFromBlueprint>["flow"]>["steps"],
) {
  assertEq(flowSteps.length, testCase.steps.length, `${testCase.id}: step count`);

  for (let i = 0; i < testCase.steps.length; i++) {
    const expected = testCase.steps[i];
    const actual = flowSteps[i];
    const label = `${testCase.id} step ${i}`;

    assertEq(actual.id, expected.id, `${label} id`);
    assertEq(actual.role, expected.role, `${label} role`);
    assertEq(actual.module, expected.module, `${label} module`);
    assertEq(actual.timeframe.toUpperCase(), expected.timeframe.toUpperCase(), `${label} TF`);
    assertEq(actual.event, expected.event, `${label} event`);

    if (expected.dependsOn?.length) {
      const depIds = (actual.dependsOn ?? []).map((d) => d.stepId);
      for (const dep of expected.dependsOn) {
        assertOk(depIds.includes(dep), `${label} depends on ${dep}`);
      }
    }
  }

  // Monotonic chain: each step after the first must depend on an earlier step id.
  const ids = flowSteps.map((s) => s.id);
  for (let i = 1; i < flowSteps.length; i++) {
    const deps = flowSteps[i].dependsOn ?? [];
    if (deps.length === 0) continue;
    const earliestDepIdx = Math.min(
      ...deps.map((d) => ids.indexOf(d.stepId)).filter((idx) => idx >= 0),
    );
    assertOk(
      earliestDepIdx < i,
      `${testCase.id}: step ${flowSteps[i].id} must depend on earlier step`,
    );
  }
}

function proveCodeMarkers(testCase: GoldenSequenceCase, code: string) {
  for (const marker of testCase.codeMarkers) {
    assertIncludes(code, marker, `${testCase.id} code`);
  }
  assertOk(!code.includes("Unknown SM type"), `${testCase.id}: no unknown SM placeholders`);
  assertOk(
    !code.includes("undeclared identifier"),
    `${testCase.id}: no undeclared placeholder text`,
  );
}

function runCase(testCase: GoldenSequenceCase): EaGenerationPath {
  const bp = goldenSequenceBlueprint(testCase);
  const result = generateEaFromBlueprint(bp);

  assertEq(result.path, testCase.expectedPath, `${testCase.id} router path`);
  assertOk(result.flow, `${testCase.id}: flow resolved`);

  const validation = validateStrategyFlowSchema(result.flow);
  assertOk(validation.ok, `${testCase.id}: flow validates — ${validation.errors.join("; ")}`);

  proveFlowSteps(testCase, result.flow!.steps);
  proveCodeMarkers(testCase, result.code);

  if (testCase.emitFile) {
    mkdirSync(OUT, { recursive: true });
    const path = resolve(OUT, testCase.emitFile);
    writeFileSync(path, result.code, "utf8");
    console.log(
      `[emit] ${testCase.emitFile} (${result.code.split("\n").length} lines, ${result.path})`,
    );
  }

  console.log(`[OK  ] ${testCase.id} — ${testCase.name}`);
  return result.path;
}

console.log("\nGolden sequence proofs\n");

let passed = 0;
const paths: Record<EaGenerationPath, number> = {
  flow_engine: 0,
  blueprint_assembler: 0,
  legacy_heuristic: 0,
};

for (const testCase of GOLDEN_SEQUENCE_CASES) {
  const path = runCase(testCase);
  paths[path]++;
  passed++;
}

console.log(`\n${passed} golden sequence proof(s) passed.`);
console.log(
  `Paths: flow=${paths.flow_engine}, assembler=${paths.blueprint_assembler}, legacy=${paths.legacy_heuristic}`,
);
console.log(`Compile anchors: verify/mql5/golden/*.mq5\n`);
