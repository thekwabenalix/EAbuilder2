import { useState, useRef, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  Send,
  Bot,
  User,
  Wrench,
  ImagePlus,
  X,
  Search,
  Target,
  ClipboardCheck,
  ListChecks,
  BookOpen,
  Hammer,
  Brain,
  Code2,
  BarChart3,
  Download,
  ClipboardList,
  RotateCcw,
  Puzzle,
  FileWarning,
} from "lucide-react";
import { toast } from "sonner";
import { applyFix } from "@/lib/api-client";
import type { EaChatMessage } from "@/lib/api-client";
import type { StrategyBlueprint } from "@/types/blueprint";

const API_BASE =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL
    ? import.meta.env.VITE_API_BASE_URL.replace(/\/$/, "")
    : "";

export type EaAssistantAction =
  | "regen_template"
  | "open_brains"
  | "open_code"
  | "open_backtest"
  | "open_export"
  | "open_validation"
  | "download_evidence"
  | "rerun_interview"
  | "ai_rebuild"
  | "open_modules"
  | "download_tester_log";

const ACTION_CONFIG = {
  regen_template: { label: "Regen Template", icon: Hammer },
  open_brains: { label: "Open Brains", icon: Brain },
  open_code: { label: "Open Code", icon: Code2 },
  open_backtest: { label: "Open Backtest", icon: BarChart3 },
  open_export: { label: "Open Export", icon: Download },
  open_validation: { label: "Open Validation", icon: ClipboardList },
  download_evidence: { label: "Evidence Pack", icon: Download },
  rerun_interview: { label: "Re-run Interview", icon: RotateCcw },
  ai_rebuild: { label: "AI Rebuild", icon: Bot },
  open_modules: { label: "Open Modules", icon: Puzzle },
  download_tester_log: { label: "Tester Log", icon: FileWarning },
} satisfies Record<EaAssistantAction, { label: string; icon: typeof Hammer }>;

const ACTION_KEYS = new Set(Object.keys(ACTION_CONFIG));

/** Strip control markers from displayed message content. */
function stripMarker(text: string): string {
  return text
    .replace(/\[FIX_READY\]\s*$/m, "")
    .replace(/^\s*\[ACTION:[a-z_]+\]\s*$/gm, "")
    .trimEnd();
}

