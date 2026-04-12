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
  // Reuse the proven legacy lookups endpoint that works for reception users
  const lookups = await api<{ modalities: ModalityDto[]; examTypes: unknown[]; priorities: unknown[] }>(
    "/appointments/lookups"
  );
  return lookups.modalities;
}

export async function fetchV2ExamTypes(modalityId: number): Promise<ExamTypeDto[]> {
  // Reuse the proven legacy lookups endpoint and filter client-side
  const lookups = await api<{ modalities: unknown[]; examTypes: ExamTypeDto[]; priorities: unknown[] }>(
    "/appointments/lookups"
  );
  return lookups.examTypes.filter(
    (et) => (et as { modalityId?: number | null }).modalityId === modalityId
  );
}

export async function fetchV2Lookups(): Promise<LookupsResponse> {
  // Use the single proven endpoint that returns modalities + examTypes + priorities
  const lookups = await api<{ modalities: ModalityDto[]; examTypes: ExamTypeDto[]; priorities: unknown[] }>(
    "/appointments/lookups"
  );
  return { modalities: lookups.modalities, examTypes: lookups.examTypes };
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

// ---------------------------------------------------------------------------
// TanStack Query hooks
// ---------------------------------------------------------------------------

export function useV2Availability(params: Parameters<typeof fetchV2Availability>[0]) {
  return useQuery({
    queryKey: ["v2-availability", params] as const,
    queryFn: () => fetchV2Availability(params),
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
