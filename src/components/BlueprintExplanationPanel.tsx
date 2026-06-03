import type { StrategyBlueprint } from "@/types/blueprint";
import { blueprintContractErrors, explainBlueprintExtraction } from "@/lib/blueprint-explanation";

export function BlueprintExplanationPanel({ blueprint }: { blueprint: StrategyBlueprint }) {
  const explanation = explainBlueprintExtraction(blueprint);
  const contractErrors = blueprintContractErrors(blueprint);
  if (
    explanation.brains.length === 0 &&
    explanation.indicators.length === 0 &&
    explanation.filters.length === 0 &&
    explanation.contract.length === 0 &&
    explanation.audit.length === 0
  ) {
    return null;
  }

  const statusTone = {
    ok: "border-emerald-500/30 text-emerald-300 bg-emerald-500/10",
    warn: "border-amber-500/30 text-amber-300 bg-amber-500/10",
    blocked: "border-destructive/30 text-destructive bg-destructive/10",
  } as const;

  return (
    <div className="rounded border border-border bg-background/35 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Blueprint Extraction
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{explanation.summary}</p>
        </div>
        {explanation.blockedModules.length > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/30 text-amber-300 bg-amber-500/10">
            review modules
          </span>
        )}
      </div>

      {contractErrors.length > 0 && (
        <div className="rounded border border-destructive/35 bg-destructive/10 p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-destructive">Generation Blocked</p>
          <div className="mt-1.5 space-y-1">
            {contractErrors.map((error) => (
              <p key={error} className="text-[11px] text-destructive/90">
                {error}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {explanation.brains.map((brain) => (
          <div key={brain.role} className="rounded border border-border/70 bg-card/40 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium">{brain.role}</p>
              <p className="text-[11px] font-mono text-muted-foreground">{brain.timeframe}</p>
            </div>
            <p className="text-[11px] text-primary mt-1">{brain.modules}</p>
            {brain.params.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {brain.params.map((item) => (
                  <span
                    key={`${brain.role}-${item.label}`}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted/30 text-muted-foreground"
                    title={`source: ${item.source}`}
                  >
                    {item.label}: {item.value}
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {brain.admission.map((item) => (
                <span
                  key={`${brain.role}-${item.label}-${item.value}`}
                  className={`text-[10px] px-1.5 py-0.5 rounded border ${statusTone[item.status]}`}
                >
                  {item.label}: {item.value}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        {explanation.management.map((item) => (
          <div key={item.label} className="rounded border border-border bg-muted/20 px-2 py-1.5">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{item.label}</p>
            <p className="text-[11px] font-medium">{item.value}</p>
          </div>
        ))}
      </div>

      {explanation.indicators.length > 0 && (
        <div className="rounded border border-sky-500/25 bg-sky-500/5 p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-sky-300">
            Built-in MT5 Indicators
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Recognized as MT5 primitives. They are referenceable by generator logic, but are not
            treated as 4-Brain modules unless wrapped by a verified contract.
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {explanation.indicators.map((item) => (
              <span
                key={`${item.label}-${item.value}`}
                className="text-[10px] px-1.5 py-0.5 rounded border border-sky-500/30 bg-sky-500/10 text-sky-300"
              >
                {item.label}: {item.value}
              </span>
            ))}
          </div>
        </div>
      )}

      {explanation.filters.length > 0 && (
        <div className="rounded border border-emerald-500/25 bg-emerald-500/5 p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-emerald-300">
            Verified Built-in Filters
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Recognized as safe filter contracts. They gate existing setup or execution logic and are
            not treated as standalone 4-Brain modules.
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {explanation.filters.map((item) => (
              <span
                key={`${item.label}-${item.value}`}
                className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              >
                {item.label}: {item.value}
              </span>
            ))}
          </div>
        </div>
      )}

      {explanation.contract.length > 0 && (
        <div className="rounded border border-violet-500/25 bg-violet-500/5 p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-violet-300">Strategy Contract</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Structured rules the generator must preserve before it can build the EA.
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {explanation.contract.map((item) => (
              <span
                key={`${item.label}-${item.value}`}
                className="text-[10px] px-1.5 py-0.5 rounded border border-violet-500/30 bg-violet-500/10 text-violet-300"
              >
                {item.label}: {item.value}
              </span>
            ))}
          </div>
        </div>
      )}

      {explanation.audit.length > 0 && (
        <div className="rounded border border-cyan-500/25 bg-cyan-500/5 p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-cyan-300">Blueprint Audit</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Deterministic checks that preserve exact trader intent before EA generation.
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {explanation.audit.map((item) => (
              <span
                key={`${item.label}-${item.value}`}
                className={`text-[10px] px-1.5 py-0.5 rounded border ${statusTone[item.status]}`}
              >
                {item.value}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
