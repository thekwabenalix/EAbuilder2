/**
 * Built-in indicator picker wiring checks.
 */
import {
  createFilterRefFromPicker,
  INDICATOR_PICKER_OPTIONS,
  mergeFilterRef,
  pickerOptionsForCategory,
} from "../src/lib/builtin-indicator-ui";

function assertOk(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

console.log("\nBuilt-in indicator picker tests\n");

assertOk(pickerOptionsForCategory("oscillator").some((o) => o.id === "macd_filter"), "MACD in oscillator");
assertOk(pickerOptionsForCategory("trend").some((o) => o.id === "ema_module"), "EMA in trend");

const macdOpt = INDICATOR_PICKER_OPTIONS.find((o) => o.id === "macd_filter")!;
const ref = createFilterRefFromPicker(macdOpt, "H1", "execution");
assertOk(ref?.id === "macd_histogram_filter", "MACD filter ref");
assertOk(ref?.timeframe === "H1", "MACD filter TF");

const merged = mergeFilterRef([], ref!);
assertOk(merged.length === 1, "merge filter ref");

console.log("\n4 built-in indicator picker checks passed.\n");
