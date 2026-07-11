/**
 * Phase 1 + 5 - assistant hotfix and action-first offline UX smoke tests.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { answerLocalAssistant } from "../src/lib/local-assistant";
import { buildAssistantChatContext } from "../src/lib/assistant-context-budget";
import { buildAssistantRepairPlan } from "../src/lib/assistant-repair-plan";
import {
  canAffordAssistantCredits,
  CREDIT_COSTS,
  creditCostForChat,
  defaultWallet,
  isFreeAssistantAction,
  PLAN_MONTHLY_CREDITS,
  spendAssistantCredits,
} from "../src/lib/assistant-credits";
import {
  clearAssistantChatHistory,
  readAssistantChatHistory,
  writeAssistantChatHistory,
} from "../src/lib/assistant-chat-history";
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
const applyIdx = noTrades.indexOf("## Repair plan");
const overviewIdx = noTrades.indexOf("Strategy overview");
assertOk(verdictIdx >= 0, "no-trades leads with verdict");
assertOk(applyIdx > verdictIdx, "Repair plan follows verdict");
assertOk(overviewIdx < 0, "compact no-trades skips strategy overview");
assertOk(noTrades.includes("[APPLY:"), "no-trades includes apply marker");
assertOk(noTrades.includes("## Repair plan"), "no-trades includes deterministic repair plan");
console.log("[OK  ] action-first no-trades diagnosis");

const repairCtx = buildAssistantChatContext({
  blueprint: flowBlueprint,
  prompt: "why no trades?",
  code: "// smoke",
  compileLog: null,
  testerLog:
    "[EVENT] Direction BOS | dir=1\n===== TRADE AUDIT =====\nFlow events logged: 1 · Trades opened: 0",
  backtestSummary: { totalTrades: 0 },
  diagnosticContext: null,
});
assertOk(repairCtx.includes("DETERMINISTIC REPAIR PLAN"), "chat context includes repair plan");
assertOk(repairCtx.includes("RULE AUDIT"), "chat context includes rule audit");
console.log("[OK  ] chat context includes repair plan");
console.log("[OK  ] chat context includes rule audit");

assertOk(noTrades.includes("## Rule audit"), "no-trades includes rule audit section");
console.log("[OK  ] offline reply includes rule audit");

const blockedPlan = buildAssistantRepairPlan({
  blueprint: flowBlueprint,
  code: "// smoke",
  testerLog:
    "[EVENT] Direction BOS | dir=1\n[GATE] BLOCKED: setup not fired\n===== TRADE AUDIT =====\nTrades opened: 0",
  backtestSummary: { totalTrades: 0 },
});
assertOk(blockedPlan.layer === "strategy_flow" || blockedPlan.layer === "risk_filter", "blocked entries classify to a repair layer");
assertOk(Boolean(blockedPlan.title), "repair plan has a title");
console.log("[OK  ] repair planner classifies blocked entries");

const withOverview = answerLocalAssistant({
  userMessage: "show strategy overview",
  blueprint: flowBlueprint,
  code: "// smoke",
  compact: false,
});
assertOk(withOverview.includes("Strategy overview"), "detail request shows overview");
console.log("[OK  ] strategy overview on request");

const alignAsk = answerLocalAssistant({
  userMessage:
    "The strategy seems to be working except that it does not waiting M5 cross to align with H1 cross. to execute m5 cross should also be in direction of the h1 cross",
  blueprint: {
    ...flowBlueprint,
    strategyFlow: {
      version: 1 as const,
      mode: "advanced_instances" as const,
      source: "user" as const,
      steps: [
        {
          id: "dir_h1",
          name: "Direction EMA H1",
          role: "direction" as const,
          module: "ema",
          timeframe: "H1",
          event: "EMA_BIAS",
          enabled: true,
        },
        {
          id: "setup_m5",
          name: "Setup EMA M5",
          role: "setup" as const,
          module: "ema",
          timeframe: "M5",
          event: "EMA_CROSS",
          dependsOn: [{ stepId: "dir_h1", relation: "after" as const }],
          directionSource: { mode: "from_step" as const, stepId: "dir_h1" },
          enabled: true,
        },
        {
          id: "entry_m5",
          name: "Entry EMA M5",
          role: "entry" as const,
          module: "ema",
          timeframe: "M5",
          event: "EMA_CLOSE_CONFIRMED",
          dependsOn: [{ stepId: "setup_m5", relation: "same_or_after" as const }],
          directionSource: { mode: "from_step" as const, stepId: "dir_h1" },
          enabled: true,
        },
      ],
    },
  },
  code: "// smoke",
});
assertOk(alignAsk.includes("Intended rule"), "alignment ask explains H1→M5 rule");
assertOk(!alignAsk.includes("Tester log is missing"), "alignment ask does not dump missing-log repair");
assertOk(alignAsk.includes("fix_htf_ltf_ema_alignment"), "alignment ask offers HTF→LTF fix apply");
console.log("[OK  ] offline assistant answers H1/M5 alignment asks");

// Phase 4 — credit policy
assertOk(isFreeAssistantAction("free_diagnosis"), "free_diagnosis is free");
assertOk(isFreeAssistantAction("free_apply"), "free_apply is free");
assertOk(!isFreeAssistantAction("cloud_chat"), "cloud_chat is paid");
assertOk(creditCostForChat(false) === CREDIT_COSTS.cloud_chat, "chat cost without images");
assertOk(creditCostForChat(true) === CREDIT_COSTS.cloud_chat_with_images, "chat cost with images");

const wallet = defaultWallet("starter");
assertOk(wallet.balance === PLAN_MONTHLY_CREDITS.starter, "starter allowance");
assertOk(canAffordAssistantCredits(1, wallet), "starter can afford 1 credit");

const spent = spendAssistantCredits("cloud_chat", wallet);
assertOk(spent.ok && spent.cost === 1 && spent.balance === wallet.balance - 1, "cloud spend deducts");

const broke = { ...wallet, balance: 0 };
const denied = spendAssistantCredits("cloud_chat", broke);
assertOk(!denied.ok && Boolean(denied.reason), "zero balance denies cloud chat");

const freeSpend = spendAssistantCredits("free_diagnosis", broke);
assertOk(freeSpend.ok && freeSpend.cost === 0 && freeSpend.balance === 0, "free diagnosis at zero balance");
console.log("[OK  ] assistant credit policy");

// Conversation persistence (localStorage)
{
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, String(v));
    },
    removeItem: (k) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;

  writeAssistantChatHistory("strat-1", [
    { role: "user", content: "why no trades?" },
    { role: "assistant", content: "Gate blocked." },
    { role: "assistant", content: "" },
  ]);
  const loaded = readAssistantChatHistory("strat-1");
  assertOk(loaded.length === 2, "persists non-empty messages only");
  assertOk(loaded[0]?.content === "why no trades?", "restores user turn");
  clearAssistantChatHistory("strat-1");
  assertOk(readAssistantChatHistory("strat-1").length === 0, "clear removes thread");
  console.log("[OK  ] assistant chat history persistence");
}

console.log("\n12 assistant checks passed.\n");

