import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAppointmentSlipSettings } from "./appointment-slip-settings.js";

test("normalizeAppointmentSlipSettings preserves heading fields", () => {
  const normalized = normalizeAppointmentSlipSettings({
    slipTitleAr: "وصل مخصص",
    slipTitleEn: "Custom Slip",
    patientDetailsHeadingAr: "بيانات خاصة",
    patientDetailsHeadingEn: "Custom Patient Details",
    appointmentDetailsHeadingAr: "موعد خاص",
    appointmentDetailsHeadingEn: "Custom Appointment Details",
    instructionsHeadingAr: "تعليمات خاصة",
    instructionsHeadingEn: "Custom Instructions",
    modalityInstructionsHeadingAr: "تعليمات جهاز خاصة",
    modalityInstructionsHeadingEn: "Custom Modality Instructions",
    examInstructionsHeadingAr: "تعليمات فحص خاصة",
    examInstructionsHeadingEn: "Custom Exam Instructions",
    locationHeadingAr: "موقع خاص",
    locationHeadingEn: "Custom Location",
  });

  assert.equal(normalized.slipTitleAr, "وصل مخصص");
  assert.equal(normalized.slipTitleEn, "Custom Slip");
  assert.equal(normalized.patientDetailsHeadingAr, "بيانات خاصة");
  assert.equal(normalized.patientDetailsHeadingEn, "Custom Patient Details");
  assert.equal(normalized.appointmentDetailsHeadingAr, "موعد خاص");
  assert.equal(normalized.appointmentDetailsHeadingEn, "Custom Appointment Details");
  assert.equal(normalized.instructionsHeadingAr, "تعليمات خاصة");
  assert.equal(normalized.instructionsHeadingEn, "Custom Instructions");
  assert.equal(normalized.modalityInstructionsHeadingAr, "تعليمات جهاز خاصة");
  assert.equal(normalized.modalityInstructionsHeadingEn, "Custom Modality Instructions");
  assert.equal(normalized.examInstructionsHeadingAr, "تعليمات فحص خاصة");
  assert.equal(normalized.examInstructionsHeadingEn, "Custom Exam Instructions");
  assert.equal(normalized.locationHeadingAr, "موقع خاص");
  assert.equal(normalized.locationHeadingEn, "Custom Location");
});

test("normalizeAppointmentSlipSettings defaults new slip flags to false", () => {
  const normalized = normalizeAppointmentSlipSettings({});

  assert.equal(normalized.showPatientCategory, false);
  assert.equal(normalized.boldAppointmentSlipText, false);
});
