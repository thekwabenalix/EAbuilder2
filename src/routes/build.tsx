import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowRight, Zap, CheckCircle2, Plus, X, ChevronDown, ChevronUp,
  Loader2, Brain, Target, Crosshair, Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { createStrategy } from "@/lib/strategies";
import type { FourBrainConfig, BrainConfig, BrainModuleType } from "@/types/blueprint";
import type { StrategyBlueprint } from "@/types/blueprint";
import { DEFAULT_BLUEPRINT } from "@/types/blueprint";

export const Route = createFileRoute("/build")({
  component: FourBrainBuilderPage,
});

// ─── Module definitions ────────────────────────────────────────────────────────

type BrainRole = "direction" | "setup" | "execution";

interface ModuleDef {
  id: BrainModuleType;
  label: string;
  desc: string;
  symbol: string;   // visual glyph
  color: string;    // tailwind text color
}

const MODULES: Record<BrainRole, ModuleDef[]> = {
  direction: [
    { id: "choch",  label: "CHoCH",      desc: "Change of Character — reversal bias",      symbol: "↺", color: "text-violet-400" },
    { id: "bos",    label: "BOS",         desc: "Break of Structure — continuation bias",   symbol: "⟶", color: "text-blue-400"   },
    { id: "ema",    label: "EMA Trend",   desc: "Fast/slow EMA crossover for trend bias",   symbol: "∿", color: "text-cyan-400"   },
  ],
  setup: [
    { id: "order_block", label: "Order Block", desc: "Last opposing candle before displacement", symbol: "▣", color: "text-amber-400"  },
    { id: "fvg",         label: "Fair Value Gap", desc: "3-candle imbalance zone",              symbol: "◫", color: "text-emerald-400" },
    { id: "snr",         label: "S / R Level",    desc: "Classic horizontal support/resistance", symbol: "─", color: "text-sky-400"    },
  ],
  execution: [
    { id: "fvg",       label: "FVG Retest",   desc: "Enter after gap fills and rejects",         symbol: "◫", color: "text-emerald-400" },
    { id: "order_block", label: "OB Retest",  desc: "Enter after OB zone confirms",              symbol: "▣", color: "text-amber-400"  },
    { id: "liqsweep",  label: "Liq Sweep",    desc: "Enter after stop hunt + close-back",        symbol: "⚡", color: "text-yellow-400" },
    { id: "engulfing", label: "Engulfing",     desc: "Strong reversal candle pattern",           symbol: "◑", color: "text-pink-400"   },
    { id: "pin_bar",   label: "Pin Bar",       desc: "Long wick rejection candle",               symbol: "⌇", color: "text-rose-400"   },
  ],
};

const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN"];

// ─── Presets ──────────────────────────────────────────────────────────────────

interface Preset {
  name: string;
  tag: string;
  description: string;
  direction?: { module: BrainModuleType; timeframe: string };
  setup?:     { module: BrainModuleType; timeframe: string };
  execution:  { module: BrainModuleType; timeframe: string };
  rr: number; risk: number; be: boolean;
}

const PRESETS: Preset[] = [
  {
    name: "Classic ICT",
    tag: "Most popular",
    description: "D1 structure → H4 order block → M15 FVG",
    direction: { module: "choch",       timeframe: "D1"  },
    setup:     { module: "order_block", timeframe: "H4"  },
    execution: { module: "fvg",         timeframe: "M15" },
    rr: 2, risk: 1, be: true,
  },
  {
    name: "Sweep & Fill",
    tag: "Aggressive",
    description: "H4 BOS → H1 FVG setup → M5 liquidity sweep entry",
    direction: { module: "bos",         timeframe: "H4"  },
    setup:     { module: "fvg",         timeframe: "H1"  },
    execution: { module: "liqsweep",    timeframe: "M5"  },
    rr: 3, risk: 1, be: true,
  },
  {
    name: "Trend Rider",
    tag: "Long-term",
    description: "W1 BOS direction → D1 order block → H4 FVG entry",
    direction: { module: "bos",         timeframe: "W1"  },
    setup:     { module: "order_block", timeframe: "D1"  },
    execution: { module: "fvg",         timeframe: "H4"  },
    rr: 3, risk: 0.5, be: true,
  },
  {
    name: "Execution Only",
    tag: "Scalp",
    description: "No bias filter — H1 FVG retest entry, both directions",
    direction: undefined,
    setup:     undefined,
    execution: { module: "fvg",         timeframe: "H1"  },
    rr: 2, risk: 1, be: false,
  },
];

// ─── Brain config state ───────────────────────────────────────────────────────

