/**
 * Phase 5 — static MQL5 lint for generated Experts and indicators.
 *
 * Not a compiler. Catches MQL4-isms and structural red flags before MetaEditor F7.
 */

export interface Mql5LintOptions {
  /** Treat warnings as hard failures (CI syntax gate). */
  strict?: boolean;
  /** File label for error messages. */
  label?: string;
}

export interface Mql5LintResult {
  label: string;
  warnings: string[];
  ok: boolean;
}

/** Project-rule patterns that must never appear in generated MQL5. */
const FORBIDDEN_PATTERNS: Array<[RegExp, string]> = [
  [/\b(Close|Open|High|Low|Time)\s*\[/g, "MQL4 series access (use iClose/iOpen/…)"],
  [/(?<![A-Za-z_.])(Ask|Bid)\b(?!\w)/g, "bare Ask/Bid (use SymbolInfoDouble SYMBOL_ASK/BID)"],
  [/\bSetMagicNumber\b/g, "SetMagicNumber (use trade.SetExpertMagicNumber)"],
  [/\bGetPointer\s*\(/g, "GetPointer on struct"],
];

/** Placeholder / generator failure strings that must never ship. */
const PLACEHOLDER_PATTERNS: Array<[RegExp, string]> = [
  [/undeclared identifier/gi, "generator placeholder text"],
  [/Unknown SM type/g, "unknown SM embed placeholder"],
  [/\/\*\s*not supported\s*\*\//gi, "unsupported module stub"],
];

/** Extra checks for full Expert Advisors (not inline SM harnesses). */
const EA_REQUIRED_MARKERS: Array<[RegExp, string]> = [
  [/\bOnInit\s*\(/, "OnInit handler"],
  [/\bOnTick\s*\(/, "OnTick handler"],
];

/** Flow-engine EAs must use the ordered event runtime. */
const FLOW_EA_MARKERS: Array<[RegExp, string]> = [
  [/RegisterEvent\s*\(/, "RegisterEvent timeline"],
  [/EvaluateEntry_\d+\s*\(/, "entry gate evaluator"],
];

export function lintMql5(code: string, options: Mql5LintOptions = {}): Mql5LintResult {
  const label = options.label ?? "MQL5";
  const warnings: string[] = [];
  const lines = code.split("\n");

  const count = (re: RegExp) => (code.match(re) ?? []).length;
  if (count(/\{/g) !== count(/\}/g)) {
    warnings.push(`brace imbalance: ${count(/\{/g)} { vs ${count(/\}/g)} }`);
  }
  if (count(/\(/g) !== count(/\)/g)) {
    warnings.push(`paren imbalance: ${count(/\(/g)} ( vs ${count(/\)/g)} )`);
  }

  const scanPatterns = (patterns: Array<[RegExp, string]>) => {
    for (const [re, msg] of patterns) {
      const hits: number[] = [];
      lines.forEach((ln, i) => {
        if (re.test(ln)) hits.push(i + 1);
        re.lastIndex = 0;
      });
      if (hits.length) {
        warnings.push(`${msg} @ lines ${hits.slice(0, 6).join(",")}${hits.length > 6 ? "…" : ""}`);
      }
    }
  };

  scanPatterns(FORBIDDEN_PATTERNS);
  scanPatterns(PLACEHOLDER_PATTERNS);

  let depth = 0;
  lines.forEach((ln, i) => {
    const before = depth;
    depth += (ln.match(/\{/g) ?? []).length - (ln.match(/\}/g) ?? []).length;
    if (before > 0 && /^\s*struct\s+\w/.test(ln)) {
      warnings.push(`struct declared inside a block @ line ${i + 1}`);
    }
  });

  return { label, warnings, ok: warnings.length === 0 };
}

export function lintExpertAdvisor(code: string, options: Mql5LintOptions = {}): Mql5LintResult {
  const base = lintMql5(code, options);
  const warnings = [...base.warnings];

  for (const [re, msg] of EA_REQUIRED_MARKERS) {
    if (!re.test(code)) warnings.push(`EA missing ${msg}`);
  }

  if (/RegisterEvent\s*\(/.test(code)) {
    for (const [re, msg] of FLOW_EA_MARKERS) {
      if (!re.test(code)) warnings.push(`flow EA missing ${msg}`);
    }
  }

  if (/B4_DebugMark\s*\(/.test(code) && !/\bvoid\s+B4_DebugMark\s*\(/.test(code)) {
    warnings.push("B4_DebugMark called but not defined (flow EMA embed needs stub)");
  }

  return { label: base.label, warnings, ok: warnings.length === 0 };
}

export function formatLintFailures(results: Mql5LintResult[]): string {
  return results
    .filter((r) => !r.ok)
    .map((r) => `${r.label}:\n${r.warnings.map((w) => `  - ${w}`).join("\n")}`)
    .join("\n\n");
}
