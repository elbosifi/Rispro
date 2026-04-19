import { Router, Request, Response } from "express";
import { pool } from "../../../../db/pool.js";
import { requireAuth } from "../../../../middleware/auth.js";
import { asyncRoute } from "../../../../utils/async-route.js";
import { createBooking } from "../../booking/services/create-booking.service.js";
import { scheduleBookingWorklistSync } from "../../../../services/dicom-service.js";
import type { AuthenticatedUserContext } from "../../../../types/http.js";

const router = Router();
router.use(requireAuth);

interface AuthedRequest extends Request {
  user?: AuthenticatedUserContext;
}

function parseStatuses(input: unknown): string[] {
  if (Array.isArray(input)) return input.map((v) => String(v)).filter(Boolean);
  if (typeof input === "string" && input.trim()) return [input.trim()];
  return [];
}

function parseBookingIdFromScan(scanValue: string): number | null {
  const trimmed = scanValue.trim();
  const v2Match = trimmed.match(/^V2-(\d+)$/i);
  if (v2Match) return Number(v2Match[1]);
  const n = Number(trimmed);
  return Number.isInteger(n) && n > 0 ? n : null;
}

router.get(
  "/appointments",
  asyncRoute(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const date = typeof query.date === "string" ? query.date : "";
    const dateFrom = typeof query.dateFrom === "string" ? query.dateFrom : "";
    const dateTo = typeof query.dateTo === "string" ? query.dateTo : "";
    const modalityId = typeof query.modalityId === "string" ? Number(query.modalityId) : null;
    const patientId = typeof query.patientId === "string" ? Number(query.patientId) : null;
    const q = typeof query.q === "string" ? query.q.trim() : "";

    const status = parseStatuses(query["status[]"] ?? query.status);

    const params: unknown[] = [];
    const where: string[] = [];

    if (date) {
      params.push(date);
      where.push(`b.booking_date = $${params.length}::date`);
    } else {
      if (dateFrom) {
        params.push(dateFrom);
        where.push(`b.booking_date >= $${params.length}::date`);
      }
      if (dateTo) {
        params.push(dateTo);
        where.push(`b.booking_date <= $${params.length}::date`);
      }
    }

    if (modalityId && Number.isFinite(modalityId)) {
      params.push(modalityId);
      where.push(`b.modality_id = $${params.length}`);
    }

    if (patientId && Number.isFinite(patientId)) {
      params.push(patientId);
      where.push(`b.patient_id = $${params.length}`);
    }

    if (status.length > 0) {
      params.push(status);
      where.push(`b.status = any($${params.length}::text[])`);
    }

    if (q) {
      params.push(`%${q.replace(/%/g, "").replace(/_/g, "")}%`);
      where.push(`(
        ('V2-' || b.id::text) ilike $${params.length}
        or p.arabic_full_name ilike $${params.length}
        or coalesce(p.english_full_name, '') ilike $${params.length}
        or coalesce(p.national_id, '') ilike $${params.length}
        or coalesce(p.mrn, '') ilike $${params.length}
      )`);
    }

    const whereClause = where.length > 0 ? `where ${where.join(" and ")}` : "";

    const sql = `
      with filtered as (
        select
          b.id,
          b.patient_id,
          b.modality_id,
          b.exam_type_id,
          b.reporting_priority_id,
          ('V2-' || b.id::text) as accession_number,
          b.booking_date::text as appointment_date,
          row_number() over (partition by b.booking_date order by b.created_at asc, b.id asc)::int as daily_sequence,
          b.status,
          b.is_walk_in,
          b.notes,
          b.created_at,
          b.updated_at,
          p.arabic_full_name,
          p.english_full_name,
          p.national_id,
          p.mrn,
          p.age_years,
          p.demographics_estimated,
          p.sex,
          p.phone_1,
          m.name_ar as modality_name_ar,
          m.name_en as modality_name_en,
          m.code as modality_code,
          m.general_instruction_ar as modality_general_instruction_ar,
          m.general_instruction_en as modality_general_instruction_en,
          et.name_ar as exam_name_ar,
          et.name_en as exam_name_en,
          rp.name_ar as priority_name_ar,
          rp.name_en as priority_name_en,
          null::int as modality_slot_number
        from appointments_v2.bookings b
        join patients p on p.id = b.patient_id
        join modalities m on m.id = b.modality_id
        left join exam_types et on et.id = b.exam_type_id
        left join reporting_priorities rp on rp.id = b.reporting_priority_id
        ${whereClause}
      )
      select *
      from filtered
      order by appointment_date desc, daily_sequence desc, id desc
    `;

    const result = await pool.query(sql, params);
    res.json({ appointments: result.rows });
  })
);