interface BrainState extends BrainConfig {
  hint?: string;  // user's optional description
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TimeframePicker({ value, onChange, recommendAbove, recommendBelow }: {
  value: string;
  onChange: (tf: string) => void;
  recommendAbove?: string;
  recommendBelow?: string;
}) {
  const aboveIdx = recommendAbove ? TIMEFRAMES.indexOf(recommendAbove) : -1;
  const belowIdx = recommendBelow ? TIMEFRAMES.indexOf(recommendBelow) : 99;

  return (
    <div className="flex flex-wrap gap-1.5">
      {TIMEFRAMES.map((tf, idx) => {
        const active  = value === tf;
        const warn    = (aboveIdx >= 0 && idx <= aboveIdx) || idx >= belowIdx;
        return (
          <button
            key={tf}
            onClick={() => onChange(tf)}
            className={[
              "px-2.5 py-1 rounded text-xs font-mono font-medium transition-all border",
              active
                ? "bg-primary text-primary-foreground border-primary"
                : warn
                ? "border-amber-500/40 text-amber-400/70 hover:border-amber-500 hover:text-amber-300 bg-amber-500/5"
                : "border-border text-muted-foreground hover:border-primary/60 hover:text-primary",
            ].join(" ")}
          >
            {tf}
          </button>
        );
      })}
    </div>
  );
}

function ModuleCard({ def, selected, onClick }: {
  def: ModuleDef;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "relative flex flex-col items-start gap-1.5 p-3 rounded-lg border text-left transition-all",
        selected
          ? "border-primary bg-primary/10 shadow-[0_0_0_1px] shadow-primary/30"
          : "border-border hover:border-primary/40 hover:bg-muted/30",
      ].join(" ")}
    >
      {selected && (
        <CheckCircle2 className="absolute top-2 right-2 h-3.5 w-3.5 text-primary" />
      )}
      <span className={`text-xl leading-none ${def.color}`}>{def.symbol}</span>
      <span className="text-xs font-semibold text-foreground">{def.label}</span>
      <span className="text-[10px] text-muted-foreground leading-tight">{def.desc}</span>
    </button>
  );
}

