/**
 * Appointments V2 — Slot model (stub).
 */

export interface Slot {
  id?: number;
  modalityId: number;
  date: string;
  startTime: string | null;
  endTime: string | null;
  capacity: number;
  bookedCount: number;
  isBookable: boolean;
}
