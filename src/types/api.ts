import type {
  Appointment,
  AuditEvent,
  ExamType,
  Modality,
  Patient,
  QueueItem,
  User
} from "./domain.js";

export interface ApiEnvelope<T> {
  data?: T;
  error?: {
    message: string;
    details?: unknown;
  };
}

export interface PatientsSearchResponse {
  patients: Patient[];
}

export interface AppointmentsListResponse {
  appointments: Appointment[];
}

export interface QueueSnapshotResponse {
  queueDate: string;
  reviewTime: string;
  reviewActive: boolean;
  queueEntries: QueueItem[];
}

export interface UsersListResponse {
  users: User[];
}

export interface ModalitiesListResponse {
  modalities: Modality[];
}

export interface ExamTypesListResponse {
  examTypes: ExamType[];
}

export interface AuditEntriesResponse {
  entries: AuditEvent[];
  pagination?: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
    rangeStart: number;
    rangeEnd: number;
  };
  summary?: {
    total: number;
    important: number;
    security: number;
    automated: number;
    other: number;
    failed: number;
  };
  meta?: unknown;
}
