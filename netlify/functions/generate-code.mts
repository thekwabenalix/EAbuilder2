// Regenerates MQL5 code from an existing StrategyBlueprint.
// Streams the response via SSE to avoid Netlify's 26-second function timeout.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Proven, always-compilable MQL5 helper functions ─────────────────────────
// These are extracted from a production EA builder that compiles without errors.
// The AI MUST copy these verbatim — do NOT rewrite or simplify them.
const PROVEN_HELPERS = `
//+------------------------------------------------------------------+
//  MANDATORY HELPER FUNCTIONS — copy verbatim, never rewrite
//+------------------------------------------------------------------+

// Normalize a lot size to broker limits
double NormalizeVolume(double volume, string symbol)
{
   double minLot  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   if(lotStep <= 0) lotStep = 0.01;
   volume = MathFloor(volume / lotStep) * lotStep;
   if(volume < minLot) volume = minLot;
   if(volume > maxLot) volume = maxLot;
   int digits = 0;
   double step = lotStep;
   while(step < 1.0 && digits < 8) { step *= 10.0; digits++; }
   return NormalizeDouble(volume, digits);
}

// Risk-based lot sizing using tick value — the only correct approach in MQL5
double CalcLot(double stopDistancePoints, string symbol, double riskPercent)
{
   if(stopDistancePoints <= 0) return 0.0;
   double equity    = AccountInfoDouble(ACCOUNT_EQUITY);
   double riskMoney = equity * (riskPercent / 100.0);
   double tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
   if(tickValue <= 0) tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE_PROFIT);
   if(tickValue <= 0) tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   double tickSize  = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
   double point     = SymbolInfoDouble(symbol, SYMBOL_POINT);
   if(tickValue <= 0 || tickSize <= 0 || point <= 0) return 0.0;
   double lossPerLot = (stopDistancePoints * point / tickSize) * tickValue;
   if(lossPerLot <= 0) return 0.0;
   return NormalizeVolume(riskMoney / lossPerLot, symbol);
}

// Check whether this EA already has an open position on this symbol
bool HasOpenPosition(string symbol, long magic)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL) == symbol &&
         PositionGetInteger(POSITION_MAGIC) == magic)
         return true;
   }
   return false;
}

// Spread guard — skip entry when spread is too wide
bool SpreadOk(string symbol, int maxSpreadPoints)
{
   if(maxSpreadPoints <= 0) return true;
   long spread = SymbolInfoInteger(symbol, SYMBOL_SPREAD);
   return spread <= maxSpreadPoints;
}

// Safe CopyBuffer wrapper — returns 0.0 on failure, never crashes
double IndicatorValue(int handle, int bufferIndex, int shift)
{
   if(handle == INVALID_HANDLE) return 0.0;
   double buf[];
   ArraySetAsSeries(buf, true);
   if(CopyBuffer(handle, bufferIndex, shift, 1, buf) != 1) return 0.0;
   return buf[0];
}
`;

