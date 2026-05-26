import { Button } from "@/components/ui/button";
import { Copy, Download, Check } from "lucide-react";
import { useState } from "react";

export function CodeViewer({
  code,
  filename = "strategy.mq5",
  language = "mql5",
}: {
  code: string;
  filename?: string;
  language?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onDownload = () => {
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-md border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono">{filename}</span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">{language}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onCopy}>
            {copied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDownload}>
            <Download className="h-3.5 w-3.5 mr-1" /> Download
          </Button>
        </div>
      </div>
      <pre className="overflow-auto max-h-[70vh] p-4 text-xs leading-relaxed font-mono text-foreground/90">
        <code>{code || "// No code generated yet."}</code>
      </pre>
    </div>
  );
}
