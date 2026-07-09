import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, FileCode2 } from "lucide-react";
import { toast } from "sonner";
import { generateFvgDetector } from "@/lib/smc-modules/fvg-detector";
import { generateFvgInversionDetector } from "@/lib/smc-modules/fvg-inversion-detector";
import { generateBosDetector } from "@/lib/smc-modules/bos-detector";
import { generateObDetector } from "@/lib/smc-modules/ob-detector";
import { generateLiqSweepDetector } from "@/lib/smc-modules/liqsweep-detector";
import { generateRsiHiddenDivergenceDetector } from "@/lib/indicator-modules/rsi-hidden-divergence-detector";

export const Route = createFileRoute("/resources")({
  component: ResourcesRoute,
});

const resources = [
  {
    id: "fvg",
    name: "FVG Detector",
    filename: "FVG_Detector.mq5",
    type: "Smart money concept",
    detail: "Marks fair value gaps, mitigations, and valid imbalance zones on MT5 charts.",
    generate: generateFvgDetector,
  },
  {
    id: "ifvg",
    name: "IFVG Detector",
    filename: "IFVG_Detector.mq5",
    type: "Execution module",
    detail:
      "Tracks inversion fair value gaps so traders can inspect valid reversal zones before using them in EAs.",
    generate: generateFvgInversionDetector,
  },
  {
    id: "bos",
    name: "BOS Detector",
    filename: "BOS_Detector.mq5",
    type: "Structure module",
    detail: "Labels structural breaks with swing strength controls.",
    generate: generateBosDetector,
  },
  {
    id: "ob",
    name: "Order Block Detector",
    filename: "Order_Block_Detector.mq5",
    type: "Zone module",
    detail: "Draws bullish and bearish order blocks with invalidation and expiry behavior.",
    generate: generateObDetector,
  },
  {
    id: "liqsweep",
    name: "Liquidity Sweep Detector",
    filename: "Liquidity_Sweep_Detector.mq5",
    type: "Momentum module",
    detail: "Highlights stop hunts, sweep confirmations, and return-to-range events.",
    generate: generateLiqSweepDetector,
  },
  {
    id: "rsi_hd",
    name: "RSI Hidden Divergence",
    filename: "RSI_Hidden_Divergence.mq5",
    type: "Indicator module",
    detail: "Visualizes bullish and bearish hidden divergence with RSI context and signal buffers.",
    generate: generateRsiHiddenDivergenceDetector,
  },
] as const;

function downloadMq5(filename: string, source: string) {
  const blob = new Blob([source], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function ResourcesRoute() {
  return (
    <div>
      <PageHeader
        title="Resources"
        subtitle="Download verified MT5 indicators for chart inspection and module testing."
      />
      <div className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
        {resources.map((resource) => (
          <Card key={resource.id} className="bg-card">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FileCode2 className="h-5 w-5" />
                </div>
                <span className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  MQ5
                </span>
              </div>
              <CardTitle className="pt-3">{resource.name}</CardTitle>
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                {resource.type}
              </p>
            </CardHeader>
            <CardContent>
              <p className="min-h-[84px] text-sm leading-6 text-muted-foreground">
                {resource.detail}
              </p>
              <Button
                className="mt-5 w-full"
                onClick={() => {
                  downloadMq5(resource.filename, resource.generate());
                  toast.success(`${resource.name} downloaded`);
                }}
              >
                <Download className="mr-2 h-4 w-4" /> Download .mq5
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
