/**
 * Phase 1 — assistant hotfix smoke tests (ea-chat load safety + offline assistant).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { answerLocalAssistant } from "../src/lib/local-assistant";
import { DEFAULT_BLUEPRINT } from "../src/types/blueprint";

function assertOk(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

console.log("\nAssistant hotfix checks (Phase 1)\n");

const eaChatPath = resolve("netlify/functions/ea-chat.mts");
const eaChatSrc = readFileSync(eaChatPath, "utf8");

assertOk(
  !/Bullet lists \(`/.test(eaChatSrc),
  "ea-chat SYSTEM prompt must not contain nested backticks (causes ReferenceError at load)",
);
console.log("[OK  ] ea-chat SYSTEM prompt has no nested backticks");

const offline = answerLocalAssistant({
  userMessage: "why is cloud offline?",
  blueprint: { ...DEFAULT_BLUEPRINT, name: "Smoke Test" },
  code: "// smoke",
  testerLog: "[EVENT] Direction BOS H1 | dir=1\n",
});
assertOk(offline.includes("Why is cloud AI offline?"), "offline assistant answers cloud-offline intent");
assertOk(!offline.includes("ReferenceError"), "offline assistant reply is clean");
console.log("[OK  ] offline assistant cloud-offline section");

const noTrades = answerLocalAssistant({
  userMessage: "why no trades?",
  blueprint: {
    ...DEFAULT_BLUEPRINT,
    name: "Flow Smoke",
    strategyFlow: {
      version: 1,
      mode: "advanced_instances",
      source: "user",
      steps: [
        {
          id: "d",
          name: "Direction BOS",
          role: "direction",
          module: "bos",
          timeframe: "H1",
          event: "BOS_BIAS",
          enabled: true,
        },
        {
          id: "e",
          name: "Entry BOS",
          role: "entry",
          module: "bos",
          timeframe: "M5",
          event: "BOS_CONFIRMED",
          dependsOn: [{ stepId: "d", relation: "after" }],
          enabled: true,
        },
      ],
    },
  },
  testerLog: "[EVENT] Direction BOS | dir=1\nFlow events logged: 1 · Trades opened: 0",
  backtestSummary: { totalTrades: 0 },
});
assertOk(noTrades.includes("Why no trades?") || noTrades.includes("Verdict"), "offline no-trades diagnosis");
console.log("[OK  ] offline assistant no-trades diagnosis");

console.log("\n3 assistant hotfix check(s) passed.\n");
