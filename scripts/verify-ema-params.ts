import {
  emaModeFromPeriods,
  emaParamsForBlueprint,
  emaPeriodsFromText,
  normalizeEmaParams,
  sanitizeEmaPeriods,
} from "../src/lib/ema-params";

function assertOk(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

console.log("\nEMA params normalization tests\n");

assertOk(emaModeFromPeriods([50]) === "single", "single mode");
assertOk(emaModeFromPeriods([12, 48]) === "dual", "dual mode");
assertOk(emaModeFromPeriods([9, 21, 50, 200]) === "multi", "multi mode");

const single = normalizeEmaParams({ emaPeriods: [50] });
assertOk(single.mode === "single" && single.periods.length === 1, "single period");
assertOk(single.requireCross === false, "single disables cross");

const dual = normalizeEmaParams({ fastPeriod: 21, slowPeriod: 50 });
assertOk(dual.mode === "dual" && dual.periods.join(",") === "21,50", "legacy dual");

const multi = normalizeEmaParams({ emaPeriods: [200, 9, 50, 21] });
assertOk(multi.periods.join(",") === "9,21,50,200", "sorted multi");

const text = normalizeEmaParams({
  emaPeriods: emaPeriodsFromText("trade the 9 ema 21 ema and 200 ema stack"),
});
assertOk(text.periods.join(",") === "9,21,200", "text extract");

const synced = emaParamsForBlueprint({ emaPeriods: [12, 48] });
assertOk(synced.fastPeriod === 12 && synced.slowPeriod === 48, "legacy sync");

assertOk(sanitizeEmaPeriods([5, 5, 9, 9, 21]).join(",") === "5,9,21", "dedupe");

console.log("\n8 EMA params checks passed.\n");
