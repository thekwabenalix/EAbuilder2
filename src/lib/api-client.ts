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
  generatedCode: string;
  source: "ai";
}

/** Stage 1-5: parse a plain-English strategy description into a blueprint + MQL5 code. */
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
