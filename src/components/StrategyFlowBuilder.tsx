import { useEffect, useMemo, useRef } from "react";
import type {
  BrainModuleType,
  StrategyFlowConfig,
  StrategyStepConfig,
  StrategyStepRole,
} from "@/types/blueprint";
import { ALL_BRAIN_MODULES, TIMEFRAMES as TF_LIST } from "@/lib/brain-modules";
import { MODULE_UI_PARAMS, type UIParam } from "@/lib/module-library";
import { eventsForStepRole, firstEventForRole } from "@/lib/strategy-flow-events";
import { flowSupportsModuleRole, isFlowVerifiedModule } from "@/generators/gen-flow-ea";
import {
  createDefaultStep,
  formatStepDisplayName,
  normalizeFlowStepNames,
  reorderSteps,
  removeStepAt,
  STEP_ROLE_OPTIONS,
  syncLinearDependencies,
  validateFlowForBuilder,
} from "@/lib/strategy-flow-ui";
import { getModuleAdmission, MODULE_ADMISSION_STATUS_META } from "@/lib/module-admission";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  GitBranch,
  Plus,
  Trash2,
} from "lucide-react";

function StepParamEditor({
  moduleId,
  params,
  onChange,
}: {
  moduleId: string;
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
}) {
  const uiParams: UIParam[] = MODULE_UI_PARAMS[moduleId as BrainModuleType] ?? [];
  if (!uiParams.length) return null;

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      {uiParams.map((p) => {
        const current = typeof params[p.key] === "number" ? (params[p.key] as number) : p.default;
        return (
          <div key={p.key} className="space-y-0.5">
            <Label className="text-[10px] text-muted-foreground">{p.label}</Label>
            <input
              type="number"
              min={p.min}
              max={p.max}
              step={p.step}
              value={current}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v)) onChange({ ...params, [p.key]: v });
              }}
              className="w-full h-7 rounded border border-border bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              title={p.hint}
            />
          </div>
        );
      })}
    </div>
  );
}

