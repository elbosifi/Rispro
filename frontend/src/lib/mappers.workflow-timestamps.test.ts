import { describe, expect, it } from "vitest";
import { mapAppointmentWithDetails, mapQueueSnapshot } from "./mappers";

describe("workflow timestamp mapping", () => {
  it("maps appointment workflow timestamps from snake_case API fields", () => {
    const appointment = mapAppointmentWithDetails({
      id: 1,
      patient_id: 2,
      modality_id: 3,
      accession_number: "ACC-1",
      appointment_date: "2026-06-18",
      daily_sequence: 1,
      status: "waiting",
      arabic_full_name: "Patient",
      modality_name_ar: "CT",
      modality_name_en: "CT",
      arrived_at: "2026-06-18T08:15:00Z",
      waiting_started_at: "2026-06-18T08:20:00Z",
      completed_at: "2026-06-18T09:30:00Z",
    });

    expect(appointment.arrivedAt).toBe("2026-06-18T08:15:00Z");
    expect(appointment.waitingStartedAt).toBe("2026-06-18T08:20:00Z");
    expect(appointment.completedAt).toBe("2026-06-18T09:30:00Z");
  });

  it("maps queue workflow timestamps while preserving scannedAt", () => {
    const snapshot = mapQueueSnapshot({
      queue_date: "2026-06-18",
      review_time: "18:00",
      summary: {},
      queue_entries: [
        {
          id: 1,
          queue_date: "2026-06-18",
          queue_number: 1,
          queue_status: "waiting",
          scanned_at: "2026-06-18T08:15:00Z",
          arrived_at: "2026-06-18T08:15:00Z",
          waiting_started_at: "2026-06-18T08:20:00Z",
          completed_at: null,
          appointment_id: 44,
          accession_number: "ACC-44",
          appointment_status: "waiting",
          patient_id: 22,
          arabic_full_name: "Patient",
          modality_name_ar: "CT",
          modality_name_en: "CT",
        },
      ],
    });

    expect(snapshot.queueEntries[0].scannedAt).toBe("2026-06-18T08:15:00Z");
    expect(snapshot.queueEntries[0].arrivedAt).toBe("2026-06-18T08:15:00Z");
    expect(snapshot.queueEntries[0].waitingStartedAt).toBe("2026-06-18T08:20:00Z");
    expect(snapshot.queueEntries[0].completedAt).toBeNull();
  });
});
