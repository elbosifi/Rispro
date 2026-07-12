import type { PacsNodeRow } from "../../services/pacs-node-service.js";

export type OhifAccessStrategy = "native_dicomweb" | "orthanc_gateway";
export type OhifOpenMode = "new_tab" | "same_tab";
export type OhifAuthType = "none" | "basic" | "bearer";
export type ViewerLaunchStatus =
  | "ready"
  | "not_found"
  | "ambiguous"
  | "source_unavailable"
  | "configuration_error"
  | "retrieval_required"
  | "retrieving"
  | "retrieval_failed";

export interface ImagingStudy {
  patientId: string;
  patientName: string;
  accessionNumber: string;
  modality: string;
  studyDescription: string;
  studyDate: string;
  studyInstanceUid: string;
}

export interface PacsWebEndpoint {
  id: number;
  pacsNodeId: number;
  enabled: boolean;
  dicomwebBaseUrl: string;
  qidoRoot: string;
  wadoRsRoot: string;
  wadoUriRoot: string | null;
  stowRoot: string | null;
  authType: OhifAuthType;
  usernameEnvKey: string | null;
  passwordEnvKey: string | null;
  bearerTokenEnvKey: string | null;
  verifyTls: boolean;
  timeoutSeconds: number;
  osirixVersion: string | null;
  dicomwebServerEnabled: boolean | null;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  lastTestMessage: string | null;
  qidoLastStatus: string | null;
  wadoMetadataLastStatus: string | null;
  wadoFrameLastStatus: string | null;
  authenticationLastStatus: string | null;
  tlsLastStatus: string | null;
  corsLastStatus: string | null;
}

export interface OhifViewerSettings {
  enabled: boolean;
  ohifPublicBaseUrl: string;
  selectedPacsNodeId: number | null;
  accessStrategy: OhifAccessStrategy;
  orthancGatewayEnabled: boolean;
  orthancModalityKey: string | null;
  openMode: OhifOpenMode;
  allowPriorStudies: boolean;
  maxPriorStudies: number;
  launchTokenTtlSeconds: number;
  cacheRetentionHours: number;
  retrievalTimeoutSeconds: number;
  updatedAt: string;
}

export interface OhifViewerConfiguration {
  settings: OhifViewerSettings;
  selectedPacsNode: PacsNodeRow | null;
  webEndpoint: PacsWebEndpoint | null;
}

export interface AuthorizedViewerCase {
  appointmentId: number;
  patientId: number;
  patientDicomId: string | null;
  patientEnglishName: string | null;
  patientArabicName: string | null;
  accessionNumber: string;
  studyInstanceUid: string | null;
  bookingDate: string;
  modalityCode: string;
}

export interface StudyMatchResult {
  status: "matched" | "not_found" | "ambiguous";
  study: ImagingStudy | null;
  candidateCount: number;
  rejectedPatientMismatchCount: number;
}

export interface ImagingSourceAdapter {
  readonly strategy: OhifAccessStrategy;
  testConnection(): Promise<{ ok: true; message: string }>;
  searchStudyByAccession(accessionNumber: string): Promise<ImagingStudy[]>;
  searchStudiesByPatient(patientId: string): Promise<ImagingStudy[]>;
  getStudyMetadata(studyInstanceUid: string): Promise<unknown>;
  testFrameRetrieval?(studyInstanceUid: string, seriesInstanceUid: string, sopInstanceUid: string): Promise<{ bytes: number }>;
  verifyStudyAvailable(studyInstanceUid: string): Promise<boolean>;
  requestStudyRetrieval?(studyInstanceUid: string): Promise<{ orthancJobId: string | null }>;
}

export interface ViewerLaunchReadyResponse {
  status: "ready";
  launchUrl: string;
  openMode: OhifOpenMode;
  currentStudy: { studyInstanceUid: string };
  priorStudies: Array<Pick<ImagingStudy, "studyInstanceUid" | "studyDate" | "modality" | "studyDescription" | "accessionNumber">>;
  priorStudyCount: number;
}

export type ViewerLaunchResponse = ViewerLaunchReadyResponse | {
  status: Exclude<ViewerLaunchStatus, "ready">;
  message: string;
  retrievalJobId?: number;
};
