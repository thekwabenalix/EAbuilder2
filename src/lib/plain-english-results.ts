import type { StrategyBlueprint } from "@/types/blueprint";
import type { ReportSummary } from "@/types/mt5";
import {
  buildExpectedTradePath,
  parseTesterLogForTradeAudit,
} from "@/lib/trade-audit";
import { buildRuleAudit } from "@/lib/rule-audit";

export type ResultsNextAction =
  | { kind: "ask_assistant"; label: string; prompt: string }
  | { kind: "retest"; label: string }
  | { kind: "none"; label?: string };

export interface PlainEnglishResults {
  tone: "success" | "warning" | "danger" | "info";
  headline: string;
  summary: string;
  bullets: string[];
  likelyCause: string | null;
  nextAction: ResultsNextAction;
}

function fmtMoney(n: number | null | undefined, currency: string | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const c = currency?.trim() || "";
  const sign = n > 0 ? "+" : "";
  return `${sign}${c}${n.toFixed(2)}`;
}

function friendlyBlockReason(reason: string): string {
  const r = reason.toLowerCase();
  if (/outside session|session filter|trading time|not in session/i.test(r)) {
    return "New trades were blocked because price was outside your trading hours.";
  }
  if (/direction mismatch|not aligned|dir_mismatch|bias/i.test(r)) {
    return "The entry disagreed with the bigger-picture Direction layer.";
  }
  if (/setup|no setup|setup not/i.test(r)) {
    return "The Setup layer never lined up, so entries stayed closed.";
  }
  if (/max.?stop|stop.?too|sl distance/i.test(r)) {
    return "Trades were skipped because the stop loss would have been too wide.";
  }
  if (/max.?trade|already open|max positions/i.test(r)) {
    return "The robot hit its max open-trades limit.";
  }
  if (/spread/i.test(r)) {
    return "Spreads were too wide for the rules you set.";
  }
  if (/gate|blocked|signal_blocked/i.test(r)) {
    return "A strategy rule blocked the entry before a trade could open.";
  }
  return reason.replace(/[\[\]]/g, "").trim() || "A strategy rule blocked entries.";
}

const ZERO_TRADES_PROMPT =
  "Why no trades? Explain in plain English using the test results and tester log. Tell me the most likely reason, then the safest next click in the app.";

const FAILED_TEST_PROMPT =
  "My history test failed. Explain in plain English what went wrong (helper, MetaTrader, data, or robot), then the safest next click.";

/** Beginner-facing story for a finished history test. */
export function buildPlainEnglishResults(input: {
  blueprint: StrategyBlueprint;
  success: boolean;
  summary: ReportSummary | null;
  testerLog?: string | null;
  symbol: string;
  period: string;
  fromDate: string;
  toDate: string;
  suggestedPeriod?: string;
}): PlainEnglishResults {
  const { blueprint, success, summary, testerLog, symbol, period, fromDate, toDate, suggestedPeriod } =
    input;
  const trades = summary?.totalTrades ?? null;
  const expected = buildExpectedTradePath(blueprint);
  const parsed = testerLog?.trim()
    ? parseTesterLogForTradeAudit(testerLog, {
        tradingSchedule:
          blueprint.fourBrain?.management?.tradingSchedule ??
          blueprint.strategyFlow?.management?.tradingSchedule,
      })
    : null;
  const ruleAudit = buildRuleAudit({ blueprint, testerLog, parsed });

  const rangeLine = `${symbol} · ${period} · ${fromDate} → ${toDate}`;

  if (!success) {
    return {
      tone: "danger",
      headline: "History test didn’t finish",
      summary: `Something stopped the run on ${rangeLine}.`,
      bullets: [
        "This is usually the MT5 helper, MetaTrader already open, or missing price data — not your strategy idea itself.",
        "Use Ask Assistant for a plain-English diagnosis, or close MT5 and try Test on history again.",
      ],
      likelyCause: "The tester couldn’t complete a full report.",
      nextAction: {
        kind: "ask_assistant",
        label: "Ask Assistant what went wrong",
        prompt: FAILED_TEST_PROMPT,
      },
    };
  }

  if (trades === 0) {
    const bullets: string[] = [
      `The robot ran on ${rangeLine} but never opened a trade.`,
    ];
    if (suggestedPeriod && suggestedPeriod !== period) {
      bullets.push(
        `Your strategy’s entry layer uses ${suggestedPeriod}, but this test ran on ${period} — that often causes zero trades.`,
      );
    }
    if (parsed?.sessionHint) {
      bullets.push(parsed.sessionHint);
    }
    if (ruleAudit.steps.some((s) => s.status === "missing")) {
      const missing = ruleAudit.steps
        .filter((s) => s.status === "missing")
        .map((s) => s.name)
        .slice(0, 3);
      if (missing.length) {
        bullets.push(`These steps never showed up in the log: ${missing.join(", ")}.`);
      }
    }
    if (!parsed?.hasAuditMarkers && testerLog?.trim()) {
      bullets.push(
        "The log has few robot markers — prepare again so the newest robot file is what’s tested.",
      );
    }

    const cause = parsed?.dominantBlock
      ? friendlyBlockReason(parsed.dominantBlock)
      : suggestedPeriod && suggestedPeriod !== period
        ? `Tester timeframe (${period}) doesn’t match the strategy entry timeframe (${suggestedPeriod}).`
        : "The Direction → Setup → Entry chain never completed in this date range.";

    return {
      tone: "warning",
      headline: "No trades in this test",
      summary: "The run completed, but the robot never entered the market.",
      bullets,
      likelyCause: cause,
      nextAction: {
        kind: "ask_assistant",
        label: "Why no trades?",
        prompt: ZERO_TRADES_PROMPT,
      },
    };
  }

  const net = summary?.netProfit ?? null;
  const winRate = summary?.winRate;
  const dd = summary?.maximalDrawdown;
  const bullets: string[] = [
    `Opened ${trades} trade${trades === 1 ? "" : "s"} on ${rangeLine}.`,
  ];
  if (winRate != null) {
    bullets.push(`About ${winRate.toFixed(0)}% of trades were winners.`);
  }
  if (dd != null) {
    bullets.push(`Worst drawdown was roughly ${dd.toFixed(1)}%.`);
  }
  if (expected.length) {
    bullets.push(
      `Strategy chain: ${expected.map((s) => s.name).slice(0, 4).join(" → ")}${expected.length > 4 ? "…" : ""}.`,
    );
  }
  if (parsed?.sessionHint) {
    bullets.push(parsed.sessionHint);
  }

  const profitable = net != null && net >= 0;
  return {
    tone: profitable ? "success" : "info",
    headline: profitable ? "History test finished" : "History test finished (net loss)",
    summary:
      net == null
        ? "Here’s how the robot behaved on past data."
        : profitable
          ? `Net result ${fmtMoney(net, summary?.currency)} on this sample.`
          : `Net result ${fmtMoney(net, summary?.currency)} on this sample — useful for learning, not a promise of live profit.`,
    bullets,
    likelyCause: null,
    nextAction:
      (winRate != null && winRate < 40) || (dd != null && dd > 25)
        ? {
            kind: "ask_assistant",
            label: "Ask Assistant to review this",
            prompt:
              "Review this history test in plain English. Are the results useful, risky, or a wiring problem? End with one safest next click.",
          }
        : { kind: "none" },
  };
}
