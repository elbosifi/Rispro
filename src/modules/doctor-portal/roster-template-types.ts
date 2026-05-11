import type { RosterConflict, RosterDutyType, RosterTeamRole, RosterWeekRow } from "./roster-types.js";

export type RosterTemplateType = "ct_weekly" | "mri_weekly" | "ultrasound_weekly" | "mammography_weekly" | "mixed_weekly" | "custom";
export type RosterTemplateCopyMode = "structure_only" | "structure_with_named_doctors";

export interface RosterTemplateMemberRow {
  id: number;
  templateAssignmentId: number;
  doctorId: number | null;
  doctorName: string | null;
  teamRole: RosterTeamRole;
  placeholderLabel: string | null;
  requiredRole: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RosterTemplateAssignmentRow {
  id: number;
  templateId: number;
  dayOfWeek: number;
  modalityId: number | null;
  modalityCode: string | null;
  modalityNameEn: string | null;
  modalityNameAr: string | null;
  dutyType: RosterDutyType;
  sessionName: string | null;
  startTime: string | null;
  endTime: string | null;
  teamName: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  members: RosterTemplateMemberRow[];
}

export interface RosterTemplateRow {
  id: number;
  name: string;
  description: string | null;
  modalityId: number | null;
  modalityCode: string | null;
  modalityNameEn: string | null;
  modalityNameAr: string | null;
  templateType: RosterTemplateType;
  active: boolean;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  assignments: RosterTemplateAssignmentRow[];
}

export interface RosterTemplateMemberInput {
  doctorId: number | null;
  teamRole: RosterTeamRole;
  placeholderLabel: string | null;
  requiredRole: string | null;
}

export interface RosterTemplateAssignmentInput {
  dayOfWeek: number;
  modalityId: number | null;
  dutyType: RosterDutyType;
  sessionName: string | null;
  startTime: string | null;
  endTime: string | null;
  teamName: string;
  sortOrder: number;
  members: RosterTemplateMemberInput[];
}

export interface RosterTemplateInput {
  name: string;
  description: string | null;
  modalityId: number | null;
  templateType: RosterTemplateType;
  assignments: RosterTemplateAssignmentInput[];
}

export interface ApplyRosterTemplateResult {
  week: RosterWeekRow;
  createdAssignmentCount: number;
  copiedMemberCount: number;
  skippedCount: number;
  conflicts: RosterConflict[];
}