function BrainCard({
  role, icon: Icon, title, color,
  state, onChange, onClear,
  optional, recommendAbove, recommendBelow,
}: {
  role: BrainRole;
  icon: React.ElementType;
  title: string;
  color: string;
  state: BrainState | undefined;
  onChange: (s: BrainState) => void;
  onClear: () => void;
  optional: boolean;
  recommendAbove?: string;
  recommendBelow?: string;
}) {
  const [open, setOpen] = useState(false);
  const modules = MODULES[role];
  const configured = Boolean(state?.module && state?.timeframe);

  const selectedMod = state?.module
    ? modules.find((m) => m.id === state.module)
    : undefined;

  return (
    <div
      className={[
        "flex-1 min-w-0 rounded-xl border transition-all",
        configured
          ? "border-primary/40 bg-card"
          : "border-border bg-card/60",
        open ? "ring-1 ring-primary/20" : "",
      ].join(" ")}
    >
      {/* Header */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className={`p-1.5 rounded-lg ${color} bg-current/10`}>
          <Icon className={`h-4 w-4 ${color.replace("bg-", "text-")}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{title}</span>
            {optional && !configured && (
              <span className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
                optional
              </span>
            )}
          </div>
          {configured && selectedMod ? (
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-xs font-medium ${selectedMod.color}`}>
                {selectedMod.symbol} {selectedMod.label}
              </span>
              <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                {state!.timeframe}
              </span>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {optional ? "Skip or click to configure" : "Click to configure — required"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {configured && (
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          )}
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expanded config */}
      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-4">
          {/* Module grid */}
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Module
            </p>
            <div className="grid grid-cols-2 gap-2">
              {modules.map((mod) => (
                <ModuleCard
                  key={mod.id}
                  def={mod}
                  selected={state?.module === mod.id}
                  onClick={() =>
                    onChange({
                      ...(state ?? { module: mod.id, timeframe: "H1" }),
                      module: mod.id,
                    })
                  }
                />
              ))}
            </div>
          </div>

          {/* Timeframe */}
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Timeframe
            </p>
            <TimeframePicker
              value={state?.timeframe ?? ""}
              onChange={(tf) =>
                onChange({
                  ...(state ?? { module: modules[0].id, timeframe: tf }),
                  timeframe: tf,
                })
              }
              recommendAbove={recommendAbove}
              recommendBelow={recommendBelow}
            />
          </div>

          {/* Optional hint */}
          <details className="group">
            <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors list-none flex items-center gap-1.5">
              <Plus className="h-3 w-3" />
              Describe further (optional — AI refines params)
            </summary>
            <Textarea
              className="mt-2 text-xs font-mono resize-none h-16"
              placeholder={`e.g. "use 5-bar pivots, lookback 30 bars, only first break each day"`}
              value={state?.hint ?? ""}
              onChange={(e) =>
                onChange({ ...(state as BrainState), hint: e.target.value })
              }
            />
          </details>

          {/* Actions */}
          <div className="flex justify-between items-center pt-1">
            {optional && (
              <button
                onClick={() => { onClear(); setOpen(false); }}
                className="text-[11px] text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1"
              >
                <X className="h-3 w-3" /> Skip this brain
              </button>
            )}
            <div className="flex-1" />
            <button
              onClick={() => setOpen(false)}
              className="text-[11px] text-primary hover:text-primary/80 font-medium"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Arrow({ active }: { active: boolean }) {
  return (
    <div className="flex items-center justify-center shrink-0 w-8 pt-4">
      <ArrowRight
        className={`h-5 w-5 transition-colors ${active ? "text-primary" : "text-border"}`}
      />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function FourBrainBuilderPage() {
  const { user } = useAuth();
  const navigate  = useNavigate();

  // Brain states
  const [direction, setDirection] = useState<BrainState | undefined>(undefined);
  const [setup,     setSetup]     = useState<BrainState | undefined>(undefined);
  const [execution, setExecution] = useState<BrainState | undefined>(undefined);

  // Management
  const [risk,       setRisk]       = useState(1.0);
  const [rr,         setRr]         = useState(2.0);
  const [be,         setBe]         = useState(true);
  const [beAt,       setBeAt]       = useState(1.0);
  const [maxTrades,  setMaxTrades]  = useState(1);
  const [stopBuffer, setStopBuffer] = useState(20);

  const [saving, setSaving] = useState(false);

  // ── Preset application ────────────────────────────────────────────────────
  function applyPreset(p: Preset) {
    setDirection(p.direction ? { ...p.direction } : undefined);
    setSetup(p.setup         ? { ...p.setup }     : undefined);
    setExecution({ ...p.execution });
    setRr(p.rr);
    setRisk(p.risk);
    setBe(p.be);
  }

  // ── Live summary ──────────────────────────────────────────────────────────
  function summary() {
    const parts: string[] = [];
    if (direction?.module && direction.timeframe)
      parts.push(`${direction.timeframe} ${direction.module.toUpperCase().replace("_", " ")}`);
    if (setup?.module && setup.timeframe)
      parts.push(`${setup.timeframe} ${setup.module.toUpperCase().replace("_", " ")}`);
    if (execution?.module && execution.timeframe)
      parts.push(`${execution.timeframe} ${execution.module.toUpperCase().replace("_", " ")}`);
    const chain  = parts.join(" → ");
    const mgmt   = `${risk}% risk · ${rr}R TP${be ? ` · BE@${beAt}R` : ""}`;
    return chain ? `${chain} | ${mgmt}` : mgmt;
  }

  // ── Generate ──────────────────────────────────────────────────────────────
  async function onGenerate() {
    if (!user) return;
    if (!execution?.module || !execution.timeframe) {
      toast.error("Execution Brain is required — select a module and timeframe.");
      return;
    }

    const fourBrain: FourBrainConfig = {
      direction: direction?.module && direction.timeframe
        ? { module: direction.module, timeframe: direction.timeframe, params: {} }
        : undefined,
      setup: setup?.module && setup.timeframe
        ? { module: setup.module, timeframe: setup.timeframe, params: {} }
        : undefined,
      execution: {
        module: execution.module,
        timeframe: execution.timeframe,
        params: { expiry: 50 },
      },
    };

    const bp: StrategyBlueprint = {
      ...DEFAULT_BLUEPRINT,
      name: buildName(fourBrain),
      fourBrain,
      risk: {
        ...DEFAULT_BLUEPRINT.risk,
        riskPercent: risk,
        rewardRisk: rr,
        breakevenEnabled: be,
        maxOpenTrades: maxTrades,
        stopBufferPoints: stopBuffer,
      },
    };

    setSaving(true);
    try {
      const row = await createStrategy({
        userId: user.id,
        name: bp.name,
        prompt: summary(),
        blueprint: bp,
        generatedCode: "",
      });
      toast.success("4-Brain strategy created — generate the EA on the Code tab");
      navigate({ to: "/s/$id", params: { id: row.id } });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to create strategy");
    } finally {
      setSaving(false);
    }
  }

  function buildName(cfg: FourBrainConfig): string {
    const parts: string[] = [];
    if (cfg.direction) parts.push(`${cfg.direction.timeframe} ${cfg.direction.module.replace("_", " ").toUpperCase()}`);
    if (cfg.setup)     parts.push(`${cfg.setup.timeframe} ${cfg.setup.module.replace("_", " ").toUpperCase()}`);
    parts.push(`${cfg.execution.timeframe} ${cfg.execution.module.replace("_", " ").toUpperCase()}`);
    return parts.join(" → ");
  }

  const execConfigured = Boolean(execution?.module && execution.timeframe);

  return (
    <div className="min-h-screen flex flex-col">
      <PageHeader
        title="4-Brain Strategy Builder"
        subtitle="Visual multi-timeframe EA builder — Direction · Setup · Execution · Management"
      />

      <div className="flex-1 p-6 space-y-6 max-w-7xl mx-auto w-full">

        {/* ── Presets ── */}
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-3">
            Quick start — presets
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => applyPreset(p)}
                className="group flex flex-col gap-1.5 rounded-lg border border-border hover:border-primary/50 bg-card hover:bg-muted/20 p-3 text-left transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold group-hover:text-primary transition-colors">
                    {p.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
                    {p.tag}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  {p.description}
                </p>
                <div className="flex items-center gap-1 mt-1 text-[10px] font-mono text-muted-foreground/60">
                  <span>{p.rr}R</span>
                  <span>·</span>
                  <span>{p.risk}%</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Brain flow ── */}
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-3">
            Configure each brain
          </p>
          <div className="flex items-stretch gap-0">
            <BrainCard
              role="direction"
              icon={Brain}
              title="Direction Brain"
              color="bg-violet-500"
              state={direction}
              onChange={setDirection}
              onClear={() => setDirection(undefined)}
              optional
              recommendBelow={setup?.timeframe ?? execution?.timeframe}
            />
            <Arrow active={Boolean(direction?.module)} />
            <BrainCard
              role="setup"
              icon={Target}
              title="Setup Brain"
              color="bg-amber-500"
              state={setup}
              onChange={setSetup}
              onClear={() => setSetup(undefined)}
              optional
              recommendAbove={direction?.timeframe}
              recommendBelow={execution?.timeframe}
            />
            <Arrow active={Boolean(setup?.module)} />
            <BrainCard
              role="execution"
              icon={Crosshair}
              title="Execution Brain"
              color="bg-emerald-500"
              state={execution}
              onChange={setExecution}
              onClear={() => {}}
              optional={false}
              recommendAbove={setup?.timeframe ?? direction?.timeframe}
            />
          </div>
        </div>

        {/* ── Management Brain ── */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-1.5 rounded-lg bg-sky-500/10">
              <Settings2 className="h-4 w-4 text-sky-400" />
            </div>
            <span className="text-sm font-semibold">Management Brain</span>
            <span className="text-[10px] text-muted-foreground">risk · exits · limits</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-5">
            {/* Risk */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Risk per trade</Label>
                <span className="text-xs font-mono text-primary">{risk.toFixed(1)}%</span>
              </div>
              <Slider
                min={0.1} max={5} step={0.1}
                value={[risk]}
                onValueChange={([v]) => setRisk(v)}
              />
            </div>

            {/* R:R */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Reward : Risk</Label>
                <span className="text-xs font-mono text-primary">{rr.toFixed(1)}R</span>
              </div>
              <Slider
                min={0.5} max={10} step={0.5}
                value={[rr]}
                onValueChange={([v]) => setRr(v)}
              />
            </div>

            {/* Stop buffer */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Stop buffer</Label>
                <span className="text-xs font-mono text-primary">{stopBuffer} pts</span>
              </div>
              <Slider
                min={5} max={100} step={5}
                value={[stopBuffer]}
                onValueChange={([v]) => setStopBuffer(v)}
              />
            </div>

            {/* Break-even */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Break-even</Label>
                <Switch checked={be} onCheckedChange={setBe} />
              </div>
              {be && (
                <div className="flex justify-between items-center">
                  <span className="text-[11px] text-muted-foreground">Move SL to B/E at</span>
                  <div className="flex items-center gap-2">
                    <Slider
                      min={0.25} max={3} step={0.25}
                      value={[beAt]}
                      onValueChange={([v]) => setBeAt(v)}
                      className="w-24"
                    />
                    <span className="text-xs font-mono text-primary w-8">{beAt}R</span>
                  </div>
                </div>
              )}
            </div>

            {/* Max trades */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Max open trades</Label>
                <span className="text-xs font-mono text-primary">{maxTrades}</span>
              </div>
              <Slider
                min={1} max={10} step={1}
                value={[maxTrades]}
                onValueChange={([v]) => setMaxTrades(v)}
              />
            </div>
          </div>
        </div>

        {/* ── Summary + Generate ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-border bg-card/50 px-5 py-4">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
              Strategy summary
            </p>
            <p className="text-sm font-mono text-foreground truncate">
              {summary()}
            </p>
          </div>
          <Button
            size="lg"
            disabled={!execConfigured || saving}
            onClick={onGenerate}
            className="shrink-0 gap-2"
          >
            {saving ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
            ) : (
              <><Zap className="h-4 w-4" /> Build EA</>
            )}
          </Button>
        </div>

        {!execConfigured && (
          <p className="text-xs text-amber-400 text-center">
            Configure the Execution Brain to enable EA generation.
          </p>
        )}
      </div>
    </div>
  );
}
