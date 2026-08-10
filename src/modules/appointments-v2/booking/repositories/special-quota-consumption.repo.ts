import type { PoolClient } from "pg";

export interface SpecialQuotaConsumptionRow {
  id: number;
  bookingId: number;
  quotaRuleId: number;
  quotaLogicalKey: string;
  policyVersionId: number;
  bookingDate: string;
  examTypeId: number;
  consumedByUserId: number | null;
  consumedAt: string;
  releasedAt: string | null;
  releasedByUserId: number | null;
  releaseReason: string | null;
}

const CONSUMPTION_COLUMNS = `
  id,
  booking_id as "bookingId",
  quota_rule_id as "quotaRuleId",
  quota_logical_key::text as "quotaLogicalKey",
  policy_version_id as "policyVersionId",
  booking_date::text as "bookingDate",
  exam_type_id as "examTypeId",
  consumed_by_user_id as "consumedByUserId",
  consumed_at as "consumedAt",
  released_at as "releasedAt",
  released_by_user_id as "releasedByUserId",
  release_reason as "releaseReason"
`;

export async function findActiveSpecialQuotaConsumption(
  client: PoolClient,
  bookingId: number,
  options: { forUpdate?: boolean } = {}
): Promise<SpecialQuotaConsumptionRow | null> {
  const result = await client.query<SpecialQuotaConsumptionRow>(
    `
      select ${CONSUMPTION_COLUMNS}
      from appointments_v2.special_quota_consumptions
      where booking_id = $1
        and released_at is null
      order by id desc
      limit 1
      ${options.forUpdate ? "for update" : ""}
    `,
    [bookingId]
  );
  return result.rows[0] ?? null;
}

export async function insertSpecialQuotaConsumption(
  client: PoolClient,
  params: {
    bookingId: number;
    quotaRuleId: number;
    quotaLogicalKey: string;
    policyVersionId: number;
    bookingDate: string;
    examTypeId: number;
    consumedByUserId: number;
  }
): Promise<SpecialQuotaConsumptionRow> {
  const result = await client.query<SpecialQuotaConsumptionRow>(
    `
      insert into appointments_v2.special_quota_consumptions (
        booking_id,
        quota_rule_id,
        quota_logical_key,
        policy_version_id,
        booking_date,
        exam_type_id,
        consumed_by_user_id
      ) values ($1, $2, $3::uuid, $4, $5, $6, $7)
      returning ${CONSUMPTION_COLUMNS}
    `,
    [
      params.bookingId,
      params.quotaRuleId,
      params.quotaLogicalKey,
      params.policyVersionId,
      params.bookingDate,
      params.examTypeId,
      params.consumedByUserId,
    ]
  );
  return result.rows[0];
}

export async function releaseActiveSpecialQuotaConsumption(
  client: PoolClient,
  params: {
    bookingId: number;
    releasedByUserId: number;
    releaseReason: string;
  }
): Promise<SpecialQuotaConsumptionRow | null> {
  const result = await client.query<SpecialQuotaConsumptionRow>(
    `
      update appointments_v2.special_quota_consumptions
      set released_at = now(),
          released_by_user_id = $2,
          release_reason = $3,
          updated_at = now()
      where booking_id = $1
        and released_at is null
      returning ${CONSUMPTION_COLUMNS}
    `,
    [params.bookingId, params.releasedByUserId, params.releaseReason]
  );
  return result.rows[0] ?? null;
}
