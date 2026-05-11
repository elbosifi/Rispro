import type { CaseAssignmentType } from "./case-assignment-rules.js";

export interface WorkloadCatalogRule {
  id: number;
  modalityId: number;
  examTypeId: number | null;
  caseCategory: string | null;
  assignmentType: CaseAssignmentType;
  baseUnits: number;
  reportRequiredMultiplier: number;
  noReportUnits: number;
  active: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface WorkloadCalculationSummary {
  calculatedCount: number;
  alreadyCurrentCount: number;
  defaultedNoCatalogRuleCount: number;
  skippedCount: number;
  errors: Array<{ appointmentId: number; reason: string }>;
}

export interface TeamWorkloadSummaryRow {
  rosterAssignmentId: number;
  teamName: string;
  dutyType: string;
  date: string;
  modalityId: number;
  modalityName: string | null;
  caseCategory: string | null;
  caseCount: number;
  totalWorkloadUnits: number;
  reportRequiredCount: number;
  noReportCount: number;
  pendingCount: number;
  finalizedCount: number;
  overdueCount: number;
}
