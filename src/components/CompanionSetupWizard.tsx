import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  Loader2,
  Monitor,
  RefreshCw,
  Server,
} from "lucide-react";
import { toast } from "sonner";

const COMPANION_FILENAME = "mt5-local-runner.exe";
const COMPANION_DOWNLOAD_URL = `/downloads/${COMPANION_FILENAME}`;

type WizardStep = 1 | 2 | 3 | 4;

/**
 * In-flow setup for Test on history: download helper → run → token → pick MT5.
 * Reuses the same localhost runner APIs as Settings.
 */
export function CompanionSetupWizard({
  compact = false,
  onReady,
}: {
  compact?: boolean;
  /** Called when companion is online and MT5 terminal is configured. */
  onReady?: () => void;
}) {
  const qc = useQueryClient();
  const [runnerToken, setRunnerToken] = useState("");
  const [manualPath, setManualPath] = useState("");

  const health = useQuery({
    queryKey: ["local-runner-health"],
    queryFn: getLocalRunnerHealth,
    retry: false,
    refetchInterval: 4000,
  });
  const companionOnline = Boolean(health.data?.ok);

  const status = useQuery({
    queryKey: ["mt5-status-wizard", runnerToken, companionOnline],
    queryFn: getMt5Status,
    enabled: companionOnline && Boolean(runnerToken.trim()),
    retry: false,
    refetchInterval: companionOnline ? 5000 : false,
  });
  const authenticated = Boolean(status.data);
  const mt5Configured = Boolean(status.data?.configuredTerminalPath);
  const installations = status.data?.installations ?? [];

  useEffect(() => {
    setRunnerToken(getRunnerToken());
  }, []);

  useEffect(() => {
    if (companionOnline && mt5Configured) onReady?.();
  }, [companionOnline, mt5Configured, onReady]);

  const configureMut = useMutation({
    mutationFn: (terminalPath: string) => configureMt5({ terminalPath }),
    onSuccess: () => {
      toast.success("MetaTrader connected");
      qc.invalidateQueries({ queryKey: ["mt5-status"] });
      qc.invalidateQueries({ queryKey: ["mt5-status-wizard"] });
      qc.invalidateQueries({ queryKey: ["mt5-status-backtest"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not connect MetaTrader"),
  });

  const step: WizardStep = !companionOnline
    ? 1
    : !authenticated
      ? 2
      : !mt5Configured
        ? 3
        : 4;

  const refresh = () => {
    void health.refetch();
    if (companionOnline && runnerToken.trim()) void status.refetch();
  };

  const saveToken = () => {
    saveRunnerToken(runnerToken.trim());
    qc.invalidateQueries({ queryKey: ["mt5-status"] });
    qc.invalidateQueries({ queryKey: ["mt5-status-wizard"] });
    qc.invalidateQueries({ queryKey: ["mt5-status-backtest"] });
    void status.refetch();
    toast.success("Token saved");
  };

  return (
    <div
      className={
        compact
          ? "rounded-lg border border-border bg-card/60 p-4 space-y-4 max-w-lg mx-auto"
          : "rounded-lg border border-amber-500/30 bg-amber-500/5 p-5 space-y-5 max-w-lg mx-auto"
      }
    >
      <div className="flex items-start gap-3">
        <Monitor className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold">Set up the MT5 helper</p>
          <p className="text-xs text-muted-foreground mt-1">
            One-time on this computer. After this, Test on history is one click.
          </p>
        </div>
      </div>

      <ol className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide">
        {(
          [
            [1, "Download"],
            [2, "Connect"],
            [3, "MetaTrader"],
            [4, "Ready"],
          ] as const
        ).map(([n, label]) => (
          <li
            key={n}
            className={[
              "flex-1 rounded-md border px-2 py-1.5 text-center",
              step === n
                ? "border-primary/50 bg-primary/10 text-primary"
                : step > n
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-border text-muted-foreground",
            ].join(" ")}
          >
            {step > n ? "✓ " : `${n}. `}
            {label}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Download the helper and double-click it. A small window stays open on this PC (no
            installer).
          </p>
          <Button asChild size="sm" className="w-full sm:w-auto">
            <a href={COMPANION_DOWNLOAD_URL} download={COMPANION_FILENAME}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> Download helper
            </a>
          </Button>
          <div className="rounded-md bg-muted/40 border border-border px-3 py-2 text-[11px] text-muted-foreground">
            Windows SmartScreen? Click <span className="font-mono">More info</span> →{" "}
            <span className="font-mono">Run anyway</span>. It only talks to this browser on
            localhost.
          </div>
          <Button size="sm" variant="outline" onClick={refresh}>
            {health.isFetching ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            )}
            I started it — check again
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Helper is running. Open{" "}
            <a
              href={LOCAL_RUNNER_URL}
              target="_blank"
              rel="noreferrer"
              className="underline inline-flex items-center gap-1"
            >
              {LOCAL_RUNNER_URL}
              <ExternalLink className="h-3 w-3" />
            </a>
            , copy the token, and paste it here.
          </p>
          <div className="flex gap-2">
            <Input
              value={runnerToken}
              onChange={(e) => setRunnerToken(e.target.value)}
              placeholder="Paste connection token"
              className="font-mono text-xs"
            />
            <Button size="sm" variant="outline" onClick={saveToken} disabled={!runnerToken.trim()}>
              <KeyRound className="h-3.5 w-3.5 mr-1.5" /> Save
            </Button>
          </div>
          <Button size="sm" variant="ghost" onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
          </Button>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Choose the MetaTrader 5 terminal this computer should use for tests.
          </p>
          {installations.length > 0 ? (
            <div className="space-y-2">
              {installations.map((inst) => (
                <button
                  key={inst.terminalPath}
                  type="button"
                  onClick={() => configureMut.mutate(inst.terminalPath)}
                  disabled={configureMut.isPending}
                  className="w-full text-left rounded-md border border-border hover:border-primary/40 bg-background/50 px-3 py-2 text-xs transition-colors"
                >
                  <p className="font-medium truncate">
                    {inst.terminalPath.split(/[\\/]/).slice(-2, -1)[0] ?? "MetaTrader 5"}
                  </p>
                  <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
                    {inst.terminalPath}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground">
                No terminal detected. Paste the path to <span className="font-mono">terminal64.exe</span>:
              </p>
              <div className="flex gap-2">
                <Input
                  value={manualPath}
                  onChange={(e) => setManualPath(e.target.value)}
                  placeholder="C:\Program Files\MetaTrader 5\terminal64.exe"
                  className="font-mono text-xs"
                />
                <Button
                  size="sm"
                  disabled={!manualPath.trim() || configureMut.isPending}
                  onClick={() => configureMut.mutate(manualPath.trim())}
                >
                  {configureMut.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Use"
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 4 && (
        <div className="flex items-start gap-2 text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">Ready to test</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Helper online
              {health.data?.version ? ` (v${health.data.version})` : ""}. Tap{" "}
              <strong className="text-foreground">Test on history</strong> above.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <Server className="h-3 w-3" />
        <span className="font-mono">{LOCAL_RUNNER_URL}</span>
      </div>
    </div>
  );
}
