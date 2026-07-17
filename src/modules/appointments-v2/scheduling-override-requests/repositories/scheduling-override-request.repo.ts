import type { PoolClient } from "pg";
import type {
  SchedulingOverrideRequestFilters,
  SchedulingOverrideRequestRow,
  SchedulingOverrideRequestStatus,
  SchedulingOverrideStoredPayload,
} from "../models/scheduling-override-request.js";
import type { SchedulingOverrideType } from "../../shared/types/common.js";

const SELECT_COLUMNS = `
  id,
  request_type as "requestType",
  override_type as "overrideType",
  status,
  requester_user_id as "requesterUserId",
  approver_user_id as "approverUserId",
  patient_id as "patientId",
  modality_id as "modalityId",
  exam_type_id as "examTypeId",
  requested_booking_date::text as "requestedBookingDate",
  requested_booking_time::text as "requestedBookingTime",
  booking_id as "bookingId",
  requested_policy_version_id as "requestedPolicyVersionId",
  approved_policy_version_id as "approvedPolicyVersionId",
  patient_identity_verification_fingerprint as "patientIdentityVerificationFingerprint",
  request_payload_json as "requestPayloadJson",
  original_decision_snapshot_json as "originalDecisionSnapshotJson",
  approval_decision_snapshot_json as "approvalDecisionSnapshotJson",
  requester_reason as "requesterReason",
  approver_reason as "approverReason",
  failure_code as "failureCode",
  failure_message as "failureMessage",
  expires_at as "expiresAt",
  superseded_by_request_id as "supersededByRequestId",
  created_from_context as "createdFromContext",
  approved_at as "approvedAt",
  rejected_at as "rejectedAt",
  cancelled_at as "cancelledAt",
  failed_at as "failedAt",
  expired_at as "expiredAt",
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

export async function insertSchedulingOverrideRequest(
  client: PoolClient,
  input: {
    requestType: "create_booking" | "reschedule_booking";
    overrideType: SchedulingOverrideType;
    requesterUserId: number;
    patientId: number;
    modalityId: number;
    examTypeId: number | null;
    requestedBookingDate: string;
    requestedBookingTime: string | null;
    bookingId: number | null;
    requestedPolicyVersionId: number | null;
    patientIdentityVerificationFingerprint: string | null;
    requestPayload: SchedulingOverrideStoredPayload;
    originalDecisionSnapshot: unknown;
    requesterReason: string;
    expiresAt: Date;
    createdFromContext: string | null;
  }
): Promise<SchedulingOverrideRequestRow> {
  const result = await client.query<SchedulingOverrideRequestRow>(
    `
      insert into appointments_v2.scheduling_override_requests (
        request_type, override_type, requester_user_id, patient_id, modality_id, exam_type_id,
        requested_booking_date, requested_booking_time, booking_id, requested_policy_version_id, patient_identity_verification_fingerprint,
        request_payload_json, original_decision_snapshot_json, requester_reason, expires_at,
        created_from_context
      ) values (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12::jsonb, $13::jsonb, $14, $15,
        $16
      )
      returning ${SELECT_COLUMNS}
    `,
    [
      input.requestType,
      input.overrideType,
      input.requesterUserId,
      input.patientId,
      input.modalityId,
      input.examTypeId,
      input.requestedBookingDate,
      input.requestedBookingTime,
      input.bookingId,
      input.requestedPolicyVersionId,
      input.patientIdentityVerificationFingerprint,
      JSON.stringify(input.requestPayload),
      JSON.stringify(input.originalDecisionSnapshot),
      input.requesterReason,
      input.expiresAt,
      input.createdFromContext,
    ]
  );
  return result.rows[0];
}

export async function listSchedulingOverrideRequests(
  client: PoolClient,
  filters: SchedulingOverrideRequestFilters,
  visibility: { requesterUserId?: number | null }
): Promise<SchedulingOverrideRequestRow[]> {
  const values: unknown[] = [];
  const where: string[] = [];

  if (visibility.requesterUserId != null) {
    values.push(visibility.requesterUserId);
    where.push(`requester_user_id = $${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    where.push(`status = $${values.length}`);
  }
  if (filters.requestType) {
    values.push(filters.requestType);
    where.push(`request_type = $${values.length}`);
  }
  if (filters.overrideType) {
    values.push(filters.overrideType);
    where.push(`override_type = $${values.length}`);
  }
  if (filters.modalityId) {
    values.push(filters.modalityId);
    where.push(`modality_id = $${values.length}`);
  }
  if (filters.requestedBookingDate) {
    values.push(filters.requestedBookingDate);
    where.push(`requested_booking_date = $${values.length}::date`);
  }

  const result = await client.query<SchedulingOverrideRequestRow>(
    `
      select ${SELECT_COLUMNS}
      from appointments_v2.scheduling_override_requests
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by created_at desc, id desc
      limit 200
    `,
    values
  );
  return result.rows;
}

