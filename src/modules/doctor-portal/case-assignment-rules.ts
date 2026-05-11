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

function includesAny(value: string, terms: string[]): boolean {
  const normalized = value.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

export function nextWorkingDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  do {
    date.setUTCDate(date.getUTCDate() + 1);
  } while (date.getUTCDay() === 5 || date.getUTCDay() === 6);
  return date.toISOString().slice(0, 10);
}

export function classifyCaseRule(booking: CaseBookingSignal): AssignmentRuleResult {
  const signal = `${booking.modalityCode ?? ""} ${booking.modalityName ?? ""} ${booking.examTypeName ?? ""}`;
  if (includesAny(signal, ["ct", "computed tomography"])) {
    return {
      assignmentType: "protocol",
      expectedReportingDate: nextWorkingDay(booking.bookingDate),
      allowedDutyTypes: ["ct_protocol_day"],
      requiresSessionMatch: false,
    };
  }
  if (includesAny(signal, ["mri", "magnetic resonance"])) {
    return {
      assignmentType: "reporting",
      expectedReportingDate: booking.bookingDate,
      allowedDutyTypes: ["mri_supervision_reporting"],
      requiresSessionMatch: false,
    };
  }
  if (includesAny(signal, ["mammography", "mammogram", "breast"])) {
    return {
      assignmentType: "mammography_episode",
      expectedReportingDate: booking.bookingDate,
      allowedDutyTypes: ["mammography_session"],
      requiresSessionMatch: false,
    };
  }
  if (includesAny(signal, ["us", "ultrasound", "u/s"])) {
    return {
      assignmentType: "ultrasound_operator",
      expectedReportingDate: booking.bookingDate,
      allowedDutyTypes: ["ultrasound_term_1", "ultrasound_term_2", "ultrasound_term_3"],
      requiresSessionMatch: Boolean(booking.sessionName),
    };
  }
  return {
    assignmentType: "imaging",
    expectedReportingDate: booking.bookingDate,
    allowedDutyTypes: ["general_reporting"],
    requiresSessionMatch: false,
  };
}

export function isRosterMatch(
  booking: CaseBookingSignal,
  roster: RosterAssignmentSignal,
  rule = classifyCaseRule(booking)
): boolean {
  if (roster.date !== booking.bookingDate) return false;
  if (!rule.allowedDutyTypes.includes(roster.dutyType)) return false;
  if (roster.modalityId !== null && roster.modalityId !== booking.modalityId) return false;
  if (rule.requiresSessionMatch) {
    return (roster.sessionName ?? "").trim().toLowerCase() === (booking.sessionName ?? "").trim().toLowerCase();
  }
  return true;
}
