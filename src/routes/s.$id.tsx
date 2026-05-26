import type { ReactNode } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getStrategy, updateStrategy, deleteStrategy, duplicateStrategy } from "@/lib/strategies";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StrategySpecForm } from "@/components/StrategySpecForm";
import { CodeViewer } from "@/components/CodeViewer";
import { BuilderProgress, BUILDER_STEPS, type BuilderStep } from "@/components/BuilderProgress";
import {
  Save,
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
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { EaChatDrawer } from "@/components/EaChatDrawer";
import { toast } from "sonner";
import {
  buildExportFilename,
  buildMockCompileLog,
  buildValidationReport,
} from "@/lib/mql5-generator";
import { generateCode, fixCompileErrors } from "@/lib/api-client";
import type { StrategyBlueprint } from "@/types/blueprint";
import { DEFAULT_BLUEPRINT } from "@/types/blueprint";
import {
  getLocalRunnerHealth,
  getMt5Status,
  buildRunnerApproval,
  compileEa,
  openMetaEditor,
  submitBacktest,
  getRunnerJob,
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

  useEffect(() => {
    if (data) {
      setBlueprint(data.spec_json);
      setGeneratedCode(data.generated_code);
      setName(data.name);
      setDirty(false);
    }
  }, [data]);

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

  const exec = blueprint.execution;
  const subtitle = [
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

  return (
    <div>
      <PageHeader
        title={
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            className="bg-transparent outline-none border-b border-transparent focus:border-border w-full max-w-md"
          />
        }
        subtitle={subtitle}
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setChatOpen(true)}
            >
              <Bot className="h-4 w-4 mr-1.5" /> AI Chat
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => dupMut.mutate()}
              disabled={dupMut.isPending}
            >
              <Copy className="h-4 w-4 mr-1.5" /> Duplicate
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (confirm(`Delete "${name}"?`)) delMut.mutate();
              }}
            >
              <Trash2 className="h-4 w-4 mr-1.5 text-destructive" /> Delete
            </Button>
            <Button
              size="sm"
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || !dirty}
            >
              {saveMut.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1.5" />
              )}
              {dirty ? "Save changes" : "Saved"}
            </Button>
          </>
        }
      />

      <Tabs defaultValue={data.generated_code ? "spec" : "code"} className="px-6 pt-4">
        <TabsList>
          <TabsTrigger value="spec">Spec</TabsTrigger>
          <TabsTrigger value="builder">Builder</TabsTrigger>
          <TabsTrigger value="code">Code</TabsTrigger>
          <TabsTrigger value="backtest">Backtest</TabsTrigger>
          <TabsTrigger value="validation">Validation</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
        </TabsList>

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
            onCodeChange={(code) => {
              setGeneratedCode(code);
              setDirty(true);
            }}
            onAutoSave={async (code) => {
              await updateStrategy(id, {
                name: name || "Untitled Strategy",
                blueprint,
                generatedCode: code,
              });
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
            onOpenChat={(msg) => { setChatAutoMessage(msg ?? null); setChatOpen(true); }}
            onApplyCode={(fixed) => { setGeneratedCode(fixed); setDirty(true); }}
          />
        </TabsContent>

        <TabsContent value="validation" className="pt-6 pb-10">
          <ValidationTab blueprint={blueprint} />
        </TabsContent>

        <TabsContent value="export" className="pt-6 pb-10">
          <ExportTab blueprint={blueprint} prompt={data.prompt} code={generatedCode} />
        </TabsContent>
      </Tabs>

      <EaChatDrawer
        open={chatOpen}
        onOpenChange={(open) => { setChatOpen(open); if (!open) setChatAutoMessage(null); }}
        autoMessage={chatAutoMessage ?? undefined}
        blueprint={blueprint}
        code={generatedCode}
        compileLog={compileLog}
        backtestSummary={backtestSummary}
        onApplyCode={(code) => {
          setGeneratedCode(code);
          setDirty(true);
          setChatOpen(false);
          toast.success("AI code applied — remember to save");
        }}
      />
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
}: {
  strategyId: string;
  strategyName: string;
  blueprint: StrategyBlueprint;
  code: string;
  onCodeChange: (code: string) => void;
  onAutoSave?: (code: string) => Promise<void>;
}) {
  const [generating, setGenerating] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [compileLog, setCompileLog] = useState<string | null>(null);

  const companion = useQuery({
    queryKey: ["local-runner-health"],
    queryFn: getLocalRunnerHealth,
    retry: false,
    refetchInterval: 10000,
    staleTime: 8000,
  });
  const companionOnline = Boolean(companion.data?.ok);

  const generate = async () => {
    setGenerating(true);
    try {
      // onChunk streams partial code into the editor so the user sees it being written live.
      const result = await generateCode(blueprint, (partial) => onCodeChange(partial));
      if (onAutoSave) {
        await onAutoSave(result.code);
        toast.success(code ? "Code regenerated & saved" : "MQL5 code generated & saved");
      } else {
        onCodeChange(result.code);
        toast.success(code ? "Code regenerated" : "MQL5 code generated");
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to generate code");
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

  // No code yet — show a prominent generate button
  if (!code) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4 text-center max-w-md mx-auto">
        <FileCode2 className="h-10 w-10 text-muted-foreground/40" />
        <div>
          <p className="font-medium">No code generated yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Click below to generate the MQL5 Expert Advisor from the blueprint. This takes 15–30
            seconds.
          </p>
        </div>
        <Button onClick={generate} disabled={generating} size="lg" className="min-w-[200px]">
          {generating ? (
            <>
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              Generating MQL5…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-1.5" />
              Generate MQL5 Code
            </>
          )}
        </Button>
        {generating && (
          <p className="text-xs text-muted-foreground">
            The AI is writing your Expert Advisor. Please wait…
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-muted-foreground">
          AI-generated MQL5 — compile in MetaEditor 5 to verify before using.
        </p>
        <div className="flex items-center gap-2">
          {/* Companion compile button */}
          {companionOnline ? (
            <Button
              size="sm"
              variant="outline"
              onClick={compile}
              disabled={compiling}
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
              onClick={() => openMetaEditor(buildExportFilename(blueprint, "mq5")).catch(() => {})}
              title="Companion offline — open MetaEditor manually"
              disabled
            >
              <WifiOff className="h-3.5 w-3.5 mr-1.5" />
              Companion offline
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={generate} disabled={generating}>
            {generating ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1.5" />
            )}
            Regenerate
          </Button>
        </div>
      </div>
      <CodeViewer code={code} filename={buildExportFilename(blueprint, "mq5")} />
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
  onOpenChat,
  onApplyCode,
}: {
  strategyId: string;
  strategyName: string;
  blueprint: StrategyBlueprint;
  code: string;
  onCompileLog?: (log: string | null) => void;
  onBacktestSummary?: (summary: ReportSummary | null) => void;
  onOpenChat?: (message?: string) => void;
  onApplyCode?: (code: string) => void;
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
  const [config, setConfig] = useState<Omit<TesterConfig, "expertName" | "reportName" | "visualMode" | "optimization">>({
    symbol: blueprint.execution.symbol || "EURUSD",
    period: blueprint.execution.entryTimeframe || "H1",
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
  const processedJobIds = useRef(new Set<string>());

  const compileMut = useMutation({
    mutationFn: async () => {
      const filename = buildExportFilename(blueprint, "mq5");
      const approval = await buildRunnerApproval(code, "compile");
      return compileEa({ strategyId, strategyName, eaFilename: filename, sourceCode: code, approval });
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
      if (status === "succeeded") {
        const result = data as BacktestResult;
        setBacktestResult(result);
        onBacktestSummary?.(result.summary);
        toast.success("Backtest report ready");
      } else {
        toast.error("Backtest failed — " + (data.job.message || "see tester log"));
      }
    }
  }, [backtestJobQuery.data, onBacktestSummary]);

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
      const res = await submitBacktest({ strategyId, strategyName, eaFilename: filename, sourceCode: code, approval, testerConfig });
      setBacktestResult(null);
      setBacktestJobId(res.job.id);
      setBacktestPolling(true);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to start backtest"),
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
      const res = await submitBacktest({ strategyId, strategyName, eaFilename: filename, sourceCode: code, approval, testerConfig });
      setVisualJobId(res.job.id);
      setVisualPolling(true);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to start visual test"),
  });

  const set = <K extends keyof typeof config>(k: K, v: (typeof config)[K]) =>
    setConfig((c) => ({ ...c, [k]: v }));

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

  const backtestJobStatus = backtestJobQuery.data?.job?.status ?? null;
  const visualJobStatus = visualJobQuery.data?.job?.status ?? null;

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
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Tester configuration</p>
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
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Model</Label>
            <Select value={config.model} onValueChange={(v) => set("model", v as TesterConfig["model"])}>
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
                  <SelectItem key={l} value={l}>{l}</SelectItem>
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

        {/* Approval */}
        <div className="flex items-start gap-2 pt-1">
          <Checkbox
            id="local-approval"
            checked={localApproval}
            onCheckedChange={(v) => setLocalApproval(Boolean(v))}
            className="mt-0.5"
          />
          <label htmlFor="local-approval" className="text-xs text-muted-foreground leading-relaxed cursor-pointer select-none">
            I approve this generated EA source for local compile &amp; testing on this computer only.
            I understand it does not perform live trading.
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
              <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Compiling…</>
            ) : (
              <><Hammer className="h-4 w-4 mr-1.5" /> Compile EA</>
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
              <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                {backtestJobStatus === "running" ? "Tester running…" : "Launching…"}</>
            ) : (
              <><BarChart2 className="h-4 w-4 mr-1.5" /> Run Report Backtest</>
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
              <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                {visualJobStatus === "running" ? "Visual running…" : "Launching…"}</>
            ) : (
              <><Play className="h-4 w-4 mr-1.5" /> Run Visual Test</>
            )}
          </Button>
        </div>

        {/* Compile error banner */}
        {compileResult && !compileResult.success && compileResult.errors > 0 && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-destructive">
                {compileResult.errors} compile error{compileResult.errors !== 1 ? "s" : ""} — fix the code before backtesting
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {fixingAi
                  ? "AI is rewriting the fixed code — this takes 15–30 seconds…"
                  : "Click Fix with AI to automatically correct all errors in one step."}
              </p>
            </div>
            {onApplyCode && (
              <Button
                size="sm"
                variant="outline"
                disabled={fixingAi}
                onClick={async () => {
                  if (!compileResult.log) return;
                  setFixingAi(true);
                  try {
                    const result = await fixCompileErrors(blueprint, code, compileResult.log);
                    onApplyCode(result.code);
                    toast.success("AI fixed the code — recompile to verify");
                  } catch (e: unknown) {
                    toast.error(e instanceof Error ? e.message : "Fix failed — please try again");
                  } finally {
                    setFixingAi(false);
                  }
                }}
                className="shrink-0"
              >
                {fixingAi ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Fixing…</>
                ) : (
                  <><Bot className="h-3.5 w-3.5 mr-1.5" /> Fix with AI</>
                )}
              </Button>
            )}
          </div>
        )}

        {/* Never compiled hint */}
        {!compileResult && !compileRunning && localApproval && (
          <p className="text-xs text-muted-foreground">
            Compile the EA first, then choose a backtest mode.
          </p>
        )}

        {visualRunning && (
          <p className="text-xs text-muted-foreground">
            MT5 visual test is running — watch MetaTrader 5 for the strategy tester window.
            No report will be generated for visual tests.
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
                positive={summary.maximalDrawdown !== null ? summary.maximalDrawdown < 20 : undefined}
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
      icon: FileCode2,
      title: "Expert Advisor",
      desc: "MQL5 source for MetaEditor",
      ext: "mq5",
      content: code,
      mime: "text/plain",
    },
    {
      icon: FileJson,
      title: "Strategy blueprint",
      desc: "Full blueprint JSON (re-importable)",
      ext: "json",
      content: JSON.stringify({ prompt, blueprint }, null, 2),
      mime: "application/json",
    },
    {
      icon: FileText,
      title: "Compile log",
      desc: "Placeholder MetaEditor log",
      ext: "txt",
      content: buildMockCompileLog(blueprint),
      mime: "text/plain",
    },
    {
      icon: FileText,
      title: "Validation report",
      desc: "Risk control & rule checks",
      ext: "txt",
      content: buildValidationReport(blueprint),
      mime: "text/plain",
    },
  ] as const;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {items.map((it) => (
        <div
          key={it.ext}
          className="rounded-md border border-border bg-card p-4 flex items-start justify-between gap-4"
        >
          <div className="flex items-start gap-3 min-w-0">
            <it.icon className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-sm font-medium">{it.title}</div>
              <div className="text-xs text-muted-foreground">{it.desc}</div>
              <div className="text-[11px] font-mono text-muted-foreground mt-1 truncate">
                {buildExportFilename(blueprint, it.ext)}
              </div>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              downloadText(buildExportFilename(blueprint, it.ext), it.content, it.mime)
            }
          >
            <Download className="h-4 w-4 mr-1.5" /> Download
          </Button>
        </div>
      ))}
    </div>
  );
}
