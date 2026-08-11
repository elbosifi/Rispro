import { api } from "@/lib/api-client";
import { mapAppointmentsWithDetails, mapStatistics } from "@/lib/mappers";
import type { AppointmentStatistics, ModalityProtocolAssignment } from "@/types/api";
import { rawArray, rawBool, rawNumber, rawString, type RawRecord } from "./raw";

function mapModalityProtocolAssignment(raw: RawRecord): ModalityProtocolAssignment {
  return {
    assignmentId: Number(raw.assignment_id),
    appointmentId: Number(raw.appointment_id),
    protocolId: rawNumber(raw.protocol_id),
    protocolVersionId: rawNumber(raw.protocol_version_id),
    protocolName: rawString(raw.protocol_name),
    versionNumber: rawString(raw.version_number),
    freeTextProtocol: rawString(raw.free_text_protocol),
    modality: String(raw.modality).toUpperCase() as "CT" | "MRI",
    scannerId: rawNumber(raw.scanner_id),
    scannerName: rawString(raw.scanner_name),
    scannerVendor: rawString(raw.scanner_vendor),
    protocolNotes: rawString(raw.protocol_notes),
    contrastNotes: rawString(raw.contrast_notes),
    assignedBy: rawString(raw.assigned_by),
    assignedAt: rawString(raw.assigned_at),
    status: String(raw.status) as "ASSIGNED" | "MODIFIED",
    ctPhases: rawArray(raw.ct_phases).map((phase) => ({
      orderIndex: Number(phase.order_index),
      phasePresetName: rawString(phase.phase_preset_name),
      customPhaseName: rawString(phase.custom_phase_name),
      contrastStatus: rawString(phase.contrast_status),
      timingType: rawString(phase.timing_type),
      delaySeconds: rawNumber(phase.delay_seconds),
      timingOverride: rawString(phase.timing_override),
      coverage: rawString(phase.coverage),
      coverageOverride: rawString(phase.coverage_override),
      reconstructionNotes: rawString(phase.reconstruction_notes),
      reconstructionOverride: rawString(phase.reconstruction_override),
      instructions: rawString(phase.instructions),
      instructionsOverride: rawString(phase.instructions_override),
      isRequired: rawBool(phase.is_required),
    })),
    mriSequences: rawArray(raw.mri_sequences).map((sequence) => ({
      orderIndex: Number(sequence.order_index),
      scannerId: rawNumber(sequence.scanner_id),
      scannerName: rawString(sequence.scanner_name),
      sequencePresetName: rawString(sequence.sequence_preset_name),
      vendorSequenceName: rawString(sequence.vendor_sequence_name),
      genericFamily: rawString(sequence.generic_family),
      weighting: rawString(sequence.weighting),
      defaultPlane: rawString(sequence.default_plane),
      planeOverride: rawString(sequence.plane_override),
      defaultCoverage: rawString(sequence.default_coverage),
      coverageOverride: rawString(sequence.coverage_override),
      defaultBValues: rawString(sequence.default_b_values),
      bValuesOverride: rawString(sequence.b_values_override),
      defaultDynamicTiming: rawString(sequence.default_dynamic_timing),
      timingOverride: rawString(sequence.timing_override),
      notes: rawString(sequence.notes),
      notesOverride: rawString(sequence.notes_override),
      isRequired: rawBool(sequence.is_required),
    })),
  };
}

// -- Registrations / Calendar / Modality / Doctor / Print (shared) --
export async function fetchAppointments(params: Record<string, string | string[]>) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((v) => {
        if (v) query.append(`${key}[]`, v);
      });
    } else if (value) {
      query.set(key, value);
    }
  });

  const raw = await api<{ appointments: RawRecord[] }>(`/v2/read/appointments?${query.toString()}`);
  return mapAppointmentsWithDetails(raw.appointments);
}

export async function recordReportOutput(payload: {
  reportTemplate: string;
  outputType: "print" | "pdf" | "csv" | "copy" | "xlsx";
  filters: Record<string, unknown>;
  rowCount: number;
  includePhoneNumbers: boolean;
  includePatientIdentifiers: boolean;
}): Promise<void> {
  await api<{ ok: true }>("/v2/read/reports/output-audit", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function exportReportXlsx(payload: {
  reportTemplate: string;
  filters: Record<string, unknown>;
  rows: Array<Record<string, unknown>>;
  includePhoneNumbers: boolean;
  includePatientIdentifiers: boolean;
}): Promise<void> {
  const response = await fetch("/api/v2/read/reports/export-xlsx", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Excel export failed");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `rispro-${payload.reportTemplate}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    anchor.remove();
  }, 1000);
}

// -- Statistics --
export async function fetchStatistics(
  dateOrFilters: string | { dateFrom?: string; dateTo?: string; date?: string },
  modalityId: string
): Promise<AppointmentStatistics> {
  const params = new URLSearchParams();
  if (typeof dateOrFilters === "string") {
    params.set("date", dateOrFilters);
  } else {
    if (dateOrFilters.date) params.set("date", dateOrFilters.date);
    if (dateOrFilters.dateFrom) params.set("dateFrom", dateOrFilters.dateFrom);
    if (dateOrFilters.dateTo) params.set("dateTo", dateOrFilters.dateTo);
  }
  if (modalityId) params.set("modalityId", modalityId);
  const raw = await api<RawRecord>(`/v2/read/statistics?${params.toString()}`);
  return mapStatistics(raw);
}

// -- Modality --
export async function fetchModalityWorklist(modalityId: string, date: string, scope: string) {
  const params = new URLSearchParams();
  params.set("modalityId", modalityId);
  if (scope === "day") {
    params.set("date", date);
  } else {
    params.set("scope", "all");
  }
  const raw = await api<{ appointments: RawRecord[] }>(`/v2/read/modality/worklist?${params.toString()}`);
  return mapAppointmentsWithDetails(raw.appointments);
}

export async function fetchModalityProtocolAssignment(appointmentId: number): Promise<ModalityProtocolAssignment | null> {
  const raw = await api<{ assignment: RawRecord | null }>(`/v2/read/modality/appointments/${appointmentId}/protocol-assignment`);
  return raw.assignment ? mapModalityProtocolAssignment(raw.assignment) : null;
}

export async function completeAppointment(id: number) {
  return api<RawRecord>(`/v2/read/appointments/${id}/complete`, { method: "POST" });
}

export type CdRobotDestination = { key: string; name: string };
export type CdRobotDelivery = { id: number; destination_key: string; status: "sending" | "success" | "failed"; attempt_count: number; resend_reason_code: string | null; resend_reason_text: string | null; requested_at: string; completed_at: string | null; last_error: string | null; requested_by: string };
export async function fetchCdRobotDestinations() { return api<{ destinations: CdRobotDestination[] }>("/v2/read/modality/cd-robots"); }
export async function fetchCdRobotDeliveries(bookingId: number) { return api<{ deliveries: CdRobotDelivery[] }>(`/v2/read/modality/appointments/${bookingId}/cd-deliveries`); }
export async function createCdRobotDelivery(bookingId: number, input: { destinationKey: string; resendReasonCode?: string; resendReasonText?: string }) { return api<{ delivery: CdRobotDelivery }>(`/v2/read/modality/appointments/${bookingId}/cd-deliveries`, { method: "POST", body: JSON.stringify(input) }); }
export async function retryCdRobotDelivery(deliveryId: number) { return api<{ delivery: CdRobotDelivery }>(`/v2/read/modality/cd-deliveries/${deliveryId}/retry`, { method: "POST" }); }
