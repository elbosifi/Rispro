import type { CaseAssignmentStatus, CaseAssignmentType } from "./case-assignment-rules.js";
import type { RosterDutyType } from "./roster-types.js";

export interface DoctorCaseRow {
  appointmentId: number;
  appointmentDate: string;
  appointmentTime: string | null;
  patientId: number;
  patientMrn: string | null;
  patientNationalId: string | null;
  patientArabicName: string | null;
  patientEnglishName: string | null;
  modalityId: number;
  modalityCode: string | null;
  modalityName: string | null;
  examTypeId: number | null;
  examTypeName: string | null;
  caseCategory: string | null;
  requiresReport: boolean;
  appointmentStatus: string;
  rosterAssignmentId: number | null;
  teamName: string | null;
  dutyType: RosterDutyType | null;
  expectedReportingDate: string | null;
  assignmentType: CaseAssignmentType | null;
  assignmentStatus: CaseAssignmentStatus | null;
  protocolStatus: null;
  reportStatus: null;
}

export interface AssignmentRunSummary {
  assignedCount: number;
  alreadyAssignedCount: number;
  unassignedNoRosterCount: number;
  skippedCancelledCount: number;
  errors: Array<{ appointmentId: number; reason: string }>;
}
