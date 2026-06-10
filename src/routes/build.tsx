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
  ArrowRight,
  Zap,
  CheckCircle2,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  Loader2,
  Brain,
  Target,
  Crosshair,
  Settings2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { createStrategy } from "@/lib/strategies";
import { extractBrainParams } from "@/lib/api-client";
import type { FourBrainConfig, BrainConfig, BrainModuleType } from "@/types/blueprint";
import type { StrategyBlueprint } from "@/types/blueprint";
import { DEFAULT_BLUEPRINT } from "@/types/blueprint";
import { ALL_BRAIN_MODULES, TIMEFRAMES as TF_LIST } from "@/lib/brain-modules";
import type { BrainModuleDef } from "@/lib/brain-modules";
import { MODULE_UI_PARAMS } from "@/lib/module-library";
import type { UIParam } from "@/lib/module-library";
import { getModuleAdmission, MODULE_ADMISSION_STATUS_META } from "@/lib/module-admission";

export const Route = createFileRoute("/build")({
  component: FourBrainBuilderPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────
type BrainRole = "direction" | "setup" | "execution";

// Re-export from shared module list (single source of truth)
type ModuleDef = BrainModuleDef;
const ALL_MODULES = ALL_BRAIN_MODULES;
const TIMEFRAMES = [...TF_LIST];

function unsafeAiModuleLabels(modules: Array<BrainModuleType | string | undefined>): string[] {
  return [
    ...new Set(
      modules
        .filter((moduleId): moduleId is BrainModuleType | string => Boolean(moduleId))
        .map((moduleId) => moduleId.toLowerCase()),
    ),
  ]
    .map((moduleId) => {
      const admission = getModuleAdmission(moduleId);
      if (!admission || admission.status === "verified_state_machine") return null;
      const meta = MODULE_ADMISSION_STATUS_META[admission.status];
      return `${admission.label} (${meta.shortLabel})`;
    })
    .filter((label): label is string => Boolean(label));
}

// ─── Presets ──────────────────────────────────────────────────────────────────

interface Preset {
  name: string;
  tag: string;
  description: string;
  direction?: { modules: BrainModuleType[]; timeframe: string };
  setup?: { modules: BrainModuleType[]; timeframe: string };
  execution: { modules: BrainModuleType[]; timeframe: string };
  rr: number;
  risk: number;
  be: boolean;
}

const PRESETS: Preset[] = [
  {
    name: "Classic ICT",
    tag: "Most popular",
    description: "D1 structure → H4 order block → M15 FVG",
    direction: { modules: ["choch"], timeframe: "D1" },
    setup: { modules: ["order_block"], timeframe: "H4" },
    execution: { modules: ["fvg"], timeframe: "M15" },
    rr: 2,
    risk: 1,
    be: true,
  },
  {
    name: "Sweep & Fill",
    tag: "Aggressive",
    description: "H4 BOS → H1 FVG setup → M5 liquidity sweep entry",
    direction: { modules: ["bos"], timeframe: "H4" },
    setup: { modules: ["fvg"], timeframe: "H1" },
    execution: { modules: ["liqsweep"], timeframe: "M5" },
    rr: 3,
    risk: 1,
    be: true,
  },
  {
    name: "Trend Rider",
    tag: "Long-term",
    description: "W1 BOS direction → D1 order block → H4 FVG entry",
    direction: { modules: ["bos"], timeframe: "W1" },
    setup: { modules: ["order_block"], timeframe: "D1" },
    execution: { modules: ["fvg"], timeframe: "H4" },
    rr: 3,
    risk: 0.5,
    be: true,
  },
  {
    name: "Execution Only",
    tag: "Scalp",
    description: "No bias filter — H1 FVG retest entry, both directions",
    direction: undefined,
    setup: undefined,
    execution: { modules: ["fvg"], timeframe: "H1" },
    rr: 2,
    risk: 1,
    be: false,
  },
];

// ─── Brain config state ───────────────────────────────────────────────────────

interface BrainState extends BrainConfig {
  hint?: string; // user's optional description
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TimeframePicker({
  value,
  onChange,
  recommendAbove,
  recommendBelow,
}: {
  value: string;
  onChange: (tf: string) => void;
  recommendAbove?: string;
  recommendBelow?: string;
}) {
  const aboveIdx = recommendAbove
    ? TIMEFRAMES.indexOf(recommendAbove as (typeof TIMEFRAMES)[number])
    : -1;
  const belowIdx = recommendBelow
    ? TIMEFRAMES.indexOf(recommendBelow as (typeof TIMEFRAMES)[number])
    : 99;

  return (
    <div className="flex flex-wrap gap-1.5">
      {TIMEFRAMES.map((tf, idx) => {
        const active = value === tf;
        const warn = (aboveIdx >= 0 && idx <= aboveIdx) || idx >= belowIdx;
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

function ModuleMultiSelect({
  role,
  selected,
  onChange,
}: {
  role: BrainRole;
  selected: BrainModuleType[];
  onChange: (modules: BrainModuleType[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const modules = ALL_MODULES; // Show ALL modules in every brain — role is determined by timeframe, not module type
  const selectedDefs = modules.filter((m) => selected.includes(m.id));

  const toggleModule = (id: BrainModuleType) => {
    if (selected.includes(id)) {
      onChange(selected.filter((m) => m !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-border hover:border-primary/40 hover:bg-muted/20 transition-all text-left"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {selectedDefs.length === 0 ? (
            <span className="text-xs text-muted-foreground">Select modules…</span>
          ) : (
            <div className="flex items-center gap-1.5 flex-wrap">
              {selectedDefs.map((def) => (
                <span
                  key={def.id}
                  className="flex items-center gap-1 px-2 py-0.5 bg-primary/10 border border-primary/30 rounded text-[11px] font-medium text-primary"
                >
                  <span>{def.symbol}</span>
                  <span>{def.label}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 z-10 rounded-lg border border-border bg-card shadow-xl">
          <div className="max-h-64 overflow-y-auto p-2 space-y-1">
            {modules.map((def) => {
              const admission = getModuleAdmission(def.id);
              const admissionMeta = admission
                ? MODULE_ADMISSION_STATUS_META[admission.status]
                : null;
              return (
                <label
                  key={def.id}
                  className="flex items-start gap-3 p-2.5 rounded hover:bg-muted/30 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(def.id)}
                    onChange={() => toggleModule(def.id)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-lg leading-none ${def.color}`}>{def.symbol}</span>
                      <span className="text-xs font-semibold">{def.label}</span>
                      {admissionMeta && (
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${admissionMeta.tone}`}
                          title={admissionMeta.description}
                        >
                          {admissionMeta.shortLabel}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{def.desc}</p>
                    {admission && (
                      <p className="text-[9px] text-muted-foreground/60 mt-0.5 leading-tight">
                        {admission.notes}
                      </p>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── AI param extractor (per-brain) ────────────────────────────────────────────

function AIParamExtractor({
  role,
  state,
  onChange,
}: {
  role: BrainRole;
  state: BrainState | undefined;
  onChange: (s: BrainState) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractSummary, setExtractSummary] = useState<string | null>(null);

  const hasParams =
    state?.params &&
    Object.keys(state.params).filter((k) => k !== "expiry" || state.params![k] !== 50).length > 0;

  async function onExtract() {
    if (!state?.modules || state.modules.length === 0 || !state.timeframe || !hint.trim()) {
      toast.error("Select modules and timeframe first, then describe how they work together.");
      return;
    }
    setExtracting(true);
    setExtractSummary(null);
    try {
      const result = await extractBrainParams(role, state.modules, state.timeframe, hint.trim());
      onChange({ ...state, params: { ...(state.params ?? {}), ...result.params } });
      setExtractSummary(result.summary);
      toast.success("Params extracted");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Extraction failed — try again");
    } finally {
      setExtracting(false);
    }
  }

  return (
    <div className="space-y-2">
      {/* Toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <Sparkles className="h-3 w-3 text-violet-400" />
        Refine with AI
        {hasParams && (
          <span className="ml-1 text-[10px] text-emerald-400 font-medium">✓ params set</span>
        )}
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {open && (
        <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
          {/* Extracted params display */}
          {state?.params && Object.keys(state.params).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(state.params).map(([k, v]) => (
                <span
                  key={k}
                  className="text-[10px] font-mono bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full"
                >
                  {k} = {String(v)}
                </span>
              ))}
            </div>
          )}

          {/* AI summary */}
          {extractSummary && (
            <p className="text-[11px] text-emerald-400 italic">{extractSummary}</p>
          )}

          {/* Input + button */}
          <div className="flex gap-2">
            <Textarea
              className="text-xs font-mono resize-none h-14 flex-1"
              placeholder={`e.g. "use 5-bar pivots, lookback 30 bars, only first BOS of the session"`}
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onExtract();
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={onExtract}
              disabled={extracting || !hint.trim()}
              className="shrink-0 self-end gap-1.5 border-violet-500/40 text-violet-400 hover:bg-violet-500/10"
            >
              {extracting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              Extract
            </Button>
          </div>

          {/* Clear params */}
          {state?.params && Object.keys(state.params).length > 0 && (
            <button
              onClick={() => {
                onChange({ ...state, params: {} });
                setExtractSummary(null);
              }}
              className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
            >
              Clear extracted params
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function BrainCard({
  role,
  icon: Icon,
  title,
  color,
  state,
  onChange,
  onClear,
  optional,
  recommendAbove,
  recommendBelow,
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
  const modules = ALL_MODULES; // Show ALL modules in every brain
  const configured = Boolean(state?.modules?.[0] && state?.timeframe);

  const selectedMod = state?.modules?.[0]
    ? modules.find((m) => m.id === state.modules[0])
    : undefined;

  return (
    <div
      className={[
        "flex-1 min-w-0 rounded-xl border transition-all",
        configured ? "border-primary/40 bg-card" : "border-border bg-card/60",
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
          {configured && state?.modules && state.modules.length > 0 ? (
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {state.modules.map((modId) => {
                const mod = modules.find((m) => m.id === modId);
                return mod ? (
                  <span key={modId} className={`text-xs font-medium ${mod.color}`}>
                    {mod.symbol} {mod.label}
                  </span>
                ) : null;
              })}
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
          {configured && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
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
          {/* Module multi-select */}
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Modules (select one or more)
            </p>
            <ModuleMultiSelect
              role={role}
              selected={state?.modules ?? []}
              onChange={(mods) =>
                onChange({
                  ...(state ?? { modules: mods, timeframe: "H1" }),
                  modules: mods,
                })
              }
            />
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
                  ...(state ?? { modules: [], timeframe: tf }),
                  timeframe: tf,
                })
              }
              recommendAbove={recommendAbove}
              recommendBelow={recommendBelow}
            />
          </div>

          {/* Per-module parameter inputs */}
          {state?.modules &&
            state.modules.length > 0 &&
            (() => {
              const seen = new Set<string>();
              const allUiParams: UIParam[] = [];
              for (const mod of state.modules) {
                for (const p of MODULE_UI_PARAMS[mod] ?? []) {
                  if (!seen.has(p.key)) {
                    seen.add(p.key);
                    allUiParams.push(p);
                  }
                }
              }
              if (allUiParams.length === 0) return null;
              return (
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Parameters
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    {allUiParams.map((p) => {
                      const current =
                        typeof state?.params?.[p.key] === "number"
                          ? (state.params![p.key] as number)
                          : p.default;
                      return (
                        <div key={p.key} className="space-y-0.5">
                          <label className="text-[11px] text-muted-foreground">{p.label}</label>
                          <input
                            type="number"
                            min={p.min}
                            max={p.max}
                            step={p.step}
                            value={current}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v))
                                onChange({
                                  ...(state as BrainState),
                                  params: { ...(state?.params ?? {}), [p.key]: v },
                                });
                            }}
                            className="w-full h-7 rounded border border-border bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                            title={p.hint}
                          />
                          <p className="text-[10px] text-muted-foreground/60">{p.hint}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

          {/* Notes for AI */}
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Notes for AI{" "}
              <span className="normal-case font-normal text-muted-foreground/60">(optional)</span>
            </p>
            <Textarea
              className="text-xs font-mono resize-none h-14"
              placeholder={`Describe any specific behaviour, e.g. "only enter after EMA retest, not on the cross itself"`}
              value={state?.description ?? ""}
              onChange={(e) => onChange({ ...(state as BrainState), description: e.target.value })}
            />
          </div>

          {/* AI param extraction — kept as optional advanced tool */}
          {state?.modules && state.modules.length > 0 && (
            <AIParamExtractor role={role} state={state} onChange={onChange} />
          )}

          {/* Actions */}
          <div className="flex justify-between items-center pt-1">
            {optional && (
              <button
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
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
  const navigate = useNavigate();

  // Brain states
  const [direction, setDirection] = useState<BrainState | undefined>(undefined);
  const [setup, setSetup] = useState<BrainState | undefined>(undefined);
  const [execution, setExecution] = useState<BrainState | undefined>(undefined);

  // Management
  const [risk, setRisk] = useState(1.0);
  const [rr, setRr] = useState(2.0);
  const [be, setBe] = useState(true);
  const [beAt, setBeAt] = useState(1.0);
  const [maxTrades, setMaxTrades] = useState(1);
  const [stopBuffer, setStopBuffer] = useState(20);
  const [maxStopPts, setMaxStopPts] = useState(0); // 0 = no limit
  const [strategyNotes, setStrategyNotes] = useState("");

  const [saving, setSaving] = useState(false);

  // ── Preset application ────────────────────────────────────────────────────
  function applyPreset(p: Preset) {
    setDirection(p.direction ? { ...p.direction } : undefined);
    setSetup(p.setup ? { ...p.setup } : undefined);
    setExecution({ ...p.execution });
    setRr(p.rr);
    setRisk(p.risk);
    setBe(p.be);
  }

  // ── Live summary ──────────────────────────────────────────────────────────
  function summary() {
    const parts: string[] = [];
    if (direction?.modules?.[0] && direction.timeframe) {
      const mods = direction.modules.map((m) => m.replace(/_/g, " ").toUpperCase()).join(" + ");
      parts.push(`${direction.timeframe} ${mods}`);
    }
    if (setup?.modules?.[0] && setup.timeframe) {
      const mods = setup.modules.map((m) => m.replace(/_/g, " ").toUpperCase()).join(" + ");
      parts.push(`${setup.timeframe} ${mods}`);
    }
    if (execution?.modules?.[0] && execution.timeframe) {
      const mods = execution.modules.map((m) => m.replace(/_/g, " ").toUpperCase()).join(" + ");
      parts.push(`${execution.timeframe} ${mods}`);
    }
    const chain = parts.join(" → ");
    const mgmt = `${risk}% risk · ${rr}R TP${be ? ` · BE@${beAt}R` : ""}`;
    return chain ? `${chain} | ${mgmt}` : mgmt;
  }

  // ── Generate ──────────────────────────────────────────────────────────────
  async function onGenerate() {
    if (!user) return;
    if (!execution?.modules?.[0] || !execution.timeframe) {
      toast.error("Execution Brain is required — select a module and timeframe.");
      return;
    }
    const unsafeAiModules = unsafeAiModuleLabels([
      ...(direction?.modules ?? []),
      ...(setup?.modules ?? []),
      ...(execution.modules ?? []),
    ]);
    if (unsafeAiModules.length > 0) {
      toast.error(`4-Brain EA generation is blocked for: ${unsafeAiModules.join(", ")}`);
      return;
    }

    const fourBrain: FourBrainConfig = {
      direction:
        direction?.modules?.[0] && direction.timeframe
          ? {
              modules: direction.modules,
              timeframe: direction.timeframe,
              description: direction.description,
              params: direction.params ?? {},
            }
          : undefined,
      setup:
        setup?.modules?.[0] && setup.timeframe
          ? {
              modules: setup.modules,
              timeframe: setup.timeframe,
              description: setup.description,
              params: setup.params ?? {},
            }
          : undefined,
      execution: {
        modules: execution.modules,
        timeframe: execution.timeframe,
        description: execution.description,
        params: execution.params ?? {},
      },
      management: {
        riskPercent: risk,
        rewardRisk: rr,
        breakEvenEnabled: be,
        breakEvenAtR: beAt,
        maxOpenTrades: maxTrades,
        stopBuffer: stopBuffer, // in points — gen-ea.ts uses as int (input int InpStopBuffer)
        maxStopPoints: maxStopPts,
      },
    };

    const bp = {
      ...DEFAULT_BLUEPRINT,
      name: buildName(fourBrain),
      fourBrain,
      strategyNotes: strategyNotes.trim(), // cross-brain conditions for AI generation
      risk: {
        ...DEFAULT_BLUEPRINT.risk,
        riskPercent: risk,
        rewardRisk: rr,
        breakevenEnabled: be,
        maxOpenTrades: maxTrades,
        stopBufferPoints: stopBuffer,
      },
    } as StrategyBlueprint;

    setSaving(true);
    try {
      const { generateMql5FromBlueprint } = await import("@/lib/mql5-template-generator");
      const generatedCode = generateMql5FromBlueprint(bp);
      const row = await createStrategy({
        userId: user.id,
        name: bp.name,
        prompt: summary(),
        blueprint: bp,
        generatedCode,
      });
      toast.success("Strategy created with blueprint EA — ready to compile");
      navigate({ to: "/s/$id", params: { id: row.id } });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to create strategy");
    } finally {
      setSaving(false);
    }
  }

  function buildName(cfg: FourBrainConfig): string {
    const parts: string[] = [];
    if (cfg.direction) {
      const dirModules = cfg.direction.modules
        .map((m) => m.replace("_", " ").toUpperCase())
        .join(" + ");
      parts.push(`${cfg.direction.timeframe} ${dirModules}`);
    }
    if (cfg.setup) {
      const setupModules = cfg.setup.modules
        .map((m) => m.replace("_", " ").toUpperCase())
        .join(" + ");
      parts.push(`${cfg.setup.timeframe} ${setupModules}`);
    }
    const execModules = cfg.execution.modules
      .map((m) => m.replace("_", " ").toUpperCase())
      .join(" + ");
    parts.push(`${cfg.execution.timeframe} ${execModules}`);
    return parts.join(" → ");
  }

  const execConfigured = Boolean(execution?.modules?.[0] && execution.timeframe);
  const unsafeAiModules = unsafeAiModuleLabels([
    ...(direction?.modules ?? []),
    ...(setup?.modules ?? []),
    ...(execution?.modules ?? []),
  ]);
  const canBuildEa = execConfigured && unsafeAiModules.length === 0;

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
                <p className="text-[11px] text-muted-foreground leading-snug">{p.description}</p>
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
            <Arrow active={Boolean(direction?.modules?.[0])} />
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
            <Arrow active={Boolean(setup?.modules?.[0])} />
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
                min={0.1}
                max={5}
                step={0.1}
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
                min={0.5}
                max={10}
                step={0.5}
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
                min={5}
                max={100}
                step={5}
                value={[stopBuffer]}
                onValueChange={([v]) => setStopBuffer(v)}
              />
            </div>

            {/* Max SL */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Max stop loss</Label>
                <span className="text-xs font-mono text-primary">
                  {maxStopPts === 0
                    ? "no limit"
                    : `${maxStopPts} pts (${(maxStopPts / 10).toFixed(0)} pips)`}
                </span>
              </div>
              <Slider
                min={0}
                max={300}
                step={10}
                value={[maxStopPts]}
                onValueChange={([v]) => setMaxStopPts(v)}
              />
              <p className="text-[10px] text-muted-foreground/60">
                Skip trades whose SL distance exceeds this. 0 = no limit.
              </p>
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
                      min={0.25}
                      max={3}
                      step={0.25}
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
                min={1}
                max={10}
                step={1}
                value={[maxTrades]}
                onValueChange={([v]) => setMaxTrades(v)}
              />
            </div>
          </div>
        </div>

        {/* ── Strategy Rules — cross-brain conditions for AI ── */}
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-5 py-4 space-y-2">
          <div>
            <Label className="text-xs font-semibold text-amber-400">Strategy Rules</Label>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Conditions that apply across the whole strategy — max SL distance, required sequences,
              invalidation rules, session filters. Claude reads this when generating with AI.
            </p>
          </div>
          <Textarea
            value={strategyNotes}
            onChange={(e) => setStrategyNotes(e.target.value)}
            rows={3}
            className="text-xs font-mono resize-none"
            placeholder={`• If opposite EMA cross fires, reset direction and cancel all pending setups
• Only enter after price retests either EMA — ignore any IFVGs that formed before
• Max stop loss = 7 pips (70 points) — skip trade if SL distance exceeds this
• Breakeven at 1.5R, keep original TP active`}
          />
        </div>

        {/* ── Summary + Generate ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-border bg-card/50 px-5 py-4">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
              Strategy summary
            </p>
            <p className="text-sm font-mono text-foreground truncate">{summary()}</p>
          </div>
          <Button
            size="lg"
            disabled={!canBuildEa || saving}
            onClick={onGenerate}
            className="shrink-0 gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Saving…
              </>
            ) : (
              <>
                <Zap className="h-4 w-4" /> Build EA
              </>
            )}
          </Button>
        </div>

        {!execConfigured && (
          <p className="text-xs text-amber-400 text-center">
            Configure the Execution Brain to enable EA generation.
          </p>
        )}
        {execConfigured && unsafeAiModules.length > 0 && (
          <p className="text-xs text-amber-400 text-center">
            EA generation is blocked for: {unsafeAiModules.join(", ")}. These modules are visible
            for planning, but need verified state-machine contracts before they can trade.
          </p>
        )}
      </div>
    </div>
  );
}
