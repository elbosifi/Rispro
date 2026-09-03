import { randomUUID } from "node:crypto";
import { withTransaction } from "../appointments-v2/shared/utils/transactions.js";
import { getPublicAppBaseUrl } from "../appointments-v2/public/utils/public-cancel-config.js";
import { enqueueEmail } from "../../services/email-outbox-service.js";
import { getEmailSettings } from "../../services/email-settings-service.js";
import { HttpError } from "../../utils/http-error.js";
import { insertDoctorAuditEvent } from "./profile-repository.js";
import { requireRosterManager } from "./roster-service.js";
import { findDoctorWorklistById } from "./doctor-worklist-repository.js";
import type { Actor } from "./reporting-board-service.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACTIVE_EMAIL_STATUSES = ["pending", "processing", "retry_scheduled"];

function isExpired(expiresAt: string | null): boolean {
  return expiresAt !== null && new Date(expiresAt).getTime() <= Date.now();
}

function unavailableWorklist(): never {
  throw new HttpError(409, "This doctor's Personal Reporting Desk link is not active.");
}

export async function queueDoctorReportingWorklistLinkEmail(actor: Actor, worklistId: number) {
  const manager = await requireRosterManager(actor);

  return withTransaction(async (client) => {
    const locked = await client.query<{ id: number }>(
      `
        select id
        from doctor_portal.reporting_board_saved_views
        where id = $1
        for update
      `,
      [worklistId]
    );
    if (!locked.rows[0]) throw new HttpError(404, "Doctor worklist not found.");

    const worklist = await findDoctorWorklistById(worklistId, client);
    if (!worklist) throw new HttpError(404, "Doctor worklist not found.");
    if (
      worklist.linkKind !== "doctor_worklist"
      || !worklist.systemManaged
      || !worklist.targetDoctorId
      || !worklist.doctorUserId
      || !worklist.doctorActive
      || !worklist.userActive
      || !worklist.active
      || worklist.revokedAt
      || worklist.adminDisabledAt
      || isExpired(worklist.expiresAt)
    ) {
      unavailableWorklist();
    }

    const doctorEmail = worklist.doctorEmail?.trim() ?? "";
    if (!EMAIL_PATTERN.test(doctorEmail)) {
      throw new HttpError(409, "This doctor has no valid email address.");
    }

    const settings = await getEmailSettings(client);
    if (!settings.enabled) throw new HttpError(409, "Outbound email is disabled.");
    if (!settings.passwordConfigured) throw new HttpError(409, "SMTP credentials are not configured.");

    const existing = await client.query<{ status: string }>(
      `
        select status
        from email_outbox
        where event_type = 'doctor_worklist_link'
          and related_entity_type = 'reporting_board_saved_view'
          and related_entity_id = $1
          and recipient_user_id = $2
          and status = any($3::text[])
      `,
      [String(worklist.id), worklist.doctorUserId, ACTIVE_EMAIL_STATUSES]
    );
    if (existing.rows.length > 0) {
      throw new HttpError(409, "A worklist email is already queued for this doctor.");
    }

    let publicBaseUrl: string;
    try {
      publicBaseUrl = getPublicAppBaseUrl();
    } catch {
      throw new HttpError(409, "The RISpro public application URL is not configured.");
    }
    const worklistUrl = `${publicBaseUrl}/reporting/worklist/${encodeURIComponent(worklist.token)}`;
    const displayName = worklist.doctorDisplayName.trim() || worklist.username;
    const outbox = await enqueueEmail({
      eventType: "doctor_worklist_link",
      recipientUserId: worklist.doctorUserId,
      recipientEmail: doctorEmail,
      subject: "RISpro Personal Reporting Desk",
      textBody: [
        `Hello ${displayName},`,
        "",
        "Your RISpro Personal Reporting Desk is available here:",
        "",
        worklistUrl,
        "",
        "Sign in with your RISpro account to use reporting actions.",
        "",
        "Keep this link private. If the link is unavailable, contact Radiology administration.",
        "",
        "RISpro",
      ].join("\n"),
      idempotencyKey: `doctor_worklist_link:${worklist.id}:${worklist.doctorUserId}:${randomUUID()}`,
      relatedEntityType: "reporting_board_saved_view",
      relatedEntityId: String(worklist.id),
      createdByUserId: actor.userId,
    }, client);

    await insertDoctorAuditEvent(client, {
      actorUserId: actor.userId,
      actorDoctorId: manager.profile!.id,
      eventType: "doctor_worklist_link_email_queued",
      targetType: "reporting_board_saved_view",
      targetId: worklist.id,
      metadata: {
        targetDoctorId: worklist.targetDoctorId,
        recipientUserId: worklist.doctorUserId,
        outboxId: outbox.id,
      },
      reason: null,
    });

    return {
      queued: true as const,
      outboxId: outbox.id,
      status: outbox.status,
      recipientEmail: doctorEmail,
    };
  }, { operationName: "doctor_worklist_link_email" });
}