router.get(
  "/appointments/:id",
  asyncRoute(async (req: Request, res: Response) => {
    const bookingId = Number(req.params.id);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      res.status(400).json({ error: "Invalid booking ID" });
      return;
    }

    const result = await pool.query(
      `
        select
          b.id,
          b.patient_id,
          b.modality_id,
          b.exam_type_id,
          b.reporting_priority_id,
          ('V2-' || b.id::text) as accession_number,
          b.booking_date::text as appointment_date,
          (
            select count(*)::int
            from appointments_v2.bookings seq
            where seq.booking_date = b.booking_date
              and seq.id <= b.id
          ) as daily_sequence,
          b.status,
          b.is_walk_in,
          b.notes,
          b.created_at,
          b.updated_at,
          p.arabic_full_name,
          p.english_full_name,
          p.national_id,
          p.mrn,
          p.age_years,
          p.demographics_estimated,
          p.sex,
          p.phone_1,
          m.name_ar as modality_name_ar,
          m.name_en as modality_name_en,
          m.code as modality_code,
          m.general_instruction_ar as modality_general_instruction_ar,
          m.general_instruction_en as modality_general_instruction_en,
          et.name_ar as exam_name_ar,
          et.name_en as exam_name_en,
          rp.name_ar as priority_name_ar,
          rp.name_en as priority_name_en,
          null::int as modality_slot_number
        from appointments_v2.bookings b
        join patients p on p.id = b.patient_id
        join modalities m on m.id = b.modality_id
        left join exam_types et on et.id = b.exam_type_id
        left join reporting_priorities rp on rp.id = b.reporting_priority_id
        where b.id = $1
        limit 1
      `,
      [bookingId]
    );

    const appointment = result.rows[0];
    if (!appointment) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }

    res.json({ appointment });
  })
);

