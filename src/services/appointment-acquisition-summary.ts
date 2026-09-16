import type { Pool, PoolClient } from "pg";
import { pool } from "../db/pool.js";

export type AppointmentAcquisitionSummary = {
  source: "mpps";
  sourceAeTitle: string;
  dicomDeviceId: number | null;
  equipmentId: number | null;
  equipmentName: string | null;
  equipmentVendor: string | null;
  equipmentModel: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  performedStatus: "IN PROGRESS" | "COMPLETED" | "DISCONTINUED";
  discontinuationReason: string | null;
};

type Queryable = Pick<Pool | PoolClient, "query">;

type AcquisitionSummaryRow = {
  appointment_id: number | string;
  source_ae_title: string;
  performed_status: "IN PROGRESS" | "COMPLETED" | "DISCONTINUED";
  discontinuation_reason: string | null;
  started_at: string | Date | null;
  ended_at: string | Date | null;
  duration_seconds: number | string | null;
  dicom_device_id: number | string | null;
  equipment_id: number | string | null;
  equipment_name: string | null;
  equipment_vendor: string | null;
  equipment_model: string | null;
};

function asIso(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function nullableNumber(value: number | string | null): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Loads one authoritative MPPS acquisition session per appointment.  The
 * earliest accepted N-CREATE is deliberately retained as primary: lifecycle
 * events rejected by the MPPS service are `ignored` and cannot replace it.
 */
export async function loadAppointmentAcquisitionSummaries(
  appointmentIds: readonly number[],
  db: Queryable = pool
): Promise<Map<number, AppointmentAcquisitionSummary>> {
  const ids = [...new Set(appointmentIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return new Map();

  const result = await db.query<AcquisitionSummaryRow>(
    `
      with accepted_starts as (
        select
          start_event.id,
          start_event.correlated_appointment_id as appointment_id,
          start_event.mpps_instance_uid,
          start_event.source_ae_title,
          start_event.performed_start_date,
          start_event.performed_start_time,
          row_number() over (
            partition by start_event.correlated_appointment_id
            order by start_event.id asc
          ) as primary_rank
        from mpps_event_log start_event
        where start_event.correlated_appointment_id = any($1::bigint[])
          and start_event.correlation_status = 'matched'
          and start_event.processing_status = 'processed'
          and start_event.event_type = 'n-create'
          and start_event.performed_step_status = 'IN PROGRESS'
          and nullif(trim(start_event.mpps_instance_uid), '') is not null
      ), primary_sessions as (
        select * from accepted_starts where primary_rank = 1
      ), paired as (
        select
          start_event.*,
          terminal.performed_step_status as performed_status,
          terminal.performed_end_date,
          terminal.performed_end_time,
          terminal.discontinuation_reason
        from primary_sessions start_event
        left join lateral (
          select terminal_event.*
          from mpps_event_log terminal_event
          where terminal_event.correlated_appointment_id = start_event.appointment_id
            and terminal_event.correlation_status = 'matched'
            and terminal_event.processing_status = 'processed'
            and terminal_event.event_type = 'n-set'
            and terminal_event.mpps_instance_uid = start_event.mpps_instance_uid
            and terminal_event.performed_step_status in ('COMPLETED', 'DISCONTINUED')
          order by terminal_event.id asc
          limit 1
        ) terminal on true
      ), timestamps as (
        select
          paired.*,
          case
            when performed_start_date ~ '^\\d{8}$'
              and performed_start_time ~ '^\\d{2}(\\d{2})?(\\d{2})?(\\.\\d+)?$'
            then make_timestamp(
              substring(performed_start_date from 1 for 4)::int,
              substring(performed_start_date from 5 for 2)::int,
              substring(performed_start_date from 7 for 2)::int,
              substring(performed_start_time from 1 for 2)::int,
              coalesce(nullif(substring(performed_start_time from 3 for 2), '')::int, 0),
              coalesce(nullif(substring(performed_start_time from 5), '')::double precision, 0)
            ) at time zone 'Africa/Tripoli'
            else null
          end as started_at,
          case
            when performed_end_date ~ '^\\d{8}$'
              and performed_end_time ~ '^\\d{2}(\\d{2})?(\\d{2})?(\\.\\d+)?$'
            then make_timestamp(
              substring(performed_end_date from 1 for 4)::int,
              substring(performed_end_date from 5 for 2)::int,
              substring(performed_end_date from 7 for 2)::int,
              substring(performed_end_time from 1 for 2)::int,
              coalesce(nullif(substring(performed_end_time from 3 for 2), '')::int, 0),
              coalesce(nullif(substring(performed_end_time from 5), '')::double precision, 0)
            ) at time zone 'Africa/Tripoli'
            else null
          end as ended_at
        from paired
      )
      select
        session.appointment_id,
        session.source_ae_title,
        coalesce(session.performed_status, 'IN PROGRESS') as performed_status,
        case when session.performed_status = 'DISCONTINUED' then session.discontinuation_reason else null end as discontinuation_reason,
        session.started_at,
        session.ended_at,
        case
          when session.started_at is not null and session.ended_at is not null and session.ended_at >= session.started_at
          then extract(epoch from session.ended_at - session.started_at)::int
          else null
        end as duration_seconds,
        device.id as dicom_device_id,
        equipment.id as equipment_id,
        equipment.name as equipment_name,
        equipment.vendor as equipment_vendor,
        equipment.model as equipment_model
      from timestamps session
      left join lateral (
        select device.*
        from dicom_devices device
        where lower(trim(session.source_ae_title)) in (lower(trim(device.modality_ae_title)), lower(trim(device.scheduled_station_ae_title)))
        order by device.id asc
        limit 1
      ) device on true
      left join equipment
        on equipment.dicom_device_id = device.id
    `,
    [ids]
  );

  return new Map(result.rows.map((row) => [Number(row.appointment_id), {
    source: "mpps" as const,
    sourceAeTitle: row.source_ae_title,
    dicomDeviceId: nullableNumber(row.dicom_device_id),
    equipmentId: nullableNumber(row.equipment_id),
    equipmentName: row.equipment_name,
    equipmentVendor: row.equipment_vendor,
    equipmentModel: row.equipment_model,
    startedAt: asIso(row.started_at),
    endedAt: asIso(row.ended_at),
    durationSeconds: nullableNumber(row.duration_seconds),
    performedStatus: row.performed_status,
    discontinuationReason: row.discontinuation_reason,
  }]));
}
