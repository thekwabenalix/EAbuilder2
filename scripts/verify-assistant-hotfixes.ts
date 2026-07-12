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
import {
  applyFixFlowWiring,
  applyFixSilentZoneSetup,
  applyFixSilentEntry,
  applyFixRiskGates,
  applyFixLabel,
  extractApplyMarkers,
} from "../src/lib/assistant-apply";
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

// Flow wiring Apply (any modules)
{
  const markers = extractApplyMarkers(
    'Use this:\n[APPLY:{"type":"fix_flow_wiring"}]\n[TOOL:{"action":"open_backtest"}]',
  );
  assertOk(
    markers.some((m) => m.type === "fix_flow_wiring"),
    "extracts fix_flow_wiring apply",
  );
  assertOk(
    applyFixLabel({ type: "fix_flow_wiring" }).includes("Flow wiring"),
    "labels flow wiring apply",
  );

  const bp = {
    ...DEFAULT_BLUEPRINT,
    name: "Wiring Fix Smoke",
    fourBrain: {
      direction: { modules: ["bos" as const], timeframe: "H1", params: {} },
      setup: { modules: ["fvg" as const], timeframe: "M15", params: {} },
      execution: { modules: ["fvg" as const], timeframe: "M15", params: {} },
      management: { riskPercent: 1, rewardRisk: 2 },
    },
    strategyFlow: {
      version: 1 as const,
      mode: "advanced_instances" as const,
      source: "user" as const,
      steps: [
        {
          id: "d",
          name: "Dir BOS H1",
          role: "direction" as const,
          module: "bos",
          timeframe: "H1",
          event: "BOS_BIAS",
          enabled: true,
        },
        {
          id: "s",
          name: "Setup FVG M15",
          role: "setup" as const,
          module: "fvg",
          timeframe: "M15",
          event: "FVG_FORMED",
          enabled: true,
        },
        {
          id: "e",
          name: "Entry FVG M15",
          role: "entry" as const,
          module: "fvg",
          timeframe: "M15",
          event: "FVG_RETESTED",
          dependsOn: [{ stepId: "s", relation: "same_or_after" as const }],
          enabled: true,
        },
      ],
    },
  };

  const fixed = applyFixFlowWiring(bp);
  assertOk(fixed.changed, "flow wiring changes incomplete FVG blueprint");
  assertOk(
    fixed.notes.some((n) => /direction source|after|expiry/i.test(n)),
    "flow wiring notes describe changes",
  );
  const entry = fixed.blueprint.strategyFlow?.steps?.find((s) => s.id === "e");
  assertOk(
    entry?.dependsOn?.some((d) => d.stepId === "s" && d.relation === "after"),
    "entry depends on setup with after",
  );
  console.log("[OK  ] assistant flow wiring apply");
}

{
  const bp = {
    ...flowBlueprint,
    strategyFlow: {
      version: 1 as const,
      mode: "advanced_instances" as const,
      source: "user" as const,
      steps: [
        {
          id: "s1",
          name: "Setup Order Block H1",
          role: "setup" as const,
          module: "order_block",
          timeframe: "H1",
          event: "OB_RETESTED",
          params: { dispMult: 1.5, expiryBars: 20 },
          enabled: true,
        },
        {
          id: "c1",
          name: "Confirmation Order Block H1",
          role: "confirmation" as const,
          module: "order_block",
          timeframe: "H1",
          event: "OB_RETESTED",
          dependsOn: [{ stepId: "s1", relation: "after" as const }],
          enabled: true,
        },
        {
          id: "e1",
          name: "Entry BOS M5",
          role: "entry" as const,
          module: "bos",
          timeframe: "M5",
          event: "BOS_CONFIRMED",
          dependsOn: [{ stepId: "c1", relation: "after" as const }],
          enabled: true,
        },
      ],
    },
  };

  const testerLog = Array.from({ length: 20 }, () =>
    "[EVENT] Entry BOS M5 | dir=1 | 2024.01.01 10:00 | sl=1.1",
  ).join("\n");

  const plan = buildAssistantRepairPlan({
    blueprint: bp,
    code: "// smoke",
    testerLog,
    backtestSummary: { totalTrades: 0 },
  });
  assertOk(plan.apply?.type === "fix_silent_zone_setup", "silent OB setup offers silent-zone apply");
  assertOk(plan.apply?.type !== "regen_ea", "silent OB setup never primary-applies regen_ea");
  assertOk(!/regen/i.test(plan.title), "silent OB setup does not title as regenerate");

  const patched = applyFixSilentZoneSetup(bp);
  assertOk(patched.changed, "silent zone patch changes blueprint");
  const setup = patched.blueprint.strategyFlow?.steps?.find((s) => s.id === "s1");
  const conf = patched.blueprint.strategyFlow?.steps?.find((s) => s.id === "c1");
  const entry = patched.blueprint.strategyFlow?.steps?.find((s) => s.id === "e1");
  assertOk(setup?.event === "OB_CREATED", "setup remapped to OB_CREATED");
  assertOk(conf?.enabled === false, "duplicate OB confirmation disabled");
  assertOk(
    entry?.dependsOn?.some((d) => d.stepId === "s1"),
    "entry rewired to setup",
  );

  const offline = answerLocalAssistant({
    userMessage: "Why no trades?",
    blueprint: bp,
    code: "// smoke",
    testerLog,
    backtestSummary: { totalTrades: 0 },
  });
  assertOk(offline.includes("fix_silent_zone_setup"), "offline diagnosis offers silent-zone apply");
  assertOk(/Setup never armed|orphaned/i.test(offline), "offline explains orphaned entry");
  console.log("[OK  ] silent zone setup repair");
}

