export type ProtocolingModality = "CT" | "MRI";
export type ProtocolAssignmentStatus = "ASSIGNED" | "MODIFIED" | "CANCELLED";
export type ProtocolingStatusFilter = "NOT_PROTOCOLLED" | "ASSIGNED" | "ALL";

export interface ProtocolAssignmentSummary {
  assignmentId: number;
  protocolId: number;
  protocolVersionId: number;
  protocolName: string;
  versionNumber: string;
  scannerId: number | null;
  scannerName: string | null;
  protocolNotes: string | null;
  contrastNotes: string | null;
  status: ProtocolAssignmentStatus;
  assignedBy: number | null;
  assignedAt: string | null;
}

export interface DoctorProtocolingAppointmentRow {
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
  modalityCode: ProtocolingModality;
  modalityName: string | null;
  examTypeId: number | null;
  examTypeName: string | null;
  caseCategory: string | null;
  clinicalNotes: string | null;
  appointmentStatus: string;
  protocolStatus: "NOT_PROTOCOLLED" | ProtocolAssignmentStatus;
  assignment: ProtocolAssignmentSummary | null;
}

export interface ProtocolingCtPhaseRow {
  id: number;
  orderIndex: number;
  ctPhasePresetId: number | null;
  ctPhasePresetName: string | null;
  customPhaseName: string | null;
  timingOverride: string | null;
  coverageOverride: string | null;
  reconstructionOverride: string | null;
  instructionsOverride: string | null;
  isRequired: boolean;
}

export interface ProtocolingMriSequenceRow {
  id: number;
  orderIndex: number;
  scannerId: number | null;
  scannerName: string | null;
  mriSequencePresetId: number | null;
  mriSequencePresetName: string | null;
  planeOverride: string | null;
  coverageOverride: string | null;
  bValuesOverride: string | null;
  timingOverride: string | null;
  notesOverride: string | null;
  isRequired: boolean;
}

export interface ProtocolAssignmentDetail {
  assignment: ProtocolAssignmentSummary;
  ctPhases: ProtocolingCtPhaseRow[];
  mriSequences: ProtocolingMriSequenceRow[];
}

export interface DoctorProtocolingAppointmentDetail {
  appointment: DoctorProtocolingAppointmentRow;
  assignmentDetail: ProtocolAssignmentDetail | null;
}

export interface ProtocolingFilters {
  dateFrom: string;
  dateTo: string;
  modality?: ProtocolingModality | null;
  protocolStatus?: ProtocolingStatusFilter | null;
  search?: string | null;
}

export interface ProtocolAssignmentInput {
  protocolId: number;
  scannerId: number | null;
  protocolNotes: string | null;
  contrastNotes: string | null;
  status: ProtocolAssignmentStatus;
}
