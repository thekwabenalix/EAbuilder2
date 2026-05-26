import { useState, useRef, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, Check, Bot, User } from "lucide-react";
import { toast } from "sonner";
import { eaChat, type EaChatMessage } from "@/lib/api-client";
import type { StrategyBlueprint } from "@/types/blueprint";

interface EaChatDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blueprint: StrategyBlueprint;
  code: string;
  compileLog?: string | null;
  backtestSummary?: unknown;
  onApplyCode: (code: string) => void;
}

export function EaChatDrawer({
  open,
  onOpenChange,
  blueprint,
  code,
  compileLog,
  backtestSummary,
  onApplyCode,
}: EaChatDrawerProps) {
  const [messages, setMessages] = useState<EaChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const next: EaChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    setPendingCode(null);
    try {
      const result = await eaChat(next, blueprint, code, compileLog, backtestSummary);
      setMessages((m) => [...m, { role: "assistant", content: result.reply }]);
      if (result.updatedCode) setPendingCode(result.updatedCode);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Chat failed");
      setMessages((m) => m.slice(0, -1));
      setInput(text);
    } finally {
      setLoading(false);
    }
  };

  const applyCode = () => {
    if (!pendingCode) return;
    onApplyCode(pendingCode);
    setPendingCode(null);
    toast.success("Code updated from AI suggestion");
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
              <p>or ask me to modify a specific part.</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {m.role === "assistant" && (
                <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                </div>
              )}
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 border border-border text-foreground"
                }`}
              >
                {m.content}
              </div>
              {m.role === "user" && (
                <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex gap-2 justify-start">
              <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="rounded-lg px-3 py-2 bg-muted/50 border border-border">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Apply code banner */}
        {pendingCode && (
          <div className="px-4 py-2 border-t border-emerald-500/20 bg-emerald-500/5 flex items-center gap-2 shrink-0">
            <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <p className="text-xs text-emerald-300 flex-1">AI returned updated EA code</p>
            <Button size="sm" onClick={applyCode} className="h-7 text-xs">
              Apply code
            </Button>
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
            disabled={loading}
          />
          <Button
            size="sm"
            onClick={send}
            disabled={loading || !input.trim()}
            className="self-end shrink-0"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