function extractActionMarkers(text: string): EaAssistantAction[] {
  const actions: EaAssistantAction[] = [];
  for (const match of text.matchAll(/\[ACTION:([a-z_]+)\]/g)) {
    const action = match[1];
    if (ACTION_KEYS.has(action) && !actions.includes(action as EaAssistantAction)) {
      actions.push(action as EaAssistantAction);
    }
  }
  return actions;
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const DIAGNOSIS_MODES = [
  {
    id: "no_trades",
    label: "Why No Trades",
    icon: Search,
    prompt:
      "Diagnosis mode: Why no trades? Use the original prompt, blueprint, module contracts, generated code, tester log, compile log, and backtest summary. Tell me the exact layer that blocked trades: prompt interpretation, blueprint wiring, module contract, generator/state machine, MT5 tester, or risk filters. If the tester log contains skip reasons, quote the important values in plain language. End with the safest next app action.",
  },
  {
    id: "wrong_entry",
    label: "Why This Entry",
    icon: Target,
    prompt:
      "Diagnosis mode: Why did this entry happen here? Use any attached screenshot plus the blueprint, module contracts, generated code, and tester log. Compare intended sequence vs observed entry. Identify which brain or state-machine condition allowed the entry. If no screenshot is attached, say that and diagnose from logs/code only.",
  },
  {
    id: "match_prompt",
    label: "Matches Prompt?",
    icon: ClipboardCheck,
    prompt:
      "Diagnosis mode: Does the current blueprint and generated EA match my original strategy prompt? Compare prompt -> 4-Brain mapping -> module contracts -> generated code. List mismatches only, grouped by Direction, Setup, Execution, and Management. For each mismatch, say whether the fix is re-run interview, AI rebuild, template regen, or developer/module update.",
  },
  {
    id: "skipped_rules",
    label: "Skipped Rules",
    icon: ListChecks,
    prompt:
      "Diagnosis mode: Explain skipped or blocked rules. Use blueprint audit, intent contract, module admission status, module contracts, compile log, and tester log. Tell me which requested rules are fully supported, partially supported, template-only, detector-only, or missing from verified module contracts.",
  },
  {
    id: "module_contract",
    label: "Module Contract",
    icon: BookOpen,
    prompt:
      "Diagnosis mode: Explain the selected modules and their contracts. For each active brain, explain the module role, verified state-machine status, supported events, key params, and what the module can and cannot do as an entry trigger. Keep it practical for a trader.",
  },
] as const;

const REPAIR_FLOWS = [
  {
    id: "mapping",
    label: "Fix Mapping",
    icon: ClipboardCheck,
    prompt:
      "Repair flow: Prompt-to-blueprint mapping. Compare my original prompt, blueprint, module contracts, AI diagnostics, and generated code. Tell me if the issue should be fixed by re-running the interview, changing brain params, AI rebuild, template regen, or developer/module update. Give one ordered repair path and one verification step.",
  },
  {
    id: "entry",
    label: "Fix Entries",
    icon: Target,
    prompt:
      "Repair flow: Wrong entries or missing entries. Use screenshots if attached, tester log, generated code, blueprint, and module contracts. Identify whether the entry problem is prompt interpretation, setup/execution wiring, state-machine capability, tester/data, or risk filters. Give the safest repair path and how to retest.",
  },
  {
    id: "compile",
    label: "Fix Compile",
    icon: FileWarning,
    prompt:
      "Repair flow: Compile/backtest failed. Use compile log, tester log, runner status, generated code, blueprint, and diagnostic context. Decide whether this needs regen template, AI rebuild, code inspection, close MT5/retry, or developer update. Give the exact next app action.",
  },
  {
    id: "module",
    label: "Module Gap",
    icon: Puzzle,
    prompt:
      "Repair flow: Module capability gap. Use module admission, module contracts, selected brains, blueprint audit, and prompt. Tell me whether the requested trading rule is supported, partially supported, detector-only, template-only, or missing. Suggest verified alternatives or the exact developer/module contract update needed.",
  },
] as const;

interface EaChatDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the drawer sends this message automatically the moment it opens. */
  autoMessage?: string;
  prompt?: string;
  blueprint: StrategyBlueprint;
  code: string;
  compileLog?: string | null;
  testerLog?: string | null;
  backtestSummary?: unknown;
  diagnosticContext?: unknown;
  onApplyCode: (code: string) => void;
  onSafeAction?: (action: EaAssistantAction) => void;
  /**
   * When provided AND the current code is template-generated, "Apply fix" becomes
   * "Regen from Template" — a deterministic regeneration instead of AI rewrite.
   * Pass a callback that calls generateMql5FromBlueprint and updates state.
   */
  onRegenTemplate?: () => void;
}

