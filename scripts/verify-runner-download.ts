import { existsSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const publicRunner = path.join(root, "public", "downloads", "mt5-local-runner.exe");
const sourceRunner = path.join(root, "local-runner", "dist", "mt5-local-runner.exe");
const minRunnerBytes = 10 * 1024 * 1024;

function assertRunnerAsset(label: string, filePath: string) {
  if (!existsSync(filePath)) {
    throw new Error(`${label} missing: ${filePath}`);
  }
  const size = statSync(filePath).size;
  if (size < minRunnerBytes) {
    throw new Error(`${label} looks too small (${size} bytes): ${filePath}`);
  }
  return size;
}

console.log("\nRunner download verifier\n");
const publicSize = assertRunnerAsset("public runner download", publicRunner);

if (existsSync(sourceRunner)) {
  const sourceSize = assertRunnerAsset("source runner", sourceRunner);
  if (sourceSize !== publicSize) {
    throw new Error(
      `public runner does not match source runner size: ${publicSize} bytes vs ${sourceSize} bytes`,
    );
  }
  console.log(`[OK  ] source and public runner sizes match (${publicSize} bytes)`);
} else {
  console.log("[OK  ] source runner absent (dist/ is gitignored) — public asset verified only");
}

console.log(`[OK  ] public download asset present (${publicSize} bytes)`);
console.log(`[OK  ] app URL: /downloads/mt5-local-runner.exe`);
