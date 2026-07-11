/**
 * One-click assistant fix: wire HTF Direction → LTF EMA Setup/Entry so
 * lower-TF crosses/entries only arm in the HTF bias direction.
 *
 * This mutates the blueprint (Strategy Flow + optional 4-Brain params).
 * The UI then regenerates MQL5 from the patched blueprint.
 */

import type { StrategyBlueprint, StrategyStepConfig } from "@/types/blueprint";
import { resolveStrategyFlow } from "@/lib/blueprint-generation-gate";

export type HtfLtfEmaAlignmentResult = {
  blueprint: StrategyBlueprint;
  changed: boolean;
  notes: string[];
};

function cloneStep(step: StrategyStepConfig): StrategyStepConfig {
  return {
    ...step,
    params: { ...(step.params ?? {}) },
    dependsOn: (step.dependsOn ?? []).map((d) => ({ ...d })),
    directionSource: step.directionSource ? { ...step.directionSource } : undefined,
  };
}

/** True when trader evidence says H1 bias / M5 entry are not waiting for alignment. */
export function looksLikeHtfLtfMisalignment(text: string): boolean {
  const t = text.toLowerCase();
  const mentionsHtfLtf =
    (/\bh1\b/.test(t) && /\bm5\b/.test(t)) || /higher.?tf|lower.?tf|htf|ltf/.test(t);
  const mentionsProblem =
    /still bullish|still bearish|has not cross|haven't cross|not cross|did not wait|does not wait|before.*(cross|align)|align|alignment|opposite|regardless of m5|m5 was still|fires? even when|this fix did not|updated code produced/i.test(
      t,
    );
  const panelClues =
    /last gate:.*not before entry/i.test(text) ||
    (/direction ema h1/i.test(text) && /entry ema m5/i.test(text));
  return (mentionsHtfLtf && mentionsProblem) || panelClues;
}

/**
 * Patch flow so every LTF EMA setup/entry:
 * - uses directionSource = HTF Direction step
 * - sets requireCross = true
 * - entry depends on setup with relation "after" (different bar)
 */
export function applyHtfLtfEmaAlignment(bp: StrategyBlueprint): HtfLtfEmaAlignmentResult {
  const flow = resolveStrategyFlow(bp);
  const notes: string[] = [];
  if (!flow?.steps?.length) {
    return { blueprint: bp, changed: false, notes: ["No Strategy Flow steps to patch."] };
  }

  const steps = flow.steps.map(cloneStep);
  const dir = steps.find((s) => s.enabled !== false && s.role === "direction");
  if (!dir) {
    return {
      blueprint: bp,
      changed: false,
      notes: ["No Direction step found — add an HTF Direction step in Configure first."],
    };
  }

  let changed = false;
  const dirTf = dir.timeframe.toUpperCase();

  const ltfEma = steps.filter(
    (s) =>
      s.enabled !== false &&
      s.module === "ema" &&
      s.role !== "direction" &&
      s.timeframe.toUpperCase() !== dirTf,
  );

  if (!ltfEma.length) {
    return {
      blueprint: bp,
      changed: false,
      notes: ["No lower-TF EMA Setup/Entry steps found to align with Direction."],
    };
  }

  for (const step of ltfEma) {
    if (step.params?.requireCross !== true) {
      step.params = { ...step.params, requireCross: true };
      changed = true;
      notes.push(`${step.name || step.id}: set requireCross=true (must actually cross on ${step.timeframe}).`);
    }

    const linked =
      step.directionSource?.mode === "from_step" && step.directionSource.stepId === dir.id;
    if (!linked) {
      step.directionSource = { mode: "from_step", stepId: dir.id };
      changed = true;
      notes.push(
        `${step.name || step.id}: direction source → ${dir.name || dir.id} (${dir.timeframe}).`,
      );
    }

    const hasDirDep = (step.dependsOn ?? []).some((d) => d.stepId === dir.id);
    if (!hasDirDep && (step.role === "setup" || step.role === "filter")) {
      step.dependsOn = [...(step.dependsOn ?? []), { stepId: dir.id, relation: "after" }];
      changed = true;
      notes.push(`${step.name || step.id}: depends on Direction (${dir.timeframe}) after bias is set.`);
    }
  }

  const setup = ltfEma.find((s) => s.role === "setup" || s.role === "filter");
  const entry = ltfEma.find((s) => s.role === "entry");
  if (setup && entry) {
    const depOnSetup = (entry.dependsOn ?? []).find((d) => d.stepId === setup.id);
    if (!depOnSetup || depOnSetup.relation !== "after") {
      entry.dependsOn = [
        ...(entry.dependsOn ?? []).filter((d) => d.stepId !== setup.id),
        { stepId: setup.id, relation: "after" },
      ];
      changed = true;
      notes.push(
        `${entry.name || entry.id}: must fire on a later bar than ${setup.name || setup.id} (relation=after).`,
      );
    }
    if (entry.event === "EMA_CROSS") {
      entry.event = "EMA_CLOSE_CONFIRMED";
      changed = true;
      notes.push(
        `${entry.name || entry.id}: event → EMA_CLOSE_CONFIRMED (cross arms setup; close confirms entry).`,
      );
    }
  }

  let fourBrain = bp.fourBrain;
  if (fourBrain) {
    const nextFb = {
      ...fourBrain,
      setup: fourBrain.setup
        ? {
            ...fourBrain.setup,
            params: { ...(fourBrain.setup.params ?? {}), requireCross: true },
          }
        : fourBrain.setup,
      execution: fourBrain.execution
        ? {
            ...fourBrain.execution,
            params: { ...(fourBrain.execution.params ?? {}), requireCross: true },
          }
        : fourBrain.execution,
    };
    const setupChanged =
      JSON.stringify(fourBrain.setup?.params ?? {}) !==
      JSON.stringify(nextFb.setup?.params ?? {});
    const execChanged =
      JSON.stringify(fourBrain.execution?.params ?? {}) !==
      JSON.stringify(nextFb.execution?.params ?? {});
    if (setupChanged || execChanged) {
      fourBrain = nextFb;
      changed = true;
      notes.push("4-Brain setup/execution: requireCross=true.");
    }
  }

  if (!changed) {
    notes.push(
      "Blueprint already has HTF→LTF EMA alignment wiring. Compile a fresh .ex5 and re-backtest; if sells still fire while M5 is opposite the H1 bias, attach the tester journal.",
    );
    return { blueprint: bp, changed: false, notes };
  }

  return {
    blueprint: {
      ...bp,
      fourBrain,
      strategyFlow: {
        ...flow,
        steps,
        source: flow.source === "user" ? "user" : flow.source,
      },
    },
    changed: true,
    notes,
  };
}
