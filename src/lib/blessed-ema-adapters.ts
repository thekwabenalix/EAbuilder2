/**
 * Phase 3 — blessed deterministic AI adapters (EMA+IFVG, EMA CTC).
 * Shared by Netlify gen-4brain-ai and client-side resolve-ai-wiring.
 */

import type { AiBrainWiring } from "@/lib/api-client";
import type { FourBrainConfig } from "@/types/blueprint";
import { collectBuiltinFilterRefs } from "@/lib/builtin-filter-contracts";
import { periodConst } from "@/generators/sm-embed-registry";

type StrategySemantics = NonNullable<AiBrainWiring["semantics"]>;
type ExecutionEntryEvent = "formation" | "retest" | "unknown";
type EmaRetestTarget = "fast" | "slow" | "either";

function numFrom(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function extractEmaPeriods(text: string, config?: FourBrainConfig): { fast: number; slow: number } {
  const params = {
    ...(config?.direction?.params ?? {}),
    ...(config?.setup?.params ?? {}),
    ...(config?.execution?.params ?? {}),
  };
  const fastFromParams = numFrom(params.fastPeriod, NaN);
  const slowFromParams = numFrom(params.slowPeriod, NaN);
  if (Number.isFinite(fastFromParams) && Number.isFinite(slowFromParams)) {
    return { fast: fastFromParams, slow: slowFromParams };
  }

  const matches = [...text.matchAll(/(\d{1,3})\s*(?:period\s*)?ema/gi)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n));
  if (matches.length >= 2) return { fast: matches[0], slow: matches[1] };
  return { fast: 12, slow: 48 };
}

export function extractEmaRetestTarget(
  text: string,
  fast: number,
  slow: number,
  config?: FourBrainConfig,
): EmaRetestTarget {
  const params = {
    ...(config?.setup?.params ?? {}),
    ...(config?.execution?.params ?? {}),
  };
  const configured = String(params.retestTarget ?? params.target ?? "").toLowerCase();
  if (/\b(either|any|both)\b/.test(configured)) return "either";
  if (/\b(fast|fast_ema|fast-ma|fast ma)\b/.test(configured)) return "fast";
  if (/\b(slow|slow_ema|slow-ma|slow ma)\b/.test(configured)) return "slow";

  const hay = text.toLowerCase().replace(/[–—]/g, "-");
  const fastPattern = new RegExp(`\\b${fast}\\s*(?:period\\s*)?ema\\b`);
  const slowPattern = new RegExp(`\\b${slow}\\s*(?:period\\s*)?ema\\b`);
  const onlyPatterns = [
    {
      target: "fast" as const,
      patterns: [
        new RegExp(`\\bonly\\s+(?:the\\s+)?${fast}\\s*(?:period\\s*)?ema\\b`),
        new RegExp(`\\b${fast}\\s*(?:period\\s*)?ema\\s+only\\b`),
        /\bonly\s+(?:the\s+)?fast\s+ema\b/,
        /\bfast\s+ema\s+only\b/,
      ],
    },
    {
      target: "slow" as const,
      patterns: [
        new RegExp(`\\bonly\\s+(?:the\\s+)?${slow}\\s*(?:period\\s*)?ema\\b`),
        new RegExp(`\\b${slow}\\s*(?:period\\s*)?ema\\s+only\\b`),
        /\bonly\s+(?:the\s+)?slow\s+ema\b/,
        /\bslow\s+ema\s+only\b/,
      ],
    },
  ];
  for (const option of onlyPatterns) {
    if (option.patterns.some((pattern) => pattern.test(hay))) return option.target;
  }

  const targetWindow =
    /(?:test|touch|retest)\s+(?:must\s+be\s+(?:on\s+)?)?(?:only\s+)?(?:the\s+)?([^.\n;]+)/g;
  for (const match of hay.matchAll(targetWindow)) {
    const phrase = match[1] ?? "";
    if (/\b(?:either|any|both|or)\b/.test(phrase)) return "either";
    if (fastPattern.test(phrase) || /\bfast\s+ema\b/.test(phrase)) return "fast";
    if (slowPattern.test(phrase) || /\bslow\s+ema\b/.test(phrase)) return "slow";
  }

  const eitherPatterns = [
    new RegExp(
      `\\b(?:either|any)\\s+(?:the\\s+)?(?:${fast}\\s*(?:period\\s*)?ema|fast\\s+ema).{0,40}\\b(?:or|/)\\b.{0,40}(?:${slow}\\s*(?:period\\s*)?ema|slow\\s+ema)`,
    ),
    /\b(?:either|any|both)\s+emas?\b/,
  ];
  if (eitherPatterns.some((pattern) => pattern.test(hay))) return "either";

  return "either";
}

