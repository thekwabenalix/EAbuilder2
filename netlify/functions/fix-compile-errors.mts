// Direct compile-error fixer — no chat, no intermediate steps.
// Called when the user clicks "Fix with AI" after a failed compile.
// Takes the broken code + compile log + blueprint, returns a complete fixed file via SSE.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `You are an expert MQL5 developer. Fix compile errors in an Expert Advisor and return the COMPLETE fixed file.

═══════════════════════════════════════
COMPLETENESS — NON-NEGOTIABLE
═══════════════════════════════════════
- Return THE ENTIRE .mq5 file — every single line, first header to last closing brace
- NEVER truncate — do NOT write "..." or "// rest of code" or stop early
- Every function must be FULLY implemented — no stubs, no empty bodies
- OnInit(), OnDeinit(), and OnTick() MUST all be present and complete
- Every { must have a matching }
- Every string literal must be properly closed

═══════════════════════════════════════
OUTPUT FORMAT — CRITICAL
═══════════════════════════════════════
- Output ONLY raw .mq5 file content — no markdown, no code fences, no explanations
- Start directly with //+------------------------------------------------------------------+
- End with the last closing brace of the file

═══════════════════════════════════════
MQL5-ONLY SYNTAX — ENFORCE THESE
═══════════════════════════════════════
  Ask, Bid                → SymbolInfoDouble(_Symbol, SYMBOL_ASK/BID)
  trade.SetMagicNumber()  → trade.SetExpertMagicNumber((ulong)InpMagic)
  AccountBalance/Equity() → AccountInfoDouble(ACCOUNT_BALANCE/EQUITY)
  MarketInfo()            → SymbolInfoDouble/Integer(_Symbol, ...)
  OrderSend() MQL4-style  → trade.Buy() / trade.Sell() / trade.PositionClose()

═══════════════════════════════════════
MANDATORY HELPERS — ADD IF MISSING
═══════════════════════════════════════

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

/** Keep only error/warning/result lines from the compile log. */
function trimCompileLog(log: string): string {
  return log
    .split("\n")
    .filter((l) => {
      const lower = l.toLowerCase();
      return (
        lower.includes("error") ||
        lower.includes("warning") ||
        lower.includes("result:") ||
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

  const blueprint = body.blueprint;
  const code = typeof body.code === "string" ? body.code : "";
  const rawLog = typeof body.compileLog === "string" ? body.compileLog : "";
  const compileLog = trimCompileLog(rawLog);

  if (!code || !compileLog) {
    return Response.json(
      { error: "code and compileLog are required" },
      { status: 400, headers: CORS },
    );
  }

  const userContent = [
    "=== STRATEGY BLUEPRINT ===",
    JSON.stringify(blueprint, null, 2),
    "",
    "=== BROKEN MQL5 CODE ===",
    code,
    "",
    "=== COMPILE ERRORS TO FIX ===",
    compileLog,
    "",
    "Fix ALL the compile errors listed above.",
    "Return the COMPLETE corrected .mq5 file — every line, all functions fully implemented.",
    "Start with //+------------------------------------------------------------------+ on the very first line.",
    "Output ONLY the raw .mq5 code. No markdown. No explanation.",
  ].join("\n");

  const readable = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        const stream = await client.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 16000,
          system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: userContent }],
        });

        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            send({ text: event.delta.text });
          }
        }

        send({ done: true });
      } catch (err) {
        console.error("fix-compile-errors error:", err);
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
  path: "/api/fix-compile-errors",
  timeout: 26,
};