{
  const sessionPlan = buildAssistantRepairPlan({
    blueprint: flowBlueprint,
    code: "// smoke",
    testerLog:
      "[EVENT] Direction BOS | dir=1 | 2024.01.01 10:00\n[GATE] BLOCKED: outside session\n[GATE] BLOCKED: outside session",
    backtestSummary: { totalTrades: 0 },
  });
  assertOk(sessionPlan.apply?.type === "set_time_filter", "session gate offers set_time_filter");
  assertOk(
    sessionPlan.apply?.type === "set_time_filter" && sessionPlan.apply.enabled === false,
    "session gate disables schedule",
  );
  console.log("[OK  ] session gate repair");
}

{
  const riskPlan = buildAssistantRepairPlan({
    blueprint: {
      ...DEFAULT_BLUEPRINT,
      ...flowBlueprint,
      execution: { ...DEFAULT_BLUEPRINT.execution, spreadFilterPoints: 20 },
      risk: { ...DEFAULT_BLUEPRINT.risk, maxOpenTrades: 1, stopBufferPoints: 20 },
    },
    code: "// smoke",
    testerLog:
      "[EVENT] Entry BOS | dir=1 | 2024.01.01 10:00\n[GATE] BLOCKED: spread too high\n[GATE] BLOCKED: spread too high",
    backtestSummary: { totalTrades: 0 },
  });
  assertOk(riskPlan.apply?.type === "fix_risk_gates", "spread gate offers fix_risk_gates");
  assertOk(riskPlan.apply?.type !== "regen_ea", "risk gate never primary-applies regen_ea");

  const riskPatched = applyFixRiskGates({
    ...DEFAULT_BLUEPRINT,
    execution: { ...DEFAULT_BLUEPRINT.execution, spreadFilterPoints: 20 },
    risk: { ...DEFAULT_BLUEPRINT.risk, maxOpenTrades: 1, stopBufferPoints: 20 },
  });
  assertOk(riskPatched.changed, "risk gates patch changes blueprint");
  assertOk(
    (riskPatched.blueprint.execution.spreadFilterPoints ?? 0) >= 40,
    "spread filter loosened",
  );
  console.log("[OK  ] risk gate repair");
}

{
  const silentEntryBp = {
    ...flowBlueprint,
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
          id: "s",
          name: "Setup FVG",
          role: "setup" as const,
          module: "fvg",
          timeframe: "M15",
          event: "FVG_CREATED",
          enabled: true,
        },
        {
          id: "e",
          name: "Entry EMA",
          role: "entry" as const,
          module: "ema",
          timeframe: "M5",
          event: "EMA_CLOSE_CONFIRMED",
          params: { lookback: 20 },
          dependsOn: [{ stepId: "s", relation: "after" as const }],
          enabled: true,
        },
      ],
    },
  };
  const silentEntryPlan = buildAssistantRepairPlan({
    blueprint: silentEntryBp,
    code: "// smoke",
    testerLog:
      "[EVENT] Direction BOS | dir=1 | 2024.01.01 10:00\n[EVENT] Setup FVG | dir=1 | 2024.01.01 10:05",
    backtestSummary: { totalTrades: 0 },
  });
  assertOk(
    silentEntryPlan.apply?.type === "fix_silent_entry",
    "silent entry offers fix_silent_entry",
  );
  const entryPatched = applyFixSilentEntry(silentEntryBp);
  assertOk(entryPatched.changed, "silent entry patch changes blueprint");
  const entryStep = entryPatched.blueprint.strategyFlow?.steps?.find((s) => s.id === "e");
  assertOk(entryStep?.event === "EMA_CROSS", "entry event relaxed to EMA_CROSS");
  console.log("[OK  ] silent entry repair");
}

assertOk(
  applyFixLabel({ type: "fix_risk_gates" }).toLowerCase().includes("risk"),
  "fix_risk_gates label",
);
assertOk(
  extractApplyMarkers('[APPLY:{"type":"fix_silent_entry"}]\n').some(
    (f) => f.type === "fix_silent_entry",
  ),
  "extracts fix_silent_entry",
);

console.log("\n17 assistant checks passed.\n");

