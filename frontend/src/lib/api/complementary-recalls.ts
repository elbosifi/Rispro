import { api } from "@/lib/api-client";

export type ComplementaryRecall = { id: number; originalAppointmentId: number; recallAppointmentId: number | null; receptionInstruction: string | null; technologistInstruction: string; status: "pending_scheduling" | "scheduled" | "completed" | "cancelled"; requestedByUserId: number; requestedAt: string; receptionSeenAt: string | null; scheduledAt: string | null; completedAt: string | null; cancelledAt: string | null; };

export async function fetchComplementaryRecalls(): Promise<ComplementaryRecall[]> { return (await api<{ recalls: ComplementaryRecall[] }>("/v2/complementary-recall-requests")).recalls; }
export async function fetchComplementaryRecallUnseenCount(): Promise<number> { return (await api<{ count: number }>("/v2/complementary-recall-requests/unseen-count")).count; }
export async function markComplementaryRecallSeen(id: number): Promise<void> { await api<void>(`/v2/complementary-recall-requests/${id}/mark-seen`, { method: "POST" }); }
export async function fetchComplementaryRecall(id: number): Promise<ComplementaryRecall> { return (await api<{ recall: ComplementaryRecall }>(`/v2/complementary-recall-requests/${id}`)).recall; }
export type ComplementaryRecallBookingContext = ComplementaryRecall & { patientId: number; modalityId: number; examTypeId: number; originalAccession: string; originalExam: string | null; };
export async function fetchComplementaryRecallBookingContext(id: number): Promise<ComplementaryRecallBookingContext> { return (await api<{ recall: ComplementaryRecallBookingContext }>(`/v2/complementary-recall-requests/${id}/booking-context`)).recall; }
