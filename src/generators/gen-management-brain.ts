/**
 * Management Brain Generator
 *
 * NOTE: Risk/exit settings are now emitted directly by gen-ea.ts as inputs
 * and inline OnTick logic. This file is kept for future extension (e.g.
 * generating trailing-stop or partial-close code blocks).
 *
 * Currently a no-op — returns an empty string.
 */

import type { ManagementBrainConfig } from "@/types/blueprint";

export function genManagementBrain(
  _config: ManagementBrainConfig | undefined
): string {
  // Management logic (break-even, trailing stop) is inlined by gen-ea.ts.
  return "";
}