export async function findSchedulingOverrideRequestById(
  client: PoolClient,
  id: number
): Promise<SchedulingOverrideRequestRow | null> {
  const result = await client.query<SchedulingOverrideRequestRow>(
    `
      select ${SELECT_COLUMNS}
      from appointments_v2.scheduling_override_requests
      where id = $1
      limit 1
    `,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function lockSchedulingOverrideRequestById(
  client: PoolClient,
  id: number
): Promise<SchedulingOverrideRequestRow | null> {
  const result = await client.query<SchedulingOverrideRequestRow>(
    `
      select ${SELECT_COLUMNS}
      from appointments_v2.scheduling_override_requests
      where id = $1
      for update
    `,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function markSchedulingOverrideRequestApproved(
  client: PoolClient,
  id: number,
  input: {
    approverUserId: number;
    approverReason: string | null;
    approvedPolicyVersionId: number | null;
    approvalDecisionSnapshot: unknown;
  }
): Promise<SchedulingOverrideRequestRow> {
  const result = await client.query<SchedulingOverrideRequestRow>(
    `
      update appointments_v2.scheduling_override_requests
      set status = 'approved',
          approver_user_id = $2,
          approver_reason = $3,
          approved_policy_version_id = $4,
          approval_decision_snapshot_json = $5,
          approved_at = now(),
          updated_at = now()
      where id = $1
      returning ${SELECT_COLUMNS}
    `,
    [id, input.approverUserId, input.approverReason, input.approvedPolicyVersionId, JSON.stringify(input.approvalDecisionSnapshot)]
  );
  return result.rows[0];
}

export async function markSchedulingOverrideRequestRejected(
  client: PoolClient,
  id: number,
  approverUserId: number,
  approverReason: string
): Promise<SchedulingOverrideRequestRow> {
  const result = await client.query<SchedulingOverrideRequestRow>(
    `
      update appointments_v2.scheduling_override_requests
      set status = 'rejected',
          approver_user_id = $2,
          approver_reason = $3,
          rejected_at = now(),
          updated_at = now()
      where id = $1
      returning ${SELECT_COLUMNS}
    `,
    [id, approverUserId, approverReason]
  );
  return result.rows[0];
}

export async function markSchedulingOverrideRequestCancelled(
  client: PoolClient,
  id: number,
  approverUserId: number | null
): Promise<SchedulingOverrideRequestRow> {
  const result = await client.query<SchedulingOverrideRequestRow>(
    `
      update appointments_v2.scheduling_override_requests
      set status = 'cancelled',
          approver_user_id = coalesce($2, approver_user_id),
          cancelled_at = now(),
          updated_at = now()
      where id = $1
      returning ${SELECT_COLUMNS}
    `,
    [id, approverUserId]
  );
  return result.rows[0];
}

export async function markSchedulingOverrideRequestFailed(
  client: PoolClient,
  id: number,
  input: {
    approverUserId: number | null;
    failureCode: string;
    failureMessage: string;
    approvalDecisionSnapshot?: unknown;
  }
): Promise<SchedulingOverrideRequestRow> {
  const result = await client.query<SchedulingOverrideRequestRow>(
    `
      update appointments_v2.scheduling_override_requests
      set status = 'failed',
          approver_user_id = coalesce($2, approver_user_id),
          failure_code = $3,
          failure_message = $4,
          approval_decision_snapshot_json = coalesce($5::jsonb, approval_decision_snapshot_json),
          failed_at = now(),
          updated_at = now()
      where id = $1
      returning ${SELECT_COLUMNS}
    `,
    [id, input.approverUserId, input.failureCode, input.failureMessage, input.approvalDecisionSnapshot == null ? null : JSON.stringify(input.approvalDecisionSnapshot)]
  );
  return result.rows[0];
}

export async function markSchedulingOverrideRequestExpired(
  client: PoolClient,
  id: number
): Promise<SchedulingOverrideRequestRow> {
  const result = await client.query<SchedulingOverrideRequestRow>(
    `
      update appointments_v2.scheduling_override_requests
      set status = 'expired',
          expired_at = now(),
          updated_at = now()
      where id = $1
      returning ${SELECT_COLUMNS}
    `,
    [id]
  );
  return result.rows[0];
}

export function isSchedulingOverrideRequestStatus(value: string): value is SchedulingOverrideRequestStatus {
  return ["pending", "approved", "rejected", "cancelled", "failed", "expired"].includes(value);
}
