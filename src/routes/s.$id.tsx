import type { ReactNode } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getStrategy, updateStrategy, deleteStrategy, duplicateStrategy } from "@/lib/strategies";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  buildExportFilename,
  buildMockCompileLog,
  buildValidationReport,
} from "@/lib/mql5-generator";
import { generateCode } from "@/lib/api-client";
import type { StrategyBlueprint } from "@/types/blueprint";
import { DEFAULT_BLUEPRINT } from "@/types/blueprint";

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
            blueprint={blueprint}
            code={generatedCode}
            onCodeChange={(code) => {
              setGeneratedCode(code);
              setDirty(true);
            }}
          />
        </TabsContent>

        <TabsContent value="validation" className="pt-6 pb-10">
          <ValidationTab blueprint={blueprint} />
        </TabsContent>

        <TabsContent value="export" className="pt-6 pb-10">
          <ExportTab blueprint={blueprint} prompt={data.prompt} code={generatedCode} />
        </TabsContent>
      </Tabs>
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
  blueprint,
  code,
  onCodeChange,
}: {
  blueprint: StrategyBlueprint;
  code: string;
  onCodeChange: (code: string) => void;
}) {
  const [generating, setGenerating] = useState(false);

  const generate = async () => {
    setGenerating(true);
    try {
      const result = await generateCode(blueprint);
      onCodeChange(result.code);
      toast.success(code ? "Code regenerated" : "MQL5 code generated");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to generate code");
    } finally {
      setGenerating(false);
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
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          AI-generated MQL5 — compile in MetaEditor 5 to verify before using.
        </p>
        <Button size="sm" variant="outline" onClick={generate} disabled={generating}>
          {generating ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-1.5" />
          )}
          Regenerate
        </Button>
      </div>
      <CodeViewer code={code} filename={buildExportFilename(blueprint, "mq5")} />
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