function TfPicker({ value, onChange }: { value: string; onChange: (tf: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {TF_LIST.map((tf) => (
        <button
          key={tf}
          type="button"
          onClick={() => onChange(tf)}
          className={[
            "px-2 py-0.5 rounded text-[10px] font-mono border transition-all",
            value === tf
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border text-muted-foreground hover:border-primary/60 hover:text-primary",
          ].join(" ")}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}

function StepCard({
  step,
  index,
  total,
  priorStepLabel,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  step: StrategyStepConfig;
  index: number;
  total: number;
  priorStepLabel?: string;
  onChange: (step: StrategyStepConfig) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const moduleDef = ALL_BRAIN_MODULES.find((m) => m.id === step.module);
  const eventOptions = useMemo(
    () => eventsForStepRole(step.module, step.role),
    [step.module, step.role],
  );
  const flowSupported = flowSupportsModuleRole(step.module, step.role);
  const admission = getModuleAdmission(step.module);
  const admissionMeta = admission ? MODULE_ADMISSION_STATUS_META[admission.status] : null;

  function withSyncedName(next: StrategyStepConfig): StrategyStepConfig {
    return { ...next, name: formatStepDisplayName(next.module, next.timeframe, next.role) };
  }

  function setModule(moduleId: BrainModuleType) {
    const events = eventsForStepRole(moduleId, step.role);
    const event =
      events[0]?.eventType ??
      firstEventForRole(moduleId, step.role) ??
      firstEventForRole(moduleId, "entry") ??
      step.event;
    onChange(
      withSyncedName({
        ...step,
        module: moduleId,
        event,
      }),
    );
  }

  function setRole(role: StrategyStepRole) {
    const events = eventsForStepRole(step.module, role);
    const event =
      events[0]?.eventType ??
      firstEventForRole(step.module, role) ??
      firstEventForRole(step.module, "entry") ??
      step.event;
    onChange(withSyncedName({ ...step, role, event }));
  }

  return (
    <div className="rounded-lg border border-border bg-card/40 p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
            {index + 1}
          </span>
          <div className="min-w-0">
            <input
              value={step.name}
              onChange={(e) => onChange({ ...step, name: e.target.value })}
              className="w-full bg-transparent text-sm font-medium outline-none border-b border-transparent focus:border-border"
            />
            {priorStepLabel && (
              <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                <GitBranch className="h-3 w-3" />
                After: {priorStepLabel}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onMoveUp}
            disabled={index === 0}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onMoveDown}
            disabled={index >= total - 1}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={onRemove}
            disabled={total <= 1}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Role</Label>
          <Select value={step.role} onValueChange={(v) => setRole(v as StrategyStepRole)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STEP_ROLE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Module
          </Label>
          <Select value={step.module} onValueChange={(v) => setModule(v as BrainModuleType)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {ALL_BRAIN_MODULES.filter((mod) => isFlowVerifiedModule(mod.id)).map((mod) => (
                <SelectItem key={mod.id} value={mod.id} className="text-xs">
                  {mod.symbol} {mod.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[10px]">
        {moduleDef && (
          <span className="text-muted-foreground">
            {moduleDef.symbol} {moduleDef.desc}
          </span>
        )}
        {admissionMeta && (
          <span className={`px-1.5 py-0.5 rounded border ${admissionMeta.tone}`}>
            {admissionMeta.shortLabel}
          </span>
        )}
        {!flowSupported && (
          <span className="px-1.5 py-0.5 rounded border border-amber-500/30 text-amber-300 bg-amber-500/10">
            Assembler fallback
          </span>
        )}
      </div>

      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Timeframe
        </Label>
        <TfPicker
          value={step.timeframe}
          onChange={(tf) => onChange(withSyncedName({ ...step, timeframe: tf }))}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Event</Label>
        {eventOptions.length > 0 ? (
          <Select
            value={step.event}
            onValueChange={(v) => onChange({ ...step, event: v as typeof step.event })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {eventOptions.map((opt) => (
                <SelectItem key={opt.eventType} value={opt.eventType} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-[11px] text-amber-400">No contract events for this module + role.</p>
        )}
      </div>

      <StepParamEditor
        moduleId={step.module}
        params={step.params ?? {}}
        onChange={(params) => onChange({ ...step, params })}
      />

      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Notes</Label>
        <textarea
          value={step.notes ?? ""}
          onChange={(e) => onChange({ ...step, notes: e.target.value })}
          rows={2}
          placeholder="Optional — describe timing or invalidation for this step"
          className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
        />
      </div>
    </div>
  );
}

export function StrategyFlowBuilder({
  flow,
  onChange,
}: {
  flow: StrategyFlowConfig;
  onChange: (flow: StrategyFlowConfig) => void;
}) {
  const steps = flow.steps ?? [];
  const validation = useMemo(() => validateFlowForBuilder(flow), [flow]);
  const normalizedOnMount = useRef(false);

  useEffect(() => {
    if (normalizedOnMount.current) return;
    normalizedOnMount.current = true;
    const fixed = normalizeFlowStepNames(steps);
    const changed = fixed.some((step, index) => step.name !== steps[index]?.name);
    if (changed) {
      onChange({ ...flow, steps: syncLinearDependencies(fixed) });
    }
  }, [flow, onChange, steps]);

  function updateSteps(nextSteps: StrategyStepConfig[]) {
    onChange({
      ...flow,
      steps: syncLinearDependencies(nextSteps),
    });
  }

  function updateStep(index: number, step: StrategyStepConfig) {
    const next = [...steps];
    next[index] = step;
    updateSteps(next);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-sky-500/25 bg-sky-500/5 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-sky-400" />
          <p className="text-xs font-semibold text-sky-300">Strategy Flow — ordered event chain</p>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Each step is a verified module event. Steps run in order — a trade fires only when every
          step in the chain has occurred (with timestamps). Add as many steps as your strategy
          needs.
        </p>
      </div>

      <div
        className={[
          "rounded-lg border p-3 space-y-2",
          validation.errors.length
            ? "border-destructive/30 bg-destructive/5"
            : validation.warnings.length
              ? "border-amber-500/30 bg-amber-500/5"
              : "border-emerald-500/30 bg-emerald-500/5",
        ].join(" ")}
      >
        <div className="flex items-center gap-2">
          {validation.errors.length ? (
            <AlertTriangle className="h-4 w-4 text-destructive" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          )}
          <p className="text-xs font-medium">
            {validation.errors.length
              ? "Flow needs fixes before generation"
              : validation.flowEngineOk
                ? "Ready for Strategy Flow engine"
                : "Valid — may use blueprint assembler fallback"}
          </p>
        </div>
        {validation.errors.map((error) => (
          <p key={error} className="text-[11px] text-destructive/90">
            {error}
          </p>
        ))}
        {validation.warnings.map((warning) => (
          <p key={warning} className="text-[11px] text-amber-300/90">
            {warning}
          </p>
        ))}
      </div>

      <div className="space-y-3">
        {steps.map((step, index) => (
          <StepCard
            key={step.id}
            step={step}
            index={index}
            total={steps.length}
            priorStepLabel={index > 0 ? steps[index - 1]?.name : undefined}
            onChange={(next) => updateStep(index, next)}
            onMoveUp={() => updateSteps(reorderSteps(steps, index, index - 1))}
            onMoveDown={() => updateSteps(reorderSteps(steps, index, index + 1))}
            onRemove={() => updateSteps(removeStepAt(steps, index))}
          />
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full border-dashed"
        onClick={() => updateSteps([...steps, createDefaultStep(steps)])}
      >
        <Plus className="h-4 w-4 mr-1.5" />
        Add step
      </Button>
    </div>
  );
}
