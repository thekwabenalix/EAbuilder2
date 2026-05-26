import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { constants, existsSync } from "node:fs";

const HOST = process.env.MT5_RUNNER_HOST || "127.0.0.1";
const PORT = Number(process.env.MT5_RUNNER_PORT || 8765);
const RUNNER_VERSION = "0.6.1";
const LEGACY_RUNNER_DIR = path.join(process.cwd(), "local-runner", ".runner-data");
const RUNNER_DIR =
  process.env.MT5_RUNNER_DATA_DIR ||
  (existsSync(LEGACY_RUNNER_DIR)
    ? LEGACY_RUNNER_DIR
    : path.join(os.homedir(), "AppData", "Local", "MT5 AI Builder", "Local Runner"));
const CONFIG_PATH = path.join(RUNNER_DIR, "config.json");
const JOBS_DIR = path.join(RUNNER_DIR, "jobs");
const EXPERTS_SUBDIR = "EABuilder";
const MAX_SOURCE_BYTES = 1_000_000;
const APPROVAL_TTL_MS = 10 * 60 * 1000;

const jobs = new Map();

const jsonHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function sendJson(res, status, body) {
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(body, null, 2));
}

function sendHtml(res, status, body) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "text/html; charset=utf-8",
  });
  res.end(body);
}

function nowIso() {
  return new Date().toISOString();
}

function makeJob(type, status, message) {
  const timestamp = nowIso();
  return {
    id: randomUUID(),
    type,
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
    message,
  };
}

function updateJob(record, patch) {
  record.job = {
    ...record.job,
    ...patch,
    updatedAt: nowIso(),
  };
  record.result = record.result ? { ...record.result, job: record.job } : record.result;
  jobs.set(record.job.id, record);
  return record;
}

function rememberJob(record) {
  jobs.set(record.job.id, record);
  return record;
}

function emptyReportSummary() {
  return {
    netProfit: null,
    grossProfit: null,
    grossLoss: null,
    profitFactor: null,
    expectedPayoff: null,
    absoluteDrawdown: null,
    maximalDrawdown: null,
    totalTrades: null,
    winRate: null,
    initialDeposit: null,
    finalBalance: null,
    currency: null,
    ticks: null,
    bars: null,
    equityCurve: [],
  };
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureRunnerDirs() {
  await mkdir(RUNNER_DIR, { recursive: true });
  await mkdir(JOBS_DIR, { recursive: true });
}

async function readConfig() {
  await ensureRunnerDirs();
  try {
    const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
    if (!config.apiToken) {
      return writeConfig({ ...config, apiToken: createApiToken() });
    }
    return config;
  } catch {
    return writeConfig({
      terminalPath: process.env.MT5_TERMINAL_PATH || null,
      dataPath: null,
      apiToken: process.env.MT5_RUNNER_TOKEN || createApiToken(),
      configuredAt: null,
    });
  }
}

async function writeConfig(config) {
  await ensureRunnerDirs();
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  return config;
}

function sanitizeFilename(filename) {
  const base = path.basename(String(filename || "strategy.mq5"));
  const clean = base
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\.+/g, ".")
    .replace(/^\.+/, "")
    .slice(0, 96);
  const safe = clean || "strategy.mq5";
  return safe.toLowerCase().endsWith(".mq5") ? safe : `${safe}.mq5`;
}

function sourceHash(sourceCode) {
  return createHash("sha256")
    .update(String(sourceCode || ""), "utf8")
    .digest("hex");
}

function assertSafeSource(sourceCode) {
  const source = String(sourceCode || "");
  if (!source.trim()) throw new Error("EA source code is empty.");
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
    throw new Error("EA source code is too large for local runner execution.");
  }
  return sourceHash(source);
}

function assertApprovedSource(request) {
  const hash = assertSafeSource(request.sourceCode);
  const approval = request.approval ?? {};
  const approvedAt = Date.parse(approval.approvedAt || "");
  const fresh = Number.isFinite(approvedAt) && Date.now() - approvedAt <= APPROVAL_TTL_MS;

  if (approval.accepted !== true || approval.sourceHash !== hash || !fresh) {
    const error = new Error(
      "Local approval is required before writing or running this generated EA code.",
    );
    error.code = "approval_required";
    error.sourceHash = hash;
    throw error;
  }

  return hash;
}

function resolveInside(root, ...parts) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...parts);
  const relative = path.relative(resolvedRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Blocked unsafe file path outside the configured runner folder.");
  }
  return target;
}

function assertInside(root, target) {
  return resolveInside(root, path.relative(root, target));
}

function createApiToken() {
  return randomBytes(24).toString("base64url");
}

