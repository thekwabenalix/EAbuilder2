import { toast } from "sonner";
import {
  generationPathLabel,
  type GenerateEaFromBlueprintResult,
} from "@/lib/generate-ea-router";

/** Success toast for unified blueprint generation — shows compiler path + warnings. */
export function toastEaGenerationSuccess(
  result: GenerateEaFromBlueprintResult,
  prefix = "EA generated",
): void {
  toast.success(`${prefix} — ${generationPathLabel(result.path)}`);
  for (const warning of result.validationWarnings) {
    toast.warning(warning, { duration: 7000 });
  }
}