function emaRetestCondition(target: EmaRetestTarget): string {
  if (target === "fast") return "touchedFast";
  if (target === "slow") return "touchedSlow";
  return "(touchedFast || touchedSlow)";
}

function emaRetestLabel(target: EmaRetestTarget, fast: number, slow: number): string {
  if (target === "fast") return `fast EMA (${fast})`;
  if (target === "slow") return `slow EMA (${slow})`;
  return `either EMA (${fast} or ${slow})`;
}

function extractRetestTolerancePoints(text: string, config?: FourBrainConfig): number {
  const params = {
    ...(config?.setup?.params ?? {}),
    ...(config?.execution?.params ?? {}),
  };
  const configured = numFrom(params.retestPoints ?? params.tolerancePoints, NaN);
  if (Number.isFinite(configured)) return configured;

  const fragments = text
    .split(/[\n.;]+/)
    .map((part) => part.trim())
    .filter((part) => /\b(?:ema|retest|test|touch|tap|penetrat)\w*\b/i.test(part));

  for (const fragment of fragments) {
    const hasToleranceLanguage = /\b(?:within|tolerance)\b/i.test(fragment);
    if (!hasToleranceLanguage) continue;

    const pointMatch = fragment.match(/\b(?:within|tolerance)\D{0,25}(\d+(?:\.\d+)?)\s*points?\b/i);
    if (pointMatch) return Number(pointMatch[1]);

    const pipMatch = fragment.match(/\b(?:within|tolerance)\D{0,25}(\d+(?:\.\d+)?)\s*pips?\b/i);
    if (pipMatch) return Number(pipMatch[1]) * 10;
  }

  return 0;
}

function extractIfvgEntryEvent(text: string): ExecutionEntryEvent {
  const hay = text.toLowerCase();
  const mentionsRetestEntry =
    /\b(?:enter|entry|trigger|execute).{0,80}\b(?:retest|return\s+to|tap|touch)\b.{0,40}\b(?:ifvg|inversion\s+fair\s+value\s+gap)\b/.test(
      hay,
    ) ||
    /\b(?:ifvg|inversion\s+fair\s+value\s+gap).{0,80}\b(?:retest|return\s+to|tap|touch)\b.{0,40}\b(?:entry|enter|trigger|execute)\b/.test(
      hay,
    );
  if (mentionsRetestEntry) return "retest";

  const mentionsFormation =
    /\b(?:forms?|formation|becomes?|inverts?|inversion|closes?\s+(?:above|below).{0,80}(?:boundary|fvg|gap))\b/.test(
      hay,
    );
  if (mentionsFormation) return "formation";

  return "unknown";
}

export function buildEmaIfvgSemantics(
  text: string,
  tf: string,
  fast: number,
  slow: number,
  retestTarget: EmaRetestTarget,
  source: StrategySemantics["source"],
): StrategySemantics {
  const entryEvent = extractIfvgEntryEvent(text);
  const assumptions: string[] = [];
  if (entryEvent === "unknown") {
    assumptions.push(
      "IFVG entry event was not explicit; defaulted to formation for verified wiring.",
    );
  }

  return {
    version: 1,
    source,
    timeframe: tf,
    modules: ["ema", "fvg_inversion"],
    direction: {
      module: "ema",
      event: "cross",
      fastPeriod: fast,
      slowPeriod: slow,
      resetPolicy: "opposite_cross",
    },
    setup: {
      gate: "ema_retest",
      target: retestTarget,
      targetLabel: emaRetestLabel(retestTarget, fast, slow),
      mustOccurAfter: "direction_event",
    },
    execution: {
      module: "fvg_inversion",
      entryEvent: entryEvent === "unknown" ? "formation" : entryEvent,
      mustOccurAfter: "setup_gate",
    },
    filters: collectBuiltinFilterRefs(text, tf).map((filter) => ({
      id: filter.id,
      role: filter.appliesTo ?? "execution",
      indicator: filter.indicatorId,
      timeframe: filter.timeframe,
      params: filter.params,
    })),
    assumptions,
  };
}

