import { api } from "@/lib/api-client";
import type { HistoricalPacsPatientAttestation, ProtocolingHistoricalPacsCandidatesResponse, ProtocolingPatientHistoryResponse } from "@/types/api";

export type ModalityPreviousStudiesResponse = ProtocolingHistoricalPacsCandidatesResponse & { history: ProtocolingPatientHistoryResponse };

export function fetchModalityPreviousStudies(appointmentId: number): Promise<ModalityPreviousStudiesResponse> {
  return api<ModalityPreviousStudiesResponse>(`/v2/read/modality/appointments/${appointmentId}/previous-studies`);
}

export async function recordModalityHistoricalPacsAttestation(appointmentId: number, studyInstanceUid: string, status: "confirmed" | "denied"): Promise<HistoricalPacsPatientAttestation> {
  const response = await api<{ attestation: HistoricalPacsPatientAttestation }>(`/v2/read/modality/appointments/${appointmentId}/previous-studies/attestations`, { method: "POST", body: JSON.stringify({ studyInstanceUid, status }) });
  return response.attestation;
}
