import fs from "node:fs";

const src = fs.readFileSync("netlify/functions/gen-4brain-ai.mts", "utf8");

function sliceFunction(name) {
  const re = new RegExp(`(?:export )?function ${name}\\([\\s\\S]*?\\n\\}`, "m");
  const match = src.match(re);
  if (!match) throw new Error(`Missing function ${name}`);
  return match[0].replace(/^function /, "export function ");
}

const helpers = [
  "numFrom",
  "extractEmaPeriods",
  "extractEmaRetestTarget",
  "emaRetestCondition",
  "emaRetestLabel",
  "extractRetestTolerancePoints",
  "extractIfvgEntryEvent",
  "buildEmaIfvgSemantics",
  "extractSingleTimeframe",
  "shouldRepeatEmaCtcAfterConfirmation",
]
  .map((name) => {
    const re = new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`, "m");
    const match = src.match(re);
    if (!match) throw new Error(`Missing helper ${name}`);
    return match[0];
  })
  .join("\n\n");

const header = `/**
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

${helpers}

${sliceFunction("isEmaTestThenIfvgFormation")}

${sliceFunction("isEmaCrossTestClose")}

`;

function sliceBuilder(name) {
  const start = src.indexOf(`export function ${name}`);
  if (start < 0) throw new Error(`Missing builder ${name}`);
  let depth = 0;
  let i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        return src.slice(start, i + 1).replace(
          /  applyBuiltinFilters\(response, text(?:, filterRefs)?\);\n  response\.validation = validateWiringAgainstSemantics\(response\);\n  return response;/,
          "  return response",
        );
      }
    }
  }
  throw new Error(`Unclosed builder ${name}`);
}

const footer = `
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
`;

const body = `${sliceBuilder("buildEmaTestThenIfvgFormationWiring")}\n\n${sliceBuilder("buildEmaCrossTestCloseWiring")}`;

fs.writeFileSync("src/lib/blessed-ema-adapters.ts", header + body + footer);
console.log("ok");
