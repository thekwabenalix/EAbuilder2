import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { getLocalRunnerHealth } from "@/lib/local-runner";
import {
  LayoutDashboard,
  CreditCard,
  Download,
  LayoutGrid,
  PlusSquare,
  Settings,
  LogOut,
  TerminalSquare,
} from "lucide-react";
import type { ReactNode } from "react";
import { ThemeToggleIcon } from "@/components/ThemeToggle";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/new", label: "New strategy", icon: PlusSquare },
  // Keep visible during build-out; hide from nav at product launch (route stays for dev/settings).
  { to: "/modules", label: "Trading Modules", icon: LayoutGrid },
  { to: "/resources", label: "Resources", icon: Download },
  { to: "/pricing", label: "Pricing", icon: CreditCard },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const health = useQuery({
    queryKey: ["local-runner-health"],
    queryFn: getLocalRunnerHealth,
    retry: false,
    refetchInterval: 10000,
    staleTime: 8000,
  });
  const companionOnline = Boolean(health.data?.ok);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground md:block">
      {/* Sidebar */}
      <aside className="app-panel border-b border-border/70 bg-sidebar/90 flex shadow-sm md:fixed md:inset-y-0 md:left-0 md:z-30 md:w-56 md:flex-col md:border-b-0 md:border-r">
        <div className="hidden md:flex items-center gap-2 px-4 h-14 border-b border-border/70">
          <TerminalSquare className="h-5 w-5 text-primary drop-shadow-sm" />
          <span className="font-semibold text-sm tracking-tight flex-1">MT5 AI Builder</span>
          <ThemeToggleIcon />
        </div>
        <nav className="app-scrollbar flex flex-1 gap-1 overflow-x-auto p-2 md:flex-col md:overflow-x-hidden md:overflow-y-auto">
          {NAV.map((item) => {
            const active = item.to === "/" ? path === "/" : path.startsWith(item.to);
            const Icon = item.icon;
            const isSettings = item.to === "/settings";
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`app-hover-lift flex items-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition ${
                  active
                    ? "border border-primary/20 bg-primary/10 text-sidebar-accent-foreground shadow-sm ring-1 ring-primary/10"
                    : "border border-transparent text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1">{item.label}</span>
                {isSettings && (
                  <span
                    title={companionOnline ? "Companion online" : "Companion offline"}
                    className={`h-2 w-2 rounded-full shrink-0 shadow-sm ${companionOnline ? "bg-emerald-400 shadow-emerald-400/40" : "bg-muted-foreground/30"}`}
                  />
                )}
              </Link>
            );
          })}
        </nav>
        <div className="hidden md:block p-2 border-t border-border/70">
          <div className="px-2 py-1.5 text-xs text-muted-foreground truncate">{user?.email}</div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => signOut()}
          >
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
        </div>
      </aside>

      {/* Main */}
      <main className="app-page-in flex-1 min-w-0 flex flex-col md:ml-56">
        <div className="app-panel md:hidden flex items-center gap-2 px-4 h-12 border-b border-border/70 bg-card/90">
          <TerminalSquare className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-semibold truncate flex-1">MT5 AI Builder</span>
          <ThemeToggleIcon />
          <Button variant="ghost" size="sm" onClick={() => signOut()} aria-label="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 min-w-0">{children}</div>
      </main>
    </div>
  );
}
