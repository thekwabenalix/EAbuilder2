import { useState, useRef, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, Bot, User, Wrench } from "lucide-react";
import { toast } from "sonner";
import { applyFix } from "@/lib/api-client";
import type { EaChatMessage } from "@/lib/api-client";
import type { StrategyBlueprint } from "@/types/blueprint";

const API_BASE =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/$/, "")
    : "";

/** Strip the [FIX_READY] marker from displayed message content. */
function stripMarker(text: string): string {
  return text.replace(/\[FIX_READY\]\s*$/m, "").trimEnd();
}

interface EaChatDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the drawer sends this message automatically the moment it opens. */
  autoMessage?: string;
  blueprint: StrategyBlueprint;
  code: string;
  compileLog?: string | null;
  backtestSummary?: unknown;
  onApplyCode: (code: string) => void;
}

export function EaChatDrawer({
  open,
  onOpenChange,
  autoMessage,
  blueprint,
  code,
  compileLog,
  backtestSummary,
  onApplyCode,
}: EaChatDrawerProps) {
  const [messages, setMessages] = useState<EaChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  /** True when the last AI response contained [FIX_READY] — shows the Apply Fix banner. */
  const [fixReady, setFixReady] = useState(false);
  /** True while /api/apply-fix is running — shows spinner in banner. */
  const [applyLoading, setApplyLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const processEvent = (parsed: Record<string, unknown>) => {
    if (typeof parsed.text === "string") {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role !== "assistant") return prev;
        return [
          ...prev.slice(0, -1),
          { role: "assistant" as const, content: last.content + parsed.text },
        ];
      });
    }
    if (parsed.done) {
      setLoading(false);
      // Server signals whether the AI described a fix
      if (parsed.fixReady === true) setFixReady(true);
    }
    if (typeof parsed.error === "string") throw new Error(parsed.error);
  };

  // Auto-send autoMessage the moment the drawer opens (only if no conversation exists).
  useEffect(() => {
    if (!open || !autoMessage || messages.length > 0 || loading) return;
    const id = setTimeout(() => send(autoMessage), 50);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]); // intentionally only re-runs when open changes

  /** Send a message. Pass `textArg` to bypass the input field (used for auto-send). */
  const send = async (textArg?: string) => {
    const text = (textArg ?? input).trim();
    if (!text || loading) return;

    const userMsg: EaChatMessage = { role: "user", content: text };
    const nextMessages: EaChatMessage[] = [...messages, userMsg];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setInput("");
    setLoading(true);
    setFixReady(false);

    abortRef.current = new AbortController();

    try {
      const res = await fetch(`${API_BASE}/api/ea-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          messages: nextMessages,
          blueprint,
          code,
          compileLog: compileLog ?? null,
          backtestSummary: backtestSummary ?? null,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Server error ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      const processChunk = (chunk: string) => {
        buf += chunk;
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          try {
            processEvent(JSON.parse(part.slice(6)));
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
            try { processEvent(JSON.parse(buf.trim().slice(6))); } catch {}
          }
          break;
        }
        processChunk(decoder.decode(value, { stream: true }));
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      toast.error(e instanceof Error ? e.message : "Chat failed");
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.content === "") return prev.slice(0, -1);
        return prev;
      });
      // Only restore input when the user typed manually (not during auto-send)
      if (!textArg) setInput(text);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyFix = async () => {
    setApplyLoading(true);
    try {
      const result = await applyFix(messages, blueprint, code, compileLog, backtestSummary);
      onApplyCode(result.code);
      setFixReady(false);
      onOpenChange(false);
      toast.success("Fix applied — remember to save and recompile");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Fix failed — please try again");
    } finally {
      setApplyLoading(false);
    }
  };

  const contextTags = [
    { label: "Blueprint", active: true },
    { label: "Code", active: Boolean(code) },
    { label: "Compile log", active: Boolean(compileLog) },
    { label: "Backtest", active: Boolean(backtestSummary) },
  ].filter((t) => t.active);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:w-[480px] flex flex-col p-0 gap-0 [&>button]:hidden"
      >
        {/* Header */}
        <SheetHeader className="px-4 py-3 border-b border-border shrink-0">
          <SheetTitle className="text-sm flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            EA Assistant
          </SheetTitle>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {contextTags.map((t) => (
              <span
                key={t.label}
                className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary"
              >
                {t.label}
              </span>
            ))}
          </div>
        </SheetHeader>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {messages.length === 0 && !loading && (
            <div className="text-xs text-muted-foreground text-center pt-10 space-y-1">
              <Bot className="h-8 w-8 mx-auto text-muted-foreground/30 mb-3" />
              <p className="font-medium text-foreground/60">Ask me anything about your EA</p>
              <p>Explain code, debug errors, suggest improvements,</p>
              <p>or ask me to fix a specific problem.</p>
            </div>
          )}

          {messages.map((m, i) => {
            const isLast = i === messages.length - 1;
            const isStreaming = loading && isLast && m.role === "assistant";
            // Strip [FIX_READY] marker from display
            const displayContent = m.role === "assistant" ? stripMarker(m.content) : m.content;

            return (
              <div
                key={i}
                className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {m.role === "assistant" && (
                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    {isStreaming && m.content === "" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    ) : (
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    )}
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 border border-border text-foreground"
                  } ${isStreaming && m.content === "" ? "min-w-[40px] min-h-[28px]" : ""}`}
                >
                  {displayContent}
                  {isStreaming && m.content.length > 0 && (
                    <span className="inline-block w-1.5 h-3 bg-current ml-0.5 animate-pulse align-middle" />
                  )}
                </div>
                {m.role === "user" && (
                  <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                )}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* ── APPLY FIX BANNER — visible when AI has a fix ready or is generating ── */}
        {(fixReady || applyLoading) && !loading && (
          <div className="shrink-0 px-4 py-3 border-t border-emerald-500/30 bg-emerald-500/10 flex items-center gap-3">
            {applyLoading ? (
              <>
                <Loader2 className="h-4 w-4 text-emerald-400 shrink-0 animate-spin" />
                <p className="text-xs text-emerald-300 flex-1 font-medium">
                  Generating fixed code…
                </p>
              </>
            ) : (
              <>
                <Wrench className="h-4 w-4 text-emerald-400 shrink-0" />
                <p className="text-xs text-emerald-300 flex-1 font-medium">
                  Fix is ready — click Apply to generate the corrected code
                </p>
                <Button
                  size="sm"
                  onClick={handleApplyFix}
                  className="shrink-0 bg-emerald-600 hover:bg-emerald-500 text-white border-0"
                >
                  Apply fix
                </Button>
              </>
            )}
          </div>
        )}

        {/* Input */}
        <div className="px-4 py-3 border-t border-border shrink-0 flex gap-2 items-end">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask about your EA… (Enter to send, Shift+Enter for newline)"
            className="min-h-[60px] max-h-32 resize-none text-xs flex-1"
            disabled={loading || applyLoading}
          />
          <Button
            size="sm"
            onClick={() => send()}
            disabled={loading || applyLoading || !input.trim()}
            className="self-end shrink-0"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
