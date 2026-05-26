// Calls the Netlify Functions backend (AI pipeline).

import type { StrategyBlueprint } from "@/types/blueprint";

const API_BASE =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/$/, "")
    : "";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));

  if (!res.ok) {
    const msg = (data as { error?: string })?.error;
    throw new Error(msg ?? `Request to ${path} failed with status ${res.status}`);
  }

  return data as T;
}

export interface ParseStrategyResult {
  blueprint: StrategyBlueprint;
  source: "ai";
}

/** Stage 1-4: extract a StrategyBlueprint from a plain-English strategy description. */
export async function parseStrategy(prompt: string): Promise<ParseStrategyResult> {
  return post<ParseStrategyResult>("/api/parse-strategy", { prompt });
}

export interface GenerateCodeResult {
  code: string;
}

/**
 * Regenerate MQL5 code from a (possibly edited) blueprint.
 * Streams the response via SSE — calls `onChunk(partialCode)` as lines arrive
 * so the editor can show live progress, then resolves with the complete code.
 */
export async function generateCode(
  blueprint: StrategyBlueprint,
  onChunk?: (partial: string) => void,
): Promise<GenerateCodeResult> {
  const res = await fetch(`${API_BASE}/api/generate-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blueprint }),
  });

  if (!res.ok || !res.body) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg || `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  // The server streams the continuation after the prefill; accumulate with the prefix.
  const PREFIX = "//+------------------------------------------------------------------+";
  let accumulated = PREFIX;
  let buf = "";
  let finalCode: string | null = null;

  const processChunk = (chunk: string) => {
    buf += chunk;
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      if (!part.startsWith("data: ")) continue;
      try {
        const parsed = JSON.parse(part.slice(6)) as Record<string, unknown>;
        if (typeof parsed.text === "string") {
          accumulated += parsed.text;
          onChunk?.(accumulated);
        }
        if (parsed.done) {
          finalCode = typeof parsed.code === "string" ? parsed.code : accumulated;
        }
        if (typeof parsed.error === "string") throw new Error(parsed.error);
      } catch (e) {
        if (e instanceof Error && e.message !== "AbortError") throw e;
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      processChunk(decoder.decode());
      if (buf.trim().startsWith("data: ")) {
        try {
          const parsed = JSON.parse(buf.trim().slice(6)) as Record<string, unknown>;
          if (parsed.done) finalCode = typeof parsed.code === "string" ? parsed.code : accumulated;
          if (typeof parsed.error === "string") throw new Error(parsed.error);
        } catch {}
      }
      break;
    }
    processChunk(decoder.decode(value, { stream: true }));
  }

  if (!finalCode) throw new Error("Code generation incomplete — please try again");
  return { code: finalCode };
}

export interface EaChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface EaChatResult {
  reply: string;
  fixReady: boolean;
}

/** EA assistant — Claude with full strategy context injected. */
export async function eaChat(
  messages: EaChatMessage[],
  blueprint: StrategyBlueprint,
  code: string,
  compileLog?: string | null,
  backtestSummary?: unknown,
): Promise<EaChatResult> {
  return post<EaChatResult>("/api/ea-chat", {
    messages,
    blueprint,
    code,
    compileLog: compileLog ?? null,
    backtestSummary: backtestSummary ?? null,
  });
}

export interface ApplyFixResult {
  code: string;
}

/**
 * Apply the fix described in the chat conversation.
 * Generates the complete corrected MQL5 file and resolves with it.
 * Calls `onDone(code)` when the code is ready (no streaming to the UI — silent generation).
 */
export async function applyFix(
  messages: EaChatMessage[],
  blueprint: StrategyBlueprint,
  code: string,
  compileLog?: string | null,
  backtestSummary?: unknown,
): Promise<ApplyFixResult> {
  const res = await fetch(`${API_BASE}/api/apply-fix`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      blueprint,
      code,
      compileLog: compileLog ?? null,
      backtestSummary: backtestSummary ?? null,
    }),
  });

  if (!res.ok || !res.body) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg || `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let finalCode: string | null = null;

  const processChunk = (chunk: string) => {
    buf += chunk;
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      if (!part.startsWith("data: ")) continue;
      try {
        const parsed = JSON.parse(part.slice(6)) as Record<string, unknown>;
        if (parsed.done && typeof parsed.code === "string") finalCode = parsed.code;
        if (typeof parsed.error === "string") throw new Error(parsed.error);
      } catch (e) {
        if (e instanceof Error && e.message !== "AbortError") throw e;
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      processChunk(decoder.decode());
      if (buf.trim().startsWith("data: ")) {
        try {
          const parsed = JSON.parse(buf.trim().slice(6)) as Record<string, unknown>;
          if (parsed.done && typeof parsed.code === "string") finalCode = parsed.code;
          if (typeof parsed.error === "string") throw new Error(parsed.error);
        } catch {}
      }
      break;
    }
    processChunk(decoder.decode(value, { stream: true }));
  }

  if (!finalCode) throw new Error("Fix generation incomplete — please try again");
  return { code: finalCode };
}
