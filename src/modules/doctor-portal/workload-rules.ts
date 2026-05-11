import type { CaseAssignmentType } from "./case-assignment-rules.js";

export interface WorkloadCaseSignal {
  modalityCode: string | null;
  modalityName: string | null;
  examTypeName: string | null;
  assignmentType: CaseAssignmentType;
  requiresReport: boolean;
}

function includesAny(value: string, terms: string[]): boolean {
  const normalized = value.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

export function defaultWorkloadUnits(signal: WorkloadCaseSignal): number {
  if (!signal.requiresReport && signal.assignmentType === "reporting") return 0;
  const text = `${signal.modalityCode ?? ""} ${signal.modalityName ?? ""} ${signal.examTypeName ?? ""}`;
  if (includesAny(text, ["ct", "computed tomography"])) {
    return includesAny(text, ["oncology", "body", "multiphase"]) ? 2 : 1;
  }
  if (includesAny(text, ["mri", "magnetic resonance"])) {
    return includesAny(text, ["complex", "body", "pelvis", "prostate", "rectum", "liver"]) ? 3 : 2;
  }
  if (includesAny(text, ["mammography", "mammogram", "breast"])) return 2;
  if (includesAny(text, ["us", "ultrasound", "u/s"])) return 1;
  return 1;
}
