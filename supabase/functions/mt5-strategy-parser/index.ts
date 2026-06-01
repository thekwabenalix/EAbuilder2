// MT5 Strategy Parser Edge Function
// Accepts { prompt: string } and returns a normalized StrategySpec JSON.
// Uses Lovable AI Gateway when LOVABLE_API_KEY is available, otherwise
// falls back to a deterministic mock parser so the UI always works.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface StrategySpec {
  name: string;
  symbol: string;
  setupTimeframe: string;
  entryTimeframe: string;
  fastEma: number;
  slowEma: number;
  riskPercent: number;
  rewardRisk: number;
  maxSpreadPoints: number;
  setupExpiryBars: number;
  stopBufferPoints: number;
  buyRules: string[];
  sellRules: string[];
  guardrails: string[];
}

const DEFAULT_SPEC: StrategySpec = {
  name: "Untitled Strategy",
  symbol: "EURUSD",
  setupTimeframe: "H1",
  entryTimeframe: "M5",
  fastEma: 12,
  slowEma: 48,
  riskPercent: 1,
  rewardRisk: 2,
  maxSpreadPoints: 25,
  setupExpiryBars: 24,
  stopBufferPoints: 20,
  buyRules: [],
  sellRules: [],
  guardrails: [],
};

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim().length > 0).map((x) => String(x).trim());
}

function normalizeSpec(raw: Partial<StrategySpec> & Record<string, unknown>): StrategySpec {
  return {
    name: String(raw.name ?? DEFAULT_SPEC.name).slice(0, 120) || DEFAULT_SPEC.name,
    symbol: String(raw.symbol ?? DEFAULT_SPEC.symbol)
      .toUpperCase()
      .slice(0, 16),
    setupTimeframe: String(raw.setupTimeframe ?? DEFAULT_SPEC.setupTimeframe).toUpperCase(),
    entryTimeframe: String(raw.entryTimeframe ?? DEFAULT_SPEC.entryTimeframe).toUpperCase(),
    fastEma: clampNumber(raw.fastEma, DEFAULT_SPEC.fastEma, 1, 500),
    slowEma: clampNumber(raw.slowEma, DEFAULT_SPEC.slowEma, 1, 1000),
    riskPercent: clampNumber(raw.riskPercent, DEFAULT_SPEC.riskPercent, 0.01, 100),
    rewardRisk: clampNumber(raw.rewardRisk, DEFAULT_SPEC.rewardRisk, 0.1, 50),
    maxSpreadPoints: clampNumber(raw.maxSpreadPoints, DEFAULT_SPEC.maxSpreadPoints, 0, 10000),
    setupExpiryBars: clampNumber(raw.setupExpiryBars, DEFAULT_SPEC.setupExpiryBars, 1, 10000),
    stopBufferPoints: clampNumber(raw.stopBufferPoints, DEFAULT_SPEC.stopBufferPoints, 0, 100000),
    buyRules: asStringArray(raw.buyRules),
    sellRules: asStringArray(raw.sellRules),
    guardrails: asStringArray(raw.guardrails),
  };
}

