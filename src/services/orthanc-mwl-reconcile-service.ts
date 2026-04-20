import { pool } from "../db/pool.js";
import { enqueueOrthancSyncForBooking } from "./mwl-sync-service.js";
import { probeOrthancWorklistApi } from "./orthanc-mwl-adapter.js";
import { createHash } from "crypto";

export interface OrthancMwlReconcileInput {
  dateFrom: string;
  dateTo: string;
  apply?: boolean;
  limit?: number;
}

interface ActiveBookingRow {
  booking_id: number;
  booking_date: string;
  status: string;
}

interface SyncRow {
  booking_id: number;
  sync_status: "pending" | "in_progress" | "synced" | "failed" | "deleted";
  payload_hash: string | null;
  last_synced_at: string | null;
}

interface ExpectedHashRow {
  booking_id: number;
  patient_id: number;
  modality_id: number;
  exam_type_id: number | null;
  reporting_priority_id: number | null;
  booking_date: string;
  booking_time: string | null;
  status: string;
  notes: string | null;
  mrn: string | null;
  national_id: string | null;
  arabic_full_name: string;
  english_full_name: string | null;
  estimated_date_of_birth: string | null;
  sex: string | null;
  modality_code: string;
  modality_name_en: string;
  modality_name_ar: string;
  exam_name_en: string | null;
  exam_name_ar: string | null;
  updated_at: string;
}

export interface OrthancMwlReconcileResult {
  window: { dateFrom: string; dateTo: string };
  apply: boolean;
  orthancProbe: {
    ok: boolean;
    baseUrl: string;
    orthancVersion: string | null;
    worklistsRouteReachable: boolean;
  } | null;
  missing: number[];
  staleExtras: number[];
  payloadMismatches: number[];
  notSynced: number[];
  repaired: {
    enqueuedBookingIds: number[];
    failedBookingIds: Array<{ bookingId: number; error: string }>;
  };
}

function normalizeDateInput(value: string): string {
  const clean = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    throw new Error("dateFrom/dateTo must be ISO dates in YYYY-MM-DD format.");
  }
  return clean;
}

function toSortedUniqueIds(values: Iterable<number>): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

