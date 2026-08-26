import { api } from "@/lib/api-client";

export type IncidentType = "equipment" | "clinical_workflow";
export type IncidentStatus =
  "submitted" | "under_review" | "action_required" | "resolved" | "closed";
export type ClinicalCategory =
  | "wrong_patient"
  | "wrong_exam"
  | "wrong_protocol"
  | "acquisition_quality"
  | "contrast_event"
  | "delay"
  | "communication_failure"
  | "reporting_issue"
  | "other";
export interface Incident {
  id: number;
  incidentNumber: string;
  incident_type: IncidentType;
  status: IncidentStatus;
  occurred_at: string;
  created_at: string;
  description: string;
  immediate_action: string | null;
  review_notes: string | null;
  reporter_name: string | null;
  equipment_name: string | null;
  equipment_type: string | null;
  location: string | null;
  equipment_condition: string | null;
  vendor_contacted: boolean;
  vendor_contact_person: string | null;
  vendor_reference: string | null;
  patient_arabic_name: string | null;
  patient_english_name: string | null;
  mrn: string | null;
  clinical_category: ClinicalCategory | null;
  harm_level: string | null;
}
export interface IncidentDocument {
  id: number;
  original_filename: string;
  mime_type: string;
  document_type: string;
  created_at: string;
}
export interface IncidentEquipment {
  id: number;
  name: string;
  equipment_type: string | null;
  location: string | null;
}
export interface CreateIncidentPayload {
  incidentType: IncidentType;
  occurredAt: string | FormDataEntryValue | null;
  description: string | FormDataEntryValue | null;
  immediateAction: string | FormDataEntryValue | null;
  equipmentId?: string | FormDataEntryValue | null;
  equipmentCondition?: string | FormDataEntryValue | null;
  patientId?: number;
  clinicalCategory?: string | FormDataEntryValue | null;
  harmLevel?: string | FormDataEntryValue | null;
  vendorContacted?: boolean;
  vendorContactPerson?: string | FormDataEntryValue | null;
  vendorReference?: string | FormDataEntryValue | null;
}

export const fetchIncidents = (
  filters: { incidentType?: string; status?: string } = {},
) =>
  api<{ incidents: Incident[] }>(
    `/incidents?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value) as [string, string][]).toString()}`,
  );
export const fetchIncident = (id: number) =>
  api<{ incident: Incident }>(`/incidents/${id}`);
export const createIncident = (payload: CreateIncidentPayload) =>
  api<{ incident: Incident }>("/incidents", {
    method: "POST",
    body: JSON.stringify(payload),
  });
export const reviewIncident = (
  id: number,
  payload: { status: IncidentStatus; reviewNotes: string },
) =>
  api<{ incident: Incident }>(`/incidents/${id}/review`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
export const fetchIncidentEquipment = () =>
  api<{ equipment: IncidentEquipment[] }>("/incidents/lookups/equipment");
export const listIncidentAttachments = (id: number) =>
  api<{ documents: IncidentDocument[] }>(`/incidents/${id}/attachments`);
export const uploadIncidentAttachment = (
  id: number,
  payload: {
    originalFilename: string;
    mimeType: string;
    fileContentBase64: string;
  },
) =>
  api<{ document: IncidentDocument }>(`/incidents/${id}/attachments`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
