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
    and status <> 'cancelled'
`;

export async function getBookedCountForDate(
  client: PoolClient,
  modalityId: number,
  date: string,
  caseCategory: string
): Promise<number> {
  const result = await client.query<{ count: number }>(GET_BOOKED_COUNT_SQL, [
    modalityId,
    date,
    caseCategory,
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
    and status <> 'cancelled'
`;

export async function getBookedCountsByCategoryForDate(
  client: PoolClient,
  modalityId: number,
  date: string
): Promise<BookedCountsByCategory> {
  const result = await client.query<{
    total: number;
    oncology: number;
    non_oncology: number;
  }>(GET_BOOKED_COUNTS_BY_CATEGORY_SQL, [modalityId, date]);

  const row = result.rows[0];
  return {
    total: row?.total ?? 0,
    oncology: row?.oncology ?? 0,
    nonOncology: row?.non_oncology ?? 0,
  };
}

const GET_SPECIAL_QUOTA_BOOKED_COUNT_SQL = `
  select count(*)::int as count
  from appointments_v2.bookings
  where modality_id = $1
    and booking_date = $2
    and exam_type_id = $3
    and status <> 'cancelled'
    and uses_special_quota = true
`;

export async function getSpecialQuotaBookedCount(
  client: PoolClient,
  params: {
    modalityId: number;
    bookingDate: string;
    examTypeId: number;
  }
): Promise<number> {
  const result = await client.query<{ count: number }>(GET_SPECIAL_QUOTA_BOOKED_COUNT_SQL, [
    params.modalityId,
    params.bookingDate,
    params.examTypeId,
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
   and b.status <> 'cancelled'
   and b.uses_special_quota = false
   and b.exam_type_id = emqri.exam_type_id
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
  }
): Promise<Record<number, number>> {
  if (params.ruleIds.length === 0) return {};
  const result = await client.query<{ ruleId: number; consumed: number }>(
    GET_EXAM_MIX_CONSUMED_BY_RULES_SQL,
    [params.policyVersionId, params.modalityId, params.bookingDate, params.ruleIds]
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