// Deterministic fallback parser. Pulls common values out of the prompt with regex.
function mockParse(prompt: string): StrategySpec {
  const text = prompt || "";
  const lower = text.toLowerCase();

  const emaNums = Array.from(text.matchAll(/\b(\d{1,3})\s*(?:and|&|\/)\s*(\d{1,3})\b/g))
    .map((m) => [parseInt(m[1], 10), parseInt(m[2], 10)])
    .find((pair) => pair.every((n) => n > 0 && n < 500));
  const fast = emaNums ? Math.min(...emaNums) : DEFAULT_SPEC.fastEma;
  const slow = emaNums ? Math.max(...emaNums) : DEFAULT_SPEC.slowEma;

  const symbolMatch = text.match(/\b([A-Z]{6}|XAUUSD|XAGUSD|US30|NAS100|BTCUSD)\b/);
  const symbol = symbolMatch ? symbolMatch[1] : DEFAULT_SPEC.symbol;

  const setupTfMatch = lower.match(/(\d+)\s*(hour|hr|h)\b/);
  const setupTimeframe = setupTfMatch ? `H${setupTfMatch[1]}` : DEFAULT_SPEC.setupTimeframe;

  const entryTfMatch = lower.match(/(\d+)\s*(minute|min|m)\b/);
  const entryTimeframe = entryTfMatch ? `M${entryTfMatch[1]}` : DEFAULT_SPEC.entryTimeframe;

  const riskMatch = lower.match(/risk\s*(\d+(?:\.\d+)?)\s*%/);
  const riskPercent = riskMatch ? parseFloat(riskMatch[1]) : DEFAULT_SPEC.riskPercent;

  const rrMatch = lower.match(/(\d+(?:\.\d+)?)\s*[:r]\s*(\d+(?:\.\d+)?)/);
  const rewardRisk = rrMatch
    ? parseFloat(rrMatch[1]) / parseFloat(rrMatch[2])
    : DEFAULT_SPEC.rewardRisk;

  const nameMatch = text.match(/(?:for the|called|named)\s+([A-Z][\w\s]{2,40}?)\s+strategy/i);
  const name = nameMatch ? `${nameMatch[1].trim()} Strategy` : "Custom MT5 Strategy";

  const buyRules = [
    `Higher timeframe (${setupTimeframe}): fast EMA(${fast}) above slow EMA(${slow})`,
    `Lower timeframe (${entryTimeframe}): price pulls back to touch fast EMA(${fast})`,
    `Entry on ${entryTimeframe} candle close above slow EMA(${slow})`,
    `Stop loss beyond the low of the signal candle plus buffer`,
  ];
  const sellRules = [
    `Higher timeframe (${setupTimeframe}): slow EMA(${slow}) above fast EMA(${fast})`,
    `Lower timeframe (${entryTimeframe}): price pulls back to touch slow EMA(${slow})`,
    `Entry on ${entryTimeframe} candle close below fast EMA(${fast})`,
    `Stop loss beyond the high of the signal candle plus buffer`,
  ];
  const guardrails = [
    `Risk ${riskPercent}% of account equity per trade`,
    `Reward:risk target ${rewardRisk}:1`,
    `Skip entries when spread exceeds ${DEFAULT_SPEC.maxSpreadPoints} points`,
    `Only one open position per symbol`,
    `Cancel setup if no entry within ${DEFAULT_SPEC.setupExpiryBars} bars`,
  ];

  return normalizeSpec({
    name,
    symbol,
    setupTimeframe,
    entryTimeframe,
    fastEma: fast,
    slowEma: slow,
    riskPercent,
    rewardRisk,
    buyRules,
    sellRules,
    guardrails,
  });
}

async function aiParse(prompt: string, apiKey: string): Promise<StrategySpec | null> {
  try {
    const system = `You convert plain-English forex/MT5 trading strategy descriptions into a strict JSON spec.
Return ONLY valid JSON with this exact shape:
{
  "name": string,
  "symbol": string (uppercase, e.g. EURUSD, XAUUSD),
  "setupTimeframe": string (MT5 style: M1,M5,M15,M30,H1,H4,D1,W1,MN),
  "entryTimeframe": string (MT5 style),
  "fastEma": number,
  "slowEma": number,
  "riskPercent": number,
  "rewardRisk": number,
  "maxSpreadPoints": number,
  "setupExpiryBars": number,
  "stopBufferPoints": number,
  "buyRules": string[],
  "sellRules": string[],
  "guardrails": string[]
}
No prose, no markdown. Use sensible defaults when missing.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      console.error("AI gateway error", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    if (!content) return null;
    const parsed = JSON.parse(content);
    return normalizeSpec(parsed);
  } catch (err) {
    console.error("aiParse failed", err);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const prompt: string = typeof body?.prompt === "string" ? body.prompt : "";
    if (!prompt.trim()) {
      return new Response(JSON.stringify({ error: "Missing prompt" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    let spec: StrategySpec | null = null;
    let source: "ai" | "mock" = "mock";

    if (apiKey) {
      spec = await aiParse(prompt, apiKey);
      if (spec) source = "ai";
    }
    if (!spec) spec = mockParse(prompt);

    return new Response(JSON.stringify({ spec, source }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