function maskToken(token) {
  if (!token) return null;
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

async function isAuthorized(req) {
  const config = await readConfig();
  const expected = config.apiToken;
  if (!expected) return true;
  const header = req.headers.authorization || req.headers["x-mt5-runner-token"] || "";
  const token = String(header)
    .replace(/^Bearer\s+/i, "")
    .trim();
  return token === expected;
}

async function requireAuthorized(req, res) {
  if (await isAuthorized(req)) return true;
  sendJson(res, 401, {
    error: "Runner token required",
    code: "runner_token_required",
    message: "Open the MT5 Local Runner window and copy the connection token into the web app.",
  });
  return false;
}

function expertNameFromFilename(filename) {
  return sanitizeFilename(filename).replace(/\.mq5$/i, "");
}

function terminalDirectory(terminalPath) {
  return path.dirname(terminalPath);
}

function metaEditorPathForTerminal(terminalPath) {
  return path.join(terminalDirectory(terminalPath), "metaeditor64.exe");
}

function modelToMt5Value(model) {
  return (
    {
      every_tick: "0",
      one_minute_ohlc: "1",
      open_prices: "2",
      real_ticks: "4",
    }[model] ?? "0"
  );
}

function boolToMt5(value) {
  return value ? "1" : "0";
}

function forwardModeToMt5(value) {
  return value === "half" || value === "custom" ? "1" : "0";
}

function readIniValue(content, sectionName, keyName) {
  let activeSection = "";
  const targetSection = sectionName.toLowerCase();
  const targetKey = keyName.toLowerCase();

  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";")) continue;
    const section = line.match(/^\[(.+)]$/);
    if (section) {
      activeSection = section[1].toLowerCase();
      continue;
    }
    if (activeSection !== targetSection) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    if (key === targetKey) return line.slice(separator + 1).trim();
  }

  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runProcess(filePath, args, timeoutMs = 90000) {
  return new Promise((resolve) => {
    const child = spawn(filePath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => stdout.push(chunk.toString()));
    child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        code: -1,
        timedOut,
        stdout: stdout.join(""),
        stderr: stderr.join(""),
        error,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        timedOut,
        stdout: stdout.join(""),
        stderr: stderr.join(""),
        error: null,
      });
    });
  });
}

