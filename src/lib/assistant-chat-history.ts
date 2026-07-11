/**
 * Persist EA Assistant conversation per strategy in localStorage.
 * Text only — screenshots are dropped so quota stays under the ~5 MB limit.
 */

export type StoredChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type StoredChatThread = {
  version: 1;
  updatedAt: string;
  messages: StoredChatMessage[];
};

export const ASSISTANT_CHAT_STORAGE_PREFIX = "eab-assistant-chat:";

/** Cap stored turns so localStorage stays small. */
export const ASSISTANT_CHAT_MAX_STORED = 40;

function storageKey(strategyId: string): string {
  return `${ASSISTANT_CHAT_STORAGE_PREFIX}${strategyId}`;
}

export function readAssistantChatHistory(strategyId: string): StoredChatMessage[] {
  if (typeof localStorage === "undefined" || !strategyId) return [];
  try {
    const raw = localStorage.getItem(storageKey(strategyId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredChatThread;
    if (parsed?.version !== 1 || !Array.isArray(parsed.messages)) return [];
    return parsed.messages
      .filter(
        (m): m is StoredChatMessage =>
          (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string",
      )
      .map((m) => ({ role: m.role, content: m.content }))
      .slice(-ASSISTANT_CHAT_MAX_STORED);
  } catch {
    return [];
  }
}

export function writeAssistantChatHistory(
  strategyId: string,
  messages: Array<{ role: string; content: string }>,
): void {
  if (typeof localStorage === "undefined" || !strategyId) return;
  try {
    const cleaned: StoredChatMessage[] = messages
      .filter(
        (m): m is StoredChatMessage =>
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          // Skip empty streaming placeholder until the reply has text.
          !(m.role === "assistant" && m.content.trim() === ""),
      )
      .map((m) => ({ role: m.role, content: m.content }))
      .slice(-ASSISTANT_CHAT_MAX_STORED);

    if (cleaned.length === 0) {
      localStorage.removeItem(storageKey(strategyId));
      return;
    }

    const thread: StoredChatThread = {
      version: 1,
      updatedAt: new Date().toISOString(),
      messages: cleaned,
    };
    localStorage.setItem(storageKey(strategyId), JSON.stringify(thread));
  } catch {
    // Quota or private mode — conversation still works in-memory for this session.
  }
}

export function clearAssistantChatHistory(strategyId: string): void {
  if (typeof localStorage === "undefined" || !strategyId) return;
  try {
    localStorage.removeItem(storageKey(strategyId));
  } catch {
    // ignore
  }
}
