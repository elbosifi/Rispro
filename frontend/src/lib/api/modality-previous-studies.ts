import { api } from "@/lib/api-client";
import type { HistoricalPacsCandidate, HistoricalPacsPatientAttestation, ProtocolingHistoricalPacsCandidatesResponse, ProtocolingPatientHistoryResponse } from "@/types/api";

export type ModalityPreviousStudiesResponse = ProtocolingHistoricalPacsCandidatesResponse & { history: ProtocolingPatientHistoryResponse; historicalCandidatesError?: boolean };
export type ModalityHistoricalPacsCandidatesResponse = ProtocolingHistoricalPacsCandidatesResponse & { historicalCandidatesError?: boolean };

export function fetchModalityPreviousStudies(appointmentId: number): Promise<ModalityPreviousStudiesResponse> {
  return api<ModalityPreviousStudiesResponse>(`/v2/read/modality/appointments/${appointmentId}/previous-studies`);
}

export function fetchModalityPatientHistory(appointmentId: number): Promise<ProtocolingPatientHistoryResponse> {
  return api<ProtocolingPatientHistoryResponse>(`/v2/read/modality/appointments/${appointmentId}/previous-studies/history`);
}

export function fetchModalityHistoricalPacsCandidates(appointmentId: number): Promise<ModalityHistoricalPacsCandidatesResponse> {
  return api<ModalityHistoricalPacsCandidatesResponse>(`/v2/read/modality/appointments/${appointmentId}/previous-studies/historical-candidates`);
}

export async function searchModalityHistoricalPacsPatientId(appointmentId: number, patientId: string): Promise<HistoricalPacsCandidate[]> {
  const response = await api<{ candidates: HistoricalPacsCandidate[] }>(`/v2/read/modality/appointments/${appointmentId}/previous-studies/old-patient-id`, {
    method: "POST",
    body: JSON.stringify({ patientId: patientId.trim() }),
  });
  return response.candidates;
}

export async function recordModalityHistoricalPacsAttestation(appointmentId: number, studyInstanceUid: string, status: "confirmed" | "denied"): Promise<HistoricalPacsPatientAttestation> {
  const response = await api<{ attestation: HistoricalPacsPatientAttestation }>(`/v2/read/modality/appointments/${appointmentId}/previous-studies/attestations`, { method: "POST", body: JSON.stringify({ studyInstanceUid, status }) });
  return response.attestation;
}
