import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listStrategies, deleteStrategy, duplicateStrategy } from "@/lib/strategies";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Copy,
  Trash2,
  FileCode2,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Brain,
} from "lucide-react";
import { toast } from "sonner";
import { formatBrainChain } from "@/lib/brain-modules";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

function relativeDate(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function Dashboard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ["strategies"],
    queryFn: listStrategies,
  });

  const dupMut = useMutation({
    mutationFn: (id: string) => duplicateStrategy(id, user!.id),
    onSuccess: (row) => {
      toast.success("Strategy duplicated");
      qc.invalidateQueries({ queryKey: ["strategies"] });
      navigate({ to: "/s/$id", params: { id: row.id } });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to duplicate"),
  });

  const delMut = useMutation({
    mutationFn: deleteStrategy,
    onSuccess: () => {
      toast.success("Strategy deleted");
      qc.invalidateQueries({ queryKey: ["strategies"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to delete"),
  });

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={
          data ? `${data.length} saved strateg${data.length === 1 ? "y" : "ies"}` : "Your strategies"
        }
        actions={
          <Link to="/new">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1.5" /> Strategy Builders
            </Button>
          </Link>
        }
      />

      <div className="p-6">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" /> Failed to load strategies.
          </div>
        )}

        {!isLoading && data?.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-12 text-center">
            <FileCode2 className="h-8 w-8 mx-auto text-muted-foreground/40" />
            <h3 className="mt-3 text-sm font-medium">No strategies yet</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Describe any forex strategy in plain English to get started.
            </p>
            <Link to="/new" className="inline-block mt-4">
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1.5" /> Create your first strategy
              </Button>
            </Link>
          </div>
        )}

        {data && data.length > 0 && (
          <div className="space-y-2">
            {data.map((row) => {
              const isFourBrain = Boolean(row.spec_json.fourBrain);
              const rules = row.spec_json.rules ?? [];
              const compilable = row.spec_json.compilableRuleIds?.length ?? 0;
              const confidence = row.spec_json.confidence ?? 0;
              const types = row.spec_json.strategyType ?? [];
              const hasCode = Boolean(row.generated_code);
              const exec = row.spec_json.execution;
              const fourBrain = row.spec_json.fourBrain;

              return (
                <div
                  key={row.id}
                  onClick={() => navigate({ to: "/s/$id", params: { id: row.id } })}
                  className="group flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3 cursor-pointer hover:border-primary/40 hover:bg-muted/20 transition-all"
                >
                  {/* Left: name + tags / brain chain */}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isFourBrain && (
                        <Brain className="h-3.5 w-3.5 text-primary shrink-0" />
                      )}
                      <span className="font-medium text-sm group-hover:text-primary transition-colors truncate">
                        {row.name}
                      </span>
                      {!isFourBrain && types.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="hidden sm:inline text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border"
                        >
                          {t.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      {isFourBrain && fourBrain ? (
                        <span className="font-mono text-[11px] text-primary/70">
                          {formatBrainChain(fourBrain)}
                        </span>
                      ) : (
                        <>
                          {exec?.symbol && <span className="font-mono">{exec.symbol}</span>}
                          {exec?.setupTimeframe && <span>{exec.setupTimeframe}</span>}
                          {exec?.spreadFilterPoints && <span>spread ≤ {exec.spreadFilterPoints}pts</span>}
                        </>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {relativeDate(row.updated_at)}
                      </span>
                    </div>
                  </div>

                  {/* Middle: stats — different for 4-brain vs rules */}
                  <div className="hidden md:flex items-center gap-3 shrink-0">
                    {isFourBrain && fourBrain ? (
                      <>
                        <div className="text-center">
                          <p className="text-sm font-semibold text-primary">
                            {(fourBrain.direction ? 1 : 0) + (fourBrain.setup ? 1 : 0) + 1}
                          </p>
                          <p className="text-[10px] text-muted-foreground">brains</p>
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-semibold text-emerald-400">
                            {fourBrain.management?.riskPercent ?? 1}%
                          </p>
                          <p className="text-[10px] text-muted-foreground">risk</p>
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-semibold text-amber-400">
                            {fourBrain.management?.rewardRisk ?? 2}R
                          </p>
                          <p className="text-[10px] text-muted-foreground">R:R</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-center">
                          <p className="text-sm font-semibold">{rules.length}</p>
                          <p className="text-[10px] text-muted-foreground">rules</p>
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-semibold text-emerald-400">{compilable}</p>
                          <p className="text-[10px] text-muted-foreground">compiled</p>
                        </div>
                        <div className="text-center">
                          <p className={`text-sm font-semibold ${confidence >= 75 ? "text-emerald-400" : confidence >= 50 ? "text-amber-400" : "text-destructive"}`}>
                            {confidence}%
                          </p>
                          <p className="text-[10px] text-muted-foreground">confidence</p>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Code status */}
                  <div className="hidden lg:flex items-center shrink-0">
                    {hasCode ? (
                      <span className="flex items-center gap-1 text-[11px] text-emerald-400 border border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="h-3 w-3" /> Code ready
                      </span>
                    ) : (
                      <span className="text-[11px] text-amber-400 border border-amber-500/30 bg-amber-500/5 px-2 py-0.5 rounded-full">
                        Needs code
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div
                    className="flex items-center gap-1 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Duplicate"
                      onClick={() => dupMut.mutate(row.id)}
                      disabled={dupMut.isPending}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Delete"
                      onClick={() => {
                        if (confirm(`Delete "${row.name}"? This cannot be undone.`)) {
                          delMut.mutate(row.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