export function extractSingleTimeframe(text: string, config?: FourBrainConfig): string {
  const tf = text.match(/\b(M1|M5|M15|M30|H1|H4|D1|W1|MN)\b/i)?.[1];
  if (tf) return tf.toUpperCase();

  const configured =
    config?.execution?.timeframe || config?.setup?.timeframe || config?.direction?.timeframe || "";
  if (configured) return configured.toUpperCase();

  return "M5";
}

function mentionsSingleEmaCtcEntryOnly(text: string): boolean {
  const hay = text.toLowerCase();
  if (
    /\bdo not limit\b.{0,80}\b(?:first|one|single)\b/.test(hay) ||
    /\bdo not stop\b.{0,80}\b(?:looking|watching|monitoring)\b/.test(hay) ||
    /\bmultiple\b.{0,80}\b(?:trade|entry|test|retest)\b/.test(hay) ||
    /\bcontinue\b.{0,80}\b(?:watching|monitoring|looking)\b/.test(hay)
  ) {
    return false;
  }
  return (
    /\bonly the first\b.{0,100}\b(?:test|retest|trade|entry|setup)\b/.test(hay) ||
    /\b(?:one|single)\s+trade\s+per\s+cross\b/.test(hay) ||
    /\bonly one\b.{0,80}\b(?:test|retest|trade|entry)\b/.test(hay)
  );
}

function shouldRepeatEmaCtcAfterConfirmation(text: string, config?: FourBrainConfig): boolean {
  const params = {
    ...(config?.setup?.params ?? {}),
    ...(config?.execution?.params ?? {}),
  };
  if (typeof params.repeatAfterConfirmation === "boolean") return params.repeatAfterConfirmation;
  if (mentionsSingleEmaCtcEntryOnly(text)) return false;
  return true;
}

export function isEmaTestThenIfvgFormation(text: string, config?: FourBrainConfig): boolean {
  const hay = text.toLowerCase();
  const modules = [
    ...(config?.direction?.modules ?? []),
    ...(config?.setup?.modules ?? []),
    ...(config?.execution?.modules ?? []),
  ].map((m) => m.toLowerCase());

  const hasEma = /\b(?:ema|exponential moving average)\b/.test(hay) || modules.includes("ema");
  const hasIfvg =
    /\bifvg\b/.test(hay) ||
    /inversion\s+fair\s+value\s+gap/.test(hay) ||
    modules.includes("fvg_inversion");
  const hasEmaTest = /(ema|moving average).{0,120}(?:test|touch|retest|tap)|(?:test|touch|retest|tap).{0,120}(?:ema|moving average)/.test(
    hay,
  );
  const hasAfterGate = /(after|only after|ignore.{0,40}before|must.{0,80}before|once.{0,60}after|following)/.test(hay);
  const hasFormationEntry =
    /(forms?|formation|becomes?|inverts?|inversion|inverted|closes?\s+(?:above|below).{0,80}(?:boundary|fvg|gap)|ifvg.{0,40}(?:forms?|becomes?|inverts?|inverted))/.
      test(hay);

  return hasEma && hasIfvg && hasEmaTest && hasAfterGate && hasFormationEntry;
}

export function isEmaCrossTestClose(text: string, config?: FourBrainConfig): boolean {
  const hay = text.toLowerCase();
  const modules = [
    ...(config?.direction?.modules ?? []),
    ...(config?.setup?.modules ?? []),
    ...(config?.execution?.modules ?? []),
  ].map((m) => m.toLowerCase());
  const hasEma = /\b(?:ema|exponential moving average)\b/.test(hay) || modules.includes("ema");
  const hasCross = /\bcross/.test(hay);
  const hasTest = /\b(?:test|retest|touch|tap|penetrat|retrac)\b/.test(hay);
  const hasClose =
    /\bctc\b|\bcross[-\s]*test[-\s]*close\b/.test(hay) ||
    /\b(?:close|closes|closed|closing)\b.{0,120}\b(?:ema|trend direction|confirmation|confirms?)\b/.test(hay) ||
    /\b(?:after|following)\b.{0,80}\b(?:test|retest|touch|tap)\b.{0,120}\b(?:close|closes|closed|closing)\b/.test(hay);
  const hasIfvg = /\bifvg\b|inversion\s+fair\s+value\s+gap/.test(hay);
  return hasEma && hasCross && hasTest && hasClose && !hasIfvg;
}