export function EaChatDrawer({
  open,
  onOpenChange,
  autoMessage,
  prompt,
  blueprint,
  code,
  compileLog,
  testerLog,
  backtestSummary,
  diagnosticContext,
  onApplyCode,
  onSafeAction,
  onRegenTemplate,
}: EaChatDrawerProps) {
  // Local message type carries attached screenshots so they stay visible in the
  // conversation (and prove they were captured). Stripped before hitting the API.
  type ChatMsg = EaChatMessage & { images?: string[] };
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  /** Attached chart screenshots (base64 data URLs) sent with the next message. */
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  /** Read an image File into a base64 data URL and queue it. */
  const addImageFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    if (file.size > 4 * 1024 * 1024) {
      toast.error("Image too large (max 4 MB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      if (url) setPendingImages((prev) => (prev.length >= 3 ? prev : [...prev, url]));
    };
    reader.readAsDataURL(file);
  };

  /** Capture pasted screenshots (Cmd/Ctrl+V of an image). */
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imgs = items.filter((it) => it.type.startsWith("image/"));
    if (imgs.length === 0) return;
    e.preventDefault();
    for (const it of imgs) {
      const f = it.getAsFile();
      if (f) addImageFile(f);
    }
  };

  /** Send a message. Pass `textArg` to bypass the input field (used for auto-send). */
  const send = async (textArg?: string) => {
    const text = (textArg ?? input).trim();
    const imgs = pendingImages;
    if ((!text && imgs.length === 0) || loading) return;

    const userMsg: ChatMsg = {
      role: "user",
      content: text || "(screenshot attached)",
      images: imgs.length ? imgs : undefined,
    };
    const nextMessages: ChatMsg[] = [...messages, userMsg];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setInput("");
    setPendingImages([]);
    setLoading(true);
    setFixReady(false);

    abortRef.current = new AbortController();

    try {
      const res = await fetch(`${API_BASE}/api/ea-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          // Strip base64 images from the message history — they're sent once via `images`.
          messages: nextMessages.map(({ images: _i, ...m }) => m),
          prompt: prompt ?? "",
          blueprint,
          code,
          compileLog: compileLog ?? null,
          testerLog: testerLog ?? null,
          backtestSummary: backtestSummary ?? null,
          diagnosticContext: diagnosticContext ?? null,
          images: imgs,
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
            try {
              processEvent(JSON.parse(buf.trim().slice(6)));
            } catch {
              // Ignore a trailing partial SSE frame; the accumulated stream is authoritative.
            }
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

  const sendDiagnosisMode = (promptText: string) => {
    if (loading || applyLoading) return;
    send(promptText);
  };

  const sendRepairFlow = (promptText: string) => {
    if (loading || applyLoading) return;
    send(promptText);
  };

  // Template-generated code is detected by the fixed header the generator always emits.
  // For template code, "Apply fix" must regenerate from the template (deterministic, always
  // correct) — NOT call the AI rewriter which may remove working features or reorder logic.
  const isTemplateCode = code.includes("template mode — always compiles");

  const handleSafeAction = (action: EaAssistantAction) => {
    if (loading || applyLoading) return;
    if (action === "download_evidence") {
      downloadJson("ea-builder-evidence-pack.json", {
        exportedAt: new Date().toISOString(),
        prompt: prompt ?? "",
        blueprint,
        diagnosticContext: diagnosticContext ?? null,
        compileLog: compileLog ?? null,
        testerLog: testerLog ?? null,
        backtestSummary: backtestSummary ?? null,
        code,
      });
      toast.success("Evidence pack downloaded");
      return;
    }
    if (action === "regen_template") {
      if (!onRegenTemplate) {
        toast.error("Template regeneration is not available for this strategy");
        return;
      }
      try {
        onRegenTemplate();
        setFixReady(false);
        onOpenChange(false);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Template regeneration failed");
      }
      return;
    }
    if (action === "ai_rebuild") {
      onSafeAction?.(action);
      onOpenChange(false);
      return;
    }
    if (
      action === "rerun_interview" ||
      action === "open_modules" ||
      action === "download_tester_log"
    ) {
      onSafeAction?.(action);
      onOpenChange(false);
      return;
    }
    onSafeAction?.(action);
    onOpenChange(false);
  };

  const renderActionButton = (action: EaAssistantAction, compact = false) => {
    const config = ACTION_CONFIG[action];
    const Icon = config.icon;
    return (
      <Button
        key={action}
        size="sm"
        variant="outline"
        onClick={() => handleSafeAction(action)}
        disabled={loading || applyLoading || (action === "regen_template" && !onRegenTemplate)}
        className={compact ? "h-7 px-2 text-[11px]" : "h-8 justify-start px-2 text-[11px]"}
        title={config.label}
      >
        <Icon className="h-3.5 w-3.5 mr-1.5 shrink-0" />
        <span className="truncate">{config.label}</span>
      </Button>
    );
  };

  const handleApplyFix = async () => {
    // Template path: instant deterministic regeneration — no AI involved
    if (isTemplateCode && onRegenTemplate) {
      try {
        onRegenTemplate();
        setFixReady(false);
        onOpenChange(false);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Template regeneration failed");
      }
      return;
    }

    // AI path: only for AI-generated code that the template engine doesn't cover
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
    { label: "Platform", active: true },
    { label: "Modules", active: true },
    { label: "Blueprint", active: true },
    { label: "Prompt", active: Boolean(prompt) },
    { label: "Code", active: Boolean(code) },
    { label: "Compile log", active: Boolean(compileLog) },
    { label: "Tester log", active: Boolean(testerLog) },
    { label: "Backtest", active: Boolean(backtestSummary) },
    { label: "Evidence", active: Boolean(diagnosticContext) },
    { label: "Screenshot", active: pendingImages.length > 0 },
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
          <div className="grid grid-cols-2 gap-1.5 mt-3">
            {DIAGNOSIS_MODES.map((mode) => {
              const Icon = mode.icon;
              return (
                <Button
                  key={mode.id}
                  size="sm"
                  variant="outline"
                  onClick={() => sendDiagnosisMode(mode.prompt)}
                  disabled={loading || applyLoading}
                  className="h-8 justify-start px-2 text-[11px]"
                  title={mode.label}
                >
                  <Icon className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                  <span className="truncate">{mode.label}</span>
                </Button>
              );
            })}
          </div>
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
              Safe actions
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                "regen_template",
                "open_brains",
                "open_code",
                "open_backtest",
                "download_evidence",
                "ai_rebuild",
                "rerun_interview",
                "open_export",
                "open_modules",
                "open_validation",
                "download_tester_log",
              ].map((action) => renderActionButton(action as EaAssistantAction))}
            </div>
          </div>
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
              Guided repair
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {REPAIR_FLOWS.map((flow) => {
                const Icon = flow.icon;
                return (
                  <Button
                    key={flow.id}
                    size="sm"
                    variant="outline"
                    onClick={() => sendRepairFlow(flow.prompt)}
                    disabled={loading || applyLoading}
                    className="h-8 justify-start px-2 text-[11px]"
                    title={flow.label}
                  >
                    <Icon className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                    <span className="truncate">{flow.label}</span>
                  </Button>
                );
              })}
            </div>
          </div>
        </SheetHeader>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {messages.length === 0 && !loading && (
            <div className="text-xs text-muted-foreground text-center pt-10 space-y-3">
              <Bot className="h-8 w-8 mx-auto text-muted-foreground/30 mb-3" />
              <div className="space-y-1">
                <p className="font-medium text-foreground/60">Ask me anything about your EA</p>
                <p>Use a diagnosis mode above, attach a chart screenshot,</p>
                <p>or describe the exact behavior that looks wrong.</p>
              </div>
            </div>
          )}

          {messages.map((m, i) => {
            const isLast = i === messages.length - 1;
            const isStreaming = loading && isLast && m.role === "assistant";
            // Strip [FIX_READY] marker from display
            const displayContent = m.role === "assistant" ? stripMarker(m.content) : m.content;
            const actions =
              m.role === "assistant" && !isStreaming ? extractActionMarkers(m.content) : [];

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
                  {m.images && m.images.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {m.images.map((src, k) => (
                        <img
                          key={k}
                          src={src}
                          alt="attached screenshot"
                          className="max-h-40 rounded border border-black/20"
                        />
                      ))}
                    </div>
                  )}
                  {displayContent}
                  {actions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {actions.map((action) => renderActionButton(action, true))}
                    </div>
                  )}
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
                  {isTemplateCode && onRegenTemplate
                    ? "Template code detected — click to regenerate from the latest template (no AI rewrite)"
                    : "Fix is ready — click Apply to generate the corrected code"}
                </p>
                <Button
                  size="sm"
                  onClick={handleApplyFix}
                  className="shrink-0 bg-emerald-600 hover:bg-emerald-500 text-white border-0"
                >
                  {isTemplateCode && onRegenTemplate ? "Regen Template" : "Apply fix"}
                </Button>
              </>
            )}
          </div>
        )}

        {/* Input */}
        <div className="px-4 py-3 border-t border-border shrink-0 space-y-2">
          {/* Attached screenshot thumbnails */}
          {pendingImages.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pendingImages.map((src, idx) => (
                <div
                  key={idx}
                  className="relative h-14 w-14 rounded border border-border overflow-hidden group"
                >
                  <img src={src} alt="screenshot" className="h-full w-full object-cover" />
                  <button
                    onClick={() => setPendingImages((prev) => prev.filter((_, i) => i !== idx))}
                    className="absolute top-0 right-0 bg-black/60 text-white rounded-bl p-0.5 opacity-0 group-hover:opacity-100"
                    aria-label="Remove screenshot"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 items-end">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                Array.from(e.target.files ?? []).forEach(addImageFile);
                e.target.value = "";
              }}
            />
            <Button
              size="icon"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading || applyLoading || pendingImages.length >= 3}
              className="self-end shrink-0 h-9 w-9"
              title="Attach a chart screenshot"
            >
              <ImagePlus className="h-4 w-4" />
            </Button>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask about your EA, or paste a chart screenshot… (Enter to send)"
              className="min-h-[60px] max-h-32 resize-none text-xs flex-1"
              disabled={loading || applyLoading}
            />
            <Button
              size="sm"
              onClick={() => send()}
              disabled={loading || applyLoading || (!input.trim() && pendingImages.length === 0)}
              className="self-end shrink-0"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
