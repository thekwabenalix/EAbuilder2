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

/** Regenerate MQL5 code from a (possibly edited) blueprint. */
export async function generateCode(blueprint: StrategyBlueprint): Promise<GenerateCodeResult> {
  return post<GenerateCodeResult>("/api/generate-code", { blueprint });
}

export interface EaChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface EaChatResult {
  reply: string;
  updatedCode: string | null;
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
