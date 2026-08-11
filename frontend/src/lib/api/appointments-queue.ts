import { api } from "@/lib/api-client";
import { mapAppointmentLookups, mapQueueSnapshot } from "@/lib/mappers";
import type { AppointmentLookups, QueueScanResponse, QueueSnapshot, ReportingBoardSavedView } from "@/types/api";

type RawRecord = Record<string, unknown>;

// -- Lookups --
export async function fetchAppointmentLookups(): Promise<AppointmentLookups> {
  const [modalitiesRes, prioritiesRes, specialReasonsRes] = await Promise.all([
    api<{ items: RawRecord[] }>("/v2/lookups/modalities"),
    api<{ items: RawRecord[] }>("/v2/lookups/priorities"),
    api<{ items: RawRecord[] }>("/v2/lookups/special-reason-codes"),
  ]);
  return mapAppointmentLookups({
    modalities: modalitiesRes.items ?? [],
    examTypes: [],
    priorities: (prioritiesRes.items ?? []).map((p) => ({
      id: p.id,
      code: p.code ?? String(p.nameEn ?? p.name ?? "priority"),
      name_en: p.nameEn ?? p.name,
      name_ar: p.nameAr ?? p.name,
      sort_order: 0,
    })),
    specialReasons: specialReasonsRes.items ?? [],
  });
}

// -- Dashboard Data --
export async function fetchQueueSnapshot(): Promise<QueueSnapshot> {
  const raw = await api<RawRecord>("/v2/read/queue");
  return mapQueueSnapshot(raw);
}

export async function fetchDaySettings() {
  return api<RawRecord>("/appointments/day-settings");
}

// -- Queue --
export async function scanIntoQueue(scanValue: string) {
  return api<QueueScanResponse>("/v2/read/queue/scan", {
    method: "POST",
    body: JSON.stringify({ scanValue })
  });
}