async function discoverDataPath(terminalPath) {
  const terminalDir = terminalDirectory(terminalPath);
  if (await exists(path.join(terminalDir, "MQL5"))) return terminalDir;

  const terminalDataRoot = path.join(os.homedir(), "AppData", "Roaming", "MetaQuotes", "Terminal");
  if (!(await exists(terminalDataRoot))) return null;

  const terminalPathLower = terminalPath.toLowerCase();
  const candidates = [];
  let entries = [];
  try {
    entries = await readdir(terminalDataRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(terminalDataRoot, entry.name);
    if (!(await exists(path.join(candidate, "MQL5")))) continue;

    let score = 1;
    const originPath = path.join(candidate, "origin.txt");
    try {
      const origin = (await readFile(originPath, "utf8")).toLowerCase();
      if (origin.includes(terminalPathLower) || terminalPathLower.includes(origin.trim()))
        score = 10;
    } catch {
      // Not every terminal data folder has a readable origin.txt.
    }

    let modifiedAt = 0;
    try {
      modifiedAt = (await stat(candidate)).mtimeMs;
    } catch {
      // Best effort only.
    }
    candidates.push({ candidate, score, modifiedAt });
  }

  candidates.sort((a, b) => b.score - a.score || b.modifiedAt - a.modifiedAt);
  return candidates[0]?.candidate ?? null;
}

async function resolveConfiguredMt5() {
  const config = await readConfig();
  const terminalPath = config.terminalPath;
  if (!terminalPath || !(await exists(terminalPath))) {
    throw new Error("No configured MT5 terminal path. Configure terminal64.exe first.");
  }

  const dataPath = config.dataPath || (await discoverDataPath(terminalPath));
  if (!dataPath) {
    throw new Error("Could not resolve the MT5 data folder for the configured terminal.");
  }
  if (!(await exists(path.join(dataPath, "MQL5")))) {
    throw new Error("Configured MT5 data folder does not contain an MQL5 directory.");
  }

  const expertsRoot = resolveInside(dataPath, "MQL5", "Experts");
  const expertsDir = resolveInside(expertsRoot, EXPERTS_SUBDIR);
  await mkdir(expertsDir, { recursive: true });
  await mkdir(JOBS_DIR, { recursive: true });

  const commonIni = await readFileIfExists(path.join(dataPath, "config", "common.ini"));

  return {
    terminalPath,
    terminalDir: terminalDirectory(terminalPath),
    metaEditorPath: metaEditorPathForTerminal(terminalPath),
    dataPath,
    expertsRoot,
    expertsDir,
    accountLogin: readIniValue(commonIni, "Common", "Login"),
    accountServer: readIniValue(commonIni, "Common", "Server"),
  };
}

async function writeExpertFile(mt5, eaFilename, sourceCode) {
  const filename = sanitizeFilename(eaFilename);
  const expertPath = resolveInside(mt5.expertsDir, filename);
  await writeFile(expertPath, String(sourceCode || ""), "utf8");
  return {
    filename,
    expertPath,
    testerExpertName: `${EXPERTS_SUBDIR}\\${expertNameFromFilename(filename)}`,
  };
}

async function readFileIfExists(filePath) {
  try {
    const buffer = await readFile(filePath);
    const hasUtf16Bom = buffer[0] === 0xff && buffer[1] === 0xfe;
    const hasNullBytes = buffer.subarray(0, 120).includes(0);
    if (hasUtf16Bom || hasNullBytes) {
      return buffer.toString("utf16le").replace(/^\uFEFF/, "");
    }
    return buffer.toString("utf8");
  } catch {
    return "";
  }
}

async function readFileTextAfterLengthIfExists(filePath, startLength) {
  const text = await readFileIfExists(filePath);
  return text.slice(startLength);
}

async function removeFileIfExists(filePath) {
  try {
    await unlink(filePath);
  } catch {
    // The file may not exist yet, which is fine before a compile.
  }
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function htmlToText(value) {
  return decodeHtmlEntities(
    String(value || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(td|th)>/gi, "\t")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r/g, "")
    .replace(/[ \u00a0]+/g, " ")
    .replace(/\t[ \t]+/g, "\t")
    .replace(/\n[ \n]+/g, "\n")
    .trim();
}

function parseNumeric(value) {
  const match = String(value || "").match(/-?\d+(?:[\s,]\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0].replace(/[\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePercent(value) {
  const match = String(value || "").match(/-?\d+(?:\.\d+)?\s*%/);
  return match ? parseNumeric(match[0]) : null;
}

function findMetric(rows, labels, parser = parseNumeric) {
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  for (const cells of rows) {
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index].toLowerCase();
      const matched = normalizedLabels.some((label) => cell.includes(label));
      if (!matched) continue;

      const nextCells = cells.slice(index + 1);
      for (const candidate of nextCells) {
        const parsed = parser(candidate);
        if (parsed !== null) return parsed;
      }

      const parsed = parser(cells[index]);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function parseReportRows(html) {
  return htmlToText(html)
    .split("\n")
    .map((line) =>
      line
        .split("\t")
        .map((cell) => cell.trim())
        .filter(Boolean),
    )
    .filter((cells) => cells.length > 0);
}

function parseReportSummary(html, config) {
  const rows = parseReportRows(html);
  const summary = createSummaryFromConfig(config);
  const initialDeposit = findMetric(rows, ["initial deposit", "deposit"]) ?? summary.initialDeposit;
  const grossProfit = findMetric(rows, ["gross profit"]);
  const grossLoss = findMetric(rows, ["gross loss"]);
  const netProfit =
    findMetric(rows, ["total net profit", "net profit"]) ??
    (grossProfit !== null && grossLoss !== null ? grossProfit + grossLoss : null);
  const totalTrades = findMetric(rows, ["total trades"]);
  const winRate =
    findMetric(rows, ["profit trades"], parsePercent) ??
    findMetric(rows, ["winning trades"], parsePercent) ??
    null;

  return {
    ...summary,
    netProfit,
    grossProfit,
    grossLoss,
    profitFactor: findMetric(rows, ["profit factor"]),
    expectedPayoff: findMetric(rows, ["expected payoff"]),
    absoluteDrawdown: findMetric(rows, ["balance drawdown absolute", "absolute drawdown"]),
    maximalDrawdown: findMetric(rows, [
      "balance drawdown maximal",
      "equity drawdown maximal",
      "maximal drawdown",
    ]),
    totalTrades,
    winRate,
    initialDeposit,
    finalBalance: null,
  };
}

function parseTesterLogSummary(log, config) {
  const summary = createSummaryFromConfig(config);
  const initialDeposit = parseNumeric(log.match(/initial deposit\s+([^\r\n]+)/i)?.[1]);
  const finalBalance = parseNumeric(log.match(/final balance\s+([^\r\n]+)/i)?.[1]);
  const ticksAndBars = log.match(/(\d+)\s+ticks,\s+(\d+)\s+bars generated/i);
  const equityCurve = parseEquityCurveFromTesterLog(
    log,
    config,
    initialDeposit ?? summary.initialDeposit,
  );
  const curveFinalBalance = equityCurve.length ? equityCurve[equityCurve.length - 1].balance : null;
  const resolvedFinalBalance = finalBalance ?? curveFinalBalance;
  const totalTrades = equityCurve.length
    ? Math.max(0, equityCurve[equityCurve.length - 1].trades)
    : log.includes("final balance")
      ? 0
      : null;

  return {
    ...summary,
    initialDeposit: initialDeposit ?? summary.initialDeposit,
    finalBalance: resolvedFinalBalance,
    netProfit:
      initialDeposit !== null && resolvedFinalBalance !== null
        ? resolvedFinalBalance - initialDeposit
        : null,
    grossProfit:
      initialDeposit !== null &&
      resolvedFinalBalance !== null &&
      resolvedFinalBalance >= initialDeposit
        ? resolvedFinalBalance - initialDeposit
        : null,
    grossLoss:
      initialDeposit !== null &&
      resolvedFinalBalance !== null &&
      resolvedFinalBalance < initialDeposit
        ? resolvedFinalBalance - initialDeposit
        : null,
    totalTrades,
    ticks: ticksAndBars ? Number(ticksAndBars[1]) : null,
    bars: ticksAndBars ? Number(ticksAndBars[2]) : null,
    equityCurve,
  };
}

function parseRunnerTimestamp(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return text;
  const [, year, month, day, hour, minute] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:00`;
}

function parseEquityCurveFromTesterLog(log, config, initialDeposit) {
  const points = [];
  if (initialDeposit !== null && initialDeposit !== undefined) {
    points.push({
      time: parseRunnerTimestamp(`${String(config?.fromDate || "").replaceAll(".", "-")}T00:00:00`),
      label: "Start",
      balance: Number(initialDeposit),
      equity: Number(initialDeposit),
      profit: 0,
      trades: 0,
    });
  }

  const pattern =
    /EA_BUILDER_EQUITY\|time=([^|]+)\|balance=([^|]+)\|equity=([^|]+)\|profit=([^|]+)\|deal=([^\r\n]+)/g;
  let match;
  let trades = 0;
  while ((match = pattern.exec(log))) {
    const balance = parseNumeric(match[2]);
    if (balance === null) continue;
    trades += 1;
    points.push({
      time: parseRunnerTimestamp(match[1]),
      label: match[1].trim(),
      balance,
      equity: parseNumeric(match[3]),
      profit: parseNumeric(match[4]),
      trades,
    });
  }

  return points;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildFallbackReportHtml(summary, testerLog) {
  const rows = [
    ["Initial Deposit", `${summary.initialDeposit ?? ""} ${summary.currency ?? ""}`.trim()],
    ["Final Balance", `${summary.finalBalance ?? ""} ${summary.currency ?? ""}`.trim()],
    ["Total Net Profit", summary.netProfit ?? ""],
    ["Gross Profit", summary.grossProfit ?? ""],
    ["Gross Loss", summary.grossLoss ?? ""],
    ["Total Trades", summary.totalTrades ?? ""],
  ];

  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>MT5 Backtest Report</title></head>
  <body>
    <h1>MT5 Backtest Report</h1>
    <p>MT5 completed the Strategy Tester run but did not emit its native HTML report, so this report was reconstructed from the Strategy Tester log.</p>
    <table border="1" cellspacing="0" cellpadding="4">
      ${rows
        .map(
          ([label, value]) =>
            `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`,
        )
        .join("\n")}
    </table>
    <h2>Strategy Tester Log</h2>
    <pre>${escapeHtml(testerLog)}</pre>
  </body>
</html>`;
}

function countCompileIssues(log) {
  const summary = log.match(/(?:result:)?\s*(\d+)\s+errors?,\s*(\d+)\s+warnings?/i);
  if (summary) {
    return {
      errors: Number(summary[1]),
      warnings: Number(summary[2]),
    };
  }
  const errors = (log.match(/\berror(s)?\b/gi) || []).length;
  const warnings = (log.match(/\bwarning(s)?\b/gi) || []).length;
  return { errors, warnings };
}

function compiledExecutablePath(expertPath) {
  return expertPath.replace(/\.mq5$/i, ".ex5");
}

async function configuredTerminalIsRunning(terminalPath) {
  if (process.platform !== "win32") return false;
  const escaped = terminalPath.replace(/'/g, "''").toLowerCase();
  const proc = await runProcess(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `(Get-Process terminal64 -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.ToLower() -eq '${escaped}' } | Select-Object -First 1 -ExpandProperty Id)`,
    ],
    10000,
  );
  return Boolean(proc.stdout.trim());
}

function buildTesterIni(jobId, mt5, request, expert) {
  const tester = request.testerConfig ?? {};
  const accountLogin = tester.login ?? mt5.accountLogin ?? "0";
  const accountServer = tester.server ?? mt5.accountServer ?? "";
  const reportName = `${jobId}-report`;
  const reportPath = resolveInside(JOBS_DIR, `${reportName}.htm`);
  const reportPathHtml = resolveInside(JOBS_DIR, `${reportName}.html`);
  const setFilename = `${jobId}.set`;
  const setPath = resolveInside(mt5.dataPath, "MQL5", "Profiles", "Tester", setFilename);
  const iniPath = resolveInside(JOBS_DIR, `${jobId}-tester.ini`);
  const setLines = buildSetLines(tester);
  const lines = [
    "[Common]",
    `Login=${accountLogin}`,
    accountServer ? `Server=${accountServer}` : null,
    "ProxyEnable=0",
    "NewsEnable=0",
    "",
    "[Tester]",
    `Expert=${expert.testerExpertName}`,
    `ExpertParameters=${setFilename}`,
    `Symbol=${tester.symbol ?? "EURUSD"}`,
    `Period=${tester.period ?? "M5"}`,
    `Login=${accountLogin}`,
    `Model=${modelToMt5Value(tester.model)}`,
    `FromDate=${tester.fromDate ?? "2025.01.01"}`,
    `ToDate=${tester.toDate ?? "2025.12.31"}`,
    `ForwardMode=${forwardModeToMt5(tester.forwardMode)}`,
    tester.forwardMode === "custom" && tester.forwardFromDate
      ? `ForwardDate=${tester.forwardFromDate}`
      : null,
    `Deposit=${tester.deposit ?? 10000}`,
    `Currency=${tester.currency ?? "USD"}`,
    `Leverage=${tester.leverage ?? "1:100"}`,
    `Optimization=${boolToMt5(tester.optimization)}`,
    `Visual=${boolToMt5(tester.visualMode)}`,
    `Local=${boolToMt5(tester.useLocalAgents ?? true)}`,
    `Remote=${boolToMt5(tester.useRemoteAgents)}`,
    `Cloud=${boolToMt5(tester.useCloudAgents)}`,
    `Report=${reportName}`,
    "ReplaceReport=1",
    "ShutdownTerminal=1",
    "",
  ].filter(Boolean);

  return {
    iniPath,
    reportPath,
    reportPaths: [reportPath, reportPathHtml],
    content: lines.join("\r\n"),
    setPath,
    setContent: setLines.join("\r\n"),
    dataPath: mt5.dataPath,
  };
}

function buildSetLines(tester) {
  const ranges = Array.isArray(tester.parameterRanges) ? tester.parameterRanges : [];
  const values = new Map([
    ["InpSymbol", tester.symbol ?? "EURUSD"],
    ["InpFastEMA", 12],
    ["InpSlowEMA", 48],
    ["InpRiskPercent", 1],
    ["InpRewardRisk", 2],
  ]);

  return [
    `InpSymbol=${tester.symbol ?? "EURUSD"}`,
    ...ranges.map((range) => {
      if (!range?.name) return null;
      const value = Number.isFinite(Number(range.value))
        ? Number(range.value)
        : (values.get(range.name) ?? 0);
      if (!tester.optimization || !range.enabled) return `${range.name}=${value}`;
      return `${range.name}=${value}||${range.start}||${range.step}||${range.stop}||Y`;
    }),
  ].filter(Boolean);
}

async function waitForFile(filePath, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await exists(filePath)) return true;
    await sleep(1000);
  }
  return false;
}

async function waitForBacktestOutput(mt5, reportPaths, testerLogOffset, timeoutMs) {
  const startedAt = Date.now();
  const stable = new Map();
  const testerLogPath = resolveInside(mt5.dataPath, "Tester", "logs", currentMt5LogName());

  while (Date.now() - startedAt < timeoutMs) {
    for (const filePath of reportPaths) {
      try {
        const info = await stat(filePath);
        const state = stable.get(filePath) ?? { lastSize: -1, reads: 0 };
        if (info.size > 500 && info.size === state.lastSize) {
          state.reads += 1;
        } else {
          state.lastSize = info.size;
          state.reads = 0;
        }
        stable.set(filePath, state);
        if (state.reads >= 2) {
          return {
            reportPath: filePath,
            testerLog: await readFileTextAfterLengthIfExists(testerLogPath, testerLogOffset),
          };
        }
      } catch {
        // Keep checking report and tester logs.
      }
    }

    const testerLog = await readFileTextAfterLengthIfExists(testerLogPath, testerLogOffset);
    if (
      testerLog.includes("automatical testing finished") ||
      testerLog.includes("tester didn't start") ||
      testerLog.includes("no history data, stop testing")
    ) {
      return { reportPath: null, testerLog };
    }

    await sleep(1000);
  }

  return {
    reportPath: null,
    testerLog: await readFileTextAfterLengthIfExists(testerLogPath, testerLogOffset),
  };
}

function currentMt5LogName() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}.log`;
}

function tailLines(text, count) {
  return String(text || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-count)
    .join("\n");
}

async function readTesterLogTail(mt5, lines = 80) {
  const logPath = resolveInside(mt5.dataPath, "Tester", "logs", currentMt5LogName());
  const log = await readFileIfExists(logPath);
  return log ? tailLines(log, lines) : "";
}

function createSummaryFromConfig(config) {
  return {
    ...emptyReportSummary(),
    initialDeposit: typeof config?.deposit === "number" ? config.deposit : null,
    currency: typeof config?.currency === "string" ? config.currency : null,
  };
}

async function findTerminalInDirectory(root) {
  if (!root || !(await exists(root))) return [];

  const found = [];
  const queue = [root];
  const maxDirectories = 250;
  let visited = 0;

  while (queue.length && visited < maxDirectories) {
    const current = queue.shift();
    visited += 1;

    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === "terminal64.exe") {
        found.push(fullPath);
      } else if (entry.isDirectory()) {
        const name = entry.name.toLowerCase();
        if (!["appdata", "windows", "system32", "node_modules"].includes(name)) {
          queue.push(fullPath);
        }
      }
    }
  }

  return found;
}

async function detectMt5Installations() {
  const config = await readConfig();
  const roots = [
    config.terminalPath ? path.dirname(config.terminalPath) : null,
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    path.join(os.homedir(), "AppData", "Roaming", "MetaQuotes", "Terminal"),
  ].filter(Boolean);

  const terminals = new Set();
  for (const root of roots) {
    const matches = await findTerminalInDirectory(root);
    for (const item of matches) terminals.add(item);
  }

  const installations = [];
  for (const terminalPath of terminals) {
    let modifiedAt = null;
    const dataPath =
      config.terminalPath === terminalPath && config.dataPath
        ? config.dataPath
        : await discoverDataPath(terminalPath);
    try {
      const info = await stat(terminalPath);
      modifiedAt = info.mtime.toISOString();
    } catch {
      // Best effort only. The path is still useful even without metadata.
    }

    installations.push({
      terminalPath,
      name: path.basename(path.dirname(terminalPath)),
      dataPath,
      version: null,
      modifiedAt,
      configured: config.terminalPath === terminalPath,
    });
  }

  return installations;
}

async function buildMt5Status() {
  const config = await readConfig();
  const installations = await detectMt5Installations();
  const configuredTerminalPath = config.terminalPath || null;
  const configured = Boolean(
    configuredTerminalPath &&
    installations.some((item) => item.terminalPath === configuredTerminalPath),
  );
  const activeJob = Array.from(jobs.values()).find(
    (record) => record.job.status === "queued" || record.job.status === "running",
  );

  return {
    status: activeJob ? "busy" : configured ? "mt5_configured" : "mt5_missing",
    runnerVersion: RUNNER_VERSION,
    platform: process.platform,
    dataDir: RUNNER_DIR,
    configuredTerminalPath,
    configuredDataPath: config.dataPath || null,
    tokenRequired: Boolean(config.apiToken),
    tokenPreview: maskToken(config.apiToken),
    installations,
    activeJobId: activeJob?.job.id ?? null,
    message: configured
      ? "MT5 terminal is configured."
      : installations.length
        ? "MT5 terminal was detected, but no terminal path has been selected yet."
        : "No MT5 terminal has been detected yet.",
  };
}

async function configureMt5(body) {
  const terminalPath = String(body.terminalPath || "").trim();
  if (!terminalPath.toLowerCase().endsWith("terminal64.exe")) {
    throw new Error("Select a valid terminal64.exe path.");
  }
  if (!(await exists(terminalPath))) {
    throw new Error(`MT5 terminal was not found at ${terminalPath}`);
  }

  const dataPath = body.dataPath ? String(body.dataPath) : await discoverDataPath(terminalPath);
  if (!dataPath) {
    throw new Error("MT5 terminal was found, but its data folder could not be resolved.");
  }
  if (!(await exists(path.join(dataPath, "MQL5")))) {
    throw new Error("The selected MT5 data folder is invalid because MQL5 was not found.");
  }

  const expertsPath = resolveInside(dataPath, "MQL5", "Experts");
  await mkdir(resolveInside(expertsPath, EXPERTS_SUBDIR), { recursive: true });

  const config = await writeConfig({
    ...((await readConfig()) || {}),
    terminalPath,
    dataPath,
    configuredAt: nowIso(),
  });

  return {
    ok: true,
    config,
    expertsPath,
    metaEditorPath: metaEditorPathForTerminal(terminalPath),
  };
}

async function openMetaEditor(body) {
  const mt5 = await resolveConfiguredMt5();
  if (!(await exists(mt5.metaEditorPath))) {
    throw new Error(`MetaEditor was not found at ${mt5.metaEditorPath}`);
  }

  const args = [];
  let openedPath = null;
  if (body?.eaFilename) {
    const filename = sanitizeFilename(body.eaFilename);
    const candidate = resolveInside(mt5.expertsDir, filename);
    if (await exists(candidate)) {
      openedPath = candidate;
      args.push(candidate);
    }
  }

  const child = spawn(mt5.metaEditorPath, args, {
    cwd: mt5.terminalDir,
    detached: true,
    windowsHide: false,
    stdio: "ignore",
  });
  child.unref();

  return {
    ok: true,
    metaEditorPath: mt5.metaEditorPath,
    openedPath,
  };
}

async function runCompileJob(record) {
  try {
    updateJob(record, { status: "running", message: "Writing EA and launching MetaEditor." });
    const hash = assertApprovedSource(record.request);
    const mt5 = await resolveConfiguredMt5();
    const expert = await writeExpertFile(mt5, record.request.eaFilename, record.request.sourceCode);
    const logPath = expert.expertPath.replace(/\.mq5$/i, ".log");
    const executablePath = compiledExecutablePath(expert.expertPath);
    assertInside(mt5.expertsDir, logPath);
    assertInside(mt5.expertsDir, executablePath);
    await removeFileIfExists(executablePath);
    await removeFileIfExists(logPath);
    record.log.push(`Wrote EA source: ${expert.expertPath}`);
    record.log.push(`Approved source hash: ${hash}`);

    if (!(await exists(mt5.metaEditorPath))) {
      throw new Error(`MetaEditor was not found at ${mt5.metaEditorPath}`);
    }

    record.log.push(`Launching MetaEditor: ${mt5.metaEditorPath}`);
    const proc = await runProcess(
      mt5.metaEditorPath,
      [`/compile:${expert.expertPath}`, `/include:${path.join(mt5.dataPath, "MQL5")}`, "/log"],
      90000,
    );
    const compileLog = (await readFileIfExists(logPath)) || proc.stdout || proc.stderr;
    const finalLog = [
      ...record.log,
      `MetaEditor exit code: ${proc.code}`,
      proc.timedOut ? "MetaEditor timed out." : null,
      proc.error ? `MetaEditor error: ${proc.error.message}` : null,
      compileLog,
    ]
      .filter(Boolean)
      .join("\n");
    const issues = countCompileIssues(finalLog);
    const executableReady = await waitForFile(executablePath, 5000);
    const success = !proc.timedOut && !proc.error && issues.errors === 0 && executableReady;

    record.log = finalLog.split(/\r?\n/).filter(Boolean);
    record.result = {
      job: record.job,
      success,
      errors: issues.errors,
      warnings: issues.warnings,
      log: finalLog,
      artifactPath: expert.expertPath,
      logPath,
      executablePath: executableReady ? executablePath : null,
    };
    updateJob(record, {
      status: success ? "succeeded" : "failed",
      message: success ? "MetaEditor compile completed." : "MetaEditor compile failed.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Compile job failed.";
    record.log.push(message);
    record.result = {
      job: record.job,
      success: false,
      errors: 1,
      warnings: 0,
      log: record.log.join("\n"),
      artifactPath: null,
      logPath: null,
      executablePath: null,
    };
    updateJob(record, { status: "failed", message });
  }
}

async function runBacktestJob(record) {
  try {
    updateJob(record, { status: "running", message: "Writing EA and launching MT5 tester." });
    const hash = assertApprovedSource(record.request);
    const mt5 = await resolveConfiguredMt5();
    const expert = await writeExpertFile(mt5, record.request.eaFilename, record.request.sourceCode);
    const testerIni = buildTesterIni(record.job.id, mt5, record.request, expert);
    const testerLogPath = resolveInside(mt5.dataPath, "Tester", "logs", currentMt5LogName());
    const testerLogOffset = (await readFileIfExists(testerLogPath)).length;
    for (const reportPath of testerIni.reportPaths) await removeFileIfExists(reportPath);
    await mkdir(path.dirname(testerIni.setPath), { recursive: true });
    await writeFile(testerIni.setPath, testerIni.setContent, "utf8");
    await writeFile(testerIni.iniPath, testerIni.content, "utf8");

    record.log.push(`Wrote EA source: ${expert.expertPath}`);
    record.log.push(`Approved source hash: ${hash}`);
    record.log.push(`Wrote tester inputs: ${testerIni.setPath}`);
    record.log.push(`Wrote tester config: ${testerIni.iniPath}`);
    record.log.push(`Expected report: ${testerIni.reportPath}`);
    record.log.push(`Launching terminal: ${mt5.terminalPath}`);

    if (await configuredTerminalIsRunning(mt5.terminalPath)) {
      throw new Error(
        "MT5 terminal is already running. Close MetaTrader 5 before launching a local Strategy Tester job.",
      );
    }

    const child = spawn(mt5.terminalPath, [`/config:${testerIni.iniPath}`], {
      cwd: assertInside(RUNNER_DIR, JOBS_DIR),
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    });
    child.unref();

    const output = await waitForBacktestOutput(mt5, testerIni.reportPaths, testerLogOffset, 300000);
    let completedReportPath = output.reportPath;
    let reportHtml = completedReportPath ? await readFileIfExists(completedReportPath) : null;
    const nativeReportGenerated = Boolean(completedReportPath);
    const testerCompleted = output.testerLog.includes("automatical testing finished");
    const testerStarted = output.testerLog.includes("testing of Experts");
    const testerHadRuntimeFailure =
      output.testerLog.includes("tester stopped because") ||
      output.testerLog.includes("OnInit returns non-zero") ||
      output.testerLog.includes("cannot load indicator") ||
      output.testerLog.includes("no history data, stop testing");
    const testerSucceeded = testerCompleted && testerStarted && !testerHadRuntimeFailure;

    if (!completedReportPath && output.testerLog) {
      record.log.push("Strategy Tester log:");
      record.log.push(output.testerLog);
    }

    let summary = reportHtml
      ? parseReportSummary(reportHtml, record.request.testerConfig)
      : createSummaryFromConfig(record.request.testerConfig);

    if (!reportHtml && testerSucceeded) {
      summary = parseTesterLogSummary(output.testerLog, record.request.testerConfig);
      reportHtml = buildFallbackReportHtml(summary, output.testerLog);
      completedReportPath = testerIni.reportPath;
      await writeFile(completedReportPath, reportHtml, "utf8");
    }

    const success = Boolean(completedReportPath) || testerSucceeded;

    record.report = {
      jobId: record.job.id,
      summary,
      html: reportHtml,
      path: completedReportPath,
    };
    record.result = {
      job: record.job,
      success,
      summary,
      testerConfig: record.request.testerConfig ?? null,
      reportPath: completedReportPath,
      reportHtml,
      log: record.log.join("\n"),
    };
    updateJob(record, {
      status: success ? "succeeded" : "failed",
      message: nativeReportGenerated
        ? "MT5 Strategy Tester report was generated."
        : testerSucceeded
          ? "MT5 Strategy Tester finished; report was reconstructed from tester logs."
          : "MT5 Strategy Tester did not produce a report before timeout.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backtest job failed.";
    record.log.push(message);
    const summary = createSummaryFromConfig(record.request?.testerConfig);
    record.report = {
      jobId: record.job.id,
      summary,
      html: null,
      path: null,
    };
    record.result = {
      job: record.job,
      success: false,
      summary,
      testerConfig: record.request?.testerConfig ?? null,
      reportPath: null,
      reportHtml: null,
      log: record.log.join("\n"),
    };
    updateJob(record, { status: "failed", message });
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, jsonHeaders);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

    const config = await readConfig();

    if (req.method === "GET" && url.pathname === "/") {
      sendHtml(
        res,
        200,
        `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MT5 Local Runner</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b1018; color: #e8edf5; }
      main { width: min(720px, calc(100vw - 32px)); border: 1px solid #263244; background: #111824; border-radius: 8px; padding: 28px; }
      h1 { margin: 0 0 8px; font-size: 22px; }
      p { color: #a8b3c5; line-height: 1.55; }
      code { background: #1b2636; border: 1px solid #2a384d; border-radius: 6px; padding: 2px 6px; }
      .token { user-select: all; display: block; margin: 12px 0; padding: 12px; background: #0b1018; border: 1px solid #2a384d; border-radius: 6px; overflow-wrap: anywhere; color: #ffffff; }
      .status { display: inline-flex; align-items: center; gap: 8px; color: #76e4a6; font-weight: 600; }
      .dot { width: 9px; height: 9px; border-radius: 99px; background: #42d77d; box-shadow: 0 0 18px #42d77d; }
      ul { padding-left: 20px; color: #c9d2e3; }
    </style>
  </head>
  <body>
    <main>
      <div class="status"><span class="dot"></span> Local runner online</div>
      <h1>MT5 Local Runner</h1>
      <p>This service is the Windows companion for the EA Builder app. It compiles generated MQL5 code and launches MT5 Strategy Tester jobs from this computer.</p>
      <p>Connection token:</p>
      <code class="token">${escapeHtml(config.apiToken)}</code>
      <p>Paste this token into the EA Builder connection wizard. Keep it private; it allows local browser requests to compile and backtest through this runner.</p>
      <p>This runner only supports compile and Strategy Tester workflows. It does not attach EAs to live charts or place live trades.</p>
      <ul>
        <li><code>GET /health</code> checks runner status.</li>
        <li><code>GET /mt5/status</code> returns configured terminal and job state.</li>
        <li><code>GET /mt5/installations</code> attempts to discover MT5 terminals.</li>
        <li><code>POST /mt5/configure</code> stores the selected terminal path.</li>
        <li><code>POST /compile</code> writes the EA and launches MetaEditor compile.</li>
        <li><code>POST /backtest</code> writes the EA, generates tester config, and launches MT5.</li>
        <li><code>GET /jobs/:id</code>, <code>GET /jobs/:id/logs</code>, and <code>GET /jobs/:id/report</code> expose job state and artifacts.</li>
      </ul>
    </main>
  </body>
</html>`,
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        service: "mt5-local-runner",
        version: RUNNER_VERSION,
        host: HOST,
        port: PORT,
        platform: process.platform,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/security/pairing") {
      sendJson(res, 200, {
        tokenRequired: Boolean(config.apiToken),
        tokenPreview: maskToken(config.apiToken),
        instructions: "Open http://127.0.0.1:8765 in a browser on this PC to copy the token.",
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/security/rotate-token") {
      if (!(await requireAuthorized(req, res))) return;
      const next = await writeConfig({ ...config, apiToken: createApiToken() });
      sendJson(res, 200, {
        ok: true,
        token: next.apiToken,
        tokenPreview: maskToken(next.apiToken),
      });
      return;
    }

    if (
      url.pathname !== "/" &&
      url.pathname !== "/health" &&
      !(await requireAuthorized(req, res))
    ) {
      return;
    }

    if (req.method === "GET" && url.pathname === "/mt5/status") {
      sendJson(res, 200, await buildMt5Status());
      return;
    }

    if (req.method === "GET" && url.pathname === "/mt5/installations") {
      const installations = await detectMt5Installations();
      sendJson(res, 200, { installations });
      return;
    }

    if (req.method === "POST" && url.pathname === "/mt5/configure") {
      const body = await readJsonBody(req);
      sendJson(res, 200, await configureMt5(body));
      return;
    }

    if (req.method === "POST" && url.pathname === "/mt5/open-metaeditor") {
      const body = await readJsonBody(req);
      sendJson(res, 200, await openMetaEditor(body));
      return;
    }

    if (req.method === "POST" && url.pathname === "/compile") {
      const body = await readJsonBody(req);
      assertApprovedSource(body);
      const job = makeJob("compile", "queued", "Compile job queued.");
      const record = rememberJob({
        job,
        request: body,
        log: ["Compile job accepted by MT5 Local Runner."],
        report: null,
        result: {
          job,
          success: false,
          errors: 0,
          warnings: 0,
          log: "Compile job accepted by MT5 Local Runner.",
          artifactPath: null,
          logPath: null,
          executablePath: null,
        },
      });
      runCompileJob(record);
      sendJson(res, 202, record.result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/backtest") {
      const body = await readJsonBody(req);
      assertApprovedSource(body);
      const job = makeJob("backtest", "queued", "Backtest job queued.");
      const summary = createSummaryFromConfig(body?.testerConfig);
      const report = {
        jobId: job.id,
        summary,
        html: null,
        path: null,
      };
      const record = rememberJob({
        job,
        request: body,
        log: ["Backtest job accepted by MT5 Local Runner."],
        report,
        result: {
          job,
          success: false,
          summary,
          testerConfig: body?.testerConfig ?? null,
          reportPath: null,
          reportHtml: null,
          log: "Backtest job accepted by MT5 Local Runner.",
        },
      });
      runBacktestJob(record);
      sendJson(res, 202, record.result);
      return;
    }

    const jobMatch = url.pathname.match(/^\/jobs\/([^/]+)$/);
    if (req.method === "GET" && jobMatch) {
      const record = jobs.get(decodeURIComponent(jobMatch[1]));
      if (!record) {
        sendJson(res, 404, { error: "Job not found" });
        return;
      }
      sendJson(res, 200, record.result ?? { job: record.job });
      return;
    }

    const logMatch = url.pathname.match(/^\/jobs\/([^/]+)\/logs$/);
    if (req.method === "GET" && logMatch) {
      const record = jobs.get(decodeURIComponent(logMatch[1]));
      if (!record) {
        sendJson(res, 404, { error: "Job not found" });
        return;
      }
      sendJson(res, 200, { jobId: record.job.id, lines: record.log });
      return;
    }

    const reportMatch = url.pathname.match(/^\/jobs\/([^/]+)\/report$/);
    if (req.method === "GET" && reportMatch) {
      const record = jobs.get(decodeURIComponent(reportMatch[1]));
      if (!record) {
        sendJson(res, 404, { error: "Job not found" });
        return;
      }
      sendJson(
        res,
        200,
        record.report ?? {
          jobId: record.job.id,
          summary: null,
          html: null,
          path: null,
        },
      );
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    if (error?.code === "approval_required") {
      sendJson(res, 403, {
        error: error.message,
        code: error.code,
        sourceHash: error.sourceHash,
      });
      return;
    }
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Internal runner error",
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`MT5 Local Runner listening on http://${HOST}:${PORT}`);
});
