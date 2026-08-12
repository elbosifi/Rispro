import type { Pool, PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { PROTOCOLING_MODALITY_SQL } from "./protocoling-modality.js";

export const MWL_POLICY_CATEGORY = "mwl_policy";
export const REQUIRE_PROTOCOL_BEFORE_MWL_KEY = "require_protocol_before_mwl_for_protocoling_modalities";

export type MwlProtocolHoldReason = "waiting_for_protocol" | null;

export interface MwlEligibility {
  bookingId: number;
  bookingExists: boolean;
  bookingStatus: string | null;
  protocolingModalityApplies: boolean;
  protocolRequirementEnabled: boolean;
  activeProtocolAssignmentExists: boolean;
  protocolGateSatisfied: boolean;
  holdReason: MwlProtocolHoldReason;
}

type MwlEligibilityRow = {
  booking_id: number;
  booking_status: string;
  modality_code: string | null;
  protocol_requirement_enabled: boolean;
  active_protocol_assignment_exists: boolean;
};

function mapMwlEligibilityRow(row: MwlEligibilityRow): MwlEligibility {
  return resolveMwlProtocolGate({
    bookingId: Number(row.booking_id),
    bookingStatus: row.booking_status,
    protocolingModalityApplies: row.modality_code === "CT" || row.modality_code === "MRI",
    protocolRequirementEnabled: Boolean(row.protocol_requirement_enabled),
    activeProtocolAssignmentExists: Boolean(row.active_protocol_assignment_exists),
  });
}

export function resolveMwlProtocolGate(input: {
  bookingId: number;
  bookingStatus: string;
  protocolingModalityApplies: boolean;
  protocolRequirementEnabled: boolean;
  activeProtocolAssignmentExists: boolean;
}): MwlEligibility {
  const protocolGateSatisfied = !input.protocolRequirementEnabled
    || !input.protocolingModalityApplies
    || input.activeProtocolAssignmentExists;
  return {
    ...input,
    bookingExists: true,
    protocolGateSatisfied,
    holdReason: protocolGateSatisfied ? null : "waiting_for_protocol",
  };
}

export async function resolveMwlEligibilityForBooking(
  bookingId: number,
  db: Pool | PoolClient = pool
): Promise<MwlEligibility> {
  const { rows } = await db.query<MwlEligibilityRow>(
    `
      select
        b.id as booking_id,
        b.status as booking_status,
        protocoling_modality.modality_code,
        coalesce((
          select lower(nullif(trim(setting.setting_value ->> 'value'), '')) in ('enabled', 'true', '1', 'yes', 'on')
          from system_settings setting
          where setting.category = $2
            and setting.setting_key = $3
          limit 1
        ), false) as protocol_requirement_enabled,
        exists (
          select 1
          from appointment_protocol_assignments assignment
          where assignment.appointment_id = b.id
            and assignment.status <> 'CANCELLED'
        ) as active_protocol_assignment_exists
      from appointments_v2.bookings b
      join modalities m on m.id = b.modality_id
      cross join lateral (
        select ${PROTOCOLING_MODALITY_SQL} as modality_code
      ) protocoling_modality
      where b.id = $1::bigint
      limit 1
    `,
    [bookingId, MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY]
  );
  const row = rows[0];
  if (!row) {
    return {
      bookingId,
      bookingExists: false,
      bookingStatus: null,
      protocolingModalityApplies: false,
      protocolRequirementEnabled: false,
      activeProtocolAssignmentExists: false,
      protocolGateSatisfied: false,
      holdReason: null,
    };
  }
  return mapMwlEligibilityRow(row);
}

export async function resolveMwlEligibilityForBookings(
  bookingIds: number[],
  db: Pool | PoolClient = pool
): Promise<Map<number, MwlEligibility>> {
  if (bookingIds.length === 0) return new Map();
  const { rows } = await db.query<MwlEligibilityRow>(
    `
      select
        b.id as booking_id,
        b.status as booking_status,
        protocoling_modality.modality_code,
        coalesce((
          select lower(nullif(trim(setting.setting_value ->> 'value'), '')) in ('enabled', 'true', '1', 'yes', 'on')
          from system_settings setting
          where setting.category = $2 and setting.setting_key = $3
          limit 1
        ), false) as protocol_requirement_enabled,
        exists (
          select 1 from appointment_protocol_assignments assignment
          where assignment.appointment_id = b.id and assignment.status <> 'CANCELLED'
        ) as active_protocol_assignment_exists
      from appointments_v2.bookings b
      join modalities m on m.id = b.modality_id
      cross join lateral (select ${PROTOCOLING_MODALITY_SQL} as modality_code) protocoling_modality
      where b.id = any($1::bigint[])
    `,
    [bookingIds, MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY]
  );
  return new Map(rows.map((row) => {
    const eligibility = mapMwlEligibilityRow(row);
    return [eligibility.bookingId, eligibility];
  }));
}

export async function isMwlProtocolRequirementEnabled(db: Pool | PoolClient = pool): Promise<boolean> {
  const { rows } = await db.query<{ enabled: boolean }>(
    `
      select coalesce((
        select lower(nullif(trim(setting_value ->> 'value'), '')) in ('enabled', 'true', '1', 'yes', 'on')
        from system_settings
        where category = $1 and setting_key = $2
        limit 1
      ), false) as enabled
    `,
    [MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY]
  );
  return Boolean(rows[0]?.enabled);
}

export async function listActiveBookingsAffectedByMwlProtocolPolicy(
  db: Pool | PoolClient = pool
): Promise<number[]> {
  const { rows } = await db.query<{ booking_id: number }>(
    `
      select b.id as booking_id
      from appointments_v2.bookings b
      join modalities m on m.id = b.modality_id
      cross join lateral (
        select ${PROTOCOLING_MODALITY_SQL} as modality_code
      ) protocoling_modality
      where b.status in ('scheduled', 'arrived', 'waiting')
        and protocoling_modality.modality_code in ('CT', 'MRI')
        and not exists (
          select 1
          from appointment_protocol_assignments assignment
          where assignment.appointment_id = b.id
            and assignment.status <> 'CANCELLED'
        )
      order by b.booking_date asc, b.id asc
    `
  );
  return rows.map((row) => Number(row.booking_id));
}
