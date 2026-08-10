/**
 * Appointments V2 — Capacity repository.
 *
 * Queries booked counts from appointments_v2.bookings.
 */

import type { PoolClient } from "pg";

export interface BookedCountsByCategory {
  oncology: number;
  nonOncology: number;
  total: number;
}

const GET_BOOKED_COUNT_SQL = `
  select count(*)::int as count
  from appointments_v2.bookings
  where modality_id = $1
    and booking_date = $2
    and case_category = $3
    and status not in ('cancelled', 'discontinued', 'voided')
    and ($4::bigint is null or id <> $4::bigint)
`;

export async function getBookedCountForDate(
  client: PoolClient,
  modalityId: number,
  date: string,
  caseCategory: string,
  excludeBookingId: number | null = null
): Promise<number> {
  const result = await client.query<{ count: number }>(GET_BOOKED_COUNT_SQL, [
    modalityId,
    date,
    caseCategory,
    excludeBookingId,
  ]);
  return result.rows[0]?.count ?? 0;
}

const GET_BOOKED_COUNTS_BY_CATEGORY_SQL = `
  select
    count(*)::int as total,
    count(*) filter (where case_category = 'oncology')::int as oncology,
    count(*) filter (where case_category = 'non_oncology')::int as non_oncology
  from appointments_v2.bookings
  where modality_id = $1
    and booking_date = $2
    and status not in ('cancelled', 'discontinued', 'voided')
    and ($3::bigint is null or id <> $3::bigint)
`;

export async function getBookedCountsByCategoryForDate(
  client: PoolClient,
  modalityId: number,
  date: string,
  excludeBookingId: number | null = null
): Promise<BookedCountsByCategory> {
  const result = await client.query<{
    total: number;
    oncology: number;
    non_oncology: number;
  }>(GET_BOOKED_COUNTS_BY_CATEGORY_SQL, [modalityId, date, excludeBookingId]);

  const row = result.rows[0];
  return {
    total: row?.total ?? 0,
    oncology: row?.oncology ?? 0,
    nonOncology: row?.non_oncology ?? 0,
  };
}

const GET_SPECIAL_QUOTA_CONSUMPTION_COUNT_SQL = `
  select count(*)::int as count
  from appointments_v2.special_quota_consumptions
  where quota_logical_key = $1::uuid
    and booking_date = $2
    and released_at is null
    and ($3::bigint is null or booking_id <> $3::bigint)
`;

export async function getSpecialQuotaConsumptionCount(
  client: PoolClient,
  params: {
    logicalKey: string;
    bookingDate: string;
    excludeBookingId?: number | null;
  }
): Promise<number> {
  const result = await client.query<{ count: number }>(GET_SPECIAL_QUOTA_CONSUMPTION_COUNT_SQL, [
    params.logicalKey,
    params.bookingDate,
    params.excludeBookingId ?? null,
  ]);
  return result.rows[0]?.count ?? 0;
}

const GET_EXAM_MIX_CONSUMED_BY_RULES_SQL = `
  select
    emqr.id as "ruleId",
    count(b.id)::int as consumed
  from appointments_v2.exam_mix_quota_rules emqr
  left join appointments_v2.exam_mix_quota_rule_items emqri
    on emqri.rule_id = emqr.id
  left join appointments_v2.bookings b
    on b.modality_id = emqr.modality_id
   and b.booking_date = $3
   and b.status not in ('cancelled', 'discontinued', 'voided')
   and b.uses_special_quota = false
   and b.exam_type_id = emqri.exam_type_id
   and ($5::bigint is null or b.id <> $5::bigint)
  where emqr.policy_version_id = $1
    and emqr.modality_id = $2
    and emqr.id = any($4::bigint[])
  group by emqr.id
`;

export async function getExamMixConsumedCountsByRule(
  client: PoolClient,
  params: {
    policyVersionId: number;
    modalityId: number;
    bookingDate: string;
    ruleIds: number[];
    excludeBookingId?: number | null;
  }
): Promise<Record<number, number>> {
  if (params.ruleIds.length === 0) return {};
  const result = await client.query<{ ruleId: number; consumed: number }>(
    GET_EXAM_MIX_CONSUMED_BY_RULES_SQL,
    [params.policyVersionId, params.modalityId, params.bookingDate, params.ruleIds, params.excludeBookingId ?? null]
  );
  const out: Record<number, number> = {};
  for (const row of result.rows) {
    out[Number(row.ruleId)] = Number(row.consumed ?? 0);
  }
  for (const ruleId of params.ruleIds) {
    if (out[ruleId] == null) out[ruleId] = 0;
  }
  return out;
}
