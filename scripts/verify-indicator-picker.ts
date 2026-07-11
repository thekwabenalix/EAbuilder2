/**
 * Built-in indicator picker wiring checks.
 */
import {
  createFilterRefFromPicker,
  INDICATOR_PICKER_OPTIONS,
  mergeFilterRef,
  pickerOptionsForCategory,
} from "../src/lib/builtin-indicator-ui";
import { emitAssemblerFilterSnippet } from "../src/generators/gen-builtin-filters";
import { INDICATOR_REGISTRY } from "../src/lib/indicator-registry";
import { MT5_BUFFER_FILTER_ID } from "../src/lib/mt5-buffer-filter";

function assertOk(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

console.log("\nBuilt-in indicator picker tests\n");

assertOk(
  pickerOptionsForCategory("oscillator").some((o) => o.id === "macd_filter"),
  "MACD in oscillator",
);
assertOk(
  pickerOptionsForCategory("trend").some((o) => o.id === "ema_module"),
  "EMA in trend",
);

const macdOpt = INDICATOR_PICKER_OPTIONS.find((o) => o.id === "macd_filter")!;
const ref = createFilterRefFromPicker(macdOpt, "H1", "execution");
assertOk(ref?.id === "macd_histogram_filter", "MACD filter ref");
assertOk(ref?.timeframe === "H1", "MACD filter TF");

const merged = mergeFilterRef([], ref!);
assertOk(merged.length === 1, "merge filter ref");

const builtinCount = INDICATOR_REGISTRY.filter((i) => i.via === "builtin").length;
const mt5Opts = INDICATOR_PICKER_OPTIONS.filter((o) => o.filterContractId === MT5_BUFFER_FILTER_ID);
assertOk(mt5Opts.length >= 20, `expected many MT5 builtin filters, got ${mt5Opts.length}`);
assertOk(
  pickerOptionsForCategory("trend").some((o) => o.id === "mt5_dema" || o.catalogIndicatorId === "dema"),
  "DEMA available as MT5 builtin",
);
assertOk(
  pickerOptionsForCategory("trend").some((o) => o.catalogIndicatorId === "adx"),
  "ADX available as MT5 builtin",
);

const stoch = INDICATOR_PICKER_OPTIONS.find((o) => o.catalogIndicatorId === "stochastic")!;
const stochRef = createFilterRefFromPicker(stoch, "M15", "execution");
assertOk(stochRef?.id === MT5_BUFFER_FILTER_ID, "stochastic is mt5_buffer_filter");
const snip = emitAssemblerFilterSnippet(stochRef!, 0);
assertOk(snip.includes("iStochastic"), "stochastic emits iStochastic");
assertOk(snip.includes("B4_Buf"), "stochastic reads via B4_Buf");

assertOk(builtinCount >= 25, `registry has ${builtinCount} native builtins`);

console.log(`\n${6 + 5} built-in indicator picker checks passed (MT5 catalog wired).\n`);
