import type { PoolClient } from "pg";
import { enqueueEmail } from "../../../services/email-outbox-service.js";
import { getEmailSettings } from "../../../services/email-settings-service.js";
import { getEmailNotificationRule } from "../../../services/email-notification-rules-service.js";
import { formatV2AccessionNumber } from "../shared/utils/accession.js";

const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type RecallCompletionEmailContext = {
  original_appointment_id: number;
  recipient_user_id: number | null;
  recipient_email: string | null;
  recipient_is_active: boolean | null;
  recipient_profile_active: boolean | null;
  patient_display_name: string | null;
  original_exam: string | null;
  modality_code: string | null;
  modality_name: string | null;
  reporting_disposition: "supplement_original_report" | "separate_report" | "no_separate_report" | null;
};

const reportingDispositionLabels = {
  supplement_original_report: "Supplement original report",
  separate_report: "Separate report",
  no_separate_report: "No separate report",
} as const;

export async function queueComplementaryRecallCompletedEmail(
  client: PoolClient,
  input: { recallRequestId: number; recallAppointmentId: number; actorUserId: number | null },
): Promise<{ enqueued: boolean; reason?: string }> {
  const settings = await getEmailSettings(client);
  if (!settings.enabled) return { enqueued: false, reason: "email_disabled" };
  const rule = await getEmailNotificationRule("additional_imaging_completed", client);
  if (!rule.enabled) return { enqueued: false, reason: "notification_rule_disabled" };

  const context = await client.query<RecallCompletionEmailContext>(
    `select r.original_appointment_id,
            assigned_user.id as recipient_user_id,
            assigned_user.email as recipient_email,
            assigned_user.is_active as recipient_is_active,
            assigned_profile.active as recipient_profile_active,
            coalesce(nullif(trim(p.english_full_name), ''), nullif(trim(p.arabic_full_name), '')) as patient_display_name,
            et.name_en as original_exam,
            m.code as modality_code,
            m.name_en as modality_name,
            r.reporting_disposition
       from appointments_v2.complementary_recall_requests r
       join appointments_v2.bookings original_booking on original_booking.id = r.original_appointment_id
       join patients p on p.id = original_booking.patient_id
       join modalities m on m.id = original_booking.modality_id
       left join exam_types et on et.id = original_booking.exam_type_id
       left join doctor_portal.case_team_assignments assignment on assignment.appointment_id = r.original_appointment_id and assignment.assignment_type = 'reporting' and assignment.status = 'active'
       left join doctor_portal.doctor_profiles assigned_profile on assigned_profile.id = assignment.assigned_doctor_id
       left join users assigned_user on assigned_user.id = assigned_profile.user_id
      where r.id = $1 and r.recall_appointment_id = $2`,
    [input.recallRequestId, input.recallAppointmentId],
  );
  const row = context.rows[0];
  if (!row) return { enqueued: false, reason: "recall_context_unavailable" };
  const recipientEmail = row.recipient_email?.trim() ?? "";
  if (!row.recipient_user_id) return { enqueued: false, reason: "reporting_assignment_unavailable" };
  if (!row.recipient_is_active) return { enqueued: false, reason: "assigned_user_inactive" };
  if (!row.recipient_profile_active) return { enqueued: false, reason: "assigned_doctor_ineligible" };
  if (!EMAIL_LIKE.test(recipientEmail)) return { enqueued: false, reason: "assigned_doctor_email_invalid" };

  const originalAccession = formatV2AccessionNumber(row.original_appointment_id);
  const recallAccession = formatV2AccessionNumber(input.recallAppointmentId);
  const modality = [row.modality_code, row.modality_name].filter(Boolean).join(" / ");
  const lines = [
    "Additional imaging has been completed and is ready for review.",
    "",
    `Patient: ${row.patient_display_name ?? ""}`,
    `Original examination: ${row.original_exam ?? ""}`,
    `Modality: ${modality}`,
    `Original accession: ${originalAccession}`,
    `Additional imaging accession: ${recallAccession}`,
    ...(row.reporting_disposition ? [`Reporting action: ${reportingDispositionLabels[row.reporting_disposition]}`] : []),
    "",
    "Please review the additional images and complete the appropriate reporting action.",
    "",
    "RISpro",
  ];
  await enqueueEmail({
    eventType: "additional_imaging_completed",
    recipientUserId: row.recipient_user_id,
    recipientEmail,
    subject: `RISpro: Additional imaging completed — ${recallAccession}`,
    textBody: lines.join("\n"),
    idempotencyKey: `additional_imaging_completed:${input.recallRequestId}:${input.recallAppointmentId}`,
    relatedEntityType: "complementary_recall_request",
    relatedEntityId: String(input.recallRequestId),
    createdByUserId: input.actorUserId,
  }, client);
  return { enqueued: true };
}
