/**
 * Phase 1–3 — TIME_SESSION_FILTER (windows, outside-window actions, session audit).
 */
import { generateFlowEA } from "../src/generators/gen-flow-ea";
import { generateEA } from "../src/generators/gen-ea";
import {
  applySetTimeFilter,
  buildSessionBreakdownFromTimes,
  classifyBrokerMinuteToSessions,
  emitTradingScheduleMql5,
  extractTradingScheduleFromText,
  isWithinTradingWindows,
  resolveTradingWindows,
  suggestScheduleFromBreakdown,
  type TradingScheduleConfig,
} from "../src/lib/trading-schedule";
import { extractApplyMarkers } from "../src/lib/assistant-apply";
import { fourBrainToStrategyFlow } from "../src/lib/fourbrain-flow-adapter";
import { DEFAULT_BLUEPRINT } from "../src/types/blueprint";

function assertOk(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

console.log("\nTrading schedule checks (Phase 1–3)\n");

// In-window (London 07:00–16:00), Monday
assertOk(isWithinTradingWindows(8 * 60, 1, [{ startMin: 7 * 60, endMin: 16 * 60 }], [1, 2, 3, 4, 5]), "08:00 Mon inside London");
assertOk(!isWithinTradingWindows(6 * 60, 1, [{ startMin: 7 * 60, endMin: 16 * 60 }], [1, 2, 3, 4, 5]), "06:00 Mon outside London");
assertOk(!isWithinTradingWindows(8 * 60, 0, [{ startMin: 7 * 60, endMin: 16 * 60 }], [1, 2, 3, 4, 5]), "08:00 Sun blocked by weekday");
console.log("[OK  ] in/out window + weekday");

// Midnight wrap 22:00–02:00
assertOk(isWithinTradingWindows(23 * 60, 2, [{ startMin: 22 * 60, endMin: 2 * 60 }], [1, 2, 3, 4, 5]), "23:00 inside wrap");
assertOk(isWithinTradingWindows(1 * 60, 2, [{ startMin: 22 * 60, endMin: 2 * 60 }], [1, 2, 3, 4, 5]), "01:00 inside wrap");
assertOk(!isWithinTradingWindows(12 * 60, 2, [{ startMin: 22 * 60, endMin: 2 * 60 }], [1, 2, 3, 4, 5]), "12:00 outside wrap");
console.log("[OK  ] midnight wrap");

const disabled: TradingScheduleConfig = {
  enabled: false,
  timeReference: "broker_server",
  mode: "all",
};
const empty = emitTradingScheduleMql5(disabled);
assertOk(!empty.helpers.includes("IsTradingTime"), "disabled schedule emits no helpers");
assertOk(empty.panelLine.includes("all day"), "disabled panel says all day");
console.log("[OK  ] disabled = all day");

const london: TradingScheduleConfig = {
  enabled: true,
  timeReference: "broker_server",
  mode: "presets",
  sessions: ["london"],
  allowedDays: [1, 2, 3, 4, 5],
};
assertOk(resolveTradingWindows(london).length === 1, "london preset resolves one window");
const mql = emitTradingScheduleMql5(london);
assertOk(mql.inputs.includes("InpUseSessionFilter"), "emits session filter input");
assertOk(mql.helpers.includes("IsTradingTime"), "emits IsTradingTime");
assertOk(mql.entryGate.includes("BLOCKED: outside session"), "entry gate blocks outside session");
console.log("[OK  ] codegen fragments");

const dstLondon: TradingScheduleConfig = {
  ...london,
  brokerOffsetHours: 2,
  dstMode: "eu_us_approx",
};
assertOk(resolveTradingWindows(dstLondon)[0]!.startMin === 9 * 60, "offset +2 shifts London start to 09:00");
const dstMql = emitTradingScheduleMql5(dstLondon);
assertOk(dstMql.inputs.includes("InpBrokerOffsetHours = 2"), "emits broker offset input");
assertOk(dstMql.inputs.includes("InpDstAdjust = true"), "emits DST adjust on");
assertOk(dstMql.helpers.includes("Session_IsEuDst"), "emits EU DST helper");
assertOk(dstMql.helpers.includes("Session_IsUsDst"), "emits US DST helper");
assertOk(dstMql.helpers.includes("InpWin1SumStartH"), "emits summer window inputs");
assertOk(dstMql.panelLine.includes("DST approx"), "panel mentions DST");
console.log("[OK  ] Phase 3 offset + DST codegen");

const framed: TradingScheduleConfig = {
  ...london,
  sessionWindowOverrides: {
    london: { startMin: 8 * 60, endMin: 17 * 60 },
  },
};
assertOk(resolveTradingWindows(framed)[0]!.startMin === 8 * 60, "session frame override applied");
const framedMql = emitTradingScheduleMql5(framed);
assertOk(framedMql.inputs.includes("InpWin1StartH = 8"), "override emits custom start hour");
assertOk(framedMql.inputs.includes("InpDrawSessionLines = true"), "draws session lines by default");
assertOk(framedMql.helpers.includes("UpdateSessionChartMarks"), "emits session chart mark updater");
assertOk(framedMql.helpers.includes("OBJ_VLINE"), "session marks use vertical lines");
assertOk(framedMql.helpers.includes("EA_SES_START_"), "session start line prefix");
assertOk(framedMql.helpers.includes("EA_SES_END_"), "session end line prefix");
assertOk(framedMql.onTickHook.includes("UpdateSessionChartMarks"), "onTick updates session lines");
console.log("[OK  ] session frame overrides");

const withClose: TradingScheduleConfig = {
  ...london,
  outsideWindow: {
    allowNewEntries: false,
    manageOpenPositions: false,
    closeOpenPositions: true,
    cancelPendingOrders: true,
  },
};
const closeMql = emitTradingScheduleMql5(withClose);
assertOk(closeMql.helpers.includes("SessionOutsideMaintenance"), "session maintenance helper");
assertOk(closeMql.helpers.includes("InpClosePositionsOutside"), "close positions input referenced");
assertOk(closeMql.onTickHook.includes("SessionOutsideMaintenance"), "onTick maintenance wired");
assertOk(closeMql.inputs.includes("InpClosePositionsOutside = true"), "close positions input true");
console.log("[OK  ] close positions at session end");

const flow = fourBrainToStrategyFlow({
  direction: { modules: ["bos"], timeframe: "H1" },
  setup: { modules: ["fvg"], timeframe: "H1" },
  execution: { modules: ["bos"], timeframe: "M5" },
  management: {
    riskPercent: 1,
    rewardRisk: 3,
    maxOpenTrades: 1,
    tradingSchedule: withClose,
  },
});
const code = generateFlowEA(flow, "ScheduleSmoke");
assertOk(code.includes("InpUseSessionFilter"), "flow EA includes session inputs");
assertOk(code.includes("IsTradingTime"), "flow EA includes IsTradingTime");
assertOk(code.includes("BLOCKED: outside session"), "flow EA entry gate wired");
assertOk(code.includes("SessionOutsideMaintenance"), "flow EA session maintenance");
assertOk(code.includes("PositionClose"), "flow EA closes positions outside session");
assertOk(code.includes("EvaluateEntry_"), "flow EA has entry evaluate");
console.log("[OK  ] generateFlowEA wires schedule");

assertOk(classifyBrokerMinuteToSessions(13 * 60).includes("london_ny_overlap"), "13:00 is overlap");
const breakdown = buildSessionBreakdownFromTimes([
  "2024.03.01 08:00",
  "2024.03.01 08:30",
  "2024.03.01 09:00",
  "2024.03.01 14:00",
]);
assertOk(breakdown.london >= 3, "morning buckets as London");
const hint = suggestScheduleFromBreakdown(breakdown, undefined);
assertOk(typeof hint === "string" && hint.includes("London"), "suggests London when clustered");
console.log("[OK  ] session breakdown + hint");

const fromText = extractTradingScheduleFromText("Only trade London and New York sessions");
assertOk(fromText?.enabled === true, "prompt extract enables schedule");
assertOk(fromText?.sessions?.includes("london"), "prompt extract london");
assertOk(fromText?.sessions?.includes("newyork"), "prompt extract newyork");
const custom = extractTradingScheduleFromText("Trade only 07:00-11:00 broker time");
assertOk(custom?.mode === "custom_windows", "prompt extract custom window");
console.log("[OK  ] interview text extract");

const markers = extractApplyMarkers(
  '[APPLY:{"type":"set_time_filter","sessions":["london","new_york"]}]\n',
);
assertOk(markers[0]?.type === "set_time_filter", "parses set_time_filter APPLY");
const bp = {
  ...DEFAULT_BLUEPRINT,
  fourBrain: {
    direction: { modules: ["bos" as const], timeframe: "H1" },
    setup: { modules: ["fvg" as const], timeframe: "H1" },
    execution: { modules: ["bos" as const], timeframe: "M5" },
    management: { riskPercent: 1 },
  },
};
const applied = applySetTimeFilter(bp, { sessions: ["london", "new_york"], mode: "presets" });
assertOk(applied.changed, "applySetTimeFilter changes blueprint");
assertOk(applied.schedule.sessions?.includes("newyork"), "normalizes new_york → newyork");
assertOk(applied.blueprint.fourBrain?.management?.tradingSchedule?.enabled === true, "mgmt schedule set");
console.log("[OK  ] set_time_filter Apply");

// Assembler path must also embed TIME_SESSION_FILTER (Simple 4-Brain / engulfing stacks)
const asmCode = generateEA({
  eaName: "SessionAsm",
  config: {
    direction: { modules: ["engulfing"], timeframe: "H4" },
    setup: { modules: ["engulfing"], timeframe: "H1" },
    execution: { modules: ["engulfing"], timeframe: "M15" },
    management: {
      riskPercent: 1,
      rewardRisk: 2,
      tradingSchedule: {
        enabled: true,
        timeReference: "broker_server",
        mode: "presets",
        sessions: ["newyork"],
        allowedDays: [2, 3, 4],
        outsideWindow: {
          allowNewEntries: false,
          manageOpenPositions: true,
          closeOpenPositions: false,
          cancelPendingOrders: true,
        },
      },
    },
  },
});
assertOk(asmCode.includes("InpUseSessionFilter"), "assembler embeds session filter input");
assertOk(asmCode.includes("IsTradingTime"), "assembler embeds IsTradingTime");
assertOk(asmCode.includes("BLOCKED: outside session"), "assembler session gate");
assertOk(asmCode.includes("SessionOutsideMaintenance"), "assembler cancel-pending maintenance");
assertOk(/InpAllowedDaysMask = 28\b/.test(asmCode), "Tue-Thu day mask = 28 (bits 2+3+4)");
console.log("[OK  ] blueprint assembler wires schedule");

console.log("\nAll trading schedule checks passed.\n");
