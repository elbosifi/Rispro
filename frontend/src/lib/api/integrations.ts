import { api } from "@/lib/api-client";
import { mapDicomDevices } from "@/lib/mappers";
import type { DicomDevice } from "@/types/api";

type RawRecord = Record<string, unknown>;

export async function fetchDicomDevices(): Promise<{ devices: DicomDevice[]; meta: RawRecord }> {
  const raw = await api<{ devices: RawRecord[]; meta?: RawRecord }>("/settings/dicom-devices");
  return {
    devices: mapDicomDevices(raw.devices ?? []),
    meta: raw.meta ?? {}
  };
}

export async function createDicomDevice(payload: RawRecord) {
  return api<{ device: RawRecord }>("/settings/dicom-devices", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateDicomDevice(id: number, payload: RawRecord) {
  return api<{ device: RawRecord }>(`/settings/dicom-devices/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function deleteDicomDevice(id: number) {
  return api<{ device: RawRecord }>(`/settings/dicom-devices/${id}`, { method: "DELETE" });
}

export async function fetchPacsConnection(): Promise<RawRecord> {
  const raw = await api<RawRecord>("/settings/pacs_connection");
  return raw;
}

export async function fetchEquipment(includeInactive = false) {
  return api<{ equipment: RawRecord[] }>(`/settings/equipment${includeInactive ? "?includeInactive=true" : ""}`);
}

export async function createEquipment(payload: RawRecord) {
  return api<{ equipment: RawRecord }>("/settings/equipment", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateEquipment(id: number, payload: RawRecord) {
  return api<{ equipment: RawRecord }>(`/settings/equipment/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export async function deactivateEquipment(id: number) {
  return api<{ equipment: RawRecord }>(`/settings/equipment/${id}/deactivate`, { method: "POST" });
}

// -- PACS --
export async function searchPacs(patientNationalId: string) {
  return api<RawRecord>("/integrations/pacs-search", {
    method: "POST",
    body: JSON.stringify({ patientNationalId })
  });
}
