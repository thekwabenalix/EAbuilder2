// Applies the AI-described fix to the MQL5 code.
// Called after the user reads the fix summary in the chat and clicks "Apply Fix".
// The conversation history tells this model exactly what to change; it writes the full corrected file.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `You are an expert MQL5 developer applying code fixes described in a conversation.

Your job: read the conversation history, find the described changes, and apply ALL of them to the provided MQL5 code.

Output rules (CRITICAL):
- Return ONLY the raw .mq5 file content — no markdown, no code fences, no explanations
- Include EVERY line of the original file; only change what was described
- Never truncate — write the entire file from start to finish
- Start directly with //+------------------------------------------------------------------+

MQL5-only syntax — enforce every rule below in the output:
  PRICES:     ❌ Ask, Bid  →  ✅ SymbolInfoDouble(_Symbol, SYMBOL_ASK/BID)
  MAGIC:      ❌ trade.SetMagicNumber()  →  ✅ trade.SetExpertMagicNumber((ulong)InpMagic)
  ACCOUNT:    ❌ AccountBalance(), AccountEquity()  →  ✅ AccountInfoDouble(ACCOUNT_BALANCE/EQUITY)
  SYMBOL:     ❌ MarketInfo()  →  ✅ SymbolInfoDouble/Integer(_Symbol, ...)
  ORDERS:     ❌ OrderSend() MQL4-style  →  ✅ trade.Buy() / trade.Sell() / trade.PositionClose()
  INDICATORS: ❌ reading handle return value  →  ✅ CopyBuffer() or the IndicatorValue() helper
  LOT SIZE:   ❌ hardcoded lots or equity/stop division without tick math
              ✅ Use CalcLot() that includes SYMBOL_TRADE_TICK_VALUE / SYMBOL_TRADE_TICK_SIZE

Proven helpers — if the file is missing any of these, ADD them verbatim:

double NormalizeVolume(double volume, string symbol)
{
   double minLot=SymbolInfoDouble(symbol,SYMBOL_VOLUME_MIN);
   double maxLot=SymbolInfoDouble(symbol,SYMBOL_VOLUME_MAX);
   double lotStep=SymbolInfoDouble(symbol,SYMBOL_VOLUME_STEP);
   if(lotStep<=0) lotStep=0.01;
   volume=MathFloor(volume/lotStep)*lotStep;
   if(volume<minLot) volume=minLot;
   if(volume>maxLot) volume=maxLot;
   int digits=0; double step=lotStep;
   while(step<1.0&&digits<8){step*=10.0;digits++;}
   return NormalizeDouble(volume,digits);
}

double CalcLot(double stopDistancePoints, string symbol, double riskPercent)
{
   if(stopDistancePoints<=0) return 0.0;
   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   double riskMoney=equity*(riskPercent/100.0);
   double tickValue=SymbolInfoDouble(symbol,SYMBOL_TRADE_TICK_VALUE);
   if(tickValue<=0) tickValue=SymbolInfoDouble(symbol,SYMBOL_TRADE_TICK_VALUE_PROFIT);
   if(tickValue<=0) tickValue=SymbolInfoDouble(symbol,SYMBOL_TRADE_TICK_VALUE_LOSS);
   double tickSize=SymbolInfoDouble(symbol,SYMBOL_TRADE_TICK_SIZE);
   double point=SymbolInfoDouble(symbol,SYMBOL_POINT);
   if(tickValue<=0||tickSize<=0||point<=0) return 0.0;
   double lossPerLot=(stopDistancePoints*point/tickSize)*tickValue;
   if(lossPerLot<=0) return 0.0;
   return NormalizeVolume(riskMoney/lossPerLot,symbol);
}

bool HasOpenPosition(string symbol,long magic)
{
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong ticket=PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL)==symbol&&
         PositionGetInteger(POSITION_MAGIC)==magic) return true;
   }
   return false;
}

bool SpreadOk(string symbol,int maxSpreadPoints)
{
   if(maxSpreadPoints<=0) return true;
   return SymbolInfoInteger(symbol,SYMBOL_SPREAD)<=maxSpreadPoints;
}

double IndicatorValue(int handle,int bufferIndex,int shift)
{
   if(handle==INVALID_HANDLE) return 0.0;
   double buf[];
   ArraySetAsSeries(buf,true);
   if(CopyBuffer(handle,bufferIndex,shift,1,buf)!=1) return 0.0;
   return buf[0];
}`;

const PREFILL = "//+------------------------------------------------------------------+";

/** Keep only error/warning/result lines — strips verbose information: lines. */
function trimCompileLog(log: string): string {
  return log
    .split("\n")
    .filter((l) => {
      const lower = l.toLowerCase();
      return (
        lower.includes("error") ||
        lower.includes("warning") ||
        lower.includes("result:") ||
        lower.includes("compile job") ||
        lower.includes("metaeditor exit") ||
        (l.trim().length > 0 && !lower.includes(": information:"))
      );
    })
    .join("\n")
    .trim();
}

export default async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS });

  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ error: "ANTHROPIC_API_KEY missing" }, { status: 500, headers: CORS });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400, headers: CORS });
  }

  const messages = body.messages as { role: "user" | "assistant"; content: string }[];
  const blueprint = body.blueprint;
  const code = typeof body.code === "string" ? body.code : "";
  const rawLog = typeof body.compileLog === "string" ? body.compileLog : null;
  const compileLog = rawLog ? trimCompileLog(rawLog) : null;
  const backtestSummary = body.backtestSummary ?? null;

  if (!messages?.length || !code) {
    return Response.json({ error: "messages and code are required" }, { status: 400, headers: CORS });
  }

  // Build the prompt: full context + conversation history (so the model knows what to fix)
  const conversationHistory = messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const userContent = [
    "=== STRATEGY BLUEPRINT ===",
    JSON.stringify(blueprint, null, 2),
    "",
    "=== MQL5 CODE TO FIX ===",
    code,
    compileLog ? `\n=== COMPILE ERRORS ===\n${compileLog}` : "",
    backtestSummary
      ? `\n=== BACKTEST SUMMARY ===\n${JSON.stringify(backtestSummary, null, 2)}`
      : "",
    "",
    "=== CONVERSATION (describes what to fix) ===",
    conversationHistory,
    "",
    "Apply ALL the described fixes and return the COMPLETE corrected .mq5 file:",
  ]
    .filter(Boolean)
    .join("\n");

  // Stream the fixed code so Netlify doesn't time out
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
          system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
          messages: [
            { role: "user", content: userContent },
            {
              role: "assistant",
              // Prefill forces raw code output — no prose or code fences possible
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
            // Stream each chunk so the client accumulates the full file incrementally.
            // Never put the whole code in the done event — a 30KB JSON payload can be
            // split across TCP chunks, causing a parse failure on the client.
            send({ text: event.delta.text });
          }
        }

        send({ done: true });
      } catch (err) {
        console.error("apply-fix error:", err);
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
  path: "/api/apply-fix",
  timeout: 26,
};
