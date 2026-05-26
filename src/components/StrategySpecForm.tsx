import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, X, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { StrategyBlueprint, NormalizedRule } from "@/types/blueprint";
import { TIMEFRAMES } from "@/types/blueprint";

type Props = {
  blueprint: StrategyBlueprint;
  onChange: (next: StrategyBlueprint) => void;
};

function NumField({
  label,
  value,
  onChange,
  step = 1,
  min,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        value={value}
        step={step}
        min={min}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function TFSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
      >
        {TIMEFRAMES.map((tf) => (
          <option key={tf} value={tf}>
            {tf}
          </option>
        ))}
      </select>
    </div>
  );
}

function RuleEditor({
  rules,
  onChange,
}: {
  rules: NormalizedRule[];
  onChange: (next: NormalizedRule[]) => void;
}) {
  const addRule = () => {
    const newRule: NormalizedRule = {
      id: `rule_${Date.now()}`,
      type: "custom",
      side: "both",
      label: "",
      parameters: {},
      compilable: false,
    };
    onChange([...rules, newRule]);
  };

  const updateRule = (i: number, patch: Partial<NormalizedRule>) => {
    const next = [...rules];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };

  const removeRule = (i: number) => onChange(rules.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Rules ({rules.length})</Label>
        <Button type="button" size="sm" variant="ghost" onClick={addRule}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add rule
        </Button>
      </div>

      {rules.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          No rules extracted yet. Describe your strategy to auto-generate rules.
        </p>
      )}

      <div className="space-y-3">
        {rules.map((rule, i) => (
          <div key={rule.id} className="rounded-md border border-border bg-card p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={rule.compilable ? "default" : "secondary"} className="text-[10px]">
                  {rule.type}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {rule.side}
                </Badge>
                {rule.compilable ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                )}
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                onClick={() => removeRule(i)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>

            <Textarea
              value={rule.label}
              rows={2}
              placeholder="Rule description…"
              className="text-xs"
              onChange={(e) => updateRule(i, { label: e.target.value })}
            />

            {rule.subjectiveNote && (
              <p className="text-[11px] text-amber-400/80 flex items-start gap-1">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                {rule.subjectiveNote}
              </p>
            )}

            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">Side:</span>
              {(["buy", "sell", "both", "filter"] as const).map((s) => (
                <label key={s} className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name={`side-${rule.id}`}
                    checked={rule.side === s}
                    onChange={() => updateRule(i, { side: s })}
                  />
                  {s}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StrategySpecForm({ blueprint, onChange }: Props) {
  const set = <K extends keyof StrategyBlueprint>(k: K, v: StrategyBlueprint[K]) =>
    onChange({ ...blueprint, [k]: v });

  const setRisk = <K extends keyof StrategyBlueprint["risk"]>(
    k: K,
    v: StrategyBlueprint["risk"][K],
  ) => onChange({ ...blueprint, risk: { ...blueprint.risk, [k]: v } });

  const setExec = <K extends keyof StrategyBlueprint["execution"]>(
    k: K,
    v: StrategyBlueprint["execution"][K],
  ) => onChange({ ...blueprint, execution: { ...blueprint.execution, [k]: v } });

  return (
    <div className="space-y-8">
      {/* Identity */}
      <section className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Identity
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs">Strategy Name</Label>
            <Input value={blueprint.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          {blueprint.marketPhilosophy && (
            <div className="md:col-span-2 text-xs text-muted-foreground italic border-l-2 border-border pl-3">
              {blueprint.marketPhilosophy}
            </div>
          )}
        </div>
      </section>

      {/* Execution */}
      <section className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Execution
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Symbol</Label>
            <Input
              value={blueprint.execution.symbol}
              onChange={(e) => setExec("symbol", e.target.value.toUpperCase())}
            />
          </div>
          <TFSelect
            label="Setup Timeframe"
            value={blueprint.execution.setupTimeframe}
            onChange={(v) => setExec("setupTimeframe", v)}
          />
          <TFSelect
            label="Entry Timeframe"
            value={blueprint.execution.entryTimeframe}
            onChange={(v) => setExec("entryTimeframe", v)}
          />
          <NumField
            label="Spread Filter (points)"
            value={blueprint.execution.spreadFilterPoints}
            min={0}
            onChange={(n) => setExec("spreadFilterPoints", n)}
          />
          <NumField
            label="Setup Expiry (bars)"
            value={blueprint.execution.setupExpiryBars}
            min={1}
            onChange={(n) => setExec("setupExpiryBars", n)}
          />
          <NumField
            label="Magic Number"
            value={blueprint.execution.magicNumber}
            min={1}
            onChange={(n) => setExec("magicNumber", n)}
          />
        </div>
      </section>

      {/* Risk */}
      <section className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Risk Management
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <NumField
            label="Risk per trade (%)"
            value={blueprint.risk.riskPercent}
            step={0.1}
            min={0.01}
            onChange={(n) => setRisk("riskPercent", n)}
          />
          <NumField
            label="Reward : Risk"
            value={blueprint.risk.rewardRisk}
            step={0.1}
            min={0.1}
            onChange={(n) => setRisk("rewardRisk", n)}
          />
          <NumField
            label="Stop Buffer (points)"
            value={blueprint.risk.stopBufferPoints}
            min={0}
            onChange={(n) => setRisk("stopBufferPoints", n)}
          />
          <NumField
            label="Max Open Trades"
            value={blueprint.risk.maxOpenTrades}
            min={1}
            onChange={(n) => setRisk("maxOpenTrades", n)}
          />
          <div className="space-y-2">
            <Label className="text-xs">Trade management</Label>
            <div className="flex flex-col gap-1.5 text-xs">
              {(
                [
                  ["trailingStop", "Trailing stop"],
                  ["breakevenEnabled", "Move to breakeven"],
                  ["partialClose", "Partial close"],
                ] as const
              ).map(([field, label]) => (
                <label key={field} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!blueprint.risk[field]}
                    onChange={(e) => setRisk(field, e.target.checked)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Rules */}
      <section className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Strategy Rules
        </h3>
        <RuleEditor rules={blueprint.rules} onChange={(rules) => set("rules", rules)} />
      </section>

      {/* Clarifications */}
      {blueprint.pendingClarifications.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-400">
            Clarifications needed
          </h3>
          <ul className="space-y-1.5">
            {blueprint.pendingClarifications.map((q, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                {q}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Re-describe your strategy with these details to improve the generated code.
          </p>
        </section>
      )}
    </div>
  );
}
