import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CircleCheck } from "lucide-react";

export const Route = createFileRoute("/pricing")({
  component: PricingRoute,
});

const plans = [
  {
    name: "Starter",
    price: "$0",
    note: "Explore the builder",
    features: ["Create strategy drafts", "Preview module mapping", "Download sample indicators"],
    featured: false,
  },
  {
    name: "Builder",
    price: "$29",
    note: "For active EA builders",
    features: [
      "AI strategy interviews",
      "Generate MT5 EAs",
      "Compile and backtest with local runner",
    ],
    featured: true,
  },
  {
    name: "Studio",
    price: "$79",
    note: "For teams and power users",
    features: ["Strategy library", "Advanced repair assistant", "Priority module requests"],
    featured: false,
  },
] as const;

function PricingRoute() {
  return (
    <div>
      <PageHeader
        title="Pricing"
        subtitle="Choose the workflow that fits your EA building volume."
      />
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
              <div className="mt-6 space-y-3">
                {plan.features.map((feature) => (
                  <div key={feature} className="flex items-center gap-2 text-sm">
                    <CircleCheck className="h-4 w-4 text-primary" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
              <Button className="mt-6 w-full">Current workspace</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
