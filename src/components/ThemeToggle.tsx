import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme-context";
import type { ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/** Segmented control - settings / full-width. */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();

  return (
    <div
      className={cn("inline-flex rounded-md border border-border bg-muted/40 p-0.5", className)}
      role="group"
      aria-label="Color theme"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = preference === value;
        return (
          <Button
            key={value}
            type="button"
            variant={active ? "secondary" : "ghost"}
            size="sm"
            className={cn(
              "h-8 gap-1.5 px-3 text-xs",
              active && "shadow-sm bg-background text-foreground",
            )}
            onClick={() => setPreference(value)}
            aria-pressed={active}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Button>
        );
      })}
    </div>
  );
}

/** Icon cycle: light → dark → system. */
export function ThemeToggleIcon({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();

  const cycle = () => {
    const order: ThemePreference[] = ["light", "dark", "system"];
    const i = order.indexOf(preference);
    setPreference(order[(i + 1) % order.length]!);
  };

  const Icon =
    preference === "light" ? Sun : preference === "dark" ? Moon : Monitor;
  const label =
    preference === "light" ? "Light mode" : preference === "dark" ? "Dark mode" : "System theme";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("h-8 w-8 text-muted-foreground hover:text-foreground", className)}
      onClick={cycle}
      aria-label={label}
      title={label}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
