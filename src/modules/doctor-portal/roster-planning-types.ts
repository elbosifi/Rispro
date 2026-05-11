import type { RosterAssignmentRow, RosterConflict, RosterWeekRow } from "./roster-types.js";

export type RosterBalanceStrategy = "simple" | "preserve_previous" | "least_assigned";
export type RosterExportFormat = "html" | "csv";

export interface GenerateDraftRosterInput {
  weekStartDate: string;
  templateId: number | null;
  modalityId: number | null;
  includeDoctors: boolean;
  balanceStrategy: RosterBalanceStrategy;
}

export interface GenerateDraftRosterResult {
  week: RosterWeekRow;
  assignmentsCreated: number;
  membersAssigned: number;
  conflicts: RosterConflict[];
  unfilledRequirements: string[];
  warnings: string[];
}

export interface RosterNotificationRow {
  id: number;
  rosterWeekId: number;
  doctorId: number;
  doctorName: string;
  notificationType: "roster_published";
  status: "created" | "sent" | "failed";
  sentAt: string | null;
  error: string | null;
  createdAt: string;
}

export interface RosterNotificationSummary {
  createdCount: number;
  alreadyExistingCount: number;
  notifications: RosterNotificationRow[];
}

export interface RosterExportPayload {
  contentType: string;
  filename: string;
  body: string;
}

export interface CandidateDoctor {
  id: number;
  displayName: string;
  doctorRole: string;
}

export interface ExportRosterInput {
  week: RosterWeekRow;
  assignments: RosterAssignmentRow[];
  format: RosterExportFormat;
  scope: "my" | "full";
}
