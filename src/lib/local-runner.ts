import type {
  BacktestJob,
  BacktestResult,
  CompileRequest,
  CompileResult,
  ConfigureMt5Request,
  ConfigureMt5Result,
  MT5Installation,
  MT5Status,
  OpenMetaEditorResult,
  RunnerApproval,
  RunnerJob,
  RunnerJobLog,
  RunnerJobReport,
  RunnerJobResult,
} from "@/types/mt5";

export const LOCAL_RUNNER_URL = "http://127.0.0.1:8765";
const TOKEN_STORAGE_KEY = "mt5_local_runner_token";

export function getRunnerToken() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(TOKEN_STORAGE_KEY) || "";
}

export function saveRunnerToken(token: string) {
  if (typeof window === "undefined") return;
  const clean = token.trim();
  if (clean) window.localStorage.setItem(TOKEN_STORAGE_KEY, clean);
  else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
}

function authHeaders(): Record<string, string> {
  const token = getRunnerToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface LocalRunnerHealth {
  ok: boolean;
  service: string;
  version: string;
  host: string;
  port: number;
  platform: string;
}

export async function getLocalRunnerHealth(): Promise<LocalRunnerHealth> {
  const res = await fetch(`${LOCAL_RUNNER_URL}/health`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`Local runner returned ${res.status}`);
  return res.json();
}

export async function getMt5Status(): Promise<MT5Status> {
  const res = await fetch(`${LOCAL_RUNNER_URL}/mt5/status`, { headers: authHeaders() });
  if (res.status === 401) throw new Error("Runner token required");
  if (!res.ok) throw new Error(`MT5 status returned ${res.status}`);
  return res.json();
}

export async function listMt5Installations(): Promise<MT5Installation[]> {
  const res = await fetch(`${LOCAL_RUNNER_URL}/mt5/installations`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`MT5 discovery returned ${res.status}`);
  const data = await res.json();
  return data.installations ?? [];
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${LOCAL_RUNNER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `Runner returned ${res.status}`);
  }
  return res.json();
}

export async function configureMt5(request: ConfigureMt5Request): Promise<ConfigureMt5Result> {
  return postJson<ConfigureMt5Result>("/mt5/configure", request);
}

export async function openMetaEditor(eaFilename?: string): Promise<OpenMetaEditorResult> {
  return postJson<OpenMetaEditorResult>("/mt5/open-metaeditor", { eaFilename });
}

export async function buildRunnerApproval(
  sourceCode: string,
  scope: RunnerApproval["scope"],
): Promise<RunnerApproval> {
  const data = new TextEncoder().encode(sourceCode);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const sourceHash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return {
    accepted: true,
    sourceHash,
    approvedAt: new Date().toISOString(),
    scope,
    message: "User approved local-only execution. This does not permit live trading.",
  };
}

export async function compileEa(request: CompileRequest): Promise<CompileResult> {
  return postJson<CompileResult>("/compile", request);
}

export async function submitBacktest(job: BacktestJob): Promise<BacktestResult> {
  return postJson<BacktestResult>("/backtest", job);
}

export async function getRunnerJob(jobId: string): Promise<RunnerJobResult> {
  const res = await fetch(`${LOCAL_RUNNER_URL}/jobs/${encodeURIComponent(jobId)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Job poll returned ${res.status}`);
  return res.json();
}

export async function getRunnerJobReport(jobId: string): Promise<RunnerJobReport> {
  const res = await fetch(`${LOCAL_RUNNER_URL}/jobs/${encodeURIComponent(jobId)}/report`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Job report returned ${res.status}`);
  return res.json();
}

export async function getRunnerJobLog(jobId: string): Promise<RunnerJobLog> {
  const res = await fetch(`${LOCAL_RUNNER_URL}/jobs/${encodeURIComponent(jobId)}/logs`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Job log returned ${res.status}`);
  return res.json();
}
