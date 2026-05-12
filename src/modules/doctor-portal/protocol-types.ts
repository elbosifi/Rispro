export type ProtocolStatus = "draft" | "assigned" | "clarification_needed" | "cancelled";
export type ProtocolAuditEventType =
  | "protocol_created"
  | "protocol_updated"
  | "protocol_assigned"
  | "clarification_requested"
  | "protocol_cancelled"
  | "protocol_corrected";

export interface ProtocolInput {
  protocolText: string | null;
  contrastRequired: boolean | null;
  contrastPhaseOrProtocol: string | null;
  specialPreparation: string | null;
  technologistNotes: string | null;
  protocolStatus?: ProtocolStatus;
}

export interface AppointmentProtocolRow {
  id: number;
  appointmentId: number;
  protocolText: string | null;
  contrastRequired: boolean | null;
  contrastPhaseOrProtocol: string | null;
  specialPreparation: string | null;
  technologistNotes: string | null;
  protocolStatus: ProtocolStatus;
  assignedByDoctorId: number | null;
  assignedByDoctorName: string | null;
  assignedAt: string | null;
  updatedByDoctorId: number | null;
  updatedByDoctorName: string | null;
  updatedAt: string;
  version: number;
  createdAt: string;
}

export interface ProtocolTaskRow {
  appointmentId: number;
  patientId: number;
  patientMrn: string | null;
  patientNationalId: string | null;
  patientArabicName: string | null;
  patientEnglishName: string | null;
  ageYears: number | null;
  sex: string | null;
  appointmentDate: string;
  appointmentTime: string | null;
  modalityId: number;
  modalityCode: string | null;
  modalityName: string | null;
  examTypeId: number | null;
  examTypeName: string | null;
  caseCategory: string | null;
  requiresReport: boolean;
  clinicalIndication: string | null;
  appointmentStatus: string;
  rosterAssignmentId: number | null;
  teamName: string | null;
  protocolStatus: ProtocolStatus | null;
  assignedByDoctorName: string | null;
  updatedAt: string | null;
}

export interface ProtocolDetails {
  appointment: ProtocolTaskRow;
  protocol: AppointmentProtocolRow | null;
}

export interface ProtocolAuditTimelineEvent {
  eventType: ProtocolAuditEventType;
  changedByDoctorId: number | null;
  changedByDoctorName: string | null;
  createdAt: string;
  reason: string | null;
  oldSummary: string | null;
  newSummary: string | null;
  version: number | null;
  protocolStatus: ProtocolStatus | null;
}
