import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CircleCheck } from "lucide-react";
import {
  CREDIT_COSTS,
  PLAN_MONTHLY_CREDITS,
  type AssistantCreditPlan,
} from "@/lib/assistant-credits";

export const Route = createFileRoute("/pricing")({
  component: PricingRoute,
});

const plans: Array<{
  id: AssistantCreditPlan;
  name: string;
  price: string;
  note: string;
  features: string[];
  featured: boolean;
}> = [
  {
    id: "starter",
    name: "Starter",
    price: "$0",
    note: "Explore the builder",
    features: [
      `${PLAN_MONTHLY_CREDITS.starter} AI assistant credits / month`,
      "Free rule audit + repair plan that solves failures",
      "Free Apply now (fix Setup/Entry/wiring/risk/schedule)",
      "Create strategy drafts & preview modules",
    ],
    featured: false,
  },
  {
    id: "builder",
    name: "Builder",
    price: "$29",
    note: "For active EA builders",
    features: [
      `${PLAN_MONTHLY_CREDITS.builder} AI assistant credits / month`,
      "AI strategy interviews + generate MT5 EAs",
      "Compile and backtest with local runner",
      `Cloud chat ${CREDIT_COSTS.cloud_chat}–${CREDIT_COSTS.cloud_chat_with_images} credits · surgical fix ${CREDIT_COSTS.ai_surgical_fix}`,
    ],
    featured: true,
  },
  {
    id: "studio",
    name: "Studio",
    price: "$79",
    note: "For teams and power users",
    features: [
      `${PLAN_MONTHLY_CREDITS.studio} AI assistant credits / month`,
      "Strategy library + advanced repair assistant that Apply-fixes failures",
      "Priority module requests",
      "Same free diagnose → Apply → retest loop as all plans",
    ],
    featured: false,
  },
];

function PricingRoute() {
  return (
    <div>
      <PageHeader
        title="Pricing"
        subtitle="The Assistant diagnoses and Apply-fixes strategy failures. Cloud chat uses monthly credits."
      />
      <div className="mx-auto max-w-3xl px-6 pb-2 text-sm text-muted-foreground">
        <p>
          Free on every plan: rule audit, repair plan, and Apply fixes that repair Configure then
          rebuild (silent Setup/Entry, wiring, risk gates, schedule, tester period). Paid: cloud
          assistant chat that must trigger those same Applies, plus AI surgical rewrite when needed.
        </p>
      </div>
      <div className="grid gap-4 p-6 lg:grid-cols-3">
        {plans.map((plan) => (
          <Card
            key={plan.name}
            className={
              plan.featured
                ? "border-primary/50 bg-primary/5 shadow-lg shadow-primary/10"
                : "bg-card"
            }
          >
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{plan.name}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">{plan.note}</p>
                </div>
                {plan.featured && (
                  <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
                    Popular
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-2">
                <span className="text-4xl font-semibold tracking-tight">{plan.price}</span>
                <span className="pb-1 text-sm text-muted-foreground">/ month</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {PLAN_MONTHLY_CREDITS[plan.id]} AI credits included
              </p>
              <div className="mt-6 space-y-3">
                {plan.features.map((feature) => (
                  <div key={feature} className="flex items-center gap-2 text-sm">
                    <CircleCheck className="h-4 w-4 shrink-0 text-primary" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
              <Button className="mt-6 w-full" asChild>
                <Link to="/settings">Manage credits in Settings</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
