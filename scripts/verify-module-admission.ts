/**
 * Module admission verifier.
 *
 * This protects the project from "half-added" modules. A module can be detector
 * only, template only, not verified, or fully verified for AI state-machine
 * wiring, but it must be declared deliberately.
 */
import { ALL_BRAIN_MODULES } from "../src/lib/brain-modules";
import {
  buildModuleRepairPlan,
  MODULE_ADMISSION,
  type ModuleAdmissionStatus,
} from "../src/lib/module-admission";
import { MODULE_CONTRACTS } from "../src/lib/module-contracts";
import { MODULE_LIBRARY, MODULE_UI_PARAMS } from "../src/lib/module-library";

type Check = [name: string, ok: boolean, detail?: string];

const statusByImplementation: Record<string, ModuleAdmissionStatus> = {
  state_machine: "verified_state_machine",
  template: "template_only",
  not_verified: "not_verified",
};

const checks: Check[] = [];
const libraryIds = MODULE_LIBRARY.map((module) => module.id);
const uiIds = Object.keys(MODULE_UI_PARAMS);
const brainIds = ALL_BRAIN_MODULES.map((module) => module.id);
const contractIds = Object.keys(MODULE_CONTRACTS);
const admissionIds = Object.keys(MODULE_ADMISSION);

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function missingFromAdmission(ids: string[]): string[] {
  return unique(ids).filter((id) => !MODULE_ADMISSION[id]);
}

function add(name: string, ok: boolean, detail?: string) {
  checks.push([name, ok, detail]);
}

add(
  "all module-library ids are admitted",
  missingFromAdmission(libraryIds).length === 0,
  missingFromAdmission(libraryIds).join(", "),
);
add(
  "all UI param ids are admitted",
  missingFromAdmission(uiIds).length === 0,
  missingFromAdmission(uiIds).join(", "),
);
add(
  "all brain-module ids are admitted",
  missingFromAdmission(brainIds).length === 0,
  missingFromAdmission(brainIds).join(", "),
);
add(
  "all contract ids are admitted",
  missingFromAdmission(contractIds).length === 0,
  missingFromAdmission(contractIds).join(", "),
);

const aiVocabularyIds = admissionIds.filter((id) => MODULE_ADMISSION[id].aiVocabulary);
const detectorOnlyInAiVocabulary = admissionIds.filter((id) => {
  const record = MODULE_ADMISSION[id];
  return record.status === "detector_only" && (libraryIds.includes(id) || brainIds.includes(id));
});
add(
  "detector-only modules are not in AI vocabulary",
  detectorOnlyInAiVocabulary.length === 0,
  detectorOnlyInAiVocabulary.join(", "),
);

const aiWithoutContract = aiVocabularyIds.filter(
  (id) => MODULE_ADMISSION[id].contractRequired && !MODULE_CONTRACTS[id],
);
add(
  "AI vocabulary modules have contracts",
  aiWithoutContract.length === 0,
  aiWithoutContract.join(", "),
);

const contractStatusMismatches = contractIds.filter((id) => {
  const contract = MODULE_CONTRACTS[id];
  const admission = MODULE_ADMISSION[id];
  return admission && admission.status !== statusByImplementation[contract.implementation];
});
add(
  "contract implementation matches admission status",
  contractStatusMismatches.length === 0,
  contractStatusMismatches
    .map((id) => `${id}: ${MODULE_CONTRACTS[id].implementation} vs ${MODULE_ADMISSION[id].status}`)
    .join(", "),
);

const stateMachineWithoutPrefix = admissionIds.filter((id) => {
  const admission = MODULE_ADMISSION[id];
  const contract = MODULE_CONTRACTS[id];
  return (
    admission.status === "verified_state_machine" &&
    (!contract || !contract.smPrefix || !contract.smType || contract.tickArgPolicy === "none")
  );
});
add(
  "verified state-machine modules declare SM prefix/type/tick policy",
  stateMachineWithoutPrefix.length === 0,
  stateMachineWithoutPrefix.join(", "),
);

const templateWithSmPrefix = admissionIds.filter((id) => {
  const admission = MODULE_ADMISSION[id];
  const contract = MODULE_CONTRACTS[id];
  return admission.status === "template_only" && Boolean(contract?.smPrefix);
});
add(
  "template-only modules do not declare SM prefixes",
  templateWithSmPrefix.length === 0,
  templateWithSmPrefix.join(", "),
);

const detectorOnlyWithContract = admissionIds.filter((id) => {
  const admission = MODULE_ADMISSION[id];
  return admission.status === "detector_only" && Boolean(MODULE_CONTRACTS[id]);
});
add(
  "detector-only modules have no AI contract",
  detectorOnlyWithContract.length === 0,
  detectorOnlyWithContract.join(", "),
);

const admissionWithoutKnownSurface = admissionIds.filter((id) => {
  const admission = MODULE_ADMISSION[id];
  if (admission.status === "detector_only") return false;
  return (
    !libraryIds.includes(id) &&
    !uiIds.includes(id) &&
    !brainIds.includes(id) &&
    !contractIds.includes(id)
  );
});
add(
  "non-detector admission records appear in a module surface",
  admissionWithoutKnownSurface.length === 0,
  admissionWithoutKnownSurface.join(", "),
);

const bbRepair = buildModuleRepairPlan(["bb"]);
add(
  "repair plan explains blocked template modules",
  bbRepair.hasBlockedModules &&
    bbRepair.hasTemplateFallback &&
    bbRepair.blocked[0]?.id === "bb" &&
    bbRepair.blocked[0].suggestedModules.length > 0,
  JSON.stringify(bbRepair),
);

const mixedRepair = buildModuleRepairPlan(["ema", "bb", "swing_structure", "rbr_dbd"]);
const suggestedUnsafeModules = mixedRepair.blocked.flatMap((item) =>
  item.suggestedModules.filter((suggestion) => {
    const admission = MODULE_ADMISSION[suggestion.id];
    return !admission || admission.status !== "verified_state_machine";
  }),
);
add(
  "repair suggestions only point to verified modules",
  suggestedUnsafeModules.length === 0,
  suggestedUnsafeModules.map((module) => module.id).join(", "),
);

console.log("\nModule admission verifier\n");
let failed = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) failed++;
  console.log(`[${ok ? "OK  " : "FAIL"}] ${name}${!ok && detail ? ` (${detail})` : ""}`);
}

if (failed > 0) {
  console.log(`\n${failed} module admission check(s) failed.`);
  process.exit(1);
}

console.log(`\n${checks.length} module admission check(s) passed.`);
