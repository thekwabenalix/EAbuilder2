/**
 * One-click Strategy Flow wiring fixes the assistant can Apply.
 * Works for any verified module family (EMA, FVG, BOS, OB, …) — not EMA-only.
 */

import type { StrategyBlueprint, StrategyStepConfig } from "@/types/blueprint";
import type { StrategyEventType } from "@/lib/strategy-events";
import { resolveStrategyFlow } from "@/lib/blueprint-generation-gate";
import { applyHtfLtfEmaAlignment } from "@/lib/assistant-htf-ltf-fix";

export type FlowFixResult = {
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

const ZONE_LIKE = new Set([
  "fvg",
  "order_block",
  "ob_fvg",
  "liqsweep",
  "breaker_block",
  "unicorn",
  "snr",
  "gap_snr",
  "rejection",
  "zone_liq",
]);

/** Default setup expiry (bars) when zone setups have none / zero. */
const DEFAULT_ZONE_EXPIRY = 50;

/**
 * Universal flow wiring repair:
 * - Point Setup/Entry/Confirmation at Direction via directionSource
 * - Entry depends on Setup with relation "after" (different bar)
 * - Zone setups get a sensible expiryBars if missing
 * - If LTF EMA steps exist, also apply HTF→LTF EMA alignment
 */
export function applyFixFlowWiring(bp: StrategyBlueprint): FlowFixResult {
  const flow = resolveStrategyFlow(bp);
  const notes: string[] = [];
  if (!flow?.steps?.length) {
    return { blueprint: bp, changed: false, notes: ["No Strategy Flow steps to patch."] };
  }

  let steps = flow.steps.map(cloneStep);
  const dir = steps.find((s) => s.enabled !== false && s.role === "direction");
  if (!dir) {
    return {
      blueprint: bp,
      changed: false,
      notes: ["No Direction step found — add one in Configure first."],
    };
  }

  let changed = false;
  const enabled = steps.filter((s) => s.enabled !== false);
  const nonDir = enabled.filter((s) => s.role !== "direction");

  for (const step of nonDir) {
    const linked =
      step.directionSource?.mode === "from_step" && step.directionSource.stepId === dir.id;
    if (!linked && (step.role === "setup" || step.role === "entry" || step.role === "confirmation")) {
      step.directionSource = { mode: "from_step", stepId: dir.id };
      changed = true;
      notes.push(
        `${step.name || step.id}: direction source → ${dir.name || dir.id} (${dir.timeframe}).`,
      );
    }

    if (ZONE_LIKE.has(step.module) && (step.role === "setup" || step.role === "filter")) {
      const expiry = step.params?.expiryBars;
      const n = typeof expiry === "number" ? expiry : Number(expiry);
      if (!Number.isFinite(n) || n <= 0) {
        step.params = { ...step.params, expiryBars: DEFAULT_ZONE_EXPIRY };
        changed = true;
        notes.push(
          `${step.name || step.id}: set expiryBars=${DEFAULT_ZONE_EXPIRY} so the setup can expire.`,
        );
      }
    }
  }

  const setup = enabled.find((s) => s.role === "setup" || s.role === "filter");
  const entry = [...enabled].reverse().find((s) => s.role === "entry");
  if (setup && entry && setup.id !== entry.id) {
    const dep = (entry.dependsOn ?? []).find((d) => d.stepId === setup.id);
    if (!dep) {
      entry.dependsOn = [...(entry.dependsOn ?? []), { stepId: setup.id, relation: "after" }];
      changed = true;
      notes.push(
        `${entry.name || entry.id}: now depends on ${setup.name || setup.id} (after — later bar).`,
      );
    } else if (dep.relation === "same_or_after" || !dep.relation) {
      entry.dependsOn = (entry.dependsOn ?? []).map((d) =>
        d.stepId === setup.id ? { ...d, relation: "after" as const } : d,
      );
      changed = true;
      notes.push(
        `${entry.name || entry.id}: dependency on setup → after (blocks same-bar Setup+Entry).`,
      );
    }

    const hasDirDep = (setup.dependsOn ?? []).some((d) => d.stepId === dir.id);
    if (!hasDirDep) {
      setup.dependsOn = [...(setup.dependsOn ?? []), { stepId: dir.id, relation: "after" }];
      changed = true;
      notes.push(`${setup.name || setup.id}: depends on Direction after bias is set.`);
    }
  }

  let nextBp: StrategyBlueprint = {
    ...bp,
    strategyFlow: {
      ...flow,
      steps,
      source: flow.source === "user" ? "user" : flow.source,
    },
  };

  // EMA-specific extras (requireCross, entry event) when LTF EMA is present
  const hasLtfEma = nonDir.some(
    (s) =>
      s.module === "ema" && s.timeframe.toUpperCase() !== dir.timeframe.toUpperCase(),
  );
  if (hasLtfEma) {
    const ema = applyHtfLtfEmaAlignment(nextBp);
    if (ema.changed) {
      nextBp = ema.blueprint;
      changed = true;
      notes.push(...ema.notes);
    }
  }

  if (!changed) {
    notes.push(
      "Flow wiring already looks correct. Compile a fresh EA and re-backtest with InpAudit=true, or attach the tester journal for gate-level diagnosis.",
    );
    return { blueprint: bp, changed: false, notes };
  }

  return { blueprint: nextBp, changed: true, notes };
}

/** Detect same-bar / dependency timing complaints from chat or panel text. */
export function looksLikeSameBarCollision(text: string): boolean {
  return (
    /not before entry|same (bar|timestamp)|same time|setup.*=.*entry|14:05.*14:05/i.test(text) ||
    (/setup ema/i.test(text) && /entry ema/i.test(text) && /blocked/i.test(text))
  );
}

/** Detect missing/expired setup style issues. */
export function looksLikeSetupExpiryIssue(text: string): boolean {
  return /setup expir|expired|zone (gone|invalid)|never armed|setup never/i.test(text);
}

const RETEST_TO_ACTIVE: Partial<Record<StrategyEventType, StrategyEventType>> = {
  OB_RETESTED: "OB_CREATED",
  FVG_RETESTED: "FVG_CREATED",
  UNICORN_RETESTED: "UNICORN_ACTIVE",
  IFVG_RETESTED: "IFVG_FORMED",
};

/**
 * When Setup/Confirmation zone steps logged 0 events while Entry fired a lot,
 * regenerating the EA cannot invent retests. This patches the flow to:
 * - Arm Setup on zone formation (CREATED/ACTIVE) instead of rare RETESTED
 * - Disable a redundant same-module Confirmation that also waits for RETESTED
 * - Loosen displacement / raise expiry so zones can form in the test window
 */
export function applyFixSilentZoneSetup(bp: StrategyBlueprint): FlowFixResult {
  const flow = resolveStrategyFlow(bp);
  const notes: string[] = [];
  if (!flow?.steps?.length) {
    return { blueprint: bp, changed: false, notes: ["No Strategy Flow steps to patch."] };
  }

  const steps = flow.steps.map(cloneStep);
  let changed = false;

  const enabled = () => steps.filter((s) => s.enabled !== false);
  const setups = () =>
    enabled().filter((s) => s.role === "setup" || s.role === "filter");
  const confirmations = () => enabled().filter((s) => s.role === "confirmation");
  const entries = () => enabled().filter((s) => s.role === "entry");

  for (const step of steps) {
    if (step.enabled === false) continue;
    if (!ZONE_LIKE.has(step.module)) continue;
    if (step.role !== "setup" && step.role !== "filter" && step.role !== "confirmation") {
      continue;
    }

    const mapped = RETEST_TO_ACTIVE[step.event];
    if (mapped && (step.role === "setup" || step.role === "filter")) {
      const prev = step.event;
      step.event = mapped;
      changed = true;
      notes.push(
        `${step.name || step.id}: ${prev} → ${mapped} (arm when the zone forms; retests alone were never logging).`,
      );
    }

    const disp = Number(step.params?.dispMult);
    if (Number.isFinite(disp) && disp > 1.2) {
      step.params = { ...step.params, dispMult: 1.2 };
      changed = true;
      notes.push(`${step.name || step.id}: dispMult ${disp} → 1.2 (easier displacement).`);
    } else if (!Number.isFinite(disp) && step.module === "order_block") {
      step.params = { ...step.params, dispMult: 1.2 };
      changed = true;
      notes.push(`${step.name || step.id}: set dispMult=1.2.`);
    }

    const expiry = Number(step.params?.expiryBars);
    const minExpiry = /^(H1|H4|D1)$/i.test(step.timeframe) ? 80 : 50;
    if (!Number.isFinite(expiry) || expiry < minExpiry) {
      step.params = { ...step.params, expiryBars: minExpiry };
      changed = true;
      notes.push(`${step.name || step.id}: expiryBars → ${minExpiry}.`);
    }

    const lookback = Number(step.params?.lookback);
    if (Number.isFinite(lookback) && lookback > 0 && lookback < 300) {
      step.params = { ...step.params, lookback: 500 };
      changed = true;
      notes.push(`${step.name || step.id}: lookback → 500.`);
    }
  }

  // Two zone gates on the same module+TF cannot both arm on one retest — drop the duplicate confirmation.
  for (const conf of confirmations()) {
    if (!ZONE_LIKE.has(conf.module)) continue;
    const parent = setups().find(
      (s) =>
        s.module === conf.module &&
        s.timeframe.toUpperCase() === conf.timeframe.toUpperCase() &&
        (conf.dependsOn ?? []).some((d) => d.stepId === s.id),
    );
    if (!parent) continue;

    conf.enabled = false;
    changed = true;
    notes.push(
      `Disabled Confirmation "${conf.name || conf.id}" — same ${conf.module} @ ${conf.timeframe} as Setup; a second zone gate was starving the sequence.`,
    );

    for (const entry of entries()) {
      const deps = entry.dependsOn ?? [];
      if (!deps.some((d) => d.stepId === conf.id)) continue;
      entry.dependsOn = [
        ...deps.filter((d) => d.stepId !== conf.id),
        ...(deps.some((d) => d.stepId === parent.id)
          ? []
          : [{ stepId: parent.id, relation: "after" as const }]),
      ];
      changed = true;
      notes.push(
        `${entry.name || entry.id}: now waits on Setup "${parent.name || parent.id}" (not the disabled Confirmation).`,
      );
    }
  }

  if (!changed) {
    notes.push(
      "No silent-zone patch applied — open Configure and change Setup to a formation event (e.g. OB_CREATED), or pick a setup module that fires in this market.",
    );
    return { blueprint: bp, changed: false, notes };
  }

  return {
    blueprint: {
      ...bp,
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

/** Trader/assistant text that points at silent setup while entry still logs. */
export function looksLikeSilentZoneSetup(text: string): boolean {
  return (
    /setup.*(never|0|zero|no ).*(fire|event|detect)|orphaned|without a setup|setup steps?.*never|0 events.*order block|order block.*0 events|confirmation.*0 events/i.test(
      text,
    ) || /entry.*(thousands|fired|events).*(setup|confirmation).*(never|0)/i.test(text)
  );
}

const ENTRY_EVENT_RELAX: Partial<Record<StrategyEventType, StrategyEventType>> = {
  EMA_CLOSE_CONFIRMED: "EMA_CROSS",
  FVG_CONFIRMED: "FVG_RETESTED",
  OB_CONFIRMED: "OB_RETESTED",
  UNICORN_CONFIRMED: "UNICORN_RETESTED",
  IFVG_CONFIRMED: "IFVG_RETESTED",
};

/**
 * Entry step logged 0 events while upstream Direction/Setup fired.
 * Loosen entry event/params and ensure wiring so Entry can fire.
 */
export function applyFixSilentEntry(bp: StrategyBlueprint): FlowFixResult {
  const wired = applyFixFlowWiring(bp);
  let nextBp = wired.changed ? wired.blueprint : bp;
  const notes = [...wired.notes];
  const flow = resolveStrategyFlow(nextBp);
  if (!flow?.steps?.length) {
    return {
      blueprint: nextBp,
      changed: wired.changed,
      notes: notes.length ? notes : ["No Strategy Flow steps to patch."],
    };
  }

  const steps = flow.steps.map(cloneStep);
  let changed = wired.changed;
  const entry = steps.find((s) => s.enabled !== false && s.role === "entry");
  if (!entry) {
    return {
      blueprint: nextBp,
      changed,
      notes: [...notes, "No Entry step found to loosen."],
    };
  }

  const relaxed = ENTRY_EVENT_RELAX[entry.event];
  if (relaxed && relaxed !== entry.event) {
    const prev = entry.event;
    entry.event = relaxed;
    changed = true;
    notes.push(`${entry.name || entry.id}: ${prev} → ${relaxed} (easier entry trigger).`);
  }

  const params = { ...(entry.params ?? {}) };
  const lookback = Number(params.lookback);
  if (Number.isFinite(lookback) && lookback > 8) {
    params.lookback = Math.max(5, Math.floor(lookback / 2));
    changed = true;
    notes.push(`${entry.name || entry.id}: lookback ${lookback} → ${params.lookback}.`);
  }
  for (const key of ["swingLen", "pivotStrength", "strength", "confirmBars"] as const) {
    const n = Number(params[key]);
    if (Number.isFinite(n) && n > 2) {
      params[key] = 2;
      changed = true;
      notes.push(`${entry.name || entry.id}: ${key} ${n} → 2.`);
    }
  }
  if (entry.module === "ema" && params.requireCross === true) {
    // Keep requireCross — alignment matters; loosening is via event/lookback.
  }
  entry.params = params;

  // Same-TF entry waiting "after" a silent/rare setup can starve — prefer same_or_after.
  const deps = entry.dependsOn ?? [];
  entry.dependsOn = deps.map((d) => {
    if (d.relation === "after") {
      changed = true;
      notes.push(
        `${entry.name || entry.id}: dependency → same_or_after (allows entry once upstream is live).`,
      );
      return { ...d, relation: "same_or_after" as const };
    }
    return d;
  });

  if (!changed) {
    notes.push(
      "Entry already looks loose — try a different entry module/event in Configure, or attach a longer tester log.",
    );
    return { blueprint: nextBp, changed: false, notes };
  }

  return {
    blueprint: {
      ...nextBp,
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

/**
 * Loosen Management / execution risk gates that block OpenTrade (spread, max open, stop distance).
 */
export function applyFixRiskGates(bp: StrategyBlueprint): FlowFixResult {
  const notes: string[] = [];
  let changed = false;

  const risk = { ...bp.risk };
  const execution = { ...bp.execution };
  const prevSpread = execution.spreadFilterPoints ?? 25;
  if (prevSpread > 0 && prevSpread < 80) {
    execution.spreadFilterPoints = Math.max(50, prevSpread * 2);
    changed = true;
    notes.push(`Max spread ${prevSpread} → ${execution.spreadFilterPoints} points.`);
  } else if (prevSpread >= 80) {
    execution.spreadFilterPoints = 0;
    changed = true;
    notes.push("Max spread filter disabled (0 = off) for this test.");
  }

  const prevOpen = risk.maxOpenTrades ?? 1;
  if (prevOpen < 3) {
    risk.maxOpenTrades = 3;
    changed = true;
    notes.push(`Max open trades ${prevOpen} → 3.`);
  }

  const prevBuf = risk.stopBufferPoints ?? 20;
  if (prevBuf < 40) {
    risk.stopBufferPoints = 40;
    changed = true;
    notes.push(`Stop buffer ${prevBuf} → 40 points.`);
  }

  const flowMgmt = bp.strategyFlow?.management ?? {};
  const fbMgmt = bp.fourBrain?.management ?? {};
  const baseMgmt = { ...fbMgmt, ...flowMgmt };
  let mgmt = { ...baseMgmt };
  const maxStop = mgmt.maxStopPoints;
  if (typeof maxStop === "number" && maxStop > 0 && maxStop < 200) {
    mgmt = { ...mgmt, maxStopPoints: Math.max(150, maxStop * 2) };
    changed = true;
    notes.push(`Max stop ${maxStop} → ${mgmt.maxStopPoints} points.`);
  } else if (typeof maxStop === "number" && maxStop > 0) {
    mgmt = { ...mgmt, maxStopPoints: 0 };
    changed = true;
    notes.push("Max stop distance limit disabled (0 = no limit).");
  }

  if (!changed) {
    notes.push("Risk gates already look loose — inspect the gate reason or widen the test period.");
    return { blueprint: bp, changed: false, notes };
  }

  const nextFb = bp.fourBrain
    ? { ...bp.fourBrain, management: { ...bp.fourBrain.management, ...mgmt } }
    : bp.fourBrain;
  const nextFlow = bp.strategyFlow
    ? { ...bp.strategyFlow, management: { ...bp.strategyFlow.management, ...mgmt } }
    : bp.strategyFlow;

  return {
    blueprint: {
      ...bp,
      risk,
      execution,
      fourBrain: nextFb,
      strategyFlow: nextFlow,
    },
    changed: true,
    notes,
  };
}

