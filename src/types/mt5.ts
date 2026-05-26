export type Mt5RunnerStatus = "online" | "mt5_missing" | "mt5_configured" | "busy";

export type Mt5JobStatus = "queued" | "running" | "succeeded" | "failed" | "blocked";

export type Mt5BacktestModel = "every_tick" | "one_minute_ohlc" | "open_prices" | "real_ticks";

export interface MT5Installation {
  terminalPath: string;
  name: string;
  dataPath: string | null;
  version: string | null;
  modifiedAt: string | null;
  configured: boolean;
}

export interface MT5Status {
  status: Mt5RunnerStatus;
  runnerVersion: string;
  platform: string;
  dataDir?: string;
  configuredTerminalPath: string | null;
  configuredDataPath: string | null;
  tokenRequired?: boolean;
  tokenPreview?: string | null;
  installations: MT5Installation[];
  activeJobId: string | null;
  message: string;
}

export interface ConfigureMt5Request {
  terminalPath: string;
  dataPath?: string | null;
}

export interface ConfigureMt5Result {
  ok: boolean;
  config: {
    terminalPath: string;
    dataPath: string;
    configuredAt: string;
  };
  expertsPath: string;
  metaEditorPath: string;
}

export interface RunnerApproval {
  accepted: boolean;
  sourceHash: string;
  approvedAt: string;
  scope: "compile" | "backtest";
  message: string;
}

export interface CompileRequest {
  strategyId: string;
  strategyName: string;
  eaFilename: string;
  sourceCode: string;
  approval: RunnerApproval;
}

export interface RunnerJob {
  id: string;
  type: "compile" | "backtest";
  status: Mt5JobStatus;
  createdAt: string;
  updatedAt: string;
  message: string;
}

export interface CompileResult {
  job: RunnerJob;
  success: boolean;
  errors: number;
  warnings: number;
  log: string;
  artifactPath: string | null;
  logPath: string | null;
  executablePath: string | null;
}

export interface OpenMetaEditorResult {
  ok: boolean;
  metaEditorPath: string;
  openedPath: string | null;
}

export interface RunnerJobLog {
  jobId: string;
  lines: string[];
}