function computeExpectedPayloadHash(row: ExpectedHashRow): string {
  const payload = {
    bookingId: row.booking_id,
    patientId: row.patient_id,
    modalityId: row.modality_id,
    examTypeId: row.exam_type_id,
    reportingPriorityId: row.reporting_priority_id,
    bookingDate: row.booking_date,
    bookingTime: row.booking_time,
    status: row.status,
    notes: row.notes,
    patientMrn: row.mrn,
    patientNationalId: row.national_id,
    patientNameArabic: row.arabic_full_name,
    patientNameEnglish: row.english_full_name,
    patientDob: row.estimated_date_of_birth,
    patientSex: row.sex,
    modalityCode: row.modality_code,
    modalityNameEn: row.modality_name_en,
    modalityNameAr: row.modality_name_ar,
    examNameEn: row.exam_name_en,
    examNameAr: row.exam_name_ar,
    updatedAt: row.updated_at,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function reconcileOrthancMwlProjection(
  input: OrthancMwlReconcileInput
): Promise<OrthancMwlReconcileResult> {
  const dateFrom = normalizeDateInput(input.dateFrom);
  const dateTo = normalizeDateInput(input.dateTo);
  const apply = Boolean(input.apply);
  const limit = Number.isInteger(input.limit) && (input.limit as number) > 0 ? Number(input.limit) : 5000;

  const [activeBookingsResult, syncRowsResult, expectedHashResult, orthancProbe] = await Promise.all([
    pool.query<ActiveBookingRow>(
      `
        select
          b.id as booking_id,
          b.booking_date::text as booking_date,
          b.status
        from appointments_v2.bookings b
        where b.booking_date between $1::date and $2::date
          and b.status in ('scheduled', 'arrived', 'waiting')
        order by b.booking_date asc, b.id asc
        limit $3
      `,
      [dateFrom, dateTo, limit]
    ),
    pool.query<SyncRow>(
      `
        select
          s.booking_id,
          s.sync_status,
          s.payload_hash,
          s.last_synced_at::text as last_synced_at
        from external_mwl_sync s
        join appointments_v2.bookings b on b.id = s.booking_id
        where b.booking_date between $1::date and $2::date
        order by s.booking_id asc
        limit $3
      `,
      [dateFrom, dateTo, limit]
    ),
    pool.query<ExpectedHashRow>(
      `
        select
          b.id as booking_id,
          b.patient_id,
          b.modality_id,
          b.exam_type_id,
          b.reporting_priority_id,
          b.booking_date::text as booking_date,
          b.booking_time::text as booking_time,
          b.status,
          b.notes,
          p.mrn,
          p.national_id,
          p.arabic_full_name,
          p.english_full_name,
          p.estimated_date_of_birth::text as estimated_date_of_birth,
          p.sex,
          m.code as modality_code,
          m.name_en as modality_name_en,
          m.name_ar as modality_name_ar,
          et.name_en as exam_name_en,
          et.name_ar as exam_name_ar,
          b.updated_at::text as updated_at
        from appointments_v2.bookings b
        join patients p on p.id = b.patient_id
        join modalities m on m.id = b.modality_id
        left join exam_types et on et.id = b.exam_type_id
        where b.booking_date between $1::date and $2::date
          and b.status in ('scheduled', 'arrived', 'waiting')
        order by b.booking_date asc, b.id asc
        limit $3
      `,
      [dateFrom, dateTo, limit]
    ),
    probeOrthancWorklistApi().catch(() => null),
  ]);

  const activeIds = toSortedUniqueIds(activeBookingsResult.rows.map((r) => Number(r.booking_id)));
  const activeSet = new Set(activeIds);
  const syncByBookingId = new Map<number, SyncRow>();
  for (const row of syncRowsResult.rows) {
    syncByBookingId.set(Number(row.booking_id), row);
  }
  const expectedHashByBookingId = new Map<number, string>();
  for (const row of expectedHashResult.rows) {
    expectedHashByBookingId.set(Number(row.booking_id), computeExpectedPayloadHash(row));
  }

  const missing: number[] = [];
  const payloadMismatches: number[] = [];
  const notSynced: number[] = [];
  for (const bookingId of activeIds) {
    const sync = syncByBookingId.get(bookingId);
    if (!sync) {
      missing.push(bookingId);
      continue;
    }
    if (sync.sync_status !== "synced") {
      notSynced.push(bookingId);
    }
    const expectedHash = expectedHashByBookingId.get(bookingId);
    if (expectedHash && sync.payload_hash && expectedHash !== sync.payload_hash) {
      payloadMismatches.push(bookingId);
    }
    if (expectedHash && !sync.payload_hash) {
      payloadMismatches.push(bookingId);
    }
  }

  const staleExtras = toSortedUniqueIds(
    syncRowsResult.rows
      .map((r) => Number(r.booking_id))
      .filter((bookingId) => {
        if (activeSet.has(bookingId)) return false;
        const sync = syncByBookingId.get(bookingId);
        return Boolean(sync && sync.sync_status !== "deleted");
      })
  );

  const repairCandidates = toSortedUniqueIds([
    ...missing,
    ...payloadMismatches,
    ...notSynced,
    ...staleExtras,
  ]);

  const repaired = {
    enqueuedBookingIds: [] as number[],
    failedBookingIds: [] as Array<{ bookingId: number; error: string }>,
  };

  if (apply) {
    for (const bookingId of repairCandidates) {
      try {
        const result = await enqueueOrthancSyncForBooking(bookingId);
        if (result.enqueued) {
          repaired.enqueuedBookingIds.push(bookingId);
        }
      } catch (error) {
        repaired.failedBookingIds.push({
          bookingId,
          error: (error as Error).message || "enqueue_failed",
        });
      }
    }
  }

  return {
    window: { dateFrom, dateTo },
    apply,
    orthancProbe: orthancProbe
      ? {
          ok: orthancProbe.ok,
          baseUrl: orthancProbe.baseUrl,
          orthancVersion: orthancProbe.orthancVersion,
          worklistsRouteReachable: orthancProbe.worklistsRouteReachable,
        }
      : null,
    missing: toSortedUniqueIds(missing),
    staleExtras,
    payloadMismatches: toSortedUniqueIds(payloadMismatches),
    notSynced: toSortedUniqueIds(notSynced),
    repaired,
  };
}

export async function getOrthancMwlSyncSummary(): Promise<{
  syncStatus: Array<{ status: string; count: number }>;
  outboxStatus: Array<{ status: string; count: number }>;
}> {
  const [syncStatusResult, outboxStatusResult] = await Promise.all([
    pool.query<{ status: string; count: string }>(
      `
        select sync_status as status, count(*)::text as count
        from external_mwl_sync
        where external_system = 'orthanc'
        group by sync_status
        order by sync_status asc
      `
    ),
    pool.query<{ status: string; count: string }>(
      `
        select status, count(*)::text as count
        from external_mwl_outbox
        where external_system = 'orthanc'
        group by status
        order by status asc
      `
    ),
  ]);

  return {
    syncStatus: syncStatusResult.rows.map((row) => ({ status: row.status, count: Number(row.count) })),
    outboxStatus: outboxStatusResult.rows.map((row) => ({ status: row.status, count: Number(row.count) })),
  };
}
