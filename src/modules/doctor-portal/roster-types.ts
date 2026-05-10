export type RosterWeekStatus = "draft" | "published" | "archived";
export type RosterAssignmentStatus = "active" | "cancelled";
export type RosterDutyType =
  | "ct_protocol_day"
  | "ct_reporting_day"
  | "mri_supervision_reporting"
  | "ultrasound_term_1"
  | "ultrasound_term_2"
  | "ultrasound_term_3"
  | "mammography_session"
  | "general_reporting"
  | "on_call"
  | "leave"
  | "admin"
  | "teaching";
export type RosterTeamRole = "lead" | "specialist" | "sho" | "supervisor" | "observer";

export interface RosterWeekRow {
  id: number;
  weekStartDate: string;
  weekEndDate: string;
  status: RosterWeekStatus;
  createdBy: number | null;
  publishedBy: number | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RosterMemberRow {
  id: number;
  rosterAssignmentId: number;
  doctorId: number;
  displayName: string;
  doctorRole: string;
  teamRole: RosterTeamRole;
  createdAt: string;
  updatedAt: string;
}

export interface RosterAssignmentRow {
  id: number;
  rosterWeekId: number;
  date: string;
  modalityId: number | null;
  modalityCode: string | null;
  modalityNameEn: string | null;
  modalityNameAr: string | null;
  dutyType: RosterDutyType;
  sessionName: string | null;
  startTime: string | null;
  endTime: string | null;
  teamName: string;
  status: RosterAssignmentStatus;
  createdAt: string;
  updatedAt: string;
  members: RosterMemberRow[];
}

export interface RosterWeekDetails {
  week: RosterWeekRow | null;
  assignments: RosterAssignmentRow[];
}

