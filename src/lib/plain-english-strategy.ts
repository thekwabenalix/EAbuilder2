import type { StrategyBlueprint } from "@/types/blueprint";
import { getModuleAdmission } from "@/lib/module-admission";
import { ALL_BRAIN_MODULES } from "@/lib/brain-modules";
import { resolveStrategyFlow } from "@/lib/blueprint-generation-gate";
import {
  SESSION_PRESET_LABELS,
  minutesToHHMM,
  resolveTradingWindows,
  type TradingScheduleConfig,
  type TradingSessionPreset,
} from "@/lib/trading-schedule";

function moduleName(id: string): string {
  return (
    getModuleAdmission(id)?.label ??
    ALL_BRAIN_MODULES.find((m) => m.id === id)?.label ??
    id.replace(/_/g, " ")
  );
}

function joinModules(ids: string[] | undefined): string {
  if (!ids?.length) return "nothing special";
  return ids.map(moduleName).join(" + ");
}

function describeSchedule(schedule: TradingScheduleConfig): string {
  if (schedule.mode === "presets" && schedule.sessions?.length) {
    const names = schedule.sessions
      .map((s) => SESSION_PRESET_LABELS[s as TradingSessionPreset] ?? s)
      .join(" + ");
    return `during the ${names} session(s) (broker time)`;
  }
  const windows = resolveTradingWindows(schedule);
  if (windows.length) {
    return `between ${windows
      .map((w) => `${minutesToHHMM(w.startMin)}–${minutesToHHMM(w.endMin)}`)
      .join(", ")} (broker time)`;
  }
  return "during your chosen hours";
}

export interface PlainEnglishConfirm {
  headline: string;
  steps: string[];
  riskLine: string;
  scheduleLine: string | null;
}

/** Beginner-facing “what your robot will do” before Build. */
export function buildPlainEnglishConfirm(blueprint: StrategyBlueprint): PlainEnglishConfirm {
  const fb = blueprint.fourBrain;
  const flow = resolveStrategyFlow(blueprint);
  const name = blueprint.name?.trim() || "Your robot";
  const symbol = blueprint.execution?.symbol;
  const risk = blueprint.risk?.riskPercent ?? fb?.management?.riskPercent ?? 1;
  const rr = blueprint.risk?.rewardRisk ?? fb?.management?.rewardRisk;

  const steps: string[] = [];

  if (flow?.steps?.length) {
    for (const step of flow.steps) {
      if (step.enabled === false) continue;
      const role =
        step.role === "direction"
          ? "Decide the trend"
          : step.role === "setup"
            ? "Wait for a setup"
            : step.role === "entry"
              ? "Enter the trade"
              : step.role === "confirmation"
                ? "Confirm"
                : step.role === "filter" || step.role === "context"
                  ? "Filter"
                  : "Then";
      steps.push(`${role} using ${moduleName(step.module)} on ${step.timeframe}.`);
    }
  } else if (fb) {
    if (fb.direction?.modules?.length) {
      steps.push(
        `Decide the bigger picture with ${joinModules(fb.direction.modules)} on ${fb.direction.timeframe}.`,
      );
    }
    if (fb.setup?.modules?.length) {
      steps.push(
        `Wait for a setup with ${joinModules(fb.setup.modules)} on ${fb.setup.timeframe}.`,
      );
    }
    if (fb.execution?.modules?.length) {
      steps.push(
        `Enter when ${joinModules(fb.execution.modules)} fires on ${fb.execution.timeframe}.`,
      );
    }
  } else if (blueprint.rules?.length) {
    for (const rule of blueprint.rules.slice(0, 5)) {
      steps.push(rule.label);
    }
  }

  if (steps.length === 0) {
    steps.push("We'll use the rules we understood from your description.");
  }

  const riskLine =
    rr != null
      ? `Risk about ${risk}% per trade, aiming for roughly ${rr}:1 reward-to-risk.`
      : `Risk about ${risk}% per trade.`;

  const schedule = fb?.management?.tradingSchedule ?? flow?.management?.tradingSchedule;
  const scheduleLine =
    schedule?.enabled ? `Only look for new trades ${describeSchedule(schedule)}.` : null;

  const where = symbol && symbol !== "ANY" ? ` on ${symbol}` : "";
  const headline = `${name}${where} — here's what it will do:`;

  return { headline, steps, riskLine, scheduleLine };
}
