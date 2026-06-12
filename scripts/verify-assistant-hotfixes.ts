/**
 * Phase 1 + 5 — assistant hotfix and action-first offline UX smoke tests.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { answerLocalAssistant } from "../src/lib/local-assistant";
import { DEFAULT_BLUEPRINT } from "../src/types/blueprint";

function assertOk(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

console.log("\nAssistant hotfix checks (Phase 1 + 5)\n");

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
assertOk(offline.includes("## Verdict"), "cloud-offline leads with verdict");
assertOk(
  !offline.includes("Strategy overview"),
  "cloud-offline skips strategy dump in compact mode",
);
console.log("[OK  ] offline assistant cloud-offline section");

const flowBlueprint = {
  ...DEFAULT_BLUEPRINT,
  name: "Flow Smoke",
  strategyFlow: {
    version: 1 as const,
    mode: "advanced_instances" as const,
    source: "user" as const,
    steps: [
      {
        id: "d",
        name: "Direction BOS",
        role: "direction" as const,
        module: "bos",
        timeframe: "H1",
        event: "BOS_BIAS",
        enabled: true,
      },
      {
        id: "e",
        name: "Entry BOS",
        role: "entry" as const,
        module: "bos",
        timeframe: "M5",
        event: "BOS_CONFIRMED",
        dependsOn: [{ stepId: "d", relation: "after" as const }],
        enabled: true,
      },
    ],
  },
};

const noTrades = answerLocalAssistant({
  userMessage: "why no trades?",
  blueprint: flowBlueprint,
  code: "// smoke",
  testerLog:
    "[EVENT] Direction BOS | dir=1\n[EVENT] Direction BOS | dir=1\n===== TRADE AUDIT =====\nFlow events logged: 2 · Trades opened: 0",
  backtestSummary: { totalTrades: 0 },
});
const verdictIdx = noTrades.indexOf("## Verdict");
const applyIdx = noTrades.indexOf("## Apply now");
const overviewIdx = noTrades.indexOf("Strategy overview");
assertOk(verdictIdx >= 0, "no-trades leads with verdict");
assertOk(applyIdx > verdictIdx, "Apply now follows verdict");
assertOk(overviewIdx < 0, "compact no-trades skips strategy overview");
assertOk(noTrades.includes("[APPLY:"), "no-trades includes apply marker");
console.log("[OK  ] action-first no-trades diagnosis");

const withOverview = answerLocalAssistant({
  userMessage: "show strategy overview",
  blueprint: flowBlueprint,
  code: "// smoke",
  compact: false,
});
assertOk(withOverview.includes("Strategy overview"), "detail request shows overview");
console.log("[OK  ] strategy overview on request");

console.log("\n5 assistant checks passed.\n");