const MQL5_SYSTEM = `You are a senior MQL5 developer generating a COMPLETE, COMPILABLE Expert Advisor (.mq5 file) from a StrategyBlueprint JSON.

══════════════════════════════════════════════
MANDATORY: USE THESE EXACT HELPER FUNCTIONS
══════════════════════════════════════════════
Copy the following helper functions VERBATIM into every file you generate.
They are proven-compilable. Do NOT rewrite, rename, or simplify them.
${PROVEN_HELPERS}

══════════════════════════════════════════════
FILE STRUCTURE (in order)
══════════════════════════════════════════════
1. Header comment block
2. #property copyright / version / strict
3. #include <Trade/Trade.mqh>
4. CTrade trade;  ← single global instance
5. Input parameters (every tunable value, grouped and commented)
6. Global variables (indicator handles as int = INVALID_HANDLE, state vars)
7. The 5 mandatory helper functions above (NormalizeVolume, CalcLot, HasOpenPosition, SpreadOk, IndicatorValue)
8. Additional helper functions specific to this strategy
9. OnInit()
10. OnDeinit()
11. OnTick()
12. TryEntry() or TryBuy()/TrySell()

══════════════════════════════════════════════
ONINT() TEMPLATE — follow exactly
══════════════════════════════════════════════
int OnInit()
{
   trade.SetExpertMagicNumber((ulong)InpMagic);
   trade.SetTypeFillingBySymbol(_Symbol);

   // Create indicator handles here
   hMyIndicator = iMA(_Symbol, PERIOD_CURRENT, InpPeriod, 0, MODE_EMA, PRICE_CLOSE);
   if(hMyIndicator == INVALID_HANDLE) { Print("Failed to create indicator handle"); return INIT_FAILED; }

   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   if(hMyIndicator != INVALID_HANDLE) IndicatorRelease(hMyIndicator);
}

══════════════════════════════════════════════
ONTICK() BAR-OPEN PATTERN — always use this
══════════════════════════════════════════════
static datetime lastBarTime = 0;
datetime currentBarTime = iTime(_Symbol, PERIOD_CURRENT, 0);
if(currentBarTime == lastBarTime) return;
lastBarTime = currentBarTime;
// ... rest of logic on bar[1] (the closed bar)

══════════════════════════════════════════════
STRICT MQL5-ONLY — NEVER USE MQL4 SYNTAX
══════════════════════════════════════════════
PRICES — use SymbolInfoDouble, never bare globals:
  ❌ Ask, Bid
  ✅ SymbolInfoDouble(_Symbol, SYMBOL_ASK)
  ✅ SymbolInfoDouble(_Symbol, SYMBOL_BID)

MAGIC NUMBER:
  ❌ trade.SetMagicNumber(InpMagic)   ← does not exist
  ✅ trade.SetExpertMagicNumber((ulong)InpMagic)

ACCOUNT INFO:
  ❌ AccountBalance(), AccountEquity()   ← MQL4 functions
  ✅ AccountInfoDouble(ACCOUNT_BALANCE)
  ✅ AccountInfoDouble(ACCOUNT_EQUITY)

SYMBOL INFO:
  ❌ MarketInfo()   ← MQL4 only
  ✅ SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN/MAX/STEP/POINT)
  ✅ SymbolInfoInteger(_Symbol, SYMBOL_SPREAD/DIGITS/TRADE_STOPS_LEVEL)

ORDERS:
  ❌ OrderSend() with simple args   ← MQL4 style
  ✅ trade.Buy(lot, _Symbol, 0, sl, tp, "comment")
  ✅ trade.Sell(lot, _Symbol, 0, sl, tp, "comment")
  ✅ trade.PositionClose(ticket)

INDICATOR READING:
  ❌ Reading from iMA() return value directly
  ✅ Create handle in OnInit(), read with CopyBuffer() or use IndicatorValue() above

══════════════════════════════════════════════
RULES
══════════════════════════════════════════════
- Only implement what is in blueprint.rules. Never add undescribed logic.
- For any rule where compilable=false: add a // TODO comment explaining what to implement manually.
- Always check INVALID_HANDLE in OnInit(), return INIT_FAILED if any handle fails.
- Use CalcLot() from the helpers above for lot sizing — never hardcode lots.
- Use HasOpenPosition() from the helpers above to prevent duplicate entries.
- Use SpreadOk() from the helpers above before every entry.
- Use IndicatorValue() from the helpers above for every CopyBuffer call.

Output format:
Return ONLY the raw .mq5 file content.
No markdown. No code fences. No explanation. Start with //+---`;

/** The prefill prefix — forces Claude to start with the MQL5 header immediately. */
const PREFILL = "//+------------------------------------------------------------------+";

export default async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "Server configuration error: ANTHROPIC_API_KEY is missing" },
      { status: 500, headers: CORS },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
  }

  const blueprint = body?.blueprint;
  if (!blueprint || typeof blueprint !== "object") {
    return Response.json({ error: "Missing or invalid blueprint" }, { status: 400, headers: CORS });
  }

  // Stream the response so Netlify doesn't time out on long code outputs.
  const readable = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        let generatedText = "";

        const stream = await client.messages.stream({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 8192,
          system: [{ type: "text", text: MQL5_SYSTEM, cache_control: { type: "ephemeral" } }],
          messages: [
            {
              role: "user",
              content: `Generate the complete MQL5 Expert Advisor for this StrategyBlueprint:\n\n${JSON.stringify(blueprint, null, 2)}`,
            },
            {
              role: "assistant",
              // Prefill forces Claude to start with the MQL5 header — no prose or code fences possible.
              content: PREFILL,
            },
          ],
        });

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            generatedText += event.delta.text;
            send({ text: event.delta.text });
          }
        }

        // Signal completion — client uses accumulated text as the final code.
        send({ done: true });
      } catch (err) {
        console.error("generate-code error:", err);
        send({ error: err instanceof Error ? err.message : "Stream error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      ...CORS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
};

export const config = {
  path: "/api/generate-code",
  timeout: 26,
};