export function buildEmaTestThenIfvgFormationWiring(
  text: string,
  config?: FourBrainConfig,
): AiBrainWiring {
  const tf = extractSingleTimeframe(text, config);
  const TF = periodConst(tf);
  const { fast, slow } = extractEmaPeriods(text, config);
  const retestTarget = extractEmaRetestTarget(text, fast, slow, config);
  const retestCondition = emaRetestCondition(retestTarget);
  const retestLabel = emaRetestLabel(retestTarget, fast, slow);
  const retestPoints = extractRetestTolerancePoints(text, config);
  const params = {
    ...(config?.setup?.params ?? {}),
    ...(config?.execution?.params ?? {}),
  };
  const expiryBars = numFrom(params.expiryBars, 100);

  const response: AiBrainWiring = {
    direction_brain: `int gEmaIfvgSeqBias_${tf} = 0;
datetime gEmaIfvgCrossTime_${tf} = 0;
datetime gEmaIfvgTestTime_${tf} = 0;

void Direction_Brain_Execute() {
   static int _lastBias = 0;
   int hFast = B4_MA(${TF}, ${fast}, MODE_EMA);
   int hSlow = B4_MA(${TF}, ${slow}, MODE_EMA);
   datetime barTime = iTime(InpSymbol, ${TF}, 1);
   double f1 = B4_MAval(hFast, 1), s1 = B4_MAval(hSlow, 1);
   double f2 = B4_MAval(hFast, 2), s2 = B4_MAval(hSlow, 2);
   bool bullCross = (f2 <= s2 && f1 > s1);
   bool bearCross = (f2 >= s2 && f1 < s1);
   if(bullCross) {
      gBias = 1;
      gEmaIfvgSeqBias_${tf} = 1;
      gEmaIfvgCrossTime_${tf} = barTime;
      gEmaIfvgTestTime_${tf} = 0;
   } else if(bearCross) {
      gBias = -1;
      gEmaIfvgSeqBias_${tf} = -1;
      gEmaIfvgCrossTime_${tf} = barTime;
      gEmaIfvgTestTime_${tf} = 0;
   }
   if(gBias != _lastBias) {
      _lastBias = gBias;
      gSetupActive = false;
      PrintFormat("[DIR] EMA cross bias=%d cross=%s fast=%.5f slow=%.5f",
                  gBias, TimeToString(gEmaIfvgCrossTime_${tf}, TIME_DATE|TIME_MINUTES), f1, s1);
   }
}`,
    setup_brain: `void Setup_Brain_Execute() {
   gSetupActive = false; gSetupDir = 0; gSetupSLHint = 0.0;

   datetime barTime = iTime(InpSymbol, ${TF}, 1);
   if(gBias == 0) {
      gEmaIfvgSeqBias_${tf} = 0; gEmaIfvgCrossTime_${tf} = 0; gEmaIfvgTestTime_${tf} = 0;
      PrintFormat("[SETUP] waiting for EMA cross");
      return;
   }

   if(gBias != gEmaIfvgSeqBias_${tf}) {
      gSetupActive = false;
      PrintFormat("[SETUP] blocked: bias changed without a recorded EMA cross");
      return;
   }

   int hFast = B4_MA(${TF}, ${fast}, MODE_EMA);
   int hSlow = B4_MA(${TF}, ${slow}, MODE_EMA);
   double fastMa = B4_MAval(hFast, 1), slowMa = B4_MAval(hSlow, 1);
   double hi = iHigh(InpSymbol, ${TF}, 1), lo = iLow(InpSymbol, ${TF}, 1);
   double retestTol = ${retestPoints} * SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   bool touchedFast = (lo <= fastMa + retestTol && hi >= fastMa - retestTol);
   bool touchedSlow = (lo <= slowMa + retestTol && hi >= slowMa - retestTol);
   if(gEmaIfvgTestTime_${tf} == 0 && gEmaIfvgCrossTime_${tf} > 0 && barTime > gEmaIfvgCrossTime_${tf} && ${retestCondition}) {
      gEmaIfvgTestTime_${tf} = barTime;
      PrintFormat("[SETUP] EMA test accepted target=${retestLabel} at %s fastTouch=%d slowTouch=%d",
                  TimeToString(gEmaIfvgTestTime_${tf}, TIME_DATE|TIME_MINUTES), touchedFast, touchedSlow);
   }

   IFVGSM_${tf}_Tick(1);
   datetime invTime = (gBias == 1) ? IFVGSM_${tf}_BullInversionTime() : IFVGSM_${tf}_BearInversionTime();
   if(gEmaIfvgTestTime_${tf} > 0 && invTime > gEmaIfvgTestTime_${tf}) {
      gSetupActive = true;
      gSetupDir = gBias;
      gSetupSLHint = (gBias == 1) ? IFVGSM_${tf}_BullInversionSL() : IFVGSM_${tf}_BearInversionSL();
   }
   PrintFormat("[SETUP] active=%d dir=%d emaTest=%s inv=%s", gSetupActive, gSetupDir,
               TimeToString(gEmaIfvgTestTime_${tf}, TIME_DATE|TIME_MINUTES),
               TimeToString(invTime, TIME_DATE|TIME_MINUTES));
}`,
    execution_brain: `void Execution_Brain_Execute() {
   gExecSignal = false; gExecDir = 0; gExecSL = 0.0;
   IFVGSM_${tf}_Tick(1);

   datetime bullInv = IFVGSM_${tf}_BullInversionTime();
   datetime bearInv = IFVGSM_${tf}_BearInversionTime();
   if(gSetupActive && gSetupDir == 1 && gBias == 1 && IFVGSM_${tf}_BullJustInverted() && bullInv > gEmaIfvgTestTime_${tf}) {
      gExecSignal = true;
      gExecDir = 1;
      gExecSL = IFVGSM_${tf}_BullInversionSL();
   } else if(gSetupActive && gSetupDir == -1 && gBias == -1 && IFVGSM_${tf}_BearJustInverted() && bearInv > gEmaIfvgTestTime_${tf}) {
      gExecSignal = true;
      gExecDir = -1;
      gExecSL = IFVGSM_${tf}_BearInversionSL();
   }
   PrintFormat("[EXEC] signal=%d dir=%d SL=%.5f test=%s bullInv=%s bearInv=%s",
               gExecSignal, gExecDir, gExecSL,
               TimeToString(gEmaIfvgTestTime_${tf}, TIME_DATE|TIME_MINUTES),
               TimeToString(bullInv, TIME_DATE|TIME_MINUTES),
               TimeToString(bearInv, TIME_DATE|TIME_MINUTES));
}`,
    semantics: buildEmaIfvgSemantics(text, tf, fast, slow, retestTarget, "deterministic_adapter"),
    required_sms: [`IFVGSM_${tf}`],
    sm_configs: {
      [`ifvg_${tf}`]: {
        type: "fvg_inversion",
        id: tf,
        TF,
        tf,
        params: { expiryBars },
      },
    },
    notes: `Deterministic adapter: ${fast}/${slow} EMA cross on ${tf} sets direction, the EMA test target is ${retestLabel}, and only iFVG formations after that EMA-test timestamp can trigger entries. The EA uses the verified IFVGSM_${tf} state machine and fires on BullJustInverted/BearJustInverted, not on iFVG retest confirmation.`,
  };
  return response
}

