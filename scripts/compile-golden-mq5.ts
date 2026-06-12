/**
 * Phase 5 — optional MetaEditor compile smoke for golden EA fixtures.
 *
 *   npm run compile:golden
 *
 * Requires Windows + MetaEditor. Skips cleanly when MT5 is not installed unless
 * MQL5_COMPILE_REQUIRED=1 (for self-hosted CI with MT5).
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const GOLDEN_SRC = join(REPO, "verify", "mql5", "golden");
const COMPILE_ROOT = join(REPO, "verify", "mql5", "compile-out");

function required(): boolean {
  return process.env.MQL5_COMPILE_REQUIRED === "1";
}

function discoverMetaEditor(): string | null {
  const explicit = process.env.METAEDITOR_PATH?.trim();
  if (explicit && existsSync(explicit)) return explicit;

  const terminal = process.env.MT5_TERMINAL_PATH?.trim();
  if (terminal) {
    const sibling = join(dirname(terminal), "metaeditor64.exe");
    if (existsSync(sibling)) return sibling;
  }

  if (process.platform !== "win32") return null;

  const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
  const candidates = [
    join(programFiles, "MetaTrader 5", "metaeditor64.exe"),
    join(programFiles, "Fusion Markets MetaTrader 5", "metaeditor64.exe"),
    join(programFiles, "IC Markets MetaTrader 5", "metaeditor64.exe"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function discoverIncludeRoot(): string | null {
  const dataPath = process.env.MT5_DATA_PATH?.trim();
  if (dataPath) {
    const include = join(dataPath, "MQL5");
    if (existsSync(include)) return include;
  }
  return null;
}

function normalizeCompileLog(raw: string): string {
  if (raw.includes("\0")) return raw.replace(/\0/g, "");
  return raw;
}

function countCompileIssues(log: string): { errors: number; warnings: number } {
  const text = normalizeCompileLog(log);
  const summary = text.match(/(?:result:)?\s*(\d+)\s+errors?,\s*(\d+)\s+warnings?/i);
  if (summary) {
    return { errors: Number(summary[1]), warnings: Number(summary[2]) };
  }
  return { errors: 0, warnings: 0 };
}

function listGoldenMq5(): string[] {
  if (!existsSync(GOLDEN_SRC)) return [];
  return readdirSync(GOLDEN_SRC)
    .filter((f) => f.toLowerCase().endsWith(".mq5"))
    .map((f) => join(GOLDEN_SRC, f));
}

console.log("\nGolden MQL5 MetaEditor compile smoke (Phase 5)\n");

if (process.platform !== "win32") {
  const msg = "MetaEditor compile is Windows-only — skipped on this OS.";
  console.log(`[SKIP] ${msg}`);
  if (required()) {
    console.error(msg);
    process.exit(1);
  }
  process.exit(0);
}

const metaEditor = discoverMetaEditor();
if (!metaEditor) {
  const msg =
    "MetaEditor not found. Set METAEDITOR_PATH or MT5_TERMINAL_PATH, or install MetaTrader 5.";
  console.log(`[SKIP] ${msg}`);
  if (required()) {
    console.error(msg);
    process.exit(1);
  }
  process.exit(0);
}

const sources = listGoldenMq5();
if (sources.length === 0) {
  console.error("No golden .mq5 files — run npm run verify:golden first.");
  process.exit(1);
}

mkdirSync(COMPILE_ROOT, { recursive: true });
const includeArg = discoverIncludeRoot();
let failed = 0;

for (const src of sources) {
  const name = src.split(/[\\/]/).pop()!;
  const dest = join(COMPILE_ROOT, name);
  const logPath = dest.replace(/\.mq5$/i, ".log");
  const ex5Path = dest.replace(/\.mq5$/i, ".ex5");

  writeFileSync(dest, readFileSync(src, "utf8"), "utf8");
  if (existsSync(logPath)) unlinkSync(logPath);
  if (existsSync(ex5Path)) unlinkSync(ex5Path);

  const args = [`/compile:${dest}`, "/log"];
  if (includeArg) args.push(`/include:${includeArg}`);

  const proc = spawnSync(metaEditor, args, {
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
  });

  const log = normalizeCompileLog(
    existsSync(logPath) ? readFileSync(logPath, "utf8") : `${proc.stdout}\n${proc.stderr}`,
  );
  const issues = countCompileIssues(log);
  const ex5Ready = existsSync(ex5Path);

  if (proc.error) {
    console.log(`[FAIL] ${name} — ${proc.error.message}`);
    failed++;
    continue;
  }

  if (issues.errors > 0 || !ex5Ready) {
    console.log(`[FAIL] ${name} — ${issues.errors} error(s), ex5=${ex5Ready ? "yes" : "no"}`);
    console.log(log.split("\n").slice(-12).join("\n"));
    failed++;
    continue;
  }

  console.log(`[OK  ] ${name} — compiled (${issues.warnings} warning(s))`);
}

if (failed > 0) {
  console.error(`\n${failed} golden compile failure(s).\n`);
  process.exit(1);
}

console.log(`\n${sources.length} golden EA(s) compiled clean via MetaEditor.\n`);
