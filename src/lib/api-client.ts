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
  let accumulated = "";
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
        // done event has no code payload — use accumulated text directly.
        if (parsed.done) finalCode = accumulated.trim();
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
          if (parsed.done) finalCode = accumulated.trim();
          if (typeof parsed.error === "string") throw new Error(parsed.error);
        } catch {}
      }
      // If the stream ended but we never saw {done:true}, use whatever was accumulated.
      if (!finalCode && accumulated.length > 50) finalCode = accumulated.trim();
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
  let accumulated = "";
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
        // Accumulate streamed text (server now streams chunks for apply-fix too)
        if (typeof parsed.text === "string") accumulated += parsed.text;
        // done has no code payload — use accumulated text directly
        if (parsed.done) finalCode = accumulated.trim();
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
          if (typeof parsed.text === "string") accumulated += parsed.text;
          if (parsed.done) finalCode = accumulated.trim();
          if (typeof parsed.error === "string") throw new Error(parsed.error);
        } catch {}
      }
      // Fallback: if stream ended without {done:true}, use whatever was accumulated
      if (!finalCode && accumulated.length > 50) finalCode = accumulated.trim();
      break;
    }
    processChunk(decoder.decode(value, { stream: true }));
  }

  if (!finalCode) throw new Error("Fix generation incomplete — please try again");
  return { code: finalCode };
}

// ─── AI 4-Brain generator ─────────────────────────────────────────────────────

export interface AiBrainWiring {
  direction_brain: string;
  setup_brain:     string;
  execution_brain: string;
  required_sms:    string[];
  sm_configs:      Record<string, {
    type: string;
    id: string;
    TF: string;
    tf: string;
    params: Record<string, unknown>;
  }>;
  notes: string;
}

/**
 * Ask Claude to generate the 4-Brain wiring code using the module library.
 * Config-guided mode: visual builder provided explicit brain config.
 * Returns the three brain function bodies + which state machines to embed.
 */
export async function generateAiBrainWiring(
  config: {
    direction?: { modules: string[]; timeframe: string; description?: string };
    setup?:     { modules: string[]; timeframe: string; description?: string };
    execution:  { modules: string[]; timeframe: string; description?: string };
  },
  eaName: string,
  description?: string,
): Promise<AiBrainWiring> {
  return post<AiBrainWiring>("/api/gen-4brain-ai", { config, eaName, description });
}

/**
 * Description-first mode: trader wrote a plain-English strategy description.
 * Claude interprets it, selects modules, chooses brain roles + timeframes, and
 * generates the complete wiring. Returns the same AiBrainWiring structure.
 */
export async function generateAiEaFromDescription(
  prompt: string,
  eaName: string,
): Promise<AiBrainWiring> {
  return post<AiBrainWiring>("/api/gen-4brain-ai", { prompt, eaName });
}

// ─── Brain param extraction ───────────────────────────────────────────────────

export interface ExtractBrainParamsResult {
  /** Structured params extracted from the description (e.g. { lookback: 30, swingLeft: 5 }) */
  params: Record<string, unknown>;
  /** One-sentence confirmation of what Claude understood */
  summary: string;
}

/**
 * Focused Claude call: reads a plain-English description of one brain's
 * configuration and returns concrete parameters for the modules.
 *
 * Example: role="direction", modules=["choch"], timeframe="D1",
 *   description="use 5-bar pivots, lookback 30 bars"
 *   → { params: { lookback: 30, swingLeft: 5, swingRight: 5 }, summary: "..." }
 *
 * Multiple modules: modules=["order_block", "fvg"], description="OB when closes outside, FVG when fills"
 *   → params apply to both modules' shared logic
 */
export async function extractBrainParams(
  role: string,
  modules: string[],
  timeframe: string,
  description: string,
): Promise<ExtractBrainParamsResult> {
  return post<ExtractBrainParamsResult>("/api/extract-brain-params", {
    role,
    modules,
    timeframe,
    description,
  });
}

export interface FixCompileErrorsResult {
  code: string;
}

/**
 * Fix compile errors directly — no chat loop, no intermediate step.
 * Streams the complete corrected MQL5 file and resolves when done.
 * Pass `onChunk` to stream partial output to an editor for live preview.
 */
export async function fixCompileErrors(
  blueprint: StrategyBlueprint,
  code: string,
  compileLog: string,
  onChunk?: (partial: string) => void,
): Promise<FixCompileErrorsResult> {
  const res = await fetch(`${API_BASE}/api/fix-compile-errors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blueprint, code, compileLog }),
  });

  if (!res.ok || !res.body) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg || `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
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
        if (parsed.done) finalCode = accumulated.trim();
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
          if (typeof parsed.text === "string") accumulated += parsed.text;
          if (parsed.done) finalCode = accumulated.trim();
          if (typeof parsed.error === "string") throw new Error(parsed.error);
        } catch {}
      }
      if (!finalCode && accumulated.length > 50) finalCode = accumulated.trim();
      break;
    }
    processChunk(decoder.decode(value, { stream: true }));
  }

  if (!finalCode) throw new Error("Fix incomplete — please try again");
  return { code: finalCode };
}
