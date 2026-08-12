import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  adminBulkDeleteDocuments,
  adminMoveDocumentsToStorage,
  adminTestDocumentStorageConnectivity,
  createScanSession,
  deleteAppointmentDocument,
  fetchIntegrationStatus,
  listAppointmentDocuments,
  mapRequestDocument,
  fetchRequestDocumentProtocolPolicy,
  prepareScanSession,
  uploadAppointmentDocument,
} from "./documents-printing";

vi.mock("@/lib/api-client", () => ({ api: vi.fn() }));

describe("documents and printing API contracts", () => {
  beforeEach(() => vi.mocked(api).mockReset().mockResolvedValue({ documents: [], document: {}, status: {} }));

  it("preserves document list, upload, and delete contracts", async () => {
    await listAppointmentDocuments(8, "v2_booking");
    await uploadAppointmentDocument({ patientId: 3, appointmentId: 8, appointmentRefType: "v2_booking", documentType: "request", originalFilename: "request.pdf", mimeType: "application/pdf", fileContentBase64: "base64" });
    await deleteAppointmentDocument(12);

    expect(api).toHaveBeenNthCalledWith(1, "/documents?appointmentId=8&appointmentRefType=v2_booking");
    expect(api).toHaveBeenNthCalledWith(2, "/documents", { method: "POST", body: JSON.stringify({ patientId: 3, appointmentId: 8, appointmentRefType: "v2_booking", documentType: "request", originalFilename: "request.pdf", mimeType: "application/pdf", fileContentBase64: "base64" }) });
    expect(api).toHaveBeenNthCalledWith(3, "/documents/12", { method: "DELETE" });
  });

  it("reads the request-document protocol policy from the authenticated document API", async () => {
    vi.mocked(api).mockResolvedValueOnce({ requireRequestDocumentForProtocolQueue: true, hasQualifyingRequestDocument: true });
    await expect(fetchRequestDocumentProtocolPolicy(42)).resolves.toEqual({ requireRequestDocumentForProtocolQueue: true, hasQualifyingRequestDocument: true });
    expect(api).toHaveBeenCalledWith("/documents/protocol-eligibility-policy?appointmentId=42");
  });

  it("preserves scan integration and administrative storage routes", async () => {
    const payload = { appointmentId: 8, patientId: 3, documentType: "request", appointmentRefType: "v2_booking" as const };
    await fetchIntegrationStatus();
    await prepareScanSession(payload);
    await createScanSession(payload);
    await adminBulkDeleteDocuments({ mode: "appointment_date_range", dateFrom: "2026-01-01", dateTo: "2026-01-31" });
    await adminMoveDocumentsToStorage({ mode: "all" });
    await adminTestDocumentStorageConnectivity();

    expect(api).toHaveBeenNthCalledWith(1, "/integrations/status");
    expect(api).toHaveBeenNthCalledWith(2, "/integrations/scan-prepare", { method: "POST", body: JSON.stringify(payload) });
    expect(api).toHaveBeenNthCalledWith(3, "/scan-sessions", { method: "POST", body: JSON.stringify(payload) });
    expect(api).toHaveBeenNthCalledWith(4, "/admin/documents/delete", { method: "POST", body: JSON.stringify({ mode: "appointment_date_range", dateFrom: "2026-01-01", dateTo: "2026-01-31" }) });
    expect(api).toHaveBeenNthCalledWith(5, "/admin/documents/move-storage", { method: "POST", body: JSON.stringify({ mode: "all" }) });
    expect(api).toHaveBeenNthCalledWith(6, "/admin/documents/storage-test", { method: "POST" });
  });

  it.each(["request_scan_automation", "modality_scan_automation"] as const)("preserves the %s source", (source) => {
    expect(mapRequestDocument({ id: 1, source }).source).toBe(source);
  });

  it("uses manual upload only for absent or unknown legacy sources", () => {
    expect(mapRequestDocument({ id: 1 }).source).toBe("manual_upload");
    expect(mapRequestDocument({ id: 1, source: "unknown_legacy_source" }).source).toBe("manual_upload");
  });
});
