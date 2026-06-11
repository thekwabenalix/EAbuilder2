import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Horizontally scrollable wrapper for Radix TabsList on narrow viewports. */
export function ScrollableTabsList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto -mx-1 px-1 pb-1 scrollbar-thin", className)}>
      {children}
    </div>
  );
}
