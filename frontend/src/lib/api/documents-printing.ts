import { api } from "@/lib/api-client";

type RawRecord = Record<string, unknown>;
export type AppointmentRefType = "legacy_appointment" | "v2_booking" | "auto";

export interface RequestDocument {
  id: number;
  patientId: number | null;
  appointmentId: number | null;
  v2BookingId: number | null;
  documentType: string;
  originalFilename: string;
  storedPath: string;
  mimeType: string;
  fileSize: number;
  storageLocationType: "network" | "local_fallback";
  source: "manual_upload" | "naps2_webscan" | "scanner_app";
  scanSessionId?: number | null;
  pageCount?: number | null;
  scannerName?: string | null;
  workstationName?: string | null;
  appVersion?: string | null;
  lastMoveAttemptAt: string | null;
  lastMoveError: string | null;
  createdAt: string;
}

export interface IntegrationStatus {
  scanner: {
    referralUploadEnabled: boolean;
    allowedFileTypes: string[];
    documentLinkScope: string;
    scannerBridgeMode: string;
    scannerProfileName: string;
    scannerSource: string;
    scanDpi: string;
    scanColorMode: string;
    scanFileFormat: string;
    bridgeReady: boolean;
    naps2WebScanEnabled?: boolean;
    naps2WebScanEndpoint?: string;
    scannerAppEnabled?: boolean;
    scannerAppDownloadUrl?: string;
    scanSessionExpiryMinutes?: string;
  };
}

function mapRequestDocument(raw: RawRecord): RequestDocument {
  return {
    id: Number(raw.id ?? 0),
    patientId: raw.patient_id == null ? (raw.patientId == null ? null : Number(raw.patientId)) : Number(raw.patient_id),
    appointmentId:
      raw.appointment_id == null ? (raw.appointmentId == null ? null : Number(raw.appointmentId)) : Number(raw.appointment_id),
    v2BookingId:
      raw.v2_booking_id == null ? (raw.v2BookingId == null ? null : Number(raw.v2BookingId)) : Number(raw.v2_booking_id),
    documentType: String(raw.document_type ?? raw.documentType ?? ""),
    originalFilename: String(raw.original_filename ?? raw.originalFilename ?? ""),
    storedPath: String(raw.stored_path ?? raw.storedPath ?? ""),
    mimeType: String(raw.mime_type ?? raw.mimeType ?? ""),
    fileSize: Number(raw.file_size ?? raw.fileSize ?? 0),
    storageLocationType:
      String(raw.storage_location_type ?? raw.storageLocationType ?? "local_fallback") === "network"
        ? "network"
        : "local_fallback",
    source:
      String(raw.source ?? "manual_upload") === "scanner_app"
        ? "scanner_app"
        : String(raw.source ?? "manual_upload") === "naps2_webscan"
          ? "naps2_webscan"
          : "manual_upload",
    scanSessionId:
      raw.scan_session_id == null ? (raw.scanSessionId == null ? null : Number(raw.scanSessionId)) : Number(raw.scan_session_id),
    pageCount: raw.page_count == null ? (raw.pageCount == null ? null : Number(raw.pageCount)) : Number(raw.page_count),
    scannerName: (raw.scanner_name ?? raw.scannerName ?? null) as string | null,
    workstationName: (raw.workstation_name ?? raw.workstationName ?? null) as string | null,
    appVersion: (raw.app_version ?? raw.appVersion ?? null) as string | null,
    lastMoveAttemptAt: (raw.last_move_attempt_at ?? raw.lastMoveAttemptAt ?? null) as string | null,
    lastMoveError: (raw.last_move_error ?? raw.lastMoveError ?? null) as string | null,
    createdAt: String(raw.created_at ?? raw.createdAt ?? ""),
  };
}

// -- Documents --
export async function listAppointmentDocuments(
  appointmentId: number,
  appointmentRefType: AppointmentRefType = "auto"
): Promise<RequestDocument[]> {
  const params = new URLSearchParams();
  params.set("appointmentId", String(appointmentId));
  params.set("appointmentRefType", appointmentRefType);
  const raw = await api<{ documents: RawRecord[] }>(`/documents?${params.toString()}`);
  return (raw.documents ?? []).map(mapRequestDocument);
}

export async function uploadAppointmentDocument(payload: {
  patientId: number | null;
  appointmentId: number;
  appointmentRefType?: AppointmentRefType;
  documentType?: string;
  originalFilename: string;
  mimeType: string;
  fileContentBase64: string;
  source?: "manual_upload" | "naps2_webscan" | "scanner_app";
}): Promise<RequestDocument> {
  const raw = await api<{ document: RawRecord }>("/documents", {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      appointmentRefType: payload.appointmentRefType || "auto",
    }),
  });
  return mapRequestDocument(raw.document);
}

export async function deleteAppointmentDocument(documentId: number): Promise<{ deleted: boolean; documentId: number }> {
  return api<{ deleted: boolean; documentId: number }>(`/documents/${documentId}`, {
    method: "DELETE",
  });
}

export async function fetchIntegrationStatus(): Promise<IntegrationStatus> {
  const raw = await api<{ status: IntegrationStatus }>("/integrations/status");
  return raw.status;
}

export async function prepareScanSession(payload: {
  appointmentId: number;
  patientId?: number | null;
  documentType?: string;
  appointmentRefType?: AppointmentRefType;
}) {
  return api<{ preparation: RawRecord }>("/integrations/scan-prepare", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function createScanSession(payload: {
  appointmentId: number;
  patientId?: number | null;
  documentType?: string;
  appointmentRefType?: AppointmentRefType;
}): Promise<{ launchUrl: string; expiresAt: string; fallbackUploadAllowed: true }> {
  return api<{ launchUrl: string; expiresAt: string; fallbackUploadAllowed: true }>("/scan-sessions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function adminBulkDeleteDocuments(payload: {
  mode: "all" | "appointment_date_range";
  dateFrom?: string;
  dateTo?: string;
}) {
  return api<{ deletedCount: number; failedCount: number; failures: Array<{ documentId: number; reason: string }> }>(
    "/admin/documents/delete",
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
}

export async function adminMoveDocumentsToStorage(payload: {
  mode: "all" | "appointment_date_range";
  dateFrom?: string;
  dateTo?: string;
}) {
  return api<{
    movedCount: number;
    failedCount: number;
    skippedCount: number;
    failures: Array<{ documentId: number; reason: string }>;
  }>("/admin/documents/move-storage", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function adminTestDocumentStorageConnectivity() {
  return api<{ ok: boolean; path: string; authUsername: string; message: string }>(
    "/admin/documents/storage-test",
    { method: "POST" }
  );
}