export async function addWalkIn(payload: RawRecord) {
  return api<RawRecord>("/v2/read/queue/walk-in", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function confirmNoShow(appointmentId: number, reason: string) {
  return api<RawRecord>(`/v2/read/appointments/${appointmentId}/no-show`, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}

export async function updateAppointmentStatus(
  appointmentId: number,
  status: string,
  reason?: string | null
) {
  return api<RawRecord>(`/v2/read/appointments/${appointmentId}/status`, {
    method: "POST",
    body: JSON.stringify({ status, reason: reason ?? null })
  });
}

export async function fetchNoShowSummary(): Promise<import("@/types/api").NoShowSummary> {
  const raw = await api<RawRecord>("/v2/read/queue/no-show-summary");
  return { mode: String(raw.mode || "disabled") as import("@/types/api").NoShowSummary["mode"], reviewTime: String(raw.reviewTime || "17:00"), reviewActive: Boolean(raw.reviewActive), pendingCount: Number(raw.pendingCount || 0), oldCleanupCount: Number(raw.oldCleanupCount || 0), autoNoShowEnabled: Boolean(raw.autoNoShowEnabled), manualConfirmationRequired: Boolean(raw.manualConfirmationRequired), lastAutomaticRunAt: typeof raw.lastAutomaticRunAt === "string" ? raw.lastAutomaticRunAt : null, lastAutomaticProcessedCount: Number(raw.lastAutomaticProcessedCount || 0) };
}

export async function rotateReportingBoardSavedViewToken(id: number): Promise<ReportingBoardSavedView> {
  const raw = await api<{ savedView: ReportingBoardSavedView }>(`/doctor/reporting-board/saved-views/${id}/rotate-token`, { method: "POST" });
  return raw.savedView;
}

export async function revokeReportingBoardSavedView(id: number): Promise<ReportingBoardSavedView> {
  const raw = await api<{ savedView: ReportingBoardSavedView }>(`/doctor/reporting-board/saved-views/${id}/revoke`, { method: "POST" });
  return raw.savedView;
}
function mapNoShowReviewCandidate(raw: RawRecord): import("@/types/api").NoShowReviewCandidate {
  return { appointmentId: Number(raw.appointment_id || raw.appointmentId || 0), accessionNumber: String(raw.accession_number || raw.accessionNumber || ""), appointmentDate: String(raw.appointment_date || raw.appointmentDate || ""), bookingTime: typeof (raw.booking_time ?? raw.bookingTime) === "string" ? String(raw.booking_time ?? raw.bookingTime) : null, patientId: Number(raw.patient_id || raw.patientId || 0), arabicFullName: String(raw.arabic_full_name || raw.arabicFullName || ""), englishFullName: typeof (raw.english_full_name ?? raw.englishFullName) === "string" ? String(raw.english_full_name ?? raw.englishFullName) : null, phone1: typeof (raw.phone_1 ?? raw.phone1) === "string" ? String(raw.phone_1 ?? raw.phone1) : null, modalityNameAr: String(raw.modality_name_ar || raw.modalityNameAr || ""), modalityNameEn: String(raw.modality_name_en || raw.modalityNameEn || ""), examNameAr: typeof (raw.exam_name_ar ?? raw.examNameAr) === "string" ? String(raw.exam_name_ar ?? raw.examNameAr) : null, examNameEn: typeof (raw.exam_name_en ?? raw.examNameEn) === "string" ? String(raw.exam_name_en ?? raw.examNameEn) : null, arrivalStatus: String(raw.arrival_status || raw.arrivalStatus || "not_checked_in"), eligibility: String(raw.eligibility || ""), eligible: Boolean(raw.eligible) };
}
export async function fetchNoShowReviewSnapshot(): Promise<import("@/types/api").NoShowReviewSnapshot> {
  const raw = await api<RawRecord>("/v2/read/queue/no-shows");
  return { mode: String(raw.mode || "disabled") as import("@/types/api").NoShowReviewSnapshot["mode"], reviewTime: String(raw.review_time || "17:00"), reviewActive: Boolean(raw.review_active), graceMinutes: Number(raw.grace_minutes || 0), pendingCount: Number(raw.pending_count || 0), oldCleanupCount: Number(raw.old_cleanup_count || 0), candidates: ((raw.candidates as RawRecord[]) || []).map(mapNoShowReviewCandidate), deferredCandidates: ((raw.deferred_candidates as RawRecord[]) || []).map(mapNoShowReviewCandidate), oldCleanupCandidates: ((raw.old_cleanup_candidates as RawRecord[]) || []).map(mapNoShowReviewCandidate), cleanupDays: Number(raw.cleanup_days || 0), historicalCutoffDate: typeof raw.historical_cutoff_date === "string" ? raw.historical_cutoff_date : null, oldestOldCleanupDate: typeof raw.oldest_old_cleanup_date === "string" ? raw.oldest_old_cleanup_date : null, lastAutomaticRunAt: typeof raw.last_automatic_run_at === "string" ? raw.last_automatic_run_at : null, lastAutomaticTodayProcessedCount: Number(raw.last_automatic_today_processed_count || 0), lastAutomaticHistoricalProcessedCount: Number(raw.last_automatic_historical_processed_count || 0), lastAutomaticSkippedCount: Number(raw.last_automatic_skipped_count || 0), lastAutomaticError: typeof raw.last_automatic_error === "string" ? raw.last_automatic_error : null };
}
export async function runOldNoShowCleanupNow(reason: string) {
  return api<{ processedIds: number[]; processedCount: number; skipped: Array<{ bookingId: number; reason: string }>; remainingEligibleCount: number; oldestRemainingDate: string | null; cutoffDate: string }>("/v2/read/queue/no-shows/run-old-cleanup", { method: "POST", body: JSON.stringify({ reason }) });
}
export async function confirmNoShowBulk(appointmentIds: number[], reason: string) {
  return api<{ results: Array<{ bookingId: number; status: string; reason: string }> }>("/v2/read/queue/no-shows/confirm-bulk", { method: "POST", body: JSON.stringify({ appointmentIds, reason }) });
}
export async function confirmOldNoShows(appointmentIds: number[], reason: string) {
  return api<{ results: Array<{ bookingId: number; status: string; reason: string }> }>("/v2/read/queue/old-no-shows/confirm", { method: "POST", body: JSON.stringify({ appointmentIds, reason }) });
}
