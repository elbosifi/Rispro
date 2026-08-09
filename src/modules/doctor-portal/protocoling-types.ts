export type ProtocolingModality = "CT" | "MRI";
export type ProtocolAssignmentStatus = "ASSIGNED" | "MODIFIED" | "CANCELLED";
export type ProtocolingStatusFilter = "NOT_PROTOCOLLED" | "ASSIGNED" | "ALL";

export interface ProtocolAssignmentSummary {
  assignmentId: number;
  protocolId: number | null;
  protocolVersionId: number | null;
  protocolName: string | null;
  versionNumber: string | null;
  scannerId: number | null;
  scannerName: string | null;
  protocolNotes: string | null;
  contrastNotes: string | null;
  freeTextProtocol: string | null;
  status: ProtocolAssignmentStatus;
  assignedBy: number | null;
  assignedAt: string | null;
}

export interface DoctorProtocolingAppointmentRow {
  appointmentId: number;
  accessionNumber: string;
  patientId: number;
  patientMrn: string | null;
  patientNationalId: string | null;
  patientArabicName: string | null;
  patientEnglishName: string | null;
  ageYears: number | null;
  sex: string | null;
  appointmentDate: string;
  appointmentTime: string | null;
  requiresReport: boolean;
  modalityId: number;
  modalityCode: ProtocolingModality;
  modalityName: string | null;
  modalitySafetyWorkflowType: "standard_acknowledgement" | "mri_primary_implant_screening";
  mriPrimaryScreeningResult: "no_known_implant_reported" | "implant_reported_review_required" | null;
  examTypeId: number | null;
  examTypeName: string | null;
  caseCategory: string | null;
  clinicalNotes: string | null;
  patientDicomId: string | null;
  studyInstanceUid: string | null;
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
  protocolId: number | null;
  scannerId: number | null;
  protocolNotes: string | null;
  contrastNotes: string | null;
  freeTextProtocol: string | null;
  status: ProtocolAssignmentStatus;
}

export type ProtocolDocumentAnnotationType = "arrow" | "rectangle" | "freehand" | "text";

export interface ProtocolDocumentAnnotation {
  id: number;
  documentId: number;
  pageNumber: number;
  annotationType: ProtocolDocumentAnnotationType;
  geometry: Record<string, unknown>;
  textContent: string | null;
  style: Record<string, unknown> | null;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProtocolingPreviousAppointment {
  appointmentId: number;
  accessionNumber: string;
  appointmentDate: string;
  appointmentTime: string | null;
  modalityCode: string;
  modalityName: string | null;
  examTypeName: string | null;
  appointmentStatus: string;
  studyInstanceUid: string | null;
  patientDicomId: string | null;
  reportAvailable: boolean;
}
