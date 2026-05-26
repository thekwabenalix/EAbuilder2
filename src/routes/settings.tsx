import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { user, signOut } = useAuth();
  return (
    <div>
      <PageHeader title="Settings" subtitle="Account and preferences" />
      <div className="p-6 max-w-xl space-y-6">
        <section className="rounded-md border border-border bg-card p-4">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Account</h2>
          <div className="mt-3 space-y-1 text-sm">
            <div><span className="text-muted-foreground">Email:</span> {user?.email}</div>
            <div className="text-xs text-muted-foreground">User ID: <span className="font-mono">{user?.id}</span></div>
          </div>
          <div className="mt-4">
            <Button variant="outline" size="sm" onClick={() => signOut()}>
              <LogOut className="h-4 w-4 mr-1.5" /> Sign out
            </Button>
          </div>
        </section>

        <section className="rounded-md border border-border bg-card p-4 text-xs text-muted-foreground space-y-2">
          <h2 className="text-xs uppercase tracking-wide">Disclaimer</h2>
          <p>
            MT5 AI Builder generates code from natural-language descriptions. It does not
            evaluate or guarantee profitability. Always forward test on a demo account
            before risking real capital.
          </p>
        </section>
      </div>
    </div>
  );
}
