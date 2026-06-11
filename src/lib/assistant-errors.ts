const PROVIDER_CREDIT_MSG =
  "Cloud AI is unavailable (provider credits exhausted). You still get offline answers from your blueprint, code, and backtest logs below.";

const PROMPT_TOO_LONG_MSG =
  "This chat included too much data (full tester log + code). I trimmed what gets sent to cloud AI — try your question again. See the offline analysis below.";

const PROVIDER_BUSY_MSG =
  "Cloud AI is temporarily busy. Try again in a moment — or use the offline summary below.";

export function isProviderCreditError(raw: string): boolean {
  return /credit balance is too low|plans\s*&\s*billing|purchase credits/i.test(raw);
}

function extractNestedMessage(raw: string): string | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const obj = JSON.parse(jsonMatch[0]) as {
      error?: { message?: string };
      message?: string;
    };
    return obj?.error?.message ?? obj?.message ?? null;
  } catch {
    return null;
  }
}

/** Turn API / stream errors into trader-friendly copy — never raw JSON. */
export function formatAssistantError(raw: unknown): string {
  const text =
    typeof raw === "string" ? raw : raw instanceof Error ? raw.message : String(raw ?? "");

  const nested = extractNestedMessage(text);
  const combined = nested ? `${text}\n${nested}` : text;

  if (isProviderCreditError(combined)) return PROVIDER_CREDIT_MSG;
  if (/prompt is too long|maximum context|context length|too many tokens/i.test(combined)) {
    return PROMPT_TOO_LONG_MSG;
  }
  if (/ANTHROPIC_API_KEY missing/i.test(combined)) {
    return "Assistant is not configured on the server. Offline strategy summaries still work.";
  }
  if (/modelId\.replace is not a function/i.test(combined)) {
    return "AI provider configuration failed. This is a platform issue — try again later or use the offline summary.";
  }
  if (/502|503|504|bad gateway|temporarily busy|ETIMEDOUT|ECONNRESET/i.test(combined)) {
    return PROVIDER_BUSY_MSG;
  }
  if (/^\d{3}\s*\{/.test(text.trim()) || /"type"\s*:\s*"error"/.test(text)) {
    return "The cloud assistant could not respond. See the offline summary below.";
  }
  if (nested && nested.length < 240) return nested;
  if (text.length > 240) return "The assistant hit an unexpected error. See the offline summary below.";
  return text || "Chat failed — see the offline summary below.";
}

export function isAssistantProviderUnavailable(raw: unknown): boolean {
  const text =
    typeof raw === "string" ? raw : raw instanceof Error ? raw.message : String(raw ?? "");
  const nested = extractNestedMessage(text);
  const combined = nested ? `${text}\n${nested}` : text;
  return (
    isProviderCreditError(combined) ||
    /prompt is too long|maximum context|too many tokens/i.test(combined) ||
    /cloud AI is unavailable|offline summary below|assistant is not configured on the server/i.test(
      combined,
    ) ||
    /ANTHROPIC_API_KEY missing|502|503|504|bad gateway|temporarily busy/i.test(combined) ||
    /^\d{3}\s*\{/.test(text.trim()) ||
    /"type"\s*:\s*"error"/.test(text)
  );
}

/** True when chat failed and we should still show the offline blueprint/log analysis. */
export function shouldAttachOfflineFallback(raw: unknown): boolean {
  if (isAssistantProviderUnavailable(raw)) return true;
  const friendly = formatAssistantError(raw);
  return /offline summary below|offline strategy summaries|cloud assistant could not respond/i.test(
    friendly,
  );
}
