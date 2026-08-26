export type ProtocolingModality = "CT" | "MRI";
export type ProtocolAssignmentStatus = "ASSIGNED" | "MODIFIED" | "CANCELLED";
export type ProtocolingStatusFilter = "NOT_PROTOCOLLED" | "ASSIGNED" | "ALL";
export type ProtocolingAppointmentStatusFilter = "scheduled" | "arrived" | "waiting" | "completed" | "no-show";

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
  mriPrimaryScreeningImplantSite: string | null;
  mriPrimaryScreeningImplantDescription: string | null;
  mriPrimaryScreeningPreviousReviewerNameReported: string | null;
  examTypeId: number | null;
  examTypeName: string | null;
  caseCategory: string | null;
  clinicalNotes: string | null;
  patientDicomId: string | null;
  studyInstanceUid: string | null;
  appointmentStatus: string;
  protocolStatus: "NOT_PROTOCOLLED" | ProtocolAssignmentStatus;
  assignment: ProtocolAssignmentSummary | null;
  activeComplementaryRecall: { id: number; status: "pending_scheduling" | "scheduled" } | null;
  latestComplementaryRecall: { id: number; status: "pending_scheduling" | "scheduled" | "completed" | "cancelled" } | null;
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
  appointmentStatus?: ProtocolingAppointmentStatusFilter | null;
  waitingFirst?: boolean;
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

export type ProtocolingHistorySource = "rispro_pacs" | "rispro_only" | "pacs_only";
export type ProtocolingHistoryPacsStatus = "available" | "unavailable" | "patient_id_unavailable";
export type ProtocolingHistoryIdentityDiscrepancy = "patient_id_mismatch";
export interface ProtocolingPatientHistoryItem { appointmentId: number | null; orthancStudyId: string | null; studyInstanceUid: string | null; accessionNumber: string | null; date: string | null; time: string | null; modalities: string[]; description: string | null; appointmentStatus: string | null; reportAvailable: boolean; source: ProtocolingHistorySource; identityDiscrepancy: ProtocolingHistoryIdentityDiscrepancy | null; historicalPatientId?: string | null; historicalPatientName?: string | null; historicalPatientBirthDate?: string | null; reconciliation?: { id:number; status:string; oldPatientId:string|null; operationType:string; failureCode:string|null } | null; }
export interface ProtocolingPatientHistoryResponse { items: ProtocolingPatientHistoryItem[]; pacsStatus: ProtocolingHistoryPacsStatus; historicalPacsIndexStatus: HistoricalPacsIndexStatus; historicalPacsLastSuccessAt: string | null; historicalCandidates?: HistoricalPacsCandidate[]; currentPatient?: { id:number; patientId:string|null; name:string|null; birthDate:string|null }; canReconcilePatientIdentity?: boolean; }
import type { HistoricalPacsCandidate, HistoricalPacsIndexStatus } from "../../services/historical-pacs-index-service.js";
