import { expect, test, type APIResponse } from "@playwright/test";
import { signInWithSession } from "../helpers/auth.js";

const apiBase = "http://127.0.0.1:3100/api";

async function json<T>(response: APIResponse, label: string): Promise<T> {
  const body = await response.text();
  expect(response.ok(), `${label} returned ${response.status()}: ${body}`).toBeTruthy();
  return JSON.parse(body) as T;
}

test("real IR referral transitions preserve doctor-native access and Appointment V2 linkage", async ({ browser }) => {
  const receptionContext = await browser.newContext();
  const doctorContext = await browser.newContext();
  const reception = await receptionContext.newPage();
  const doctor = await doctorContext.newPage();

  try {
    await signInWithSession(reception, "e2e_reception");
    const patients = await json<{ patients: Array<{ id: number; english_full_name: string; mrn: string | null }> }>(
      await reception.request.get(`${apiBase}/patients?q=E2E%20Queue%20Patient`),
      "patient search",
    );
    const patient = patients.patients[0];
    expect(patient?.id).toBeTruthy();
    if (!patient) throw new Error("E2E seed did not provide the queue patient.");
    const patientId = Number(patient.id);

    const doctors = await json<{ doctors: Array<{ id: number; englishName: string | null }> }>(
      await reception.request.get(`${apiBase}/ir-referrals/doctors`),
      "IR doctor lookup",
    );
    const assignedDoctor = doctors.doctors[0];
    expect(assignedDoctor?.id).toBeTruthy();
    if (!assignedDoctor) throw new Error("E2E seed did not provide an assignable IR doctor.");

    const created = await json<{ referral: { id: number; status: string } }>(
      await reception.request.post(`${apiBase}/ir-referrals`, {
        data: {
          patientId,
          requestedProcedure: "CT-guided liver biopsy",
          clinicalIndication: "Focal hepatic lesion requiring tissue diagnosis",
          assignedDoctorId: assignedDoctor.id,
          notifyAssignedDoctor: false,
        },
      }),
      "create IR referral",
    );
    const referralId = created.referral.id;
    expect(created.referral.status).toBe("preparing");

    const ready = await json<{ referral: { status: string; documentsConfirmed: boolean; imagesConfirmed: boolean } }>(
      await reception.request.post(`${apiBase}/ir-referrals/${referralId}/confirm-materials`, {
        data: { documentsConfirmed: true, imagesConfirmed: true, note: "Real workflow smoke materials confirmed." },
      }),
      "confirm IR materials",
    );
    expect(ready.referral).toMatchObject({ status: "ready_for_review", documentsConfirmed: true, imagesConfirmed: true });

    await signInWithSession(doctor, "e2e_doctor");
    const doctorMe = await json<{ hasActiveDoctorProfile: boolean; profile: { id: number } | null }>(
      await doctor.request.get(`${apiBase}/doctor/me`),
      "doctor workspace profile",
    );
    expect(doctorMe.hasActiveDoctorProfile).toBe(true);
    expect(Number(doctorMe.profile?.id)).toBe(assignedDoctor.id);
    const doctorReferral = await json<{ referral: { assignedDoctorId: number | null; status: string } }>(
      await doctor.request.get(`${apiBase}/ir-referrals/${referralId}`),
      "doctor referral access",
    );
    expect(Number(doctorReferral.referral.assignedDoctorId)).toBe(assignedDoctor.id);
    expect(doctorReferral.referral.status).toBe("ready_for_review");
    await doctor.goto(`/doctor/ir-consultations/${referralId}`);
    await expect(doctor).toHaveURL(new RegExp(`/doctor/ir-consultations/${referralId}$`));
    await expect(doctor).not.toHaveURL(/\/comparisons\/ir\//);
    await expect(doctor.getByRole("heading", { name: "Clinical IR decision" })).toBeVisible();
    await doctor.goto("/comparisons");
    await expect(doctor).not.toHaveURL(/\/comparisons(?:\/|$)/);

    const needsInformation = await json<{ referral: { status: string; decision: string; assessmentText: string; decisionNote: string; reviewedByDoctorId: number } }>(
      await doctor.request.post(`${apiBase}/ir-referrals/${referralId}/decision`, {
        data: {
          assessmentText: "Lesion appears technically accessible; prior pathology is required.",
          decision: "needs_information",
          decisionNote: "Please attach the previous pathology report.",
        },
      }),
      "record needs-information decision",
    );
    expect(needsInformation.referral).toMatchObject({ status: "needs_information", decision: "needs_information", reviewedByDoctorId: expect.any(Number) });

    const returnedReady = await json<{ referral: { status: string; decision: string; decisionNote: string } }>(
      await reception.request.post(`${apiBase}/ir-referrals/${referralId}/confirm-materials`, {
        data: { documentsConfirmed: true, imagesConfirmed: true, note: "Additional pathology information confirmed." },
      }),
      "resend IR referral after additional information",
    );
    expect(returnedReady.referral).toMatchObject({ status: "ready_for_review", decision: "needs_information", decisionNote: "Please attach the previous pathology report." });

    const eligible = await json<{ referral: { status: string; decision: string; assessmentText: string; decisionNote: string } }>(
      await doctor.request.post(`${apiBase}/ir-referrals/${referralId}/decision`, {
        data: {
          assessmentText: "Prior information reviewed. Lesion is suitable for CT-guided biopsy.",
          decision: "eligible_for_intervention",
          decisionNote: null,
        },
      }),
      "record eligible decision",
    );
    expect(eligible.referral).toMatchObject({ status: "ready_for_review", decision: "eligible_for_intervention", decisionNote: null });

    const modalities = await json<{ items: Array<{ id: number; code: string }> }>(
      await reception.request.get(`${apiBase}/v2/lookups/modalities`),
      "modality lookup",
    );
    const modality = modalities.items.find((item) => item.code === "E2E_CT") ?? modalities.items[0];
    expect(modality?.id).toBeTruthy();
    if (!modality) throw new Error("E2E seed did not provide a modality.");
    const modalityId = Number(modality.id);
    const exams = await json<{ items: Array<{ id: number; modalityId: number | null }> }>(
      await reception.request.get(`${apiBase}/v2/lookups/modalities/${modalityId}/exam-types`),
      "examination lookup",
    );
    const exam = exams.items[0];
    expect(exam?.id).toBeTruthy();
    if (!exam) throw new Error("E2E seed did not provide an examination.");
    const examTypeId = Number(exam.id);

    const schedule = await json<{ request: { id: number; status: string; requestedModalityId: number; requestedExamTypeId: number } }>(
      await doctor.request.post(`${apiBase}/ir-referrals/${referralId}/schedule-requests`, {
        data: {
          modalityId,
          examTypeId,
          preferredDate: null,
          urgency: "within_72_hours",
          receptionInstruction: "Contact patient and confirm fasting instructions.",
          technologistInstruction: "Prepare CT biopsy tray and standard biopsy setup.",
        },
      }),
      "create IR scheduling request",
    );
    expect(schedule.request).toMatchObject({ status: "pending_scheduling", requestedModalityId: modalityId, requestedExamTypeId: examTypeId });

    const queued = await json<{ requests: Array<{ id: number; patientId: number; status: string }> }>(
      await reception.request.get(`${apiBase}/ir-referrals/schedule-requests`),
      "reception IR scheduling queue",
    );
    expect(queued.requests).toEqual(expect.arrayContaining([expect.objectContaining({ id: schedule.request.id, patientId, status: "pending_scheduling" })]));

    const booking = await json<{ booking: { id: number | string; patientId: number | string; modalityId: number | string; examTypeId: number | string }; wasOverride: boolean }>(
      await reception.request.post(`${apiBase}/v2/appointments`, {
        data: {
          irReferralScheduleRequestId: schedule.request.id,
          patientId,
          modalityId,
          examTypeId,
          reportingPriorityId: null,
          bookingDate: "2026-09-22",
          bookingTime: null,
          caseCategory: "non_oncology",
          requiresReport: false,
          capacityResolutionMode: "standard",
          useSpecialQuota: false,
          specialReasonCode: null,
          specialReasonNote: null,
          notes: null,
          isWalkIn: false,
          modalitySafetyAcknowledged: true,
        },
      }),
      "create Appointment V2 booking",
    );
    expect({
      id: Number(booking.booking.id),
      patientId: Number(booking.booking.patientId),
      modalityId: Number(booking.booking.modalityId),
      examTypeId: Number(booking.booking.examTypeId),
    }).toMatchObject({ id: expect.any(Number), patientId, modalityId, examTypeId });
    expect(booking.wasOverride).toBe(false);

    const final = await json<{ referral: { status: string; scheduleRequestId: number | null; decision: string } }>(
      await reception.request.get(`${apiBase}/ir-referrals/${referralId}`),
      "scheduled IR referral",
    );
    expect(final.referral).toMatchObject({ status: "scheduled", decision: "eligible_for_intervention" });
  } finally {
    await doctorContext.close();
    await receptionContext.close();
  }
});