router.get(
  "/statistics",
  asyncRoute(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const date = typeof query.date === "string" ? query.date : "";
    const modalityId = typeof query.modalityId === "string" ? Number(query.modalityId) : null;

    const params: unknown[] = [];
    const where: string[] = [];

    if (date) {
      params.push(date);
      where.push(`b.booking_date = $${params.length}::date`);
    }
    if (modalityId && Number.isFinite(modalityId)) {
      params.push(modalityId);
      where.push(`b.modality_id = $${params.length}`);
    }

    const whereClause = where.length > 0 ? `where ${where.join(" and ")}` : "";

    const [summary, statusBreakdown, modalityBreakdown, dailyBreakdown] = await Promise.all([
      pool.query(
        `
          select
            count(*)::int as total_appointments,
            count(distinct b.patient_id)::int as unique_patients,
            count(distinct b.modality_id)::int as unique_modalities,
            count(*) filter (where b.status = 'scheduled')::int as scheduled_count,
            count(*) filter (where b.status in ('arrived', 'waiting'))::int as in_queue_count,
            count(*) filter (where b.status = 'completed')::int as completed_count,
            count(*) filter (where b.status = 'no-show')::int as no_show_count,
            count(*) filter (where b.status = 'cancelled')::int as cancelled_count,
            count(*) filter (where b.is_walk_in = true)::int as walk_in_count
          from appointments_v2.bookings b
          ${whereClause}
        `,
        params
      ),
      pool.query(
        `
          select b.status, count(*)::int as total_count
          from appointments_v2.bookings b
          ${whereClause}
          group by b.status
          order by b.status asc
        `,
        params
      ),
      pool.query(
        `
          select
            b.modality_id,
            m.code as modality_code,
            m.name_ar as modality_name_ar,
            m.name_en as modality_name_en,
            count(*)::int as total_count,
            count(*) filter (where b.status = 'scheduled')::int as scheduled_count,
            count(*) filter (where b.status in ('arrived', 'waiting'))::int as in_queue_count,
            count(*) filter (where b.status = 'completed')::int as completed_count,
            count(*) filter (where b.status = 'no-show')::int as no_show_count,
            count(*) filter (where b.status = 'cancelled')::int as cancelled_count
          from appointments_v2.bookings b
          join modalities m on m.id = b.modality_id
          ${whereClause}
          group by b.modality_id, m.code, m.name_ar, m.name_en
          order by total_count desc, modality_name_en asc
        `,
        params
      ),
      pool.query(
        `
          select
            b.booking_date::text as appointment_date,
            count(*)::int as total_count,
            count(*) filter (where b.status = 'completed')::int as completed_count,
            count(*) filter (where b.status = 'cancelled')::int as cancelled_count,
            count(*) filter (where b.status = 'no-show')::int as no_show_count
          from appointments_v2.bookings b
          ${whereClause}
          group by b.booking_date
          order by b.booking_date desc
          limit 31
        `,
        params
      ),
    ]);

    const summaryRow = summary.rows[0] ?? {
      total_appointments: 0,
      unique_patients: 0,
      unique_modalities: 0,
      scheduled_count: 0,
      in_queue_count: 0,
      completed_count: 0,
      no_show_count: 0,
      cancelled_count: 0,
      walk_in_count: 0,
    };

    res.json({
      summary: {
        totalAppointments: summaryRow.total_appointments,
        uniquePatients: summaryRow.unique_patients,
        uniqueModalities: summaryRow.unique_modalities,
        scheduledCount: summaryRow.scheduled_count,
        inQueueCount: summaryRow.in_queue_count,
        completedCount: summaryRow.completed_count,
        noShowCount: summaryRow.no_show_count,
        cancelledCount: summaryRow.cancelled_count,
        walkInCount: summaryRow.walk_in_count,
      },
      statusBreakdown: statusBreakdown.rows.map((r) => ({ status: r.status, count: r.total_count })),
      modalityBreakdown: modalityBreakdown.rows.map((r) => ({
        modalityId: r.modality_id,
        modalityCode: r.modality_code,
        modalityNameEn: r.modality_name_en,
        modalityNameAr: r.modality_name_ar,
        totalCount: r.total_count,
        scheduledCount: r.scheduled_count,
        inQueueCount: r.in_queue_count,
        completedCount: r.completed_count,
        noShowCount: r.no_show_count,
        cancelledCount: r.cancelled_count,
      })),
      dailyBreakdown: dailyBreakdown.rows.map((r) => ({
        appointmentDate: r.appointment_date,
        totalCount: r.total_count,
        completedCount: r.completed_count,
        cancelledCount: r.cancelled_count,
        noShowCount: r.no_show_count,
      })),
    });
  })
);

