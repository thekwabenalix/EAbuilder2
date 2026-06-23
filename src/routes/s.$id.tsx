import type { ReactNode } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getStrategy, updateStrategy, deleteStrategy, duplicateStrategy } from "@/lib/strategies";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/PageHeader";
import { WorkflowStepper } from "@/components/WorkflowStepper";
import { ScrollableTabsList } from "@/components/ScrollableTabsList";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StrategySpecForm } from "@/components/StrategySpecForm";
import { BuilderProgress, BUILDER_STEPS, type BuilderStep } from "@/components/BuilderProgress";
import { BlueprintExplanationPanel } from "@/components/BlueprintExplanationPanel";
import { StrategyFlowBuilder } from "@/components/StrategyFlowBuilder";
import { StrategyFamilyPicker } from "@/components/StrategyFamilyPicker";
import { EmaPeriodEditor } from "@/components/EmaPeriodEditor";
import { TradeAuditPanel } from "@/components/TradeAuditPanel";
import {
  BuiltinIndicatorPicker,
  type IndicatorPickerResult,
} from "@/components/BuiltinIndicatorPicker";
import { BuiltinIndicatorEntryButton } from "@/components/BuiltinIndicatorEntryButton";
import { mergeFilterRef, mergeIndicatorRef } from "@/lib/builtin-indicator-ui";
import {
  Save,
  Check,
  Copy,
  Trash2,
  Loader2,
  Play,
  Download,
  FileJson,
  FileText,
  FileCode2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Sparkles,
  Hammer,
  BarChart2,
  WifiOff,
  Bot,
  Brain,
  Plus,
  X,
  MoreHorizontal,
  Settings2,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { EaChatDrawer, type EaAssistantAction } from "@/components/EaChatDrawer";
import { resolveFlowBacktestPeriod, type AssistantApplyFix } from "@/lib/assistant-apply";
import { toast } from "sonner";
import {
  buildExportFilename,
  buildMockCompileLog,
  buildValidationReport,
} from "@/lib/mql5-generator";
import { fixCompileErrors } from "@/lib/api-client";
import {
  generateMql5FromBlueprint,
  generateEaFromBlueprint,
  generationPathLabel,
  analyzeBuildability,
  isLegacyFlatRulesBlueprint,
} from "@/lib/mql5-template-generator";
import { EaGenerationError } from "@/lib/generate-ea-router";
import { blueprintReadyForGeneration } from "@/lib/ea-generation-policy";
import {
  assertBlueprintGeneratable,
  firstBlueprintGenerationError,
  validateBlueprintForGeneration,
} from "@/lib/blueprint-generation-gate";
import type { StrategyBlueprint } from "@/types/blueprint";
import { DEFAULT_BLUEPRINT } from "@/types/blueprint";
import type {
  FourBrainConfig,
  BrainConfig,
  BrainModuleType,
  StrategyFamily,
} from "@/types/blueprint";
import {
  ALL_BRAIN_MODULES,
  TIMEFRAMES as TF_LIST,
  formatBrainChain,
  type BrainModuleDef,
} from "@/lib/brain-modules";
import { MODULE_UI_PARAMS } from "@/lib/module-library";
import type { UIParam } from "@/lib/module-library";
import { getModuleAdmission, MODULE_ADMISSION_STATUS_META } from "@/lib/module-admission";
import type { AiBrainWiring } from "@/lib/api-client";
import {
  attachUserFlowToBlueprint,
  builderModeFromBlueprint,
  detachAdvancedFlow,
  nameFromFlowSteps,
  seedAdvancedFlow,
  type BuilderFlowMode,
} from "@/lib/strategy-flow-ui";
import { fourBrainToStrategyFlow } from "@/lib/strategy-flow";
import {
  crossFamilyWarnings,
  filterModulesForFamily,
  inferStrategyFamilyFromModules,
  moduleAllowedInFamily,
  pickerModulesForBrain,
} from "@/lib/strategy-family";
import {
  isZoneScopedRejectionPair,
  smcZoneRejectionEventLabel,
} from "@/lib/smc-zone-rejection-display";
import type { StrategyFlowConfig } from "@/types/blueprint";
import {
  buildExpectedTradePath,
  parseTesterLogForTradeAudit,
  summarizeTradeAudit,
} from "@/lib/trade-audit";
import {
  getLocalRunnerHealth,
  getMt5Status,
  buildRunnerApproval,
  compileEa,
  openMetaEditor,
  submitBacktest,
  getRunnerJob,
  getRunnerJobReport,
  getRunnerJobLog,
} from "@/lib/local-runner";
import type { TesterConfig, BacktestResult, CompileResult, ReportSummary } from "@/types/mt5";

export const Route = createFileRoute("/s/$id")({
  component: StrategyPage,
});

function downloadText(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type AiWiringDiagnostic = NonNullable<StrategyBlueprint["aiWiringDiagnostics"]>;
type AiWiringInsightData = AiBrainWiring | AiWiringDiagnostic;

function AiWiringInsight({ wiring }: { wiring: AiWiringInsightData | null }) {
  if (!wiring) return null;

  const validation = wiring.validation;
  const semantics = wiring.semantics;
  const status = validation?.status ?? "warn";
  const repairAttempts = wiring.repairAttempts ?? 0;
  const statusStyle =
    status === "pass"
      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
      : status === "fail"
        ? "border-destructive/30 bg-destructive/5 text-destructive"
        : "border-amber-500/30 bg-amber-500/5 text-amber-300";
  const statusIcon =
    status === "pass" ? (
      <CheckCircle2 className="h-3.5 w-3.5" />
    ) : status === "fail" ? (
      <XCircle className="h-3.5 w-3.5" />
    ) : (
      <AlertTriangle className="h-3.5 w-3.5" />
    );

  const items = [
    semantics?.timeframe ? `Timeframe: ${semantics.timeframe}` : null,
    semantics?.direction
      ? `Direction: ${semantics.direction.module} ${semantics.direction.event}${
          semantics.direction.fastPeriod && semantics.direction.slowPeriod
            ? ` ${semantics.direction.fastPeriod}/${semantics.direction.slowPeriod}`
            : ""
        }`
      : null,
    semantics?.setup
      ? `Setup gate: ${semantics.setup.gate}${
          semantics.setup.targetLabel ? ` on ${semantics.setup.targetLabel}` : ""
        }`
      : null,
    semantics?.execution
      ? `Entry: ${semantics.execution.module} ${semantics.execution.entryEvent}`
      : null,
  ].filter(Boolean);

  return (
    <div className={`rounded-md border p-3 text-xs space-y-2 ${statusStyle}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-medium">
          {statusIcon}
          <span>AI wiring validation: {status}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {repairAttempts > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 uppercase tracking-wide">
              repaired once
            </span>
          )}
          {semantics?.source && (
            <span className="text-[10px] uppercase tracking-wide opacity-70">
              {semantics.source}
            </span>
          )}
        </div>
      </div>

      {repairAttempts > 0 && (
        <p className="text-cyan-200/90">
          The first AI wiring failed deterministic validation. The system sent the validator errors
          back once, accepted the repaired wiring, and generated from that corrected contract.
        </p>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
          {items.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      )}

      {wiring.notes && (
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Notes: </span>
          {wiring.notes}
        </p>
      )}

      {validation?.errors.length ? (
        <div className="space-y-1">
          {validation.errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      ) : null}

      {validation?.warnings.length || semantics?.assumptions.length ? (
        <div className="space-y-1 text-muted-foreground">
          {[...(validation?.warnings ?? []), ...(semantics?.assumptions ?? [])].map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function safeDownloadName(name: string) {
  return name
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function buildAiDiagnosticsExport(blueprint: StrategyBlueprint, prompt: string, code: string) {
  const diagnostics = blueprint.aiWiringDiagnostics;
  return JSON.stringify(
    {
      strategy: {
        name: blueprint.name,
        prompt,
        summary: blueprint.summary,
        strategyNotes: blueprint.strategyNotes,
      },
      aiWiringDiagnostics: diagnostics ?? null,
      generatedEa: {
        hasCode: Boolean(code?.trim()),
        auditHeader: code
          .split("\n")
          .filter((line) => line.startsWith("//| AI "))
          .slice(0, 20),
      },
      exportedAt: new Date().toISOString(),
    },
    null,
    2,
  );
}

function StrategyPage() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["strategy", id],
    queryFn: () => getStrategy(id),
  });

  const [blueprint, setBlueprint] = useState<StrategyBlueprint>(DEFAULT_BLUEPRINT);
  const [generatedCode, setGeneratedCode] = useState<string>("");
  const [name, setName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  /** When set, the drawer auto-sends this message the moment it opens. */
  const [chatAutoMessage, setChatAutoMessage] = useState<string | null>(null);
  const [compileLog, setCompileLog] = useState<string | null>(null);
  const [backtestSummary, setBacktestSummary] = useState<ReportSummary | null>(null);
  const [testerLog, setTesterLog] = useState<string | null>(null);
  const [backtestPeriodPatch, setBacktestPeriodPatch] = useState<string | null>(null);
  const [diagnosticContext, setDiagnosticContext] = useState<unknown>(null);
  const [activeTab, setActiveTab] = useState("brains");
  const autoSavedCodeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!data) return;

    setBlueprint(data.spec_json);
    setName(data.name);

    const savedCode = data.generated_code;
    const canAutoGenerate = blueprintReadyForGeneration(data.spec_json);

    if (!savedCode && canAutoGenerate) {
      try {
        const result = generateEaFromBlueprint(data.spec_json);
        setGeneratedCode(result.code);
        setActiveTab("code");

        if (autoSavedCodeRef.current !== data.id) {
          autoSavedCodeRef.current = data.id;
          updateStrategy(data.id, {
            name: data.name || "Untitled Strategy",
            blueprint: data.spec_json,
            generatedCode: result.code,
          })
            .then(() => {
              qc.invalidateQueries({ queryKey: ["strategy", data.id] });
              qc.invalidateQueries({ queryKey: ["strategies"] });
              toast.success(`Blueprint EA generated — ${generationPathLabel(result.path)}`);
            })
            .catch((e: unknown) => {
              autoSavedCodeRef.current = null;
              toast.error(e instanceof Error ? e.message : "Auto-save failed — save manually");
            });
        }
      } catch (e: unknown) {
        toast.error(e instanceof EaGenerationError ? e.message : "Auto-generate failed");
      }
    } else {
      setGeneratedCode(savedCode);
      setActiveTab(data.spec_json?.fourBrain ? "brains" : savedCode ? "spec" : "code");
    }

    setDirty(false);
  }, [data, qc]);

  const saveMut = useMutation({
    mutationFn: () =>
      updateStrategy(id, {
        name: name || "Untitled Strategy",
        blueprint,
        generatedCode,
      }),
    onSuccess: () => {
      toast.success("Saved");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["strategies"] });
      qc.invalidateQueries({ queryKey: ["strategy", id] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const dupMut = useMutation({
    mutationFn: () => duplicateStrategy(id, user!.id),
    onSuccess: (row) => {
      toast.success("Duplicated");
      qc.invalidateQueries({ queryKey: ["strategies"] });
      navigate({ to: "/s/$id", params: { id: row.id } });
    },
  });

  const delMut = useMutation({
    mutationFn: () => deleteStrategy(id),
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["strategies"] });
      navigate({ to: "/" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading strategy…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-6 text-sm text-destructive flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" /> Failed to load strategy.
      </div>
    );
  }

  const isFourBrain = Boolean(blueprint.fourBrain);
  const exec = blueprint.execution;
  const subtitle =
    isFourBrain && blueprint.fourBrain
      ? [
          formatBrainChain(blueprint.fourBrain),
          `risk ${blueprint.fourBrain.management?.riskPercent ?? blueprint.risk.riskPercent}%`,
        ].join(" · ")
      : [
          exec.symbol,
          exec.setupTimeframe !== exec.entryTimeframe
            ? `${exec.setupTimeframe} → ${exec.entryTimeframe}`
            : exec.entryTimeframe,
          `risk ${blueprint.risk.riskPercent}%`,
          blueprint.strategyType.length > 0 ? blueprint.strategyType.join(", ") : null,
        ]
          .filter(Boolean)
          .join(" · ");

  const onBlueprintChange = (next: StrategyBlueprint) => {
    setBlueprint(next);
    setDirty(true);
  };

  const regenFromTemplate = () => {
    const fixed = generateMql5FromBlueprint(blueprint);
    setGeneratedCode(fixed);
    setDirty(true);
    toast.success("Regenerated from blueprint — save and recompile");
  };

  const handleAssistantAction = (action: EaAssistantAction) => {
    if (action === "regen_template") {
      regenFromTemplate();
      return;
    }
    if (action === "rerun_interview") {
      if (data.prompt?.trim()) {
        sessionStorage.setItem("ea-reinterview-prompt", data.prompt);
      }
      navigate({ to: "/new" });
      return;
    }
    if (action === "open_modules") {
      navigate({ to: "/modules" });
      return;
    }
    if (action === "ai_rebuild") {
      regenFromTemplate();
      return;
    }
    if (action === "download_tester_log") {
      setActiveTab("backtest");
      toast.message("Use the Tester log button in Backtest results after a report run");
      return;
    }
    const nextTab =
      action === "open_brains"
        ? isFourBrain
          ? "brains"
          : "builder"
        : action === "open_code"
          ? "code"
          : action === "open_backtest"
            ? "backtest"
            : action === "open_export"
              ? "export"
              : action === "open_validation"
                ? isFourBrain
                  ? "brains"
                  : "validation"
                : activeTab;
    setActiveTab(nextTab);
  };

  const handleApplyAssistantFix = (fix: AssistantApplyFix) => {
    if (fix.type === "set_backtest_period") {
      setBacktestPeriodPatch(fix.period);
      setActiveTab("backtest");
      toast.success(`Backtest period set to ${fix.period} — re-run backtest`);
      return;
    }
    if (fix.type === "save_strategy") {
      saveMut.mutate();
      return;
    }
    if (fix.type === "regen_ea") {
      regenFromTemplate();
    }
  };

  return (
    <div className="pb-8">
      <PageHeader
        title={
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            className="bg-transparent outline-none border-b border-transparent focus:border-border w-full max-w-lg text-lg font-semibold"
            aria-label="Strategy name"
          />
        }
        subtitle={subtitle}
        below={
          isFourBrain ? (
            <WorkflowStepper
              steps={[
                { id: "brains", label: "Configure", shortLabel: "Configure", icon: Settings2 },
                { id: "code", label: "Generated code", shortLabel: "Code", icon: FileCode2 },
                { id: "backtest", label: "Backtest", shortLabel: "Test", icon: BarChart2 },
                { id: "export", label: "Export", shortLabel: "Export", icon: Download },
              ]}
              currentId={activeTab}
              onStepClick={setActiveTab}
            />
          ) : undefined
        }
        actions={
          <>
            <Button size="sm" onClick={() => setChatOpen(true)}>
              <Bot className="h-4 w-4 mr-1.5" /> Assistant
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setActiveTab("backtest")}
              className="hidden sm:inline-flex"
            >
              <Play className="h-4 w-4 mr-1.5" /> Backtest
            </Button>
            <Button
              size="sm"
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || !dirty}
              variant={dirty ? "default" : "outline"}
            >
              {saveMut.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : dirty ? (
                <Save className="h-4 w-4 mr-1.5" />
              ) : (
                <Check className="h-4 w-4 mr-1.5" />
              )}
              {dirty ? "Save" : "Saved"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="px-2">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">More actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => dupMut.mutate()} disabled={dupMut.isPending}>
                  <Copy className="h-4 w-4 mr-2" /> Duplicate strategy
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => {
                    if (confirm(`Delete "${name}"?`)) delMut.mutate();
                  }}
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Delete strategy
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {!isFourBrain && isLegacyFlatRulesBlueprint(blueprint) && (
        <div className="mx-6 mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <strong className="font-medium">Legacy flat-rules strategy.</strong> This EA uses the
          deprecated single-timeframe template path. Create a new strategy via{" "}
          <Link to="/build" className="underline text-amber-100">
            Visual Builder
          </Link>{" "}
          or refine your prompt so intake produces a 4-Brain configuration.
        </div>
      )}

      {isFourBrain ? (
        /* ── 4-Brain strategy tabs ─────────────────────────────────────────── */
        <Tabs value={activeTab} onValueChange={setActiveTab} className="px-4 sm:px-6 pt-4">
          <ScrollableTabsList>
            <TabsList className="w-max min-w-full sm:min-w-0">
              <TabsTrigger value="brains">
                <Brain className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                Configure
              </TabsTrigger>
              <TabsTrigger value="code">
                <FileCode2 className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                Code
              </TabsTrigger>
              <TabsTrigger value="backtest">
                <BarChart2 className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                Backtest
              </TabsTrigger>
              <TabsTrigger value="export">
                <Download className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                Export
              </TabsTrigger>
            </TabsList>
          </ScrollableTabsList>

          <TabsContent value="brains" className="pt-6 pb-10">
            <FourBrainTab
              blueprint={blueprint}
              onChange={(next) => {
                onBlueprintChange(next);
              }}
              onRegenerate={(next, aiCode) => {
                if (aiCode) {
                  setGeneratedCode(aiCode);
                  setDirty(true);
                  return;
                }
                try {
                  const result = generateEaFromBlueprint(next);
                  setGeneratedCode(result.code);
                  setDirty(true);
                  toast.success(`EA regenerated — ${generationPathLabel(result.path)}`);
                } catch (e: unknown) {
                  toast.error(e instanceof EaGenerationError ? e.message : "Regeneration failed");
                }
              }}
            />
          </TabsContent>

          <TabsContent value="code" className="pt-6 pb-10">
            <CodeTab
              strategyId={id}
              strategyName={name || "Untitled Strategy"}
              blueprint={blueprint}
              code={generatedCode}
              prompt={data.prompt}
              onCodeChange={(code) => {
                setGeneratedCode(code);
                setDirty(true);
              }}
              onAutoSave={async (code, nextBlueprint = blueprint) => {
                await updateStrategy(id, {
                  name: name || "Untitled Strategy",
                  blueprint: nextBlueprint,
                  generatedCode: code,
                });
                setBlueprint(nextBlueprint);
                setGeneratedCode(code);
                setDirty(false);
                qc.invalidateQueries({ queryKey: ["strategies"] });
                qc.invalidateQueries({ queryKey: ["strategy", id] });
              }}
            />
          </TabsContent>

          <TabsContent value="backtest" className="pt-6 pb-10">
            <BacktestTab
              strategyId={id}
              strategyName={name || "Untitled Strategy"}
              blueprint={blueprint}
              code={generatedCode}
              onCompileLog={setCompileLog}
              onBacktestSummary={setBacktestSummary}
              onBacktestLog={setTesterLog}
              onDiagnosticContext={setDiagnosticContext}
              onOpenChat={(msg) => {
                setChatAutoMessage(msg ?? null);
                setChatOpen(true);
              }}
              onApplyCode={(fixed) => {
                setGeneratedCode(fixed);
                setDirty(true);
              }}
              periodPatch={backtestPeriodPatch}
              onPeriodPatchApplied={() => setBacktestPeriodPatch(null)}
              suggestedPeriod={resolveFlowBacktestPeriod(blueprint)}
            />
          </TabsContent>

          <TabsContent value="export" className="pt-6 pb-10">
            <ExportTab blueprint={blueprint} prompt={data.prompt} code={generatedCode} />
          </TabsContent>
        </Tabs>
      ) : (
        /* ── Rules-based strategy tabs ─────────────────────────────────────── */
        <Tabs value={activeTab} onValueChange={setActiveTab} className="px-4 sm:px-6 pt-4">
          <ScrollableTabsList>
            <TabsList className="w-max min-w-full sm:min-w-0">
              <TabsTrigger value="spec">Spec</TabsTrigger>
              <TabsTrigger value="builder">Builder</TabsTrigger>
              <TabsTrigger value="code">
                <FileCode2 className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                Code
              </TabsTrigger>
              <TabsTrigger value="backtest">
                <BarChart2 className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                Backtest
              </TabsTrigger>
              <TabsTrigger value="validation">Validation</TabsTrigger>
              <TabsTrigger value="export">
                <Download className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                Export
              </TabsTrigger>
            </TabsList>
          </ScrollableTabsList>

          <TabsContent value="spec" className="pt-6 pb-10">
            <StrategySpecForm blueprint={blueprint} onChange={onBlueprintChange} />
          </TabsContent>

          <TabsContent value="builder" className="pt-6 pb-10 max-w-2xl">
            <BuilderTab blueprint={blueprint} />
          </TabsContent>

          <TabsContent value="code" className="pt-6 pb-10">
            <CodeTab
              strategyId={id}
              strategyName={name || "Untitled Strategy"}
              blueprint={blueprint}
              code={generatedCode}
              prompt={data.prompt}
              onCodeChange={(code) => {
                setGeneratedCode(code);
                setDirty(true);
              }}
              onAutoSave={async (code, nextBlueprint = blueprint) => {
                await updateStrategy(id, {
                  name: name || "Untitled Strategy",
                  blueprint: nextBlueprint,
                  generatedCode: code,
                });
                setBlueprint(nextBlueprint);
                setGeneratedCode(code);
                setDirty(false);
                qc.invalidateQueries({ queryKey: ["strategies"] });
                qc.invalidateQueries({ queryKey: ["strategy", id] });
              }}
            />
          </TabsContent>

          <TabsContent value="backtest" className="pt-6 pb-10">
            <BacktestTab
              strategyId={id}
              strategyName={name || "Untitled Strategy"}
              blueprint={blueprint}
              code={generatedCode}
              onCompileLog={setCompileLog}
              onBacktestSummary={setBacktestSummary}
              onBacktestLog={setTesterLog}
              onDiagnosticContext={setDiagnosticContext}
              onOpenChat={(msg) => {
                setChatAutoMessage(msg ?? null);
                setChatOpen(true);
              }}
              onApplyCode={(fixed) => {
                setGeneratedCode(fixed);
                setDirty(true);
              }}
              periodPatch={backtestPeriodPatch}
              onPeriodPatchApplied={() => setBacktestPeriodPatch(null)}
              suggestedPeriod={resolveFlowBacktestPeriod(blueprint)}
            />
          </TabsContent>

          <TabsContent value="validation" className="pt-6 pb-10">
            <ValidationTab blueprint={blueprint} />
          </TabsContent>

          <TabsContent value="export" className="pt-6 pb-10">
            <ExportTab blueprint={blueprint} prompt={data.prompt} code={generatedCode} />
          </TabsContent>
        </Tabs>
      )}

      <EaChatDrawer
        open={chatOpen}
        onOpenChange={(open) => {
          setChatOpen(open);
          if (!open) setChatAutoMessage(null);
        }}
        autoMessage={chatAutoMessage ?? undefined}
        prompt={data.prompt}
        blueprint={blueprint}
        code={generatedCode}
        compileLog={compileLog}
        testerLog={testerLog}
        backtestSummary={backtestSummary}
        diagnosticContext={diagnosticContext}
        onApplyCode={(code) => {
          setGeneratedCode(code);
          setDirty(true);
          setChatOpen(false);
          toast.success("AI code applied — remember to save");
        }}
        onSafeAction={handleAssistantAction}
        onRegenTemplate={regenFromTemplate}
        onApplyAssistantFix={handleApplyAssistantFix}
      />
    </div>
  );
}

// ─── FourBrainTab ─────────────────────────────────────────────────────────────

const TF_OPTIONS = [...TF_LIST];

function BrainModuleChips({
  selected,
  onChange,
  brainRole,
  brainTimeframe,
  onIndicatorSideEffect,
  familyModules,
  setupModule,
}: {
  selected: BrainModuleType[];
  onChange: (mods: BrainModuleType[]) => void;
  brainRole: BrainRole;
  brainTimeframe: string;
  onIndicatorSideEffect?: (result: IndicatorPickerResult) => void;
  familyModules: BrainModuleDef[];
  setupModule?: BrainModuleType;
}) {
  const [open, setOpen] = useState(false);
  const [indicatorOpen, setIndicatorOpen] = useState(false);

  const toggle = (id: BrainModuleType) => {
    onChange(selected.includes(id) ? selected.filter((m) => m !== id) : [...selected, id]);
  };

  function applyIndicator(result: IndicatorPickerResult) {
    if (result.brainModule && !selected.includes(result.brainModule)) {
      onChange([...selected, result.brainModule]);
    }
    onIndicatorSideEffect?.(result);
  }

  return (
    <div className="space-y-2">
      <BuiltinIndicatorEntryButton onClick={() => setIndicatorOpen(true)} compact />

      {/* Selected chips */}
      <div className="flex flex-wrap gap-1.5">
        {selected.map((id) => {
          const def = ALL_BRAIN_MODULES.find((m) => m.id === id);
          const zoneScoped =
            brainRole === "execution" && isZoneScopedRejectionPair(setupModule, id);
          const label = zoneScoped
            ? `${smcZoneRejectionEventLabel(setupModule!)} + Next Bar`
            : (def?.label ?? id);
          return (
            <span
              key={id}
              className={[
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border",
                zoneScoped
                  ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                  : "bg-primary/15 border-primary/30 text-primary",
              ].join(" ")}
            >
              {zoneScoped ? "✓" : def?.symbol} {label}
              <button
                onClick={() => toggle(id)}
                className="ml-0.5 hover:text-destructive transition-colors"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          );
        })}
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border border-dashed border-border text-muted-foreground hover:border-primary/60 hover:text-primary transition-colors"
        >
          <Plus className="h-2.5 w-2.5" />
          {selected.length === 0 ? "Add module" : "Add more"}
        </button>
      </div>

      {/* Module picker dropdown */}
      {open && (
        <div className="rounded-lg border border-border bg-card p-3 max-h-72 overflow-y-auto">
          <div className="grid grid-cols-2 gap-1">
            {familyModules.map((m) => {
              const active = selected.includes(m.id);
              const admission = getModuleAdmission(m.id);
              const admissionMeta = admission
                ? MODULE_ADMISSION_STATUS_META[admission.status]
                : null;
              return (
                <button
                  key={m.id}
                  onClick={() => toggle(m.id)}
                  className={[
                    "flex items-center gap-2 px-2.5 py-1.5 rounded text-xs text-left transition-all border",
                    active
                      ? "bg-primary/15 border-primary/40 text-primary"
                      : "border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                  ].join(" ")}
                >
                  <span className={`${m.color} text-sm`}>{m.symbol}</span>
                  <span className="min-w-0 flex-1">{m.label}</span>
                  {admissionMeta && (
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${admissionMeta.tone}`}
                      title={admission?.notes ?? admissionMeta.description}
                    >
                      {admissionMeta.shortLabel}
                    </span>
                  )}
                  {active && <CheckCircle2 className="h-3 w-3 ml-auto text-primary" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <BuiltinIndicatorPicker
        open={indicatorOpen}
        onOpenChange={setIndicatorOpen}
        timeframe={brainTimeframe}
        brainRole={brainRole}
        onApply={applyIndicator}
      />
    </div>
  );
}

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

function unsafeFourBrainAiModules(config?: FourBrainConfig): string[] {
  if (!config) return [];
  return unsafeAiModuleLabels([
    ...(config.direction?.modules ?? []),
    ...(config.setup?.modules ?? []),
    ...(config.execution?.modules ?? []),
  ]);
}

function TfPicker({ value, onChange }: { value: string; onChange: (tf: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {TF_OPTIONS.map((tf) => (
        <button
          key={tf}
          onClick={() => onChange(tf)}
          className={[
            "px-2 py-0.5 rounded text-[11px] font-mono border transition-all",
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

type BrainRole = "direction" | "setup" | "execution";

const BRAIN_META: Record<
  BrainRole,
  { label: string; icon: ReactNode; color: string; hint: string }
> = {
  direction: {
    label: "Direction Brain",
    icon: <Brain className="h-4 w-4" />,
    color: "text-blue-400 border-blue-500/30 bg-blue-500/5",
    hint: "Sets the market bias (BULL / BEAR). Uses the HTF.",
  },
  setup: {
    label: "Setup Brain",
    icon: <BarChart2 className="h-4 w-4" />,
    color: "text-violet-400 border-violet-500/30 bg-violet-500/5",
    hint: "Detects the active zone (OB / FVG / S-R). MTF.",
  },
  execution: {
    label: "Execution Brain",
    icon: <Sparkles className="h-4 w-4" />,
    color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
    hint: "Fires the entry trigger. LTF — required.",
  },
};

// ─── Per-module parameter inputs ─────────────────────────────────────────────

function ModuleParamEditor({
  modules,
  params,
  onChange,
}: {
  modules: BrainModuleType[];
  params: Record<string, unknown>;
  onChange: (p: Record<string, unknown>) => void;
}) {
  // Collect the union of all UI params across all selected modules (deduped by key)
  const seen = new Set<string>();
  const allParams: UIParam[] = [];
  const hasEma = modules.includes("ema");
  for (const mod of modules) {
    const uiParams = MODULE_UI_PARAMS[mod] ?? [];
    for (const p of uiParams) {
      if (hasEma && (p.key === "fastPeriod" || p.key === "slowPeriod")) continue;
      if (!seen.has(p.key)) {
        seen.add(p.key);
        allParams.push(p);
      }
    }
  }

  if (allParams.length === 0 && !hasEma) return null;

  return (
    <div className="space-y-2 pt-1">
      <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">
        Parameters
      </Label>
      {hasEma && <EmaPeriodEditor params={params} onChange={onChange} />}
      {allParams.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {allParams.map((p) => {
            const current =
              typeof params[p.key] === "number" ? (params[p.key] as number) : p.default;
            return (
              <div key={p.key} className="space-y-0.5">
                <Label className="text-[11px] text-muted-foreground">{p.label}</Label>
                <div className="flex items-center gap-1.5">
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
                <p className="text-[10px] text-muted-foreground/60 leading-tight">{p.hint}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActiveConfluenceFilters({
  filterRefs,
  indicatorRefs,
  onRemoveFilter,
  onRemoveIndicator,
}: {
  filterRefs: NonNullable<StrategyBlueprint["filterRefs"]>;
  indicatorRefs: NonNullable<StrategyBlueprint["indicatorRefs"]>;
  onRemoveFilter: (id: string, appliesTo?: "setup" | "execution") => void;
  onRemoveIndicator: (id: string) => void;
}) {
  if (!filterRefs.length && !indicatorRefs.length) return null;

  return (
    <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 space-y-2">
      <Label className="text-xs font-semibold text-sky-400">Confluence filters & indicators</Label>
      <p className="text-[10px] text-muted-foreground -mt-1">
        Wired into EA compile — add more via Built-in indicator in any brain&apos;s module list.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {filterRefs.map((f) => (
          <span
            key={`${f.id}-${f.appliesTo ?? "any"}`}
            className="inline-flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-200"
          >
            {f.label} · {f.appliesTo ?? "entry"} · {f.timeframe}
            <button
              type="button"
              onClick={() => onRemoveFilter(f.id, f.appliesTo)}
              className="hover:text-white"
              aria-label={`Remove ${f.label}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {indicatorRefs.map((r) => (
          <span
            key={r.id}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground"
            title={r.note}
          >
            {r.name} (reference)
            <button
              type="button"
              onClick={() => onRemoveIndicator(r.id)}
              className="hover:text-foreground"
              aria-label={`Remove ${r.name}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

function BrainCard({
  role,
  config,
  enabled,
  optional,
  onChange,
  onToggle,
  onIndicatorSideEffect,
  familyModules,
  setupModule,
}: {
  role: BrainRole;
  config: BrainConfig;
  enabled: boolean;
  optional: boolean;
  onChange: (c: BrainConfig) => void;
  onToggle?: (on: boolean) => void;
  onIndicatorSideEffect?: (result: IndicatorPickerResult) => void;
  familyModules: BrainModuleDef[];
  setupModule?: BrainModuleType;
}) {
  const meta = BRAIN_META[role];
  return (
    <div
      className={`rounded-lg border p-4 space-y-3 transition-opacity ${enabled ? "" : "opacity-40"} ${meta.color}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {meta.icon}
          <span className="text-sm font-semibold">{meta.label}</span>
        </div>
        {optional && onToggle && (
          <Switch checked={enabled} onCheckedChange={onToggle} className="scale-75" />
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">{meta.hint}</p>

      {enabled && (
        <>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">
              Modules
            </Label>
            <BrainModuleChips
              selected={config.modules}
              onChange={(mods) => onChange({ ...config, modules: mods })}
              brainRole={role}
              brainTimeframe={config.timeframe}
              onIndicatorSideEffect={onIndicatorSideEffect}
              familyModules={familyModules}
              setupModule={setupModule}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">
              Timeframe
            </Label>
            <TfPicker
              value={config.timeframe}
              onChange={(tf) => onChange({ ...config, timeframe: tf })}
            />
          </div>

          {/* Per-module parameter inputs — e.g. EMA periods, lookback bars */}
          {config.modules.length > 0 && (
            <ModuleParamEditor
              modules={config.modules}
              params={(config.params as Record<string, unknown>) ?? {}}
              onChange={(p) => onChange({ ...config, params: p })}
            />
          )}

          {/* Optional notes for AI — describe any nuance Claude should know */}
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">
              Notes for AI{" "}
              <span className="normal-case font-normal">
                (optional — describe any specific behaviour)
              </span>
            </Label>
            <textarea
              value={config.description ?? ""}
              onChange={(e) => onChange({ ...config, description: e.target.value })}
              rows={2}
              placeholder={`e.g. "Only trigger after price pulls back to the EMA zone, not on the cross itself"`}
              className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>
        </>
      )}
    </div>
  );
}

function FourBrainTab({
  blueprint,
  onChange,
  onRegenerate,
}: {
  blueprint: StrategyBlueprint;
  onChange: (bp: StrategyBlueprint) => void;
  onRegenerate: (bp: StrategyBlueprint, aiCode?: string) => void;
}) {
  const cfg = blueprint.fourBrain!;
  const mgmt = cfg.management;

  const [direction, setDirection] = useState<BrainConfig | undefined>(cfg.direction);
  const [setup, setSetup] = useState<BrainConfig | undefined>(cfg.setup);
  const [execution, setExecution] = useState<BrainConfig>(cfg.execution);
  /** Strategy-level rules that apply across all brains (filters, invalidation, special conditions) */
  const [strategyNotes, setStrategyNotes] = useState<string>(
    (blueprint as { strategyNotes?: string }).strategyNotes ?? "",
  );
  const [filterRefs, setFilterRefs] = useState<NonNullable<StrategyBlueprint["filterRefs"]>>(
    blueprint.filterRefs ?? [],
  );
  const [indicatorRefs, setIndicatorRefs] = useState<
    NonNullable<StrategyBlueprint["indicatorRefs"]>
  >(blueprint.indicatorRefs ?? []);

  function handleIndicatorSideEffect(result: IndicatorPickerResult) {
    if (result.kind === "filter" && result.filterRef) {
      setFilterRefs((prev) => mergeFilterRef(prev, result.filterRef!));
    } else if (result.kind === "catalog" && result.indicatorRef) {
      setIndicatorRefs((prev) => mergeIndicatorRef(prev, result.indicatorRef!));
    }
    toast.message(result.message);
  }

  function removeFilter(id: string, appliesTo?: "setup" | "execution") {
    setFilterRefs((prev) =>
      prev.filter(
        (f) => !(f.id === id && (f.appliesTo ?? "execution") === (appliesTo ?? "execution")),
      ),
    );
  }

  function removeIndicator(id: string) {
    setIndicatorRefs((prev) => prev.filter((r) => r.id !== id));
  }

  const [riskPct, setRiskPct] = useState(mgmt?.riskPercent ?? 1);
  const [rr, setRr] = useState(mgmt?.rewardRisk ?? 2);
  const [stopBuf, setStopBuf] = useState(mgmt?.stopBuffer ?? 20);
  const [maxStopPts, setMaxStopPts] = useState(mgmt?.maxStopPoints ?? 0);
  const [beOn, setBeOn] = useState(mgmt?.breakEvenEnabled ?? false);
  const [beAtR, setBeAtR] = useState(mgmt?.breakEvenAtR ?? 1);
  const [maxTrades, setMaxTrades] = useState(mgmt?.maxOpenTrades ?? 1);

  const [builderMode, setBuilderMode] = useState<BuilderFlowMode>(() =>
    builderModeFromBlueprint(blueprint),
  );
  const [flowConfig, setFlowConfig] = useState<StrategyFlowConfig>(() =>
    seedAdvancedFlow(blueprint, cfg),
  );

  const [strategyFamily, setStrategyFamily] = useState<StrategyFamily>(
    () =>
      blueprint.strategyFamily ??
      inferStrategyFamilyFromModules([
        ...(cfg.direction?.modules ?? []),
        ...(cfg.setup?.modules ?? []),
        ...cfg.execution.modules,
        ...(blueprint.strategyFlow?.steps?.map((s) => s.module) ?? []),
      ]),
  );
  const setupModuleId = setup?.modules?.[0];

  function brainPickerModules(role: BrainRole): BrainModuleDef[] {
    return pickerModulesForBrain(strategyFamily, role, setup?.modules);
  }

  function handleStrategyFamilyChange(next: StrategyFamily) {
    setStrategyFamily(next);
    const filter = (mods: BrainModuleType[]) => filterModulesForFamily(mods, next);
    if (direction?.modules?.length) {
      const modules = filter(direction.modules);
      setDirection(modules.length ? { ...direction, modules } : undefined);
    }
    if (setup?.modules?.length) {
      const modules = filter(setup.modules);
      setSetup(modules.length ? { ...setup, modules } : undefined);
    }
    if (execution.modules?.length) {
      const modules = filter(execution.modules);
      if (modules.length) setExecution({ ...execution, modules });
      else if (isZoneScopedRejectionPair(setup?.modules?.[0], execution.modules[0])) {
        /* keep zone-scoped execution trigger (hidden from SMC picker) */
      } else {
        const fallback = pickerModulesForBrain(next, "execution", setup?.modules)[0]?.id;
        if (fallback) setExecution({ ...execution, modules: [fallback] });
      }
    }
    if (flowConfig.steps.length) {
      setFlowConfig({
        ...flowConfig,
        steps: flowConfig.steps.filter(
          (s) => s.enabled === false || moduleAllowedInFamily(s.module, next),
        ),
      });
    }
  }

  const familyWarnings = useMemo(
    () =>
      crossFamilyWarnings(
        [
          ...(direction?.modules ?? []),
          ...(setup?.modules ?? []),
          ...execution.modules,
          ...(builderMode === "advanced" ? flowConfig.steps.map((s) => s.module) : []),
        ],
        strategyFamily,
      ),
    [strategyFamily, direction, setup, execution, builderMode, flowConfig.steps],
  );

  const strategyFlowSyncKey = [
    blueprint.strategyFlow?.source ?? "",
    blueprint.strategyFlow?.mode ?? "",
    blueprint.strategyFlow?.steps?.length ?? 0,
    blueprint.strategyFlow?.steps?.map((s) => s.id).join(",") ?? "",
  ].join("|");

  useEffect(() => {
    const flow = blueprint.strategyFlow;
    if (flow?.steps?.length) {
      setBuilderMode("advanced");
      setFlowConfig(flow);
    }
  }, [strategyFlowSyncKey]);

  function buildFourBrainConfig(): FourBrainConfig {
    return {
      direction: direction?.modules?.length ? direction : undefined,
      setup: setup?.modules?.length ? setup : undefined,
      execution,
      management: {
        riskPercent: riskPct,
        rewardRisk: rr,
        stopBuffer: stopBuf,
        maxStopPoints: maxStopPts,
        breakEvenEnabled: beOn,
        breakEvenAtR: beAtR,
        maxOpenTrades: maxTrades,
      },
    };
  }

  function buildUpdatedBp(): StrategyBlueprint {
    const newCfg = buildFourBrainConfig();
    const parts: string[] = [];
    if (newCfg.direction)
      parts.push(
        `${newCfg.direction.timeframe} ${newCfg.direction.modules.map((m) => m.replace(/_/g, " ").toUpperCase()).join("+")}`,
      );
    if (newCfg.setup)
      parts.push(
        `${newCfg.setup.timeframe} ${newCfg.setup.modules.map((m) => m.replace(/_/g, " ").toUpperCase()).join("+")}`,
      );
    parts.push(
      `${newCfg.execution.timeframe} ${newCfg.execution.modules.map((m) => m.replace(/_/g, " ").toUpperCase()).join("+")}`,
    );

    let newBp: StrategyBlueprint = {
      ...blueprint,
      name:
        builderMode === "advanced" && flowConfig.steps.length
          ? nameFromFlowSteps(flowConfig.steps)
          : parts.join(" → "),
      strategyFamily,
      fourBrain: newCfg,
      filterRefs: filterRefs.length ? filterRefs : undefined,
      indicatorRefs: indicatorRefs.length ? indicatorRefs : undefined,
    };
    (newBp as unknown as Record<string, unknown>).strategyNotes = strategyNotes;

    if (builderMode === "advanced") {
      newBp = attachUserFlowToBlueprint(newBp, {
        ...flowConfig,
        management: newCfg.management,
      });
    } else {
      newBp = detachAdvancedFlow(newBp);
    }
    return newBp;
  }

  // Lift brain/management edits to the parent blueprint on EVERY change so they
  // survive the Brains tab unmounting (Radix TabsContent) and don't reset to the
  // MODULE_UI_PARAMS defaults (e.g. EMA 21/50) when you switch tabs or rebuild.
  const firstSync = useRef(true);
  useEffect(() => {
    if (firstSync.current) {
      firstSync.current = false;
      return;
    }
    onChange(buildUpdatedBp());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    direction,
    setup,
    execution,
    strategyNotes,
    filterRefs,
    indicatorRefs,
    riskPct,
    rr,
    stopBuf,
    maxStopPts,
    beOn,
    beAtR,
    maxTrades,
    builderMode,
    flowConfig,
    strategyFamily,
  ]);

  const canRegenerate =
    builderMode === "advanced"
      ? flowConfig.steps.some(
          (s) => s.enabled !== false && (s.role === "entry" || s.role === "confirmation"),
        )
      : execution.modules.length > 0 && execution.timeframe;
  const [aiWiring] = useState<AiWiringInsightData | null>(blueprint.aiWiringDiagnostics ?? null);

  return (
    <div className="max-w-3xl space-y-5 pb-24">
      <StrategyFamilyPicker value={strategyFamily} onChange={handleStrategyFamilyChange} compact />

      {familyWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 space-y-1">
          {familyWarnings.map((warning) => (
            <p key={warning} className="text-[11px] text-amber-300/90">
              {warning}
            </p>
          ))}
        </div>
      )}

      {/* Builder mode — Simple 4-Brain vs Advanced Strategy Flow */}
      <div className="rounded-lg border border-border p-1 flex gap-1 bg-muted/20">
        <button
          type="button"
          onClick={() => setBuilderMode("simple")}
          className={[
            "flex-1 rounded-md px-3 py-2 text-xs font-medium transition-all",
            builderMode === "simple"
              ? "bg-background text-foreground shadow-sm border border-border"
              : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          Simple — 4-Brain preset
        </button>
        <button
          type="button"
          onClick={() => {
            if (builderMode !== "advanced") {
              setFlowConfig(seedAdvancedFlow(buildUpdatedBp(), buildFourBrainConfig()));
            }
            setBuilderMode("advanced");
          }}
          className={[
            "flex-1 rounded-md px-3 py-2 text-xs font-medium transition-all",
            builderMode === "advanced"
              ? "bg-background text-foreground shadow-sm border border-border"
              : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          Advanced — Strategy Flow
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-2">
        {builderMode === "simple"
          ? "Three brain slots (Direction · Setup · Execution). The compiler expands them into ordered steps automatically."
          : "Build any number of ordered module steps. Each step must occur before the next — same compiler as AI strategy_flow output."}
      </p>

      <TradeAuditPanel blueprint={buildUpdatedBp()} compact />

      {/* Strategy-level notes — cross-brain conditions, filters, invalidation rules */}
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
        <div>
          <Label className="text-xs font-semibold text-amber-400">Strategy Rules</Label>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Describe conditions that apply across the whole strategy — max SL distance, invalidation
            rules, required sequences (e.g. "must retest EMA before entry"), session filters. The AI
            assistant reads these when helping you debug or refine the strategy.
          </p>
        </div>
        <textarea
          value={strategyNotes}
          onChange={(e) => setStrategyNotes(e.target.value)}
          rows={4}
          placeholder={`Examples:
• If opposite EMA cross fires, reset direction and cancel all pending setups
• Only enter after price retests either EMA — ignore IFVGs that form before the retest
• Max stop loss = 7 pips (70 points) — skip trade if SL distance exceeds this
• Breakeven at 1.5R, keep original TP active`}
          className="w-full rounded border border-amber-500/20 bg-background px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-amber-500/60 resize-none"
        />
      </div>

      <details className="rounded-lg border border-border bg-card/50 group">
        <summary className="cursor-pointer list-none px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center justify-between">
          Strategy summary
          <span className="text-[10px] font-normal normal-case text-muted-foreground/70 group-open:hidden">
            Show blueprint details
          </span>
        </summary>
        <div className="px-4 pb-4 border-t border-border/50">
          <BlueprintExplanationPanel blueprint={buildUpdatedBp()} />
        </div>
      </details>

      {builderMode === "advanced" ? (
        <>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => {
                const seeded = fourBrainToStrategyFlow(buildFourBrainConfig());
                setFlowConfig({
                  ...seeded,
                  mode: "advanced_instances",
                  source: "user",
                  management: buildFourBrainConfig().management,
                });
              }}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Import from 4-Brain preset
            </Button>
          </div>
          <StrategyFlowBuilder
            flow={flowConfig}
            onChange={(next) => setFlowConfig(next)}
            strategyFamily={strategyFamily}
          />
        </>
      ) : (
        <>
          <ActiveConfluenceFilters
            filterRefs={filterRefs}
            indicatorRefs={indicatorRefs}
            onRemoveFilter={removeFilter}
            onRemoveIndicator={removeIndicator}
          />

          {/* Direction brain */}
          <BrainCard
            role="direction"
            config={direction ?? { modules: [], timeframe: "D1" }}
            enabled={Boolean(direction)}
            optional={true}
            onToggle={(on) =>
              setDirection(on ? { modules: ["choch"], timeframe: "D1" } : undefined)
            }
            onChange={setDirection}
            onIndicatorSideEffect={handleIndicatorSideEffect}
            familyModules={brainPickerModules("direction")}
          />

          {/* Setup brain */}
          <BrainCard
            role="setup"
            config={setup ?? { modules: [], timeframe: "H4" }}
            enabled={Boolean(setup)}
            optional={true}
            onToggle={(on) =>
              setSetup(on ? { modules: ["order_block"], timeframe: "H4" } : undefined)
            }
            onChange={setSetup}
            onIndicatorSideEffect={handleIndicatorSideEffect}
            familyModules={brainPickerModules("setup")}
          />

          {/* Execution brain — always on */}
          <BrainCard
            role="execution"
            config={execution}
            enabled={true}
            optional={false}
            onChange={setExecution}
            onIndicatorSideEffect={handleIndicatorSideEffect}
            familyModules={brainPickerModules("execution")}
            setupModule={setupModuleId}
          />
        </>
      )}

      {/* Management */}
      <div className="rounded-lg border border-border p-4 space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Management
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Risk per trade</Label>
            <div className="flex items-center gap-2">
              <Slider
                value={[riskPct]}
                min={0.1}
                max={5}
                step={0.1}
                onValueChange={([v]) => setRiskPct(v)}
                className="flex-1"
              />
              <span className="text-xs font-mono w-10 text-right">{riskPct}%</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Reward : Risk</Label>
            <div className="flex items-center gap-2">
              <Slider
                value={[rr]}
                min={0.5}
                max={10}
                step={0.5}
                onValueChange={([v]) => setRr(v)}
                className="flex-1"
              />
              <span className="text-xs font-mono w-10 text-right">{rr}R</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Stop buffer (pts)</Label>
            <div className="flex items-center gap-2">
              <Slider
                value={[stopBuf]}
                min={0}
                max={100}
                step={5}
                onValueChange={([v]) => setStopBuf(v)}
                className="flex-1"
              />
              <span className="text-xs font-mono w-10 text-right">{stopBuf}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Max stop loss</Label>
            <div className="flex items-center gap-2">
              <Slider
                value={[maxStopPts]}
                min={0}
                max={300}
                step={10}
                onValueChange={([v]) => setMaxStopPts(v)}
                className="flex-1"
              />
              <span className="text-xs font-mono w-16 text-right">
                {maxStopPts === 0 ? "off" : `${maxStopPts}pt`}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground/60">
              {maxStopPts === 0
                ? "No SL limit"
                : `Skip trades with SL > ${(maxStopPts / 10).toFixed(0)} pips`}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Max trades</Label>
            <div className="flex items-center gap-2">
              <Slider
                value={[maxTrades]}
                min={1}
                max={10}
                step={1}
                onValueChange={([v]) => setMaxTrades(v)}
                className="flex-1"
              />
              <span className="text-xs font-mono w-10 text-right">{maxTrades}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Switch checked={beOn} onCheckedChange={setBeOn} />
          <Label
            className="text-xs text-muted-foreground cursor-pointer"
            onClick={() => setBeOn((v) => !v)}
          >
            Break-even at
          </Label>
          {beOn && (
            <div className="flex items-center gap-2 flex-1">
              <Slider
                value={[beAtR]}
                min={0.5}
                max={3}
                step={0.25}
                onValueChange={([v]) => setBeAtR(v)}
                className="flex-1 max-w-32"
              />
              <span className="text-xs font-mono">{beAtR}R</span>
            </div>
          )}
        </div>
      </div>

      <AiWiringInsight wiring={aiWiring} />

      {/* Generate EA — sticky footer */}
      <div className="fixed bottom-0 left-0 right-0 md:left-56 z-20 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-4 sm:px-6 py-3">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-[11px] text-muted-foreground flex-1 hidden sm:block">
            Compiles verified modules into a self-contained EA. Use the Assistant to debug
            backtests.
          </p>
          <Button
            size="lg"
            className="w-full sm:w-auto sm:min-w-[200px] shrink-0"
            onClick={() => {
              if (!canRegenerate) {
                toast.error("Execution Brain needs at least one module and a timeframe.");
                return;
              }
              const bp = buildUpdatedBp();
              const contractError = firstBlueprintGenerationError(bp);
              if (contractError) {
                toast.error(contractError);
                return;
              }
              onChange(bp);
              onRegenerate(bp);
            }}
          >
            <Hammer className="h-4 w-4 mr-1.5" />
            Generate EA
          </Button>
        </div>
      </div>
    </div>
  );
}

function BuilderTab({ blueprint }: { blueprint: StrategyBlueprint }) {
  const [steps, setSteps] = useState<BuilderStep[]>(
    BUILDER_STEPS.map((s) => ({ ...s, state: "pending" })),
  );
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    const next: BuilderStep[] = BUILDER_STEPS.map((s) => ({ ...s, state: "pending" }));
    setSteps(next);
    for (let i = 0; i < next.length; i++) {
      next[i] = { ...next[i], state: "running" };
      setSteps([...next]);
      await new Promise((r) => setTimeout(r, 400));
      next[i] = { ...next[i], state: "done" };
      setSteps([...next]);
    }
    setRunning(false);
    toast.success("Build complete");
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Walk the blueprint through the build pipeline. Use the Code tab to regenerate after edits.
      </p>
      <BuilderProgress steps={steps} />
      <Button onClick={run} disabled={running}>
        {running ? (
          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
        ) : (
          <Play className="h-4 w-4 mr-1.5" />
        )}
        {running ? "Building…" : "Run build"}
      </Button>
      <p className="text-xs text-muted-foreground">
        EA for <span className="font-mono">{blueprint.execution.symbol}</span> on{" "}
        {blueprint.execution.entryTimeframe} · {blueprint.rules.length} rule(s) · confidence{" "}
        {blueprint.confidence}%
      </p>
    </div>
  );
}

function CodeTab({
  strategyId,
  strategyName,
  blueprint,
  code,
  onCodeChange,
  onAutoSave,
  prompt,
}: {
  strategyId: string;
  strategyName: string;
  blueprint: StrategyBlueprint;
  code: string;
  onCodeChange: (code: string) => void;
  onAutoSave?: (code: string, nextBlueprint?: StrategyBlueprint) => Promise<void>;
  /** Original user prompt from /new — enables AI generation from description */
  prompt?: string;
}) {
  const [generating, setGenerating] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [compileLog, setCompileLog] = useState<string | null>(null);
  const [aiWiring] = useState<AiWiringInsightData | null>(blueprint.aiWiringDiagnostics ?? null);
  const generationGate = validateBlueprintForGeneration(blueprint);
  const generationError = generationGate.ok ? undefined : generationGate.errors[0];

  const companion = useQuery({
    queryKey: ["local-runner-health"],
    queryFn: getLocalRunnerHealth,
    retry: false,
    refetchInterval: 10000,
    staleTime: 8000,
  });
  const companionOnline = Boolean(companion.data?.ok);

  const generateTemplate = async () => {
    if (generationError) {
      toast.error(generationError);
      return;
    }
    setGenerating(true);
    try {
      const result = generateEaFromBlueprint(blueprint);
      if (onAutoSave) {
        await onAutoSave(result.code);
        toast.success(`EA generated & saved — ${generationPathLabel(result.path)}`);
      } else {
        onCodeChange(result.code);
        toast.success(`EA generated — ${generationPathLabel(result.path)}`);
      }
    } catch (e: unknown) {
      toast.error(e instanceof EaGenerationError ? e.message : "Template generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const compile = async () => {
    if (!code) return;
    setCompiling(true);
    setCompileLog(null);
    try {
      const filename = buildExportFilename(blueprint, "mq5");
      const approval = await buildRunnerApproval(code, "compile");
      const result = await compileEa({
        strategyId,
        strategyName,
        eaFilename: filename,
        sourceCode: code,
        approval,
      });
      setCompileLog(result.log);
      if (result.success) {
        toast.success(`Compiled — ${result.errors} errors, ${result.warnings} warnings`);
      } else {
        toast.error(`Compile failed — ${result.errors} error(s). See log below.`);
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Compile failed");
    } finally {
      setCompiling(false);
    }
  };

  // No code yet — run buildability check, then surface generate options
  const filename = buildExportFilename(blueprint, "mq5");

  const copyCode = async () => {
    if (!code.trim()) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const downloadCode = () => {
    if (!code.trim()) return;
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const saveCode = async () => {
    if (!code.trim()) {
      toast.error("Paste or write MQL5 code first");
      return;
    }
    if (!onAutoSave) {
      toast.success("Code updated. Use Save changes to persist it.");
      return;
    }
    try {
      await onAutoSave(code, blueprint);
      toast.success("Code saved");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Code save failed");
    }
  };

  const editorPanel = (
    <div className="rounded-md border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-muted/30">
        <div className="min-w-0 flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono truncate">{filename}</span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
            editable mql5
          </span>
          {code.trim() && (
            <span className="text-[10px] text-muted-foreground/60">
              {code.split("\n").length} lines
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="ghost" onClick={saveCode} disabled={!code.trim()}>
            <Save className="h-3.5 w-3.5 mr-1" />
            Save Code
          </Button>
          <Button size="sm" variant="ghost" onClick={copyCode} disabled={!code.trim()}>
            {copied ? (
              <Check className="h-3.5 w-3.5 mr-1" />
            ) : (
              <Copy className="h-3.5 w-3.5 mr-1" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button size="sm" variant="ghost" onClick={downloadCode} disabled={!code.trim()}>
            <Download className="h-3.5 w-3.5 mr-1" /> Download
          </Button>
        </div>
      </div>
      <textarea
        value={code}
        onChange={(event) => onCodeChange(event.currentTarget.value)}
        spellCheck={false}
        placeholder={
          "// Paste or write a complete MT5 Expert Advisor here.\n// Then click Save Code, Compile, and run Backtest."
        }
        className="block h-[68vh] min-h-[420px] w-full resize-y bg-[#111827] px-4 py-3 font-mono text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
      />
    </div>
  );

  if (!code) {
    const build = analyzeBuildability(blueprint);
    const pillColor =
      build.coverage === 100
        ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
        : build.coverage >= 60
          ? "border-amber-500/40 text-amber-400 bg-amber-500/10"
          : "border-destructive/40 text-destructive bg-destructive/10";

    return (
      <div className="max-w-5xl mx-auto py-6 space-y-5">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="font-semibold text-base">Manual MQL5 workspace</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Paste or write any complete MT5 EA here, then save, compile, and backtest it.
              </p>
            </div>
            {companionOnline ? (
              <Button
                size="sm"
                variant="outline"
                onClick={compile}
                disabled={compiling || !code.trim()}
                title="Compile this editor content with local MetaEditor"
              >
                {compiling ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Hammer className="h-4 w-4 mr-1.5" />
                )}
                {compiling ? "Compiling..." : "Compile"}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" className="text-muted-foreground" disabled>
                <WifiOff className="h-3.5 w-3.5 mr-1.5" />
                Companion offline
              </Button>
            )}
          </div>
          {editorPanel}
          {compileLog && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Compile log</p>
              <pre className="rounded-md border border-border bg-card p-3 text-xs font-mono whitespace-pre-wrap max-h-64 overflow-auto">
                {compileLog}
              </pre>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 h-px bg-border" />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
            or generate from strategy
          </span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Status header */}
        <div className="flex items-start gap-3">
          <FileCode2 className="h-8 w-8 text-muted-foreground/40 shrink-0 mt-1" />
          <div>
            <p className="font-semibold text-base">Generate MQL5 Expert Advisor</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              The blueprint assembler maps your strategy to verified state-machine code.
            </p>
          </div>
        </div>

        <BlueprintExplanationPanel blueprint={blueprint} />

        {/* Primitive mapping summary */}
        <div
          className={`rounded-lg border p-4 space-y-3 ${
            build.buildable && build.unsupportedCount === 0
              ? "border-emerald-500/30 bg-emerald-500/5"
              : build.buildable
                ? "border-amber-500/30 bg-amber-500/5"
                : "border-destructive/30 bg-destructive/5"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium">
              {build.buildable && build.unsupportedCount === 0
                ? "All rules mapped — ready to generate"
                : build.buildable
                  ? `${build.supportedCount} of ${blueprint.rules.length} rules have primitives`
                  : "No entry trigger has an implementation yet"}
            </p>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${pillColor}`}>
              {build.coverage}% coverage
            </span>
          </div>

          {build.unsupportedCount > 0 && (
            <div className="space-y-1">
              {build.statuses.map(({ rule, category }) =>
                category === "unsupported" ? (
                  <div key={rule.id} className="flex items-start gap-2 text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                    <span className="text-destructive/80">{rule.label}</span>
                    <span className="ml-auto shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-destructive/15 text-destructive font-medium uppercase">
                      no primitive
                    </span>
                  </div>
                ) : null,
              )}
              <p className="text-[11px] text-muted-foreground pt-1">
                These rules will be skipped. Go to New Strategy and re-interview with a more
                specific description.
              </p>
            </div>
          )}
          {build.hasFvgMachine && (
            <p className="text-[11px] text-violet-400/80">
              ⚙ FVG state machine active — retest, confirmation, invalidation, expiry, SL and
              break-even are all implemented.
            </p>
          )}
        </div>

        {/* Generation */}
        <div className="space-y-3">
          <Button
            onClick={generateTemplate}
            disabled={generating || !build.buildable || Boolean(generationError)}
            size="lg"
            className="w-full"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Hammer className="h-4 w-4 mr-1.5" />
                Generate EA
              </>
            )}
          </Button>
          <p className="text-[11px] text-center text-muted-foreground">
            {generationError
              ? `Generation blocked: ${generationError}`
              : "Compiles your blueprint via the Strategy Flow engine (verified modules). Use the AI Assistant to debug or refine the strategy."}
          </p>

          {!build.buildable && (
            <p className="text-[11px] text-center text-muted-foreground">
              Add a supported entry trigger in the Brains tab, or refine the strategy in /new.
            </p>
          )}
          {generationError && (
            <p className="text-[11px] text-center text-destructive/80">
              Fix validation errors before generating (Blueprint Audit + Strategy Flow).
            </p>
          )}
        </div>

        <AiWiringInsight wiring={aiWiring} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-muted-foreground">
          Editable MQL5 workspace - paste, modify, save, compile, and backtest any complete EA.
        </p>
        <div className="flex items-center gap-2">
          {/* Companion compile button */}
          {companionOnline ? (
            <Button
              size="sm"
              variant="outline"
              onClick={compile}
              disabled={compiling || !code.trim()}
              title="Compile with local MetaEditor via Desktop Companion"
            >
              {compiling ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Hammer className="h-4 w-4 mr-1.5" />
              )}
              {compiling ? "Compiling…" : "Compile"}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => openMetaEditor(filename).catch(() => {})}
              title="Companion offline — open MetaEditor manually"
              disabled
            >
              <WifiOff className="h-3.5 w-3.5 mr-1.5" />
              Companion offline
            </Button>
          )}
          <Button
            size="sm"
            onClick={generateTemplate}
            disabled={generating || Boolean(generationError)}
            title="Regenerate from Strategy Flow blueprint"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Hammer className="h-4 w-4 mr-1.5" />
            )}
            Regenerate EA
          </Button>
        </div>
      </div>
      <AiWiringInsight wiring={aiWiring} />
      {editorPanel}
      {compileLog && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Compile log</p>
          <pre className="rounded-md border border-border bg-card p-3 text-xs font-mono whitespace-pre-wrap max-h-64 overflow-auto">
            {compileLog}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Backtest helpers ─────────────────────────────────────────────────────────

function todayDot() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, ".");
}

function mt5TesterSymbol(symbol?: string | null) {
  const clean = String(symbol ?? "").trim();
  return clean && clean.toUpperCase() !== "ANY" ? clean : "EURUSD";
}

function oneYearAgoDot() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10).replace(/-/g, ".");
}

function fmt(n: number | null | undefined, decimals = 2) {
  if (n === null || n === undefined) return "—";
  return n.toFixed(decimals);
}

function MetricCard({
  label,
  value,
  sub,
  positive,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
}) {
  const color =
    positive === true
      ? "text-emerald-400"
      : positive === false
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function BacktestTab({
  strategyId,
  strategyName,
  blueprint,
  code,
  onCompileLog,
  onBacktestSummary,
  onBacktestLog,
  onDiagnosticContext,
  onOpenChat,
  onApplyCode,
  periodPatch,
  onPeriodPatchApplied,
  suggestedPeriod,
}: {
  strategyId: string;
  strategyName: string;
  blueprint: StrategyBlueprint;
  code: string;
  onCompileLog?: (log: string | null) => void;
  onBacktestSummary?: (summary: ReportSummary | null) => void;
  onBacktestLog?: (log: string | null) => void;
  onDiagnosticContext?: (context: unknown) => void;
  onOpenChat?: (message?: string) => void;
  onApplyCode?: (code: string) => void;
  periodPatch?: string | null;
  onPeriodPatchApplied?: () => void;
  suggestedPeriod?: string;
}) {
  const companion = useQuery({
    queryKey: ["local-runner-health"],
    queryFn: getLocalRunnerHealth,
    retry: false,
    refetchInterval: 10000,
    staleTime: 8000,
  });
  const mt5Status = useQuery({
    queryKey: ["mt5-status-backtest"],
    queryFn: getMt5Status,
    enabled: Boolean(companion.data?.ok),
    retry: false,
    refetchInterval: 15000,
  });

  const companionOnline = Boolean(companion.data?.ok);
  const mt5Configured = Boolean(mt5Status.data?.configuredTerminalPath);

  const [localApproval, setLocalApproval] = useState(false);
  const [config, setConfig] = useState<
    Omit<TesterConfig, "expertName" | "reportName" | "visualMode" | "optimization">
  >({
    symbol: mt5TesterSymbol(blueprint.execution.symbol),
    period: suggestedPeriod || blueprint.execution.entryTimeframe || "H1",
    model: "open_prices",
    fromDate: oneYearAgoDot(),
    toDate: todayDot(),
    deposit: 10000,
    currency: "USD",
    leverage: "1:100",
    useLocalAgents: true,
    useRemoteAgents: false,
    useCloudAgents: false,
  });

  useEffect(() => {
    if (!periodPatch) return;
    setConfig((c) => ({ ...c, period: periodPatch }));
    onPeriodPatchApplied?.();
  }, [periodPatch, onPeriodPatchApplied]);

  // Compile (async — server returns 202 immediately, job runs in background)
  const [fixingAi, setFixingAi] = useState(false);
  const [compileJobId, setCompileJobId] = useState<string | null>(null);
  const [compilePolling, setCompilePolling] = useState(false);
  const [compileResult, setCompileResult] = useState<CompileResult | null>(null);
  const [backtestJobId, setBacktestJobId] = useState<string | null>(null);
  const [visualJobId, setVisualJobId] = useState<string | null>(null);
  const [backtestPolling, setBacktestPolling] = useState(false);
  const [visualPolling, setVisualPolling] = useState(false);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [downloadingTesterLog, setDownloadingTesterLog] = useState(false);
  const processedJobIds = useRef(new Set<string>());

  const compileMut = useMutation({
    mutationFn: async () => {
      const filename = buildExportFilename(blueprint, "mq5");
      const approval = await buildRunnerApproval(code, "compile");
      return compileEa({
        strategyId,
        strategyName,
        eaFilename: filename,
        sourceCode: code,
        approval,
      });
    },
    onSuccess: (result) => {
      setCompileResult(null);
      setCompileJobId(result.job.id);
      setCompilePolling(true);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Compile failed"),
  });

  const compileJobQuery = useQuery({
    queryKey: ["runner-job", compileJobId],
    queryFn: () => getRunnerJob(compileJobId!),
    enabled: Boolean(compileJobId) && compilePolling,
    refetchInterval: compilePolling ? 1500 : false,
  });

  useEffect(() => {
    const data = compileJobQuery.data;
    if (!data?.job) return;
    const { status, id } = data.job;
    if ((status === "succeeded" || status === "failed") && !processedJobIds.current.has(id)) {
      processedJobIds.current.add(id);
      setCompilePolling(false);
      const result = data as unknown as CompileResult;
      setCompileResult(result);
      onCompileLog?.(result.log ?? null);
      if (status === "succeeded" && result.success) {
        toast.success(`Compiled — ${result.errors ?? 0}E ${result.warnings ?? 0}W`);
      } else {
        toast.error(`Compile failed — ${result.errors ?? "?"}E. See compile log.`);
      }
    }
  }, [compileJobQuery.data, onCompileLog]);

  const compileSucceeded = compileResult?.success === true;
  const backtestBlockedByRunningTerminal =
    backtestResult?.success === false &&
    /terminal is already running|close metatrader 5/i.test(
      `${backtestResult.job?.message ?? ""}\n${backtestResult.log ?? ""}`,
    );

  const backtestJobQuery = useQuery({
    queryKey: ["runner-job", backtestJobId],
    queryFn: () => getRunnerJob(backtestJobId!),
    enabled: Boolean(backtestJobId) && backtestPolling,
    refetchInterval: backtestPolling ? 1500 : false,
  });

  const visualJobQuery = useQuery({
    queryKey: ["runner-job", visualJobId],
    queryFn: () => getRunnerJob(visualJobId!),
    enabled: Boolean(visualJobId) && visualPolling,
    refetchInterval: visualPolling ? 1500 : false,
  });

  useEffect(() => {
    const data = backtestJobQuery.data;
    if (!data?.job) return;
    const { status, id } = data.job;
    if ((status === "succeeded" || status === "failed") && !processedJobIds.current.has(id)) {
      processedJobIds.current.add(id);
      setBacktestPolling(false);
      const result = data as BacktestResult;
      setBacktestResult(result);
      onBacktestSummary?.(result.summary ?? null);
      onBacktestLog?.(result.log ?? null);
      if (status === "succeeded") {
        toast.success("Backtest report ready");
      } else {
        toast.error("Backtest failed — " + (data.job.message || "see tester log"));
      }
    }
  }, [backtestJobQuery.data, onBacktestLog, onBacktestSummary]);

  useEffect(() => {
    const data = visualJobQuery.data;
    if (!data?.job) return;
    const { status, id } = data.job;
    if ((status === "succeeded" || status === "failed") && !processedJobIds.current.has(id)) {
      processedJobIds.current.add(id);
      setVisualPolling(false);
      if (status === "succeeded") {
        toast.success("Visual test launched — watch MT5");
      } else {
        toast.error("Visual test failed — " + (data.job.message || "see log"));
      }
    }
  }, [visualJobQuery.data]);

  const backtestMut = useMutation({
    mutationFn: async () => {
      const filename = buildExportFilename(blueprint, "mq5");
      const approval = await buildRunnerApproval(code, "backtest");
      const testerConfig: TesterConfig = {
        ...config,
        expertName: filename.replace(/\.mq5$/i, ""),
        reportName: `${strategyId}-report`,
        visualMode: false,
        optimization: false,
      };
      const res = await submitBacktest({
        strategyId,
        strategyName,
        eaFilename: filename,
        sourceCode: code,
        approval,
        testerConfig,
      });
      setBacktestResult(null);
      onBacktestSummary?.(null);
      onBacktestLog?.(null);
      setBacktestJobId(res.job.id);
      setBacktestPolling(true);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Failed to start backtest"),
  });

  const visualMut = useMutation({
    mutationFn: async () => {
      const filename = buildExportFilename(blueprint, "mq5");
      const approval = await buildRunnerApproval(code, "backtest");
      const testerConfig: TesterConfig = {
        ...config,
        expertName: filename.replace(/\.mq5$/i, ""),
        reportName: `${strategyId}-visual`,
        visualMode: true,
        optimization: false,
      };
      const res = await submitBacktest({
        strategyId,
        strategyName,
        eaFilename: filename,
        sourceCode: code,
        approval,
        testerConfig,
      });
      setVisualJobId(res.job.id);
      setVisualPolling(true);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Failed to start visual test"),
  });

  const set = <K extends keyof typeof config>(k: K, v: (typeof config)[K]) =>
    setConfig((c) => ({ ...c, [k]: v }));

  useEffect(() => {
    onDiagnosticContext?.({
      updatedAt: new Date().toISOString(),
      runner: {
        companionOnline,
        runnerVersion: companion.data?.version ?? null,
        mt5Configured,
        mt5Status: mt5Status.data?.status ?? null,
        configuredTerminal: mt5Status.data?.configuredTerminalPath?.split(/[\\/]/).at(-1) ?? null,
        activeJobId: mt5Status.data?.activeJobId ?? null,
        message: mt5Status.data?.message ?? null,
      },
      testerConfig: config,
      approval: {
        localApproval,
      },
      compile: {
        running: compileMut.isPending || compilePolling,
        jobId: compileJobId,
        success: compileResult?.success ?? null,
        errors: compileResult?.errors ?? null,
        warnings: compileResult?.warnings ?? null,
        artifactPath: compileResult?.artifactPath ?? null,
        executablePath: compileResult?.executablePath ?? null,
      },
      backtest: {
        running: backtestMut.isPending || backtestPolling,
        jobId: backtestJobId,
        success: backtestResult?.success ?? null,
        totalTrades: backtestResult?.summary?.totalTrades ?? null,
        reportPath: backtestResult?.reportPath ?? null,
        blockedByRunningTerminal: backtestBlockedByRunningTerminal,
      },
      visual: {
        running: visualMut.isPending || visualPolling,
        jobId: visualJobId,
      },
      tradeAudit: summarizeTradeAudit(
        buildExpectedTradePath(blueprint),
        backtestResult?.log ? parseTesterLogForTradeAudit(backtestResult.log) : null,
      ),
    });
  }, [
    backtestBlockedByRunningTerminal,
    backtestJobId,
    backtestMut.isPending,
    backtestPolling,
    backtestResult,
    blueprint,
    companion.data,
    companionOnline,
    compileJobId,
    compileMut.isPending,
    compilePolling,
    compileResult,
    config,
    localApproval,
    mt5Configured,
    mt5Status.data,
    onDiagnosticContext,
    visualJobId,
    visualMut.isPending,
    visualPolling,
  ]);

  // ── Guard states ──
  if (!code) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center max-w-sm mx-auto">
        <BarChart2 className="h-10 w-10 text-muted-foreground/30" />
        <p className="font-medium">No code yet</p>
        <p className="text-sm text-muted-foreground">Generate MQL5 code on the Code tab first.</p>
      </div>
    );
  }
  if (!companionOnline) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center max-w-sm mx-auto">
        <WifiOff className="h-10 w-10 text-muted-foreground/30" />
        <p className="font-medium">Companion offline</p>
        <p className="text-sm text-muted-foreground">
          Start the desktop companion and configure MT5 in Settings.
        </p>
      </div>
    );
  }
  if (!mt5Configured) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center max-w-sm mx-auto">
        <BarChart2 className="h-10 w-10 text-muted-foreground/30" />
        <p className="font-medium">MT5 not configured</p>
        <p className="text-sm text-muted-foreground">
          Select your MT5 terminal in Settings before running a backtest.
        </p>
      </div>
    );
  }

  const compileRunning = compileMut.isPending || compilePolling;
  const backtestRunning = backtestMut.isPending || backtestPolling;
  const visualRunning = visualMut.isPending || visualPolling;
  const anyRunning = compileRunning || backtestRunning || visualRunning;
  const summary: ReportSummary | null = backtestResult?.summary ?? null;
  const artifactJobId = backtestResult?.job?.id ?? backtestJobId;
  const artifactBaseName = safeDownloadName(
    `${strategyName || blueprint.name || strategyId}-${config.symbol}-${config.period}`,
  );

  const backtestJobStatus = backtestJobQuery.data?.job?.status ?? null;
  const visualJobStatus = visualJobQuery.data?.job?.status ?? null;

  const downloadBacktestReport = async () => {
    setDownloadingReport(true);
    try {
      let html = backtestResult?.reportHtml ?? null;
      if (!html && artifactJobId) {
        const report = await getRunnerJobReport(artifactJobId);
        html = report.html;
      }
      if (!html) throw new Error("No backtest report is available yet");
      downloadText(`${artifactBaseName}-backtest-report.html`, html, "text/html");
      toast.success("Backtest report downloaded");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not download report");
    } finally {
      setDownloadingReport(false);
    }
  };

  const downloadTesterLog = async () => {
    setDownloadingTesterLog(true);
    try {
      let log = backtestResult?.log ?? "";
      if (artifactJobId) {
        const jobLog = await getRunnerJobLog(artifactJobId);
        if (jobLog.lines?.length) log = jobLog.lines.join("\n");
      }
      if (!log.trim()) throw new Error("No tester log is available yet");
      downloadText(`${artifactBaseName}-tester-log.txt`, log, "text/plain");
      toast.success("Tester log downloaded");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not download tester log");
    } finally {
      setDownloadingTesterLog(false);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Status cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-md border border-border bg-background/50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Companion</p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-sm font-medium">v{companion.data?.version ?? "?"}</span>
          </div>
        </div>
        <div className="rounded-md border border-border bg-background/50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">MT5</p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-sm font-medium truncate">
              {mt5Status.data?.configuredTerminalPath?.split(/[\\/]/).at(-2) ?? "Configured"}
            </span>
          </div>
        </div>
        <div className="rounded-md border border-border bg-background/50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">EA source</p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-sm font-medium">{Math.round(code.length / 1024)} KB</span>
          </div>
        </div>
        <div className="rounded-md border border-border bg-background/50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Compile</p>
          <div className="mt-1.5 flex items-center gap-1.5">
            {compileRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : compileResult?.success === true ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            ) : compileResult?.success === false ? (
              <XCircle className="h-3.5 w-3.5 text-destructive" />
            ) : (
              <div className="h-3.5 w-3.5 rounded-full border-2 border-border" />
            )}
            <span className="text-sm font-medium">
              {compileRunning
                ? "Running…"
                : compileResult?.success === true
                  ? `OK · ${compileResult.warnings}w`
                  : compileResult?.success === false
                    ? `${compileResult.errors}E ${compileResult.warnings}W`
                    : "Not compiled"}
            </span>
          </div>
        </div>
      </div>

      {/* Config + actions */}
      <div className="rounded-md border border-border bg-card p-4 space-y-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Tester configuration
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Symbol</Label>
            <Input
              value={config.symbol}
              onChange={(e) => set("symbol", e.target.value)}
              className="font-mono text-sm"
              placeholder="EURUSD"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Timeframe</Label>
            <Select value={config.period} onValueChange={(v) => set("period", v)}>
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"].map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Model</Label>
            <Select
              value={config.model}
              onValueChange={(v) => set("model", v as TesterConfig["model"])}
            >
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open_prices">Open prices only</SelectItem>
                <SelectItem value="one_minute_ohlc">1 min OHLC</SelectItem>
                <SelectItem value="every_tick">Every tick</SelectItem>
                <SelectItem value="real_ticks">Real ticks</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Leverage</Label>
            <Select value={config.leverage} onValueChange={(v) => set("leverage", v)}>
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["1:50", "1:100", "1:200", "1:500", "1:1000"].map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">From date</Label>
            <Input
              value={config.fromDate}
              onChange={(e) => set("fromDate", e.target.value)}
              placeholder="2024.01.01"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To date</Label>
            <Input
              value={config.toDate}
              onChange={(e) => set("toDate", e.target.value)}
              placeholder="2024.12.31"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Deposit</Label>
            <Input
              type="number"
              value={config.deposit}
              onChange={(e) => set("deposit", Number(e.target.value))}
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Currency</Label>
            <Input
              value={config.currency}
              onChange={(e) => set("currency", e.target.value)}
              className="font-mono text-sm"
              placeholder="USD"
            />
          </div>
        </div>

        {suggestedPeriod && config.period !== suggestedPeriod && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
            <span>
              Strategy flow uses <strong>{suggestedPeriod}</strong> but tester is on{" "}
              <strong>{config.period}</strong> — this often causes zero trades.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] border-amber-500/40"
              onClick={() => set("period", suggestedPeriod)}
            >
              Use {suggestedPeriod}
            </Button>
          </div>
        )}

        {/* Approval */}
        <div className="flex items-start gap-2 pt-1">
          <Checkbox
            id="local-approval"
            checked={localApproval}
            onCheckedChange={(v) => setLocalApproval(Boolean(v))}
            className="mt-0.5"
          />
          <label
            htmlFor="local-approval"
            className="text-xs text-muted-foreground leading-relaxed cursor-pointer select-none"
          >
            I approve this generated EA source for local compile &amp; testing on this computer
            only. I understand it does not perform live trading.
          </label>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => compileMut.mutate()}
            disabled={anyRunning || !localApproval}
            className="min-w-[120px]"
          >
            {compileRunning ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Compiling…
              </>
            ) : (
              <>
                <Hammer className="h-4 w-4 mr-1.5" /> Compile EA
              </>
            )}
          </Button>

          <div className="h-5 w-px bg-border mx-1 hidden sm:block" />

          <Button
            size="sm"
            onClick={() => backtestMut.mutate()}
            disabled={anyRunning || !compileSucceeded || !localApproval}
            className="min-w-[160px]"
            title={!compileSucceeded ? "Compile EA first" : undefined}
          >
            {backtestRunning ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                {backtestJobStatus === "running" ? "Tester running…" : "Launching…"}
              </>
            ) : (
              <>
                <BarChart2 className="h-4 w-4 mr-1.5" /> Run Report Backtest
              </>
            )}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => visualMut.mutate()}
            disabled={anyRunning || !compileSucceeded || !localApproval}
            className="min-w-[140px]"
            title={!compileSucceeded ? "Compile EA first" : undefined}
          >
            {visualRunning ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                {visualJobStatus === "running" ? "Visual running…" : "Launching…"}
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-1.5" /> Run Visual Test
              </>
            )}
          </Button>
        </div>

        {backtestBlockedByRunningTerminal && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-300 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-100">
                EA compiled, but MT5 is already open
              </p>
              <p className="text-xs text-amber-100/80">
                Close MetaTrader 5 completely, then run the report backtest again. The local runner
                launches MT5 with a tester config file, and an already-open terminal can ignore that
                config or collide with the tester profile.
              </p>
            </div>
          </div>
        )}

        {/* Compile error banner */}
        {compileResult &&
          !compileResult.success &&
          compileResult.errors > 0 &&
          (() => {
            // 4-Brain EAs are assembled from proven inline state machines + AI wiring.
            // A freeform AI rewrite would destroy the structure (it rewrites 800+ lines
            // and truncates). The correct fix is to regenerate — template or AI Rebuild
            // from the Brains tab — NOT a freeform rewrite.
            const isFourBrain = Boolean(blueprint.fourBrain);
            const isBlueprintCode = code.includes("(blueprint SM)");
            const isLegacyTemplateCode = code.includes("template mode — always compiles");
            return (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-3">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-destructive">
                    {compileResult.errors} compile error{compileResult.errors !== 1 ? "s" : ""} —
                    fix the code before backtesting
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {fixingAi
                      ? "Generating fixed code — this takes 15–30 seconds…"
                      : isFourBrain
                        ? "This is a 4-Brain EA. Regenerate from Blueprint (instant, verified SMs) or use AI Rebuild on the Brains tab. Do NOT use freeform AI fix — it rewrites the whole file."
                        : isBlueprintCode || isLegacyTemplateCode
                          ? "This is blueprint-generated code. Regenerating from the blueprint is faster and safer than AI rewrite."
                          : "Click Fix with AI to automatically correct all errors in one step."}
                  </p>
                </div>
                {onApplyCode && (
                  <div className="flex items-center gap-2 shrink-0">
                    {(isFourBrain || isBlueprintCode || isLegacyTemplateCode) && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={fixingAi}
                        className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 shrink-0"
                        onClick={() => {
                          try {
                            onApplyCode(generateMql5FromBlueprint(blueprint));
                            toast.success("Regenerated from blueprint — recompile to verify");
                          } catch (e: unknown) {
                            toast.error(
                              e instanceof Error ? e.message : "Blueprint generation failed",
                            );
                          }
                        }}
                      >
                        <Hammer className="h-3.5 w-3.5 mr-1.5" /> Regen from Blueprint
                      </Button>
                    )}
                    {/* Freeform AI fix — ONLY for non-4-brain, raw AI-generated code */}
                    {!isFourBrain && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={fixingAi}
                        onClick={async () => {
                          if (!compileResult.log) return;
                          setFixingAi(true);
                          try {
                            const result = await fixCompileErrors(
                              blueprint,
                              code,
                              compileResult.log,
                            );
                            onApplyCode(result.code);
                            toast.success("AI fixed the code — recompile to verify");
                          } catch (e: unknown) {
                            toast.error(
                              e instanceof Error ? e.message : "Fix failed — please try again",
                            );
                          } finally {
                            setFixingAi(false);
                          }
                        }}
                        className="shrink-0"
                      >
                        {fixingAi ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Fixing…
                          </>
                        ) : (
                          <>
                            <Bot className="h-3.5 w-3.5 mr-1.5" /> Fix with AI
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

        {/* Never compiled hint */}
        {!compileResult && !compileRunning && localApproval && (
          <p className="text-xs text-muted-foreground">
            Compile the EA first, then choose a backtest mode.
          </p>
        )}

        {visualRunning && (
          <p className="text-xs text-muted-foreground">
            MT5 visual test is running — watch MetaTrader 5 for the strategy tester window. No
            report will be generated for visual tests.
          </p>
        )}
        {backtestRunning && (
          <p className="text-xs text-muted-foreground">
            MT5 Strategy Tester running in background — report will appear below when complete.
          </p>
        )}
      </div>

      {/* Compile log */}
      {compileResult?.log && (
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Compile log</p>
          <pre className="rounded-md border border-border bg-card p-3 text-xs font-mono whitespace-pre-wrap max-h-52 overflow-auto">
            {compileResult.log}
          </pre>
        </div>
      )}

      {/* Report results */}
      {backtestResult && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            {backtestResult.success ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-destructive" />
            )}
            <p className="text-sm font-medium">
              {backtestResult.success ? "Report backtest completed" : "Backtest failed"}
            </p>
            <span className="text-xs text-muted-foreground">
              {config.symbol} · {config.period} · {config.fromDate} → {config.toDate}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={downloadBacktestReport}
              disabled={downloadingReport || (!backtestResult.reportHtml && !artifactJobId)}
            >
              {downloadingReport ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5 mr-1.5" />
              )}
              Report
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={downloadTesterLog}
              disabled={downloadingTesterLog || (!backtestResult.log && !artifactJobId)}
            >
              {downloadingTesterLog ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <FileText className="h-3.5 w-3.5 mr-1.5" />
              )}
              Tester log
            </Button>
            {!backtestResult.success && onOpenChat && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onOpenChat(
                    "Diagnosis mode: Backtest failed. Use the compile log, tester log, runner status, generated code, blueprint, and module contracts. Tell me whether this is an EA logic problem, MT5 runner/tester problem, symbol/data issue, or risk/filter issue. End with the safest next action.",
                  )
                }
              >
                <Bot className="h-3.5 w-3.5 mr-1.5" />
                Ask AI
              </Button>
            )}
            {backtestResult.success && summary?.totalTrades === 0 && onOpenChat && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onOpenChat(
                    "Diagnosis mode: Why no trades? The backtest completed with zero trades. Use the original prompt, blueprint, module contracts, generated code, tester log, and backtest summary. Identify the exact gate that prevented entries: direction, setup, execution, management/risk, spread, max stop, max trades, date/data, or tester config. End with the safest next app action.",
                  )
                }
              >
                <Bot className="h-3.5 w-3.5 mr-1.5" />
                Why no trades?
              </Button>
            )}
          </div>

          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard
                label="Net Profit"
                value={`${summary.currency ?? ""}${fmt(summary.netProfit)}`}
                positive={summary.netProfit !== null ? summary.netProfit >= 0 : undefined}
              />
              <MetricCard
                label="Profit Factor"
                value={fmt(summary.profitFactor)}
                positive={summary.profitFactor !== null ? summary.profitFactor >= 1 : undefined}
              />
              <MetricCard
                label="Max Drawdown"
                value={`${fmt(summary.maximalDrawdown)}%`}
                positive={
                  summary.maximalDrawdown !== null ? summary.maximalDrawdown < 20 : undefined
                }
              />
              <MetricCard
                label="Win Rate"
                value={summary.winRate !== null ? `${fmt(summary.winRate)}%` : "—"}
                positive={summary.winRate !== null ? summary.winRate >= 50 : undefined}
              />
              <MetricCard label="Total Trades" value={fmt(summary.totalTrades, 0)} />
              <MetricCard
                label="Initial Deposit"
                value={`${summary.currency ?? ""}${fmt(summary.initialDeposit, 0)}`}
              />
              <MetricCard
                label="Final Balance"
                value={`${summary.currency ?? ""}${fmt(summary.finalBalance, 0)}`}
                positive={
                  summary.finalBalance !== null && summary.initialDeposit !== null
                    ? summary.finalBalance >= summary.initialDeposit
                    : undefined
                }
              />
              <MetricCard
                label="Expected Payoff"
                value={fmt(summary.expectedPayoff)}
                positive={summary.expectedPayoff !== null ? summary.expectedPayoff > 0 : undefined}
              />
            </div>
          )}

          <TradeAuditPanel blueprint={blueprint} testerLog={backtestResult.log} />

          {backtestResult.log && (
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Tester log</p>
              <pre className="rounded-md border border-border bg-card p-3 text-xs font-mono whitespace-pre-wrap max-h-64 overflow-auto">
                {backtestResult.log}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReportCard({
  title,
  value,
  tone = "default",
}: {
  title: string;
  value: ReactNode;
  tone?: "default" | "ok" | "warn";
}) {
  const toneCls =
    tone === "ok" ? "text-emerald-400" : tone === "warn" ? "text-amber-400" : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className={`mt-1.5 text-sm font-medium ${toneCls}`}>{value}</div>
    </div>
  );
}

function ValidationTab({ blueprint }: { blueprint: StrategyBlueprint }) {
  const report = buildValidationReport(blueprint);
  const warnings = (report.match(/\[WARN\]/g) || []).length;
  const compilablePct =
    blueprint.rules.length > 0
      ? Math.round((blueprint.compilableRuleIds.length / blueprint.rules.length) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <ReportCard
          title="Compile"
          value={
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" /> 0 errors
            </span>
          }
          tone="ok"
        />
        <ReportCard title="Warnings" value={`${warnings}`} tone={warnings ? "warn" : "ok"} />
        <ReportCard
          title="Compilability"
          value={`${compilablePct}%`}
          tone={compilablePct >= 80 ? "ok" : compilablePct >= 50 ? "warn" : "default"}
        />
        <ReportCard title="AI Confidence" value={`${blueprint.confidence}%`} />
        <ReportCard title="Symbol" value={blueprint.execution.symbol} />
        <ReportCard title="Risk" value={`${blueprint.risk.riskPercent}% / trade`} />
        <ReportCard title="Rules" value={`${blueprint.rules.length} extracted`} />
        <ReportCard
          title="Clarifications"
          value={blueprint.pendingClarifications.length}
          tone={blueprint.pendingClarifications.length > 0 ? "warn" : "ok"}
        />
      </div>
      <div>
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
          Validation notes
        </h3>
        <pre className="rounded-md border border-border bg-card p-4 text-xs font-mono whitespace-pre-wrap">
          {report}
        </pre>
      </div>
    </div>
  );
}

function ExportTab({
  blueprint,
  prompt,
  code,
}: {
  blueprint: StrategyBlueprint;
  prompt: string;
  code: string;
}) {
  const items = [
    {
      key: "ea",
      icon: FileCode2,
      title: "Expert Advisor",
      desc: "MQL5 source for MetaEditor",
      filename: buildExportFilename(blueprint, "mq5"),
      content: code,
      mime: "text/plain",
    },
    {
      key: "blueprint",
      icon: FileJson,
      title: "Strategy blueprint",
      desc: "Full blueprint JSON (re-importable)",
      filename: buildExportFilename(blueprint, "json"),
      content: JSON.stringify({ prompt, blueprint }, null, 2),
      mime: "application/json",
    },
    {
      key: "ai-diagnostics",
      icon: FileJson,
      title: "AI wiring diagnostics",
      desc: blueprint.aiWiringDiagnostics
        ? "AI semantics, validation, repair status and SM wiring"
        : "No AI wiring diagnostics saved yet",
      filename: `${safeDownloadName(blueprint.name || "strategy")}-ai-diagnostics.json`,
      content: buildAiDiagnosticsExport(blueprint, prompt, code),
      mime: "application/json",
    },
    {
      key: "compile-log",
      icon: FileText,
      title: "Compile log",
      desc: "Placeholder MetaEditor log",
      filename: buildExportFilename(blueprint, "txt"),
      content: buildMockCompileLog(blueprint),
      mime: "text/plain",
    },
    {
      key: "validation",
      icon: FileText,
      title: "Validation report",
      desc: "Risk control & rule checks",
      filename: `${safeDownloadName(blueprint.name || "strategy")}-validation-report.txt`,
      content: buildValidationReport(blueprint),
      mime: "text/plain",
    },
  ] as const;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {items.map((it) => (
        <div
          key={it.key}
          className="rounded-md border border-border bg-card p-4 flex items-start justify-between gap-4"
        >
          <div className="flex items-start gap-3 min-w-0">
            <it.icon className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-sm font-medium">{it.title}</div>
              <div className="text-xs text-muted-foreground">{it.desc}</div>
              <div className="text-[11px] font-mono text-muted-foreground mt-1 truncate">
                {it.filename}
              </div>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadText(it.filename, it.content, it.mime)}
          >
            <Download className="h-4 w-4 mr-1.5" /> Download
          </Button>
        </div>
      ))}
    </div>
  );
}