export function buildEmaCrossTestCloseWiring(
  text: string,
  config?: FourBrainConfig,
): AiBrainWiring {
  const tf = extractSingleTimeframe(text, config);
  const TF = periodConst(tf);
  const { fast, slow } = extractEmaPeriods(text, config);
  const retestPoints = extractRetestTolerancePoints(text);
  const repeatAfterConfirmation = shouldRepeatEmaCtcAfterConfirmation(text, config);
  const repeatNote = repeatAfterConfirmation
    ? `It enforces EMA cross, then repeats slow-EMA (${slow}) test -> close beyond fast EMA (${fast}) opportunities in the same direction until an opposite cross.`
    : `It enforces EMA cross, first slow-EMA (${slow}) test, then close back beyond fast EMA (${fast}).`;
  const response: AiBrainWiring = {
    direction_brain: `void Direction_Brain_Execute() {
   int hFast = B4_MA(${TF}, ${fast}, MODE_EMA);
   int hSlow = B4_MA(${TF}, ${slow}, MODE_EMA);
   double f1 = B4_MAval(hFast, 1), s1 = B4_MAval(hSlow, 1);
   gBias = (f1 > s1) ? 1 : (f1 < s1 ? -1 : 0);
   PrintFormat("[DIR] EMA alignment bias=%d fast=%.5f slow=%.5f", gBias, f1, s1);
}`,
    setup_brain: `void Setup_Brain_Execute() {
   gSetupActive = false; gSetupDir = 0; gSetupSLHint = 0.0;
   if(EMASM_${tf}_SetupActive()) {
      int dir = EMASM_${tf}_ActiveDir();
      if(dir != 0 && (gBias == 0 || gBias == dir)) {
         gSetupActive = true;
         gSetupDir = dir;
         gSetupSLHint = EMASM_${tf}_ActiveSL();
         PrintFormat("[SETUP] EMA CTC active dir=%d SLhint=%.5f", gSetupDir, gSetupSLHint);
      }
   }
}`,
    execution_brain: `void Execution_Brain_Execute() {
   gExecSignal = false; gExecDir = 0; gExecSL = 0.0;
   if(EMASM_${tf}_JustConfirmed()) {
      int dir = EMASM_${tf}_ConfirmDir();
      if(dir != 0 && (gBias == 0 || gBias == dir) && (gSetupDir == 0 || gSetupDir == dir)) {
         gExecSignal = true;
         gExecDir = dir;
         gExecSL = EMASM_${tf}_ConfirmSL();
         PrintFormat("[EXEC] EMA CTC confirmed dir=%d SL=%.5f", gExecDir, gExecSL);
      }
   }
}`,
    semantics: {
      version: 1,
      source: "deterministic_adapter",
      timeframe: tf,
      modules: ["ema"],
      direction: {
        module: "ema",
        event: "cross",
        fastPeriod: fast,
        slowPeriod: slow,
        resetPolicy: "opposite_cross",
      },
      setup: {
        gate: "ema_retest",
        target: "slow",
        targetLabel: emaRetestLabel("slow", fast, slow),
        mustOccurAfter: "direction_event",
      },
      execution: {
        module: "ema",
        entryEvent: "confirmation",
        mustOccurAfter: "setup_gate",
      },
      filters: collectBuiltinFilterRefs(text, tf).map((filter) => ({
        id: filter.id,
        role: filter.appliesTo ?? "execution",
        indicator: filter.indicatorId,
        timeframe: filter.timeframe,
        params: filter.params,
      })),
      assumptions: [],
    },
    required_sms: [`EMASM_${tf}`],
    sm_configs: {
      [`ema_${tf}`]: {
        type: "ema",
        id: tf,
        TF,
        tf,
        params: {
          fastPeriod: fast,
          slowPeriod: slow,
          retestPoints,
          requireCross: true,
          repeatAfterConfirmation,
        },
      },
    },
    notes: `Deterministic CTC adapter: ${fast}/${slow} EMA on ${tf} uses the verified EMASM_${tf} state machine. ${repeatNote} The assembler enters on the current new bar, which is the next candle open after confirmation.`,
  };
  return response
}
export type BlessedAdapterId = "ema_ifvg" | "ema_ctc";

export function detectBlessedAdapterId(
  text: string,
  config?: FourBrainConfig,
): BlessedAdapterId | null {
  if (isEmaTestThenIfvgFormation(text, config)) return "ema_ifvg";
  if (isEmaCrossTestClose(text, config)) return "ema_ctc";
  return null;
}

export function isBlessedAdapterWiring(wiring: Pick<AiBrainWiring, "semantics" | "notes">): boolean {
  if (wiring.semantics?.source === "deterministic_adapter") return true;
  return Boolean(wiring.notes?.includes("Deterministic adapter:"));
}

export function buildBlessedAdapterWiring(
  id: BlessedAdapterId,
  text: string,
  config?: FourBrainConfig,
): AiBrainWiring {
  if (id === "ema_ifvg") return buildEmaTestThenIfvgFormationWiring(text, config);
  return buildEmaCrossTestCloseWiring(text, config);
}
