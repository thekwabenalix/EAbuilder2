import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, useLocation } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { ThemeProvider, useTheme } from "@/lib/theme-context";
import { LandingPage } from "@/components/LandingPage";
import {
  MarketingModulesPage,
  MarketingPricingPage,
  MarketingResourcesPage,
} from "@/components/MarketingPages";
import { AppShell } from "@/components/AppShell";
import { Loader2 } from "lucide-react";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
});

function Gate() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!user) {
    if (location.pathname === "/modules") return <MarketingModulesPage />;
    if (location.pathname === "/pricing") return <MarketingPricingPage />;
    if (location.pathname === "/resources") return <MarketingResourcesPage />;
    return <LandingPage />;
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster richColors theme={resolved} />;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <Gate />
          <ThemedToaster />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
