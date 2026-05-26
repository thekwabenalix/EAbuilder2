import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  LOCAL_RUNNER_URL,
  configureMt5,
  getLocalRunnerHealth,
  getMt5Status,
  getRunnerToken,
  saveRunnerToken,
} from "@/lib/local-runner";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  KeyRound,
  LogOut,
  RefreshCw,
  Server,
  ShieldCheck,
  XCircle,
  Monitor,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function StatusTile({
  icon,
  label,
  value,
  ok,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-background/50 p-3">
      <div className={ok ? "text-emerald-400" : "text-muted-foreground"}>{icon}</div>
      <div className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

const COMPANION_DOWNLOAD_URL =
  "https://github.com/thekwabenalix/EAbuilder2/releases/download/v0.6.1/mt5-local-runner.exe";

function RunnerStartCard({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/5 p-4 space-y-4">
      <div className="flex items-start gap-2">
        <Monitor className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-amber-300">Start the Desktop Companion</p>
          <p className="text-xs text-muted-foreground mt-1">
            A small Windows app that compiles your generated MQL5 code using MetaEditor on this PC.
            No install required — just download and run.
          </p>
        </div>
      </div>

      <a href={COMPANION_DOWNLOAD_URL} download>
        <Button size="sm" className="w-full sm:w-auto">
          <Download className="h-3.5 w-3.5 mr-1.5" /> Download mt5-local-runner.exe
        </Button>
      </a>

      <ol className="text-xs text-muted-foreground space-y-1.5 pl-4 list-decimal">
        <li>Download and double-click <span className="font-mono">mt5-local-runner.exe</span></li>
        <li>
          A terminal window opens — open{" "}
          <a
            href={LOCAL_RUNNER_URL}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-foreground"
          >
            {LOCAL_RUNNER_URL}
          </a>{" "}
          in your browser to see your connection token
        </li>
        <li>Copy the token and paste it in the field below, then click Save</li>
        <li>Select your MT5 terminal from the detected list</li>
      </ol>

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" variant="outline" onClick={onRefresh}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Check again
        </Button>
        <span className="text-xs text-muted-foreground">Windows x64 · No install needed</span>
      </div>
    </div>
  );
}

function SettingsPage() {
  const { user, signOut } = useAuth();
  const qc = useQueryClient();
  const [runnerToken, setRunnerToken] = useState("");
  const [manualTerminalPath, setManualTerminalPath] = useState("");

  const health = useQuery({
    queryKey: ["local-runner-health"],
    queryFn: getLocalRunnerHealth,
    retry: false,
    refetchInterval: 5000,
  });
  const runnerReachable = Boolean(health.data?.ok);

  const status = useQuery({
    queryKey: ["mt5-status", runnerToken, runnerReachable],
    queryFn: getMt5Status,
    enabled: runnerReachable && Boolean(runnerToken),
    retry: false,
  });
  const runnerAuthenticated = Boolean(status.data);
  const mt5Configured = Boolean(status.data?.configuredTerminalPath);

  useEffect(() => {
    setRunnerToken(getRunnerToken());
  }, []);

  const refresh = () => {
    health.refetch();
    if (runnerReachable && runnerToken) status.refetch();
  };

  const configureMut = useMutation({
    mutationFn: (terminalPath: string) => configureMt5({ terminalPath }),
    onSuccess: () => {
      toast.success("MT5 terminal configured");
      qc.invalidateQueries({ queryKey: ["mt5-status"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Failed to configure MT5"),
  });

  return (
    <div>
      <PageHeader title="Settings" subtitle="Account and desktop companion" />

      <div className="grid gap-6 p-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* ── LEFT: Companion section ── */}
        <div className="space-y-6">
          {/* Status card */}
          <section className="rounded-md border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
                  MT5 Desktop Companion
                </h2>
                <div className="mt-3 flex items-center gap-2 text-sm">
                  {health.isLoading ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                      <span>Checking companion…</span>
                    </>
                  ) : !runnerReachable ? (
                    <>
                      <XCircle className="h-4 w-4 text-destructive" />
                      <span>Companion not running</span>
                    </>
                  ) : !runnerAuthenticated ? (
                    <>
                      <KeyRound className="h-4 w-4 text-amber-400" />
                      <span>Connected — enter token</span>
                    </>
                  ) : mt5Configured ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      <span>Ready — MetaEditor compile available</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-amber-400" />
                      <span>Connected — select MT5 terminal</span>
                    </>
                  )}
                </div>
                {status.data?.message && (
                  <p className="mt-2 text-xs text-muted-foreground">{status.data.message}</p>
                )}
                {status.data?.configuredDataPath && (
                  <p className="mt-1 text-[11px] text-muted-foreground break-all">
                    Data: {status.data.configuredDataPath}
                  </p>
                )}
              </div>
              <Button size="sm" variant="outline" onClick={refresh}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
              </Button>
            </div>

            {/* Status tiles */}
            <div className="mt-4 grid grid-cols-3 gap-3">
              <StatusTile
                icon={<Server className="h-4 w-4" />}
                label="Companion"
                value={runnerReachable ? `v${health.data?.version ?? "?"}` : "Not running"}
                ok={runnerReachable}
              />
              <StatusTile
                icon={<ShieldCheck className="h-4 w-4" />}
                label="Auth"
                value={runnerAuthenticated ? "Connected" : runnerToken ? "Bad token" : "No token"}
                ok={runnerAuthenticated}
              />
              <StatusTile
                icon={<CheckCircle2 className="h-4 w-4" />}
                label="MT5"
                value={
                  mt5Configured
                    ? "Configured"
                    : (status.data?.installations.length ?? 0) > 0
                      ? "Detected"
                      : "Not found"
                }
                ok={mt5Configured}
              />
            </div>

            {/* Runner URL */}
            <div className="mt-4 rounded-md border border-border bg-background/50 p-3 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Server className="h-3.5 w-3.5" />
                <span className="font-mono">{LOCAL_RUNNER_URL}</span>
                <a
                  href={LOCAL_RUNNER_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto hover:text-foreground"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
              {health.data && (
                <p className="mt-1 text-muted-foreground">
                  Version {health.data.version} on {health.data.platform}
                </p>
              )}
            </div>

            {/* Token entry or RunnerStartCard */}
            {runnerReachable ? (
              <div className="mt-4 rounded-md border border-border bg-background/50 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium">Connection Token</h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  Open{" "}
                  <a
                    href={LOCAL_RUNNER_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-foreground"
                  >
                    {LOCAL_RUNNER_URL}
                  </a>{" "}
                  in a browser on this PC, copy the token shown, and paste it here.
                </p>
                <div className="flex gap-2">
                  <Input
                    value={runnerToken}
                    onChange={(e) => setRunnerToken(e.target.value)}
                    placeholder="Paste runner token"
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    onClick={() => {
                      saveRunnerToken(runnerToken);
                      qc.invalidateQueries({ queryKey: ["mt5-status"] });
                      status.refetch();
                      toast.success("Token saved");
                    }}
                  >
                    <ShieldCheck className="h-4 w-4 mr-1.5" /> Save
                  </Button>
                </div>
              </div>
            ) : (
              <RunnerStartCard onRefresh={refresh} />
            )}
          </section>

          {/* MT5 terminals list */}
          {runnerAuthenticated && (
            <section className="rounded-md border border-border bg-card p-4 space-y-3">
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
                MT5 Terminals
              </h2>
              {status.isLoading && (
                <p className="text-xs text-muted-foreground">Scanning install locations…</p>
              )}
              {!status.isLoading && (status.data?.installations.length ?? 0) === 0 && (
                <p className="text-xs text-muted-foreground">
                  No MT5 terminal detected. Paste the path to terminal64.exe below.
                </p>
              )}
              {(status.data?.installations ?? []).map((item) => (
                <div
                  key={item.terminalPath}
                  className="rounded-md border border-border bg-background/50 p-3 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="font-mono text-[11px] text-muted-foreground break-all">
                      {item.terminalPath}
                    </p>
                    {item.configured && (
                      <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" /> Active
                      </span>
                    )}
                  </div>
                  {!item.configured && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={configureMut.isPending}
                      onClick={() => configureMut.mutate(item.terminalPath)}
                    >
                      Use this
                    </Button>
                  )}
                </div>
              ))}

              {/* Manual path input */}
              <div className="pt-1 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Not detected? Paste the full path to{" "}
                  <span className="font-mono">terminal64.exe</span> manually:
                </p>
                <div className="flex gap-2">
                  <Input
                    value={manualTerminalPath}
                    onChange={(e) => setManualTerminalPath(e.target.value)}
                    placeholder="C:\Program Files\MetaTrader 5\terminal64.exe"
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    disabled={!manualTerminalPath.trim() || configureMut.isPending}
                    onClick={() => {
                      configureMut.mutate(manualTerminalPath.trim());
                      setManualTerminalPath("");
                    }}
                  >
                    Configure
                  </Button>
                </div>
              </div>
            </section>
          )}
        </div>

        {/* ── RIGHT: Account ── */}
        <div className="space-y-6">
          <section className="rounded-md border border-border bg-card p-4">
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Account</h2>
            <div className="mt-3 space-y-1 text-sm">
              <div>
                <span className="text-muted-foreground">Email:</span> {user?.email}
              </div>
              <div className="text-xs text-muted-foreground">
                ID: <span className="font-mono text-[11px]">{user?.id}</span>
              </div>
            </div>
            <div className="mt-4">
              <Button variant="outline" size="sm" onClick={() => signOut()}>
                <LogOut className="h-4 w-4 mr-1.5" /> Sign out
              </Button>
            </div>
          </section>

          <section className="rounded-md border border-border bg-card p-4 text-xs text-muted-foreground space-y-2">
            <h2 className="text-xs uppercase tracking-wide">Disclaimer</h2>
            <p>
              MT5 AI Builder generates code from natural-language descriptions. It does not evaluate
              or guarantee profitability. Always forward test on a demo account before risking real
              capital.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
