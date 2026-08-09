import { describe, expect, it } from "vitest";
import { mapAppointmentWithDetails, mapNameDictionaryEntry, mapQueueSnapshot } from "./mappers";

describe("workflow timestamp mapping", () => {
  it("maps persisted dictionary entries with a numeric ID", () => {
    const entry = mapNameDictionaryEntry({
      id: 17,
      arabic_text: "محمد",
      english_text: "Mohamed",
    });

    expect(entry.id).toBe(17);
    expect(entry.arabicText).toBe("محمد");
    expect(entry.englishText).toBe("Mohamed");
  });

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
      auto_completed_at: "2026-06-18T09:29:00Z",
    });

    expect(appointment.arrivedAt).toBe("2026-06-18T08:15:00Z");
    expect(appointment.waitingStartedAt).toBe("2026-06-18T08:20:00Z");
    expect(appointment.completedAt).toBe("2026-06-18T09:30:00Z");
    expect(appointment.autoCompletedAt).toBe("2026-06-18T09:29:00Z");
  });

  it("maps modality worklist PACS timing and primary identifier fields", () => {
    const appointment = mapAppointmentWithDetails({
      id: 1,
      patient_id: 2,
      modality_id: 3,
      accession_number: "ACC-1",
      appointment_date: "2026-06-18",
      daily_sequence: 1,
      status: "completed",
      arabic_full_name: "Patient",
      modality_name_ar: "CT",
      modality_name_en: "CT",
      patient_primary_identifier_type: "passport",
      patient_primary_identifier_label_ar: "جواز سفر",
      patient_primary_identifier_label_en: "Passport",
      patient_primary_identifier_value: "P12345",
      pacs_auto_completion_enabled: true,
      pacs_study_started_at: "2026-06-18T08:25:00Z",
      pacs_first_seen_at: "2026-06-18T08:27:00Z",
      pacs_timing_source: "instance_acquisition_datetime",
      pacs_timing_confidence: "high",
      autoCompletedAt: "2026-06-18T08:28:00Z",
    });

    expect(appointment.patientPrimaryIdentifierType).toBe("passport");
    expect(appointment.patientPrimaryIdentifierLabelAr).toBe("جواز سفر");
    expect(appointment.patientPrimaryIdentifierLabelEn).toBe("Passport");
    expect(appointment.patientPrimaryIdentifierValue).toBe("P12345");
    expect(appointment.pacsAutoCompletionEnabled).toBe(true);
    expect(appointment.pacsStudyStartedAt).toBe("2026-06-18T08:25:00Z");
    expect(appointment.pacsFirstSeenAt).toBe("2026-06-18T08:27:00Z");
    expect(appointment.pacsTimingSource).toBe("instance_acquisition_datetime");
    expect(appointment.pacsTimingConfidence).toBe("high");
    expect(appointment.autoCompletedAt).toBe("2026-06-18T08:28:00Z");
  });

  it("maps MRI safety fields without treating missing workflow data as standard acknowledgement", () => {
    const mriAppointment = mapAppointmentWithDetails({
      id: 1,
      patient_id: 2,
      modality_id: 3,
      accession_number: "ACC-MRI",
      appointment_date: "2026-06-18",
      daily_sequence: 1,
      status: "scheduled",
      arabic_full_name: "Patient",
      modality_name_ar: "MRI",
      modality_name_en: "MRI",
      modality_safety_workflow_type: "mri_primary_implant_screening",
      mri_primary_screening: {
        result: "implant_reported_review_required",
        implantSite: "left hip",
        implantDescription: "joint replacement",
        previousReviewerNameReported: "Dr Reported",
        screenedByUserId: 7,
        screenedAt: "2026-06-18T08:00:00Z",
      },
    });
    const incompleteAppointment = mapAppointmentWithDetails({
      id: 2,
      patient_id: 2,
      modality_id: 3,
      accession_number: "ACC-PARTIAL",
      appointment_date: "2026-06-18",
      daily_sequence: 2,
      status: "scheduled",
      arabic_full_name: "Patient",
      modality_name_ar: "MRI",
      modality_name_en: "MRI",
    });

    expect(mriAppointment.modalitySafetyWorkflowType).toBe("mri_primary_implant_screening");
    expect(mriAppointment.mriPrimaryScreening).toEqual({
      result: "implant_reported_review_required",
      implantSite: "left hip",
      implantDescription: "joint replacement",
      previousReviewerNameReported: "Dr Reported",
      screenedByUserId: 7,
      screenedAt: "2026-06-18T08:00:00Z",
    });
    expect(incompleteAppointment.modalitySafetyWorkflowType).toBeUndefined();
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
