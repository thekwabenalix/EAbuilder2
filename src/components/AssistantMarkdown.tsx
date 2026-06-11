import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-sm font-bold tracking-tight mt-3 mb-2 first:mt-0 text-foreground">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-sm font-bold mt-4 mb-2 pb-1 border-b border-border/50 text-foreground first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-xs font-bold mt-3 mb-1.5 text-primary">{children}</h3>
  ),
  p: ({ children }) => <p className="my-1.5 leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic text-foreground/90">{children}</em>,
  ul: ({ children }) => <ul className="my-1.5 ml-4 list-disc space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 ml-4 list-decimal space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed pl-0.5">{children}</li>,
  hr: () => <hr className="my-3 border-border/60" />,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-primary/40 pl-2.5 text-foreground/80 italic">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const inline = !className;
    if (inline) {
      return (
        <code className="rounded bg-background/80 px-1 py-0.5 font-mono text-[10px] text-primary">
          {children}
        </code>
      );
    }
    return (
      <code className="block rounded-md border border-border bg-background/60 p-2 font-mono text-[10px] overflow-x-auto my-2">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="my-2 overflow-x-auto">{children}</pre>,
  table: ({ children }) => (
    <div className="my-2.5 -mx-0.5 overflow-x-auto rounded-md border border-border/70">
      <table className="w-full min-w-[280px] border-collapse text-[11px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-background/70">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-border/50">{children}</tbody>,
  tr: ({ children }) => <tr className="hover:bg-background/30">{children}</tr>,
  th: ({ children }) => (
    <th className="border-b border-border/70 px-2 py-1.5 text-left font-semibold text-foreground whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-2 py-1.5 align-top text-foreground/90 leading-snug">{children}</td>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 hover:text-primary/80"
    >
      {children}
    </a>
  ),
};

interface AssistantMarkdownProps {
  content: string;
  className?: string;
}

/** Renders assistant replies with GFM tables, lists, and emphasis. */
export function normalizeAssistantMarkdown(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/([^\n])\n(#{1,3} )/g, "$1\n\n$2")
    .replace(/([^\n])\n(\*\*[^*]+\*\*)/g, "$1\n\n$2")
    .replace(/\n(\d+\.\s)/g, "\n\n$1")
    .replace(/\n(- \*\*)/g, "\n\n$1");
}

/** Renders assistant replies with GFM tables, lists, and emphasis. */
export function AssistantMarkdown({ content, className }: AssistantMarkdownProps) {
  if (!content.trim()) return null;
  const normalized = normalizeAssistantMarkdown(content);
  return (
    <div className={className ?? "assistant-markdown space-y-1"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {normalized}
      </ReactMarkdown>
    </div>
  );
}
