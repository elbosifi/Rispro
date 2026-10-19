import { api } from "@/lib/api-client";

export type PatientIdentityStatus =
  | "not_uploaded"
  | "pending"
  | "verified";

export interface PatientIdentityDocumentState {
  status: PatientIdentityStatus;
  document: {
    id: number;
    originalFilename: string;
    mimeType: string;
    uploadedAt: string;
    verifiedAt: string | null;
    verifiedByUserId: number | null;
    verifiedByName: string | null;
  } | null;
}

export function fetchPatientIdentityDocument(
  patientId: number
): Promise<PatientIdentityDocumentState> {
  return api(`/patients/${patientId}/identity-document`);
}

export function verifyPatientIdentityDocument(
  patientId: number,
  documentId: number
): Promise<PatientIdentityDocumentState> {
  return api(`/patients/${patientId}/identity-document/verify`, {
    method: "POST",
    body: JSON.stringify({ documentId }),
  });
}

export function revokePatientIdentityDocument(
  patientId: number
): Promise<PatientIdentityDocumentState> {
  return api(`/patients/${patientId}/identity-document/revoke`, {
    method: "POST",
  });
}

export async function uploadPatientIdentityDocument(
  patientId: number,
  file: File
): Promise<void> {
  const allowedTypes = new Set([
    "application/pdf",
    "image/jpeg",
    "image/png",
  ]);

  if (!allowedTypes.has(file.type)) {
    throw new Error("Only PDF, JPEG, and PNG are supported.");
  }

  if (file.size === 0 || file.size > 50 * 1024 * 1024) {
    throw new Error("File must be between 1 byte and 50 MB.");
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Unable to read the selected file."));
    reader.readAsDataURL(file);
  });

  const base64 = dataUrl.split(",")[1];
  if (!base64) throw new Error("Unable to encode the selected file.");

  await api("/documents", {
    method: "POST",
    body: JSON.stringify({
      patientId,
      documentType: "patient_identity_document",
      originalFilename: file.name,
      mimeType: file.type,
      fileContentBase64: base64,
      source: "manual_upload",
    }),
  });
}