router.get(
  "/queue",
  asyncRoute(async (_req: Request, res: Response) => {
    const todayResult = await pool.query(`select current_date::text as today`);
    const today = String(todayResult.rows[0]?.today ?? "");

    const [entries, summary] = await Promise.all([
      pool.query(
        `
          select
            row_number() over (order by b.created_at asc, b.id asc)::int as queue_number,
            b.id,
            b.booking_date::text as queue_date,
            case when b.status = 'arrived' then 'called' else 'waiting' end as queue_status,
            case when b.status in ('arrived', 'waiting') then b.updated_at else null end as scanned_at,
            b.id as appointment_id,
            ('V2-' || b.id::text) as accession_number,
            b.status as appointment_status,
            b.is_walk_in,
            b.notes,
            p.id as patient_id,
            p.arabic_full_name,
            p.english_full_name,
            p.phone_1,
            p.national_id,
            m.name_ar as modality_name_ar,
            m.name_en as modality_name_en,
            et.name_ar as exam_name_ar,
            et.name_en as exam_name_en
          from appointments_v2.bookings b
          join patients p on p.id = b.patient_id
          join modalities m on m.id = b.modality_id
          left join exam_types et on et.id = b.exam_type_id
          where b.booking_date = $1::date
            and b.status in ('scheduled', 'arrived', 'waiting')
          order by b.created_at asc, b.id asc
        `,
        [today]
      ),
      pool.query(
        `
          select
            count(*)::int as total_appointments,
            count(*) filter (where status = 'scheduled')::int as scheduled_count,
            count(*) filter (where status in ('arrived', 'waiting'))::int as waiting_count,
            count(*) filter (where status = 'no-show')::int as no_show_count,
            count(*) filter (where status = 'arrived')::int as arrived_count
          from appointments_v2.bookings
          where booking_date = $1::date
        `,
        [today]
      ),
    ]);

    const summaryRow = summary.rows[0] ?? {
      total_appointments: 0,
      scheduled_count: 0,
      waiting_count: 0,
      no_show_count: 0,
      arrived_count: 0,
    };

    res.json({
      queue_date: today,
      review_time: "17:00",
      review_active: true,
      summary: summaryRow,
      queue_entries: entries.rows,
      no_show_candidates: entries.rows
        .filter((r) => r.appointment_status === "scheduled")
        .map((r) => ({
          appointment_id: r.appointment_id,
          accession_number: r.accession_number,
          appointment_date: today,
          notes: r.notes,
          patient_id: r.patient_id,
          arabic_full_name: r.arabic_full_name,
          english_full_name: r.english_full_name,
          phone_1: r.phone_1,
          modality_name_ar: r.modality_name_ar,
          modality_name_en: r.modality_name_en,
        })),
    });
  })
);

router.post(
  "/queue/scan",
  asyncRoute(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const scanValue = String(body.scanValue ?? "").trim();
    const bookingId = parseBookingIdFromScan(scanValue);
    if (!bookingId) {
      res.status(400).json({ error: "Invalid scan value. Use V2-<bookingId> or booking ID." });
      return;
    }

    const result = await pool.query(
      `
        update appointments_v2.bookings
        set status = 'arrived', updated_at = now(), updated_by_user_id = $2
        where id = $1 and status in ('scheduled', 'waiting')
        returning id
      `,
      [bookingId, Number((req as AuthedRequest).user?.sub ?? 0)]
    );

    if (!result.rowCount) {
      res.status(409).json({ error: "Booking is not eligible for scan/arrival." });
      return;
    }

    scheduleBookingWorklistSync(bookingId);
    res.json({ ok: true, bookingId });
  })
);

router.post(
  "/queue/walk-in",
  asyncRoute(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patientId = Number(body.patientId);
    const modalityId = Number(body.modalityId);
    const bookingDate = String(body.appointmentDate || "");

    if (!Number.isInteger(patientId) || !Number.isInteger(modalityId) || !bookingDate) {
      res.status(400).json({ error: "patientId, modalityId, and appointmentDate are required" });
      return;
    }

    const userId = Number((req as AuthedRequest).user?.sub ?? 0);
    const created = await createBooking(
      {
        patientId,
        modalityId,
        examTypeId: null,
        reportingPriorityId: null,
        bookingDate,
        bookingTime: null,
        caseCategory: "non_oncology",
        notes: null,
        isWalkIn: true,
      },
      userId,
      "default"
    );

    res.status(201).json({
      booking: created.booking,
      decision: created.decisionSnapshot,
      wasOverride: created.wasOverride,
    });
  })
);

