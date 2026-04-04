import type { AppointmentStatus, QueueStatus } from "./domain.js";
import type { DbNumeric } from "./db.js";

export interface QueueEntryPatient {
  arabicFullName: string;
  englishFullName: string | null;
  phone1: string | null;
}

export interface QueueEntryModality {
  nameAr: string;
  nameEn: string;
}

export interface QueueEntryExamType {
  nameAr: string | null;
  nameEn: string | null;
}

export interface QueueEntryState {
  id: number;
  queueDate: string;
  queueNumber: number;
  queueStatus: QueueStatus;
  scannedAt: string | null;
}

export interface QueueSummary {
  totalAppointments: DbNumeric;
  scheduledCount: DbNumeric;
  waitingCount: DbNumeric;
  noShowCount: DbNumeric;
  arrivedCount: DbNumeric;
}

export interface QueueSnapshot {
  queueDate: string;
  reviewTime: string;
  reviewActive: boolean;
  summary: QueueSummary;
  queueEntries: QueueEntryState[];
  noShowCandidates: {
    appointmentId: number;
    accessionNumber: string;
    appointmentDate: string;
    notes: string | null;
    patientId: number;
    arabicFullName: string;
    englishFullName: string | null;
    phone1: string | null;
    modalityNameAr: string;
    modalityNameEn: string;
  }[];

  queueEntry?: QueueEntryState;
}

export interface QueueScanPayload {
  scanValue?: string;
  accessionNumber?: string;
}

export interface QueueScanResult {
  queueEntry: QueueEntryState;
  appointment: {
    id: number;
    accessionNumber: string;
    isWalkIn: boolean;
    notes: string | null;
    status: AppointmentStatus;
  };
  patient: QueueEntryPatient;
  modality: QueueEntryModality;
  examType: QueueEntryExamType | null;
}
