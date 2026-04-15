/**
 * Appointments V2 — Frontend API hooks.
 *
 * Uses TanStack Query for data fetching and the shared `api()` client.
 * All endpoints are under `/api/v2/`.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type {
  AvailabilityResponse,
  SuggestionsResponse,
  EvaluateRequest,
  SchedulingDecisionDto,
  CreateBookingRequest,
  BookingResponse,
  LookupsResponse,
  ModalityDto,
  ExamTypeDto,
  ListBookingsResponse,
  RescheduleBookingRequest,
  RescheduleBookingResponse,
  PolicyStatusDto,
  PolicySnapshotDto,
  PolicyPreviewDto,
  SpecialReasonCodeDto,
} from "./types";

// ---------------------------------------------------------------------------
// V2 API client functions (can be used without React)
// ---------------------------------------------------------------------------

export async function fetchV2Availability(params: {
  modalityId: number;
  days: number;
  offset: number;
  examTypeId: number | null;
  caseCategory: "oncology" | "non_oncology";
  useSpecialQuota: boolean;
  specialReasonCode: string | null;
  includeOverrideCandidates: boolean;
}): Promise<AvailabilityResponse> {
  const searchParams = new URLSearchParams({
    modalityId: String(params.modalityId),
    days: String(params.days),
    offset: String(params.offset),
    caseCategory: params.caseCategory,
  });

  if (params.examTypeId != null) {
    searchParams.set("examTypeId", String(params.examTypeId));
  }
  if (params.useSpecialQuota) {
    searchParams.set("useSpecialQuota", "true");
  }
  if (params.specialReasonCode) {
    searchParams.set("specialReasonCode", params.specialReasonCode);
  }
  if (params.includeOverrideCandidates) {
    searchParams.set("includeOverrideCandidates", "true");
  }

  return api<AvailabilityResponse>(`/v2/scheduling/availability?${searchParams.toString()}`);
}

export async function fetchV2Suggestions(params: {
  modalityId: number;
  days: number;
  examTypeId: number | null;
  caseCategory: "oncology" | "non_oncology" | undefined;
}): Promise<SuggestionsResponse> {
  const searchParams = new URLSearchParams({
    modalityId: String(params.modalityId),
    days: String(params.days),
  });

  if (params.examTypeId != null) {
    searchParams.set("examTypeId", String(params.examTypeId));
  }
  if (params.caseCategory) {
    searchParams.set("caseCategory", params.caseCategory);
  }

  return api<SuggestionsResponse>(`/v2/scheduling/suggestions?${searchParams.toString()}`);
}

export async function evaluateV2Scheduling(input: EvaluateRequest): Promise<SchedulingDecisionDto> {
  return api<SchedulingDecisionDto>("/v2/scheduling/evaluate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function fetchV2Modalities(): Promise<ModalityDto[]> {
  const response = await api<{ items: ModalityDto[] }>("/v2/lookups/modalities");
  return response.items;
}

export async function fetchV2ExamTypes(modalityId: number): Promise<ExamTypeDto[]> {
  const response = await api<{ modalityId: number; items: Array<Omit<ExamTypeDto, "code"> & { code?: string }> }>(
    `/v2/lookups/modalities/${modalityId}/exam-types`
  );
  return response.items.map((examType) => ({
    ...examType,
    code: examType.code ?? "",
  }));
}

export async function fetchV2ExamTypeCatalog(): Promise<ExamTypeDto[]> {
  const modalities = await fetchV2Modalities();
  const examTypesByModality = await Promise.all(
    modalities.map((modality) => fetchV2ExamTypes(modality.id))
  );
  return examTypesByModality.flat();
}

export async function fetchV2Lookups(): Promise<LookupsResponse> {
  const modalities = await fetchV2Modalities();
  return { modalities, examTypes: [] };
}

export async function fetchV2SpecialReasonCodes(): Promise<SpecialReasonCodeDto[]> {
  const response = await api<{ items: SpecialReasonCodeDto[] }>("/v2/lookups/special-reason-codes");
  return response.items;
}

export interface ReportingPriorityDto {
  id: number;
  name: string;
  nameAr: string;
  nameEn: string;
}

export async function fetchV2Priorities(): Promise<ReportingPriorityDto[]> {
  const response = await api<{ items: ReportingPriorityDto[] }>("/v2/lookups/priorities");
  return response.items;
}

export async function createV2Booking(input: CreateBookingRequest): Promise<BookingResponse> {
  return api<BookingResponse>("/v2/appointments", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function cancelV2Booking(bookingId: number): Promise<{ booking: unknown; previousStatus: string }> {
  return api<{ booking: unknown; previousStatus: string }>(`/v2/appointments/${bookingId}/cancel`, {
    method: "POST",
  });
}

export async function rescheduleV2Booking(
  bookingId: number,
  input: RescheduleBookingRequest
): Promise<RescheduleBookingResponse> {
  return api<RescheduleBookingResponse>(`/v2/appointments/${bookingId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function listV2Bookings(params: {
  modalityId: number;
  dateFrom: string;
  dateTo: string;
  limit?: number;
  offset?: number;
  includeCancelled?: boolean;
}): Promise<ListBookingsResponse> {
  const searchParams = new URLSearchParams({
    modalityId: String(params.modalityId),
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  });

  if (params.limit != null) searchParams.set("limit", String(params.limit));
  if (params.offset != null) searchParams.set("offset", String(params.offset));
  if (params.includeCancelled) searchParams.set("includeCancelled", "true");

  return api<ListBookingsResponse>(`/v2/appointments?${searchParams.toString()}`);
}

export async function fetchV2PolicyStatus(policySetKey: string = "default"): Promise<PolicyStatusDto> {
  const searchParams = new URLSearchParams({ policySetKey });
  return api<PolicyStatusDto>(`/v2/scheduling/admin/policy?${searchParams.toString()}`);
}

export async function createV2PolicyDraft(params: { policySetKey?: string; changeNote?: string | null }) {
  return api<{ draft: { id: number; versionNo: number; status: string }; basedOnVersionId: number }>(
    "/v2/scheduling/admin/policy/draft",
    {
      method: "POST",
      body: JSON.stringify({
        policySetKey: params.policySetKey ?? "default",
        changeNote: params.changeNote ?? null,
      }),
    }
  );
}

export async function saveV2PolicyDraft(params: {
  versionId: number;
  policySnapshot: PolicySnapshotDto;
  changeNote?: string | null;
}) {
  return api<{ version: { id: number; versionNo: number; status: string }; configHash: string }>(
    `/v2/scheduling/admin/policy/draft/${params.versionId}`,
    {
      method: "PUT",
      body: JSON.stringify({
        policySnapshot: params.policySnapshot,
        changeNote: params.changeNote ?? null,
      }),
    }
  );
}

export async function fetchV2PolicyPreview(versionId: number): Promise<PolicyPreviewDto> {
  return api<PolicyPreviewDto>(`/v2/scheduling/admin/policy/draft/${versionId}/preview`);
}

export async function publishV2PolicyDraft(params: { versionId: number; changeNote?: string | null }) {
  return api<{ published: { id: number; versionNo: number; status: string }; ruleCount: number }>(
    `/v2/scheduling/admin/policy/draft/${params.versionId}/publish`,
    {
      method: "POST",
      body: JSON.stringify({ changeNote: params.changeNote ?? null }),
    }
  );
}

// ---------------------------------------------------------------------------
// TanStack Query hooks
// ---------------------------------------------------------------------------

export function useV2Availability(params: Parameters<typeof fetchV2Availability>[0] | undefined) {
  return useQuery({
    queryKey: ["v2-availability", params] as const,
    queryFn: () => fetchV2Availability(params as Parameters<typeof fetchV2Availability>[0]),
    enabled: params != null,
    staleTime: 30_000,
  });
}

export function useV2Suggestions(params: Parameters<typeof fetchV2Suggestions>[0]) {
  return useQuery({
    queryKey: ["v2-suggestions", params] as const,
    queryFn: () => fetchV2Suggestions(params),
    staleTime: 30_000,
  });
}

export function useV2Evaluate() {
  return useMutation({
    mutationFn: evaluateV2Scheduling,
  });
}

export function useV2Lookups() {
  return useQuery({
    queryKey: ["v2-lookups"] as const,
    queryFn: fetchV2Lookups,
    staleTime: 5 * 60_000, // 5 minutes — modalities rarely change
  });
}

export function useV2ExamTypes(modalityId: number | null) {
  return useQuery({
    queryKey: ["v2-exam-types", modalityId] as const,
    queryFn: () => (modalityId != null ? fetchV2ExamTypes(modalityId) : []),
    enabled: modalityId != null,
    staleTime: 5 * 60_000,
  });
}

export function useV2ExamTypeCatalog() {
  return useQuery({
    queryKey: ["v2-exam-type-catalog"] as const,
    queryFn: fetchV2ExamTypeCatalog,
    staleTime: 5 * 60_000,
  });
}

export function useV2SpecialReasonCodes() {
  return useQuery({
    queryKey: ["v2-special-reason-codes"] as const,
    queryFn: fetchV2SpecialReasonCodes,
    staleTime: 5 * 60_000,
  });
}

export function useV2Priorities() {
  return useQuery({
    queryKey: ["v2-priorities"] as const,
    queryFn: fetchV2Priorities,
    staleTime: 60 * 60_000, // Priorities rarely change
  });
}

export function useV2CreateBooking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createV2Booking,
    onSuccess: () => {
      // Invalidate availability cache after booking
      queryClient.invalidateQueries({ queryKey: ["v2-availability"] });
    },
  });
}

export function useV2CancelBooking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cancelV2Booking,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["v2-availability"] });
      queryClient.invalidateQueries({ queryKey: ["v2-bookings"] });
    },
  });
}

export function useV2ListBookings(params: Parameters<typeof listV2Bookings>[0] | null) {
  return useQuery({
    queryKey: ["v2-bookings", params] as const,
    queryFn: () => (params != null ? listV2Bookings(params) : { bookings: [] }),
    enabled: params != null,
    staleTime: 10_000, // 10 seconds — bookings change when user creates/cancels
  });
}

export function useV2RescheduleBooking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ bookingId, input }: { bookingId: number; input: RescheduleBookingRequest }) =>
      rescheduleV2Booking(bookingId, input),
    onSuccess: () => {
      // Invalidate availability and bookings cache after reschedule
      queryClient.invalidateQueries({ queryKey: ["v2-availability"] });
      queryClient.invalidateQueries({ queryKey: ["v2-bookings"] });
    },
  });
}

export function useV2PolicyStatus(policySetKey: string = "default") {
  return useQuery({
    queryKey: ["v2-policy-status", policySetKey] as const,
    queryFn: () => fetchV2PolicyStatus(policySetKey),
    staleTime: 30_000,
  });
}

export function useV2CreatePolicyDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createV2PolicyDraft,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["v2-policy-status"] });
    },
  });
}

export function useV2SavePolicyDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveV2PolicyDraft,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["v2-policy-status"] });
    },
  });
}

export function useV2PolicyPreview(versionId: number | null) {
  return useQuery({
    queryKey: ["v2-policy-preview", versionId] as const,
    queryFn: () => (versionId != null ? fetchV2PolicyPreview(versionId) : null),
    enabled: versionId != null,
    staleTime: 10_000,
  });
}

export function useV2PublishPolicyDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: publishV2PolicyDraft,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["v2-policy-status"] });
      queryClient.invalidateQueries({ queryKey: ["v2-availability"] });
    },
  });
}