router.post(
  "/appointments/:id/no-show",
  asyncRoute(async (req: Request, res: Response) => {
    const bookingId = Number(req.params.id);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      res.status(400).json({ error: "Invalid booking ID" });
      return;
    }

    const result = await pool.query(
      `
        update appointments_v2.bookings
        set status = 'no-show', updated_at = now(), updated_by_user_id = $2
        where id = $1 and status in ('scheduled', 'arrived', 'waiting')
        returning id
      `,
      [bookingId, Number((req as AuthedRequest).user?.sub ?? 0)]
    );

    if (!result.rowCount) {
      res.status(409).json({ error: "Booking cannot be marked no-show in current status." });
      return;
    }

    scheduleBookingWorklistSync(bookingId);
    res.json({ ok: true });
  })
);

router.get(
  "/modality/worklist",
  asyncRoute(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const scope = String(query.scope || "day");
    const modalityId = Number(query.modalityId);
    const date = String(query.date || "");

    if (!Number.isInteger(modalityId) || modalityId <= 0) {
      res.status(400).json({ error: "modalityId is required" });
      return;
    }

    const params: unknown[] = [modalityId];
    let dateClause = "";
    if (scope !== "all") {
      params.push(date);
      dateClause = `and b.booking_date = $${params.length}::date`;
    }

    const sql = `
      select
        b.id,
        b.patient_id,
        b.modality_id,
        b.exam_type_id,
        b.reporting_priority_id,
        ('V2-' || b.id::text) as accession_number,
        b.booking_date::text as appointment_date,
        row_number() over (partition by b.booking_date, b.modality_id order by b.created_at asc, b.id asc)::int as daily_sequence,
        b.status,
        b.is_walk_in,
        b.notes,
        b.created_at,
        b.updated_at,
        p.arabic_full_name,
        p.english_full_name,
        p.national_id,
        p.mrn,
        p.age_years,
        p.demographics_estimated,
        p.sex,
        p.phone_1,
        m.name_ar as modality_name_ar,
        m.name_en as modality_name_en,
        m.code as modality_code,
        m.general_instruction_ar as modality_general_instruction_ar,
        m.general_instruction_en as modality_general_instruction_en,
        et.name_ar as exam_name_ar,
        et.name_en as exam_name_en,
        rp.name_ar as priority_name_ar,
        rp.name_en as priority_name_en,
        row_number() over (partition by b.booking_date, b.modality_id order by b.created_at asc, b.id asc)::int as modality_slot_number
      from appointments_v2.bookings b
      join patients p on p.id = b.patient_id
      join modalities m on m.id = b.modality_id
      left join exam_types et on et.id = b.exam_type_id
      left join reporting_priorities rp on rp.id = b.reporting_priority_id
      where b.modality_id = $1
      ${dateClause}
      order by b.booking_date desc, modality_slot_number asc
      limit 300
    `;

    const result = await pool.query(sql, params);
    res.json({ appointments: result.rows });
  })
);

router.post(
  "/appointments/:id/complete",
  asyncRoute(async (req: Request, res: Response) => {
    const bookingId = Number(req.params.id);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      res.status(400).json({ error: "Invalid booking ID" });
      return;
    }

    const result = await pool.query(
      `
        update appointments_v2.bookings
        set status = 'completed', updated_at = now(), updated_by_user_id = $2
        where id = $1 and status in ('arrived', 'waiting')
        returning id
      `,
      [bookingId, Number((req as AuthedRequest).user?.sub ?? 0)]
    );

    if (!result.rowCount) {
      res.status(409).json({ error: "Booking cannot be completed in current status." });
      return;
    }

    scheduleBookingWorklistSync(bookingId);
    res.json({ ok: true });
  })
);

export { router as readV2Router };
