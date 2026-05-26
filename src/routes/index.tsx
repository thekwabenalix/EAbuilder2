import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listStrategies, deleteStrategy, duplicateStrategy } from "@/lib/strategies";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Plus, Copy, Trash2, FileCode2, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

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
    onError: (e: any) => toast.error(e.message ?? "Failed to duplicate"),
  });

  const delMut = useMutation({
    mutationFn: deleteStrategy,
    onSuccess: () => {
      toast.success("Strategy deleted");
      qc.invalidateQueries({ queryKey: ["strategies"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to delete"),
  });

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="All saved strategies for your account"
        actions={
          <Link to="/new">
            <Button size="sm"><Plus className="h-4 w-4 mr-1.5" /> New Strategy</Button>
          </Link>
        }
      />

      <div className="p-6">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading strategies…
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" /> Failed to load strategies.
          </div>
        )}
        {!isLoading && data && data.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <FileCode2 className="h-8 w-8 mx-auto text-muted-foreground" />
            <h3 className="mt-3 text-sm font-medium">No strategies yet</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Describe a strategy in plain English to get started.
            </p>
            <Link to="/new" className="inline-block mt-4">
              <Button size="sm"><Plus className="h-4 w-4 mr-1.5" /> Create your first strategy</Button>
            </Link>
          </div>
        )}

        {data && data.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Name</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">Symbol</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">Setup / Entry</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden lg:table-cell">Risk</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden lg:table-cell">Updated</th>
                  <th className="text-right px-4 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.id} className="border-t border-border hover:bg-muted/20 transition">
                    <td className="px-4 py-2.5">
                      <Link to="/s/$id" params={{ id: row.id }} className="font-medium hover:text-primary">
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell font-mono text-xs">{row.spec_json.execution?.symbol ?? "—"}</td>
                    <td className="px-4 py-2.5 hidden md:table-cell text-xs text-muted-foreground">
                      {row.spec_json.execution?.setupTimeframe} → {row.spec_json.execution?.entryTimeframe}
                    </td>
                    <td className="px-4 py-2.5 hidden lg:table-cell text-xs">{row.spec_json.risk?.riskPercent ?? "—"}%</td>
                    <td className="px-4 py-2.5 hidden lg:table-cell text-xs text-muted-foreground">
                      {new Date(row.updated_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button size="icon" variant="ghost" title="Duplicate"
                          onClick={() => dupMut.mutate(row.id)} disabled={dupMut.isPending}>
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" title="Delete"
                          onClick={() => {
                            if (confirm(`Delete "${row.name}"? This cannot be undone.`)) {
                              delMut.mutate(row.id);
                            }
                          }}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
