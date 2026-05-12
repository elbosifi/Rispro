import type { RosterDutyType } from "./roster-types.js";

export type CaseAssignmentType = "imaging" | "protocol" | "reporting" | "ultrasound_operator" | "mammography_episode";
export type CaseAssignmentStatus = "active" | "superseded" | "corrected" | "cancelled";

export interface CaseBookingSignal {
  appointmentId: number;
  bookingDate: string;
  modalityId: number;
  modalityCode: string | null;
  modalityName: string | null;
  examTypeName: string | null;
  sessionName: string | null;
}

export interface RosterAssignmentSignal {
  id: number;
  date: string;
  modalityId: number | null;
  modalityCode: string | null;
  modalityName: string | null;
  dutyType: RosterDutyType;
  sessionName: string | null;
}

export interface AssignmentRuleResult {
  assignmentType: CaseAssignmentType;
  expectedReportingDate: string;
  allowedDutyTypes: RosterDutyType[];
  requiresSessionMatch: boolean;
}

export function nextWorkingDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  do {
    date.setUTCDate(date.getUTCDate() + 1);
  } while (date.getUTCDay() === 5 || date.getUTCDay() === 6);
  return date.toISOString().slice(0, 10);
}

export function classifyCaseRule(booking: CaseBookingSignal): AssignmentRuleResult {
  return {
    assignmentType: "reporting",
    expectedReportingDate: booking.bookingDate,
    allowedDutyTypes: [],
    requiresSessionMatch: false,
  };
}

export function isRosterMatch(
  booking: CaseBookingSignal,
  roster: RosterAssignmentSignal,
  rule = classifyCaseRule(booking)
): boolean {
  if (roster.date !== booking.bookingDate) return false;
  if (rule.allowedDutyTypes.length > 0 && !rule.allowedDutyTypes.includes(roster.dutyType)) return false;
  if (roster.modalityId !== null && roster.modalityId !== booking.modalityId) return false;
  if (rule.requiresSessionMatch) {
    return (roster.sessionName ?? "").trim().toLowerCase() === (booking.sessionName ?? "").trim().toLowerCase();
  }
  return true;
}
