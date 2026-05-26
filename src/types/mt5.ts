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

/** Shape returned by GET /jobs/:id — covers both compile and backtest jobs. */
export interface RunnerJobResult {
  job: RunnerJob;
  success?: boolean;
  errors?: number;
  warnings?: number;
  log?: string;
  summary?: ReportSummary | null;
  reportPath?: string | null;
  reportHtml?: string | null;
  artifactPath?: string | null;
  executablePath?: string | null;
}

// ─── Backtest types ───────────────────────────────────────────────────────────

export interface TesterConfig {
  expertName: string;
  symbol: string;
  period: string;
  model: Mt5BacktestModel;
  fromDate: string;
  toDate: string;
  deposit: number;
  currency: string;
  leverage: string;
  useLocalAgents: boolean;
  useRemoteAgents: boolean;
  useCloudAgents: boolean;
  visualMode: boolean;
  optimization: boolean;
  parameterRanges?: Array<{
    name: string;
    enabled: boolean;
    value: number;
    start: number;
    step: number;
    stop: number;
  }>;
  reportName: string;
}

export interface BacktestJob {
  strategyId: string;
  strategyName: string;
  eaFilename: string;
  sourceCode: string;
  approval: RunnerApproval;
  testerConfig: TesterConfig;
}

export interface EquityCurvePoint {
  time: string;
  label: string;
  balance: number;
  equity: number | null;
  profit: number | null;
  trades: number;
}

export interface ReportSummary {
  netProfit: number | null;
  grossProfit: number | null;
  grossLoss: number | null;
  profitFactor: number | null;
  expectedPayoff: number | null;
  absoluteDrawdown: number | null;
  maximalDrawdown: number | null;
  totalTrades: number | null;
  winRate: number | null;
  initialDeposit: number | null;
  finalBalance: number | null;
  currency: string | null;
  ticks: number | null;
  bars: number | null;
  equityCurve: EquityCurvePoint[];
}

export interface BacktestResult {
  job: RunnerJob;
  success: boolean;
  summary: ReportSummary | null;
  testerConfig?: TesterConfig | null;
  reportPath: string | null;
  reportHtml: string | null;
  log: string;
}

export interface RunnerJobReport {
  jobId: string;
  summary: ReportSummary | null;
  html: string | null;
  path: string | null;
}
