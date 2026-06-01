import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { getLocalRunnerHealth } from "@/lib/local-runner";
import {
  LayoutDashboard,
  PlusSquare,
  Settings,
  LogOut,
  TerminalSquare,
  LayoutGrid,
} from "lucide-react";
import type { ReactNode } from "react";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/new", label: "Strategy Builders", icon: PlusSquare },
  { to: "/modules", label: "Trading Modules", icon: LayoutGrid },
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
    <div className="min-h-screen flex flex-col md:flex-row bg-background text-foreground">
      {/* Sidebar */}
      <aside className="md:w-56 md:border-r border-b md:border-b-0 border-border bg-sidebar flex md:flex-col">
        <div className="hidden md:flex items-center gap-2 px-4 h-14 border-b border-border">
          <TerminalSquare className="h-5 w-5 text-primary" />
          <span className="font-semibold text-sm tracking-tight">MT5 AI Builder</span>
        </div>
        <nav className="flex md:flex-col flex-1 p-2 gap-1 overflow-x-auto">
          {NAV.map((item) => {
            const active = item.to === "/" ? path === "/" : path.startsWith(item.to);
            const Icon = item.icon;
            const isSettings = item.to === "/settings";
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap transition ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1">{item.label}</span>
                {isSettings && (
                  <span
                    title={companionOnline ? "Companion online" : "Companion offline"}
                    className={`h-2 w-2 rounded-full shrink-0 ${companionOnline ? "bg-emerald-400" : "bg-muted-foreground/30"}`}
                  />
                )}
              </Link>
            );
          })}
        </nav>
        <div className="hidden md:block p-2 border-t border-border">
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
      <main className="flex-1 min-w-0 flex flex-col">
        <div className="md:hidden flex items-center justify-between px-4 h-12 border-b border-border bg-card">
          <span className="text-xs text-muted-foreground truncate">{user?.email}</span>
          <Button variant="ghost" size="sm" onClick={() => signOut()}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 min-w-0">{children}</div>
      </main>
    </div>
  );
}
