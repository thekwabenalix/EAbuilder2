import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, FileCode2, Layers3 } from "lucide-react";
import { toast } from "sonner";
import {
  DOWNLOADABLE_MODULE_CATEGORIES,
  getDownloadableModuleCategory,
  type ResourceModuleCategoryId,
} from "@/lib/resource-module-catalog";

export const Route = createFileRoute("/resources")({
  component: ResourcesRoute,
});

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
  const [categoryId, setCategoryId] = useState<ResourceModuleCategoryId>("smc");
  const category = getDownloadableModuleCategory(categoryId);
  const [moduleId, setModuleId] = useState(category.modules[0]?.id ?? "");

  const selectedModule = useMemo(() => {
    return category.modules.find((resource) => resource.id === moduleId) ?? category.modules[0];
  }, [category.modules, moduleId]);

  function handleCategoryChange(value: string) {
    const nextCategory = getDownloadableModuleCategory(value as ResourceModuleCategoryId);
    setCategoryId(nextCategory.id);
    setModuleId(nextCategory.modules[0]?.id ?? "");
  }

  return (
    <div>
      <PageHeader
        title="Resources"
        subtitle="Select a module classification, choose a module, then download the verified MT5 indicator."
      />

      <div className="space-y-6 p-6">
        <div className="grid gap-4 md:grid-cols-3">
          {DOWNLOADABLE_MODULE_CATEGORIES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleCategoryChange(item.id)}
              className={`app-hover-lift rounded-xl border p-5 text-left transition ${
                item.id === category.id
                  ? "border-primary/60 bg-primary/10 shadow-sm ring-1 ring-primary/20"
                  : "border-border bg-card hover:border-primary/30 hover:bg-primary/5"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Layers3 className="h-5 w-5" />
                </div>
                <span className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                  {item.modules.length} indicators
                </span>
              </div>
              <h2 className="mt-5 text-lg font-semibold">{item.actionLabel}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
            </button>
          ))}
        </div>

        <Card className="bg-card">
          <CardHeader>
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                  {category.fullName}
                </p>
                <CardTitle className="mt-2">{category.actionLabel}</CardTitle>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  Downloads are available after login and are generated from the verified module
                  source used by the platform.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:w-[560px]">
                <Select value={category.id} onValueChange={handleCategoryChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select classification" />
                  </SelectTrigger>
                  <SelectContent>
                    {DOWNLOADABLE_MODULE_CATEGORIES.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={selectedModule?.id ?? ""} onValueChange={setModuleId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select module" />
                  </SelectTrigger>
                  <SelectContent>
                    {category.modules.map((resource) => (
                      <SelectItem key={resource.id} value={resource.id}>
                        {resource.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            {selectedModule ? (
              <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                <div className="rounded-xl border border-border bg-background/50 p-5">
                  <div className="flex items-start gap-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <FileCode2 className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold">{selectedModule.name}</h3>
                      <p className="mt-1 text-sm font-medium text-muted-foreground">
                        {selectedModule.filename}
                      </p>
                      <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">
                        {selectedModule.description}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-background/50 p-5">
                  <p className="text-sm font-semibold">Ready to download</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    The selected module will download as a self-contained MT5 indicator file.
                  </p>
                  <Button
                    className="mt-5 w-full"
                    onClick={() => {
                      downloadMq5(selectedModule.filename, selectedModule.generate());
                      toast.success(`${selectedModule.name} downloaded`);
                    }}
                  >
                    <Download className="mr-2 h-4 w-4" /> Download selected module
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
