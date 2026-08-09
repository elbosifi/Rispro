import { Router, Request, Response } from "express";
import { pool } from "../../../../db/pool.js";
import { requireAuth } from "../../../../middleware/auth.js";
import { requireActionPin } from "../../../../middleware/action-pin.js";
import { requirePageAccess } from "../../../../middleware/page-access.js";
import { asyncRoute } from "../../../../utils/async-route.js";
import { createBooking } from "../../booking/services/create-booking.service.js";
import { scheduleBookingWorklistSync } from "../../../../services/dicom-service.js";
import { logAuditEntry } from "../../../../services/audit-service.js";
import { buildWorkbookBuffer } from "../../../../services/workbook-service.js";
import { fetchSonicDicomStudyNotes } from "../../../../services/sonicdicom-report-service.js";
import type { AuthenticatedUserContext } from "../../../../types/http.js";
import { issuePublicCancelToken } from "../../public/utils/public-cancel-token.js";
import { readPatientQrSettings } from "../../public/utils/patient-qr-settings.js";
import { buildPublicAppointmentUrlFromSettings } from "../../public/utils/public-appointment-url-core.js";
import {
  arriveSameDayQueueBookings,
  cleanupActiveQueuePatientRequirementViolations,
  updateBookingStatusManual,
} from "../../booking/services/status-booking.service.js";
import {
  confirmManualNoShow,
  confirmManualNoShowBulk,
  confirmOldNoShowCleanup,
  getNoShowReviewSnapshot,
  getNoShowSettings,
  getTripoliToday,
  runManualOldNoShowCleanup,
} from "../../booking/services/no-show-review.service.js";
import { getModalityProtocolAssignment } from "../../modality/protocol-assignment.service.js";

const router = Router();
router.use(requireAuth);

interface AuthedRequest extends Request {
  user?: AuthenticatedUserContext;
}

type AppointmentReadRow = Record<string, unknown> & {
  id: number | string;
  accession_number?: string | null;
  study_instance_uid?: string | null;
};

const PROTOCOL_ASSIGNMENT_SELECT = `
          protocol_assignment.assignment_id as protocol_assignment_id,
          protocol_assignment.protocol_id as assigned_protocol_id,
          protocol_assignment.protocol_version_id as assigned_protocol_version_id,
          protocol_assignment.protocol_name,
          protocol_assignment.version_number as protocol_version_number,
          protocol_assignment.free_text_protocol as assigned_free_text_protocol,
          protocol_assignment.modality as protocol_assignment_modality,
          protocol_assignment.scanner_id as protocol_scanner_id,
          protocol_assignment.scanner_name as protocol_scanner_name,
          protocol_assignment.scanner_vendor as protocol_scanner_vendor,
          protocol_assignment.assigned_by as protocol_assigned_by,
          protocol_assignment.assigned_at as protocol_assigned_at,
          protocol_assignment.protocol_notes as assigned_protocol_notes,
          protocol_assignment.contrast_notes as assigned_contrast_notes,
          protocol_assignment.status as protocol_assignment_status`;

const PROTOCOL_ASSIGNMENT_JOIN = `
        left join lateral (
          select
            assignment.id as assignment_id,
            assignment.protocol_id,
            assignment.protocol_version_id,
            protocol.name as protocol_name,
            version.version_number,
            assignment.free_text_protocol,
            upper(coalesce(protocol.modality, (select code from modalities where id = b.modality_id))) as modality,
            assignment.scanner_id,
            scanner.name as scanner_name,
            scanner.vendor as scanner_vendor,
            coalesce(doctor.display_name, assigned_user.full_name, assigned_user.username) as assigned_by,
            assignment.assigned_at::text as assigned_at,
            assignment.protocol_notes,
            assignment.contrast_notes,
            assignment.status
          from appointment_protocol_assignments assignment
          left join protocols protocol on protocol.id = assignment.protocol_id
          left join protocol_versions version on version.id = assignment.protocol_version_id
          left join imaging_scanners scanner on scanner.id = assignment.scanner_id
          left join users assigned_user on assigned_user.id = assignment.assigned_by
          left join doctor_portal.doctor_profiles doctor on doctor.user_id = assigned_user.id
          where assignment.appointment_id = b.id
            and assignment.status <> 'CANCELLED'
            and upper(coalesce(protocol.modality, (select code from modalities where id = b.modality_id))) in ('CT', 'MRI')
          order by assignment.updated_at desc, assignment.id desc
          limit 1
        ) protocol_assignment on true`;

function safeBuildPublicAppointmentUrl(
  token: string,
  settings: Awaited<ReturnType<typeof readPatientQrSettings>>,
  context: string
): string | null {
  try {
    return buildPublicAppointmentUrlFromSettings(token, settings);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "unknown_error");
    console.error(
      JSON.stringify({
        type: "appointments_v2_public_appointment_url_generation_failed",
        context,
        message,
      })
    );
    return null;
  }
}

function withEmptySonicDicomStudyNote<T extends AppointmentReadRow>(row: T): T & {
  sonicDicomStudyNote: null;
  sonicDicomStudyNoteCheckedAt: null;
} {
  return {
    ...row,
    sonicDicomStudyNote: null,
    sonicDicomStudyNoteCheckedAt: null,
  };
}

async function attachSonicDicomStudyNotesToAppointments<T extends AppointmentReadRow>(
  rows: T[]
): Promise<Array<T & { sonicDicomStudyNote: string | null; sonicDicomStudyNoteCheckedAt: string | null }>> {
  if (rows.length === 0) return [];
  const withDefaults = rows.map(withEmptySonicDicomStudyNote);
  try {
    const notes = await fetchSonicDicomStudyNotes(
      rows.map((row) => ({
        bookingId: Number(row.id),
        accessionNumber: row.accession_number ?? null,
        studyInstanceUid: row.study_instance_uid ?? null,
      })),
      { useCache: true }
    );
    return withDefaults.map((row) => {
      const note = notes.get(Number(row.id));
      return {
        ...row,
        sonicDicomStudyNote: note?.note ?? null,
        sonicDicomStudyNoteCheckedAt: note?.checkedAt ?? null,
      };
    });
  } catch {
    return rows.map(withEmptySonicDicomStudyNote);
  }
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

function normalizeReportOutputType(value: unknown): "print" | "pdf" | "csv" | "copy" | "xlsx" {
  const clean = String(value || "").trim().toLowerCase();
  if (clean === "pdf" || clean === "csv" || clean === "copy" || clean === "xlsx") return clean;
  return "print";
}

function sanitizeWorkbookRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5000).map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return {};
    const output: Record<string, unknown> = {};
    for (const [key, rawValue] of Object.entries(row as Record<string, unknown>).slice(0, 80)) {
      const cleanKey = String(key || "").trim().slice(0, 80);
      if (!cleanKey) continue;
      if (rawValue == null || typeof rawValue === "string" || typeof rawValue === "number" || typeof rawValue === "boolean") {
        output[cleanKey] = rawValue ?? "";
      } else {
        output[cleanKey] = JSON.stringify(rawValue).slice(0, 500);
      }
    }
    return output;
  });
}

function safeWorkbookName(value: unknown): string {
  return String(value || "report")
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "report";
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseStatisticsIsoDateQuery(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return "";
  const clean = value.trim();
  return isValidIsoDate(clean) ? clean : "";
}

function isoDateDay(value: string): number {
  return Math.floor(new Date(`${value}T00:00:00Z`).getTime() / 86_400_000);
}

router.post(
  "/reports/output-audit",
  asyncRoute(async (req: AuthedRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const outputType = normalizeReportOutputType(body.outputType);
    const rowCount = Math.max(0, Math.min(Number(body.rowCount) || 0, 100_000));

    await logAuditEntry({
      entityType: "report_output",
      actionType: outputType,
      changedByUserId: req.user?.sub ?? null,
      newValues: {
        reportTemplate: String(body.reportTemplate || ""),
        outputType,
        rowCount,
        filters: body.filters ?? {},
        includePhoneNumbers: Boolean(body.includePhoneNumbers),
        includePatientIdentifiers: Boolean(body.includePatientIdentifiers),
      },
    });

    res.json({ ok: true });
  })
);

router.post(
  "/reports/export-xlsx",
  asyncRoute(async (req: AuthedRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rows = sanitizeWorkbookRows(body.rows);
    const reportTemplate = safeWorkbookName(body.reportTemplate);

    await logAuditEntry({
      entityType: "report_output",
      actionType: "xlsx",
      changedByUserId: req.user?.sub ?? null,
      newValues: {
        reportTemplate,
        outputType: "xlsx",
        rowCount: rows.length,
        filters: body.filters ?? {},
        includePhoneNumbers: Boolean(body.includePhoneNumbers),
        includePatientIdentifiers: Boolean(body.includePatientIdentifiers),
      },
    });

    const workbook = await buildWorkbookBuffer([
      {
        name: "Report",
        rows: rows.length ? rows : [{ Message: "No rows matched the selected filters." }],
      },
    ]);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="rispro-${reportTemplate}-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(workbook);
  })
);

router.get(
  "/appointments",
  asyncRoute(async (req: Request, res: Response) => {
    const patientQrSettings = await readPatientQrSettings();
    const query = req.query as Record<string, unknown>;
    const date = typeof query.date === "string" ? query.date : "";
    const dateFrom = typeof query.dateFrom === "string" ? query.dateFrom : "";
    const dateTo = typeof query.dateTo === "string" ? query.dateTo : "";
    const modalityId = typeof query.modalityId === "string" ? Number(query.modalityId) : null;
    const patientId = typeof query.patientId === "string" ? Number(query.patientId) : null;
    const examTypeId = typeof query.examTypeId === "string" ? Number(query.examTypeId) : null;
    const q = typeof query.q === "string" ? query.q.trim() : "";
    const caseCategory = typeof query.caseCategory === "string" ? query.caseCategory.trim() : "";
    const priority = typeof query.priority === "string" ? query.priority.trim() : "";
    const walkIn = typeof query.walkIn === "string" ? query.walkIn.trim() : "";
    const specialQuota = typeof query.specialQuota === "string" ? query.specialQuota.trim() : "";
    const supervisorOverride = typeof query.supervisorOverride === "string" ? query.supervisorOverride.trim() : "";
    const sort = typeof query.sort === "string" ? query.sort.trim() : "";

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

    if (examTypeId && Number.isFinite(examTypeId)) {
      params.push(examTypeId);
      where.push(`b.exam_type_id = $${params.length}`);
    }

    if (caseCategory === "oncology" || caseCategory === "non_oncology") {
      params.push(caseCategory);
      where.push(`b.case_category = $${params.length}`);
    }

    if (priority) {
      params.push(`%${priority.replace(/%/g, "").replace(/_/g, "")}%`);
      where.push(`(rp.name_en ilike $${params.length} or rp.name_ar ilike $${params.length})`);
    }

    if (walkIn === "true" || walkIn === "false") {
      params.push(walkIn === "true");
      where.push(`b.is_walk_in = $${params.length}`);
    }

    if (specialQuota === "true" || specialQuota === "false") {
      params.push(specialQuota === "true");
      where.push(`b.uses_special_quota = $${params.length}`);
    }

    if (supervisorOverride === "true" || supervisorOverride === "false") {
      params.push(supervisorOverride === "true");
      where.push(`(b.capacity_resolution_mode in ('category_override', 'total_capacity_override') or exists (
        select 1 from appointments_v2.override_audit_events oae where oae.booking_id = b.id
      )) = $${params.length}`);
    }

    if (status.length > 0) {
      params.push(status);
      where.push(`b.status = any($${params.length}::text[])`);
    } else {
      where.push(`b.status not in ('cancelled', 'discontinued', 'voided')`);
    }

    if (q) {
      params.push(`%${q.replace(/%/g, "").replace(/_/g, "")}%`);
      where.push(`(
        ('V2-' || lpad(b.id::text, 6, '0')) ilike $${params.length}
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
          b.case_category,
          ('V2-' || lpad(b.id::text, 6, '0')) as accession_number,
          b.booking_date::text as appointment_date,
          b.booking_time::text as booking_time,
          b.requires_report,
          b.study_instance_uid,
          b.uses_special_quota,
          b.capacity_resolution_mode,
          b.special_reason_code,
          b.special_reason_note,
          row_number() over (partition by b.booking_date order by b.created_at asc, b.id asc)::int as daily_sequence,
          b.status,
          b.is_walk_in,
          b.notes,
          b.arrived_at,
          b.waiting_started_at,
          b.completed_at,
          b.created_at,
          b.created_by_user_id,
          created_by_user.full_name as created_by_full_name,
          created_by_user.username as created_by_username,
          b.updated_at,
          p.arabic_full_name,
          p.english_full_name,
          p.national_id,
          p.mrn,
          p.age_years,
          p.demographics_estimated,
          p.sex,
          p.phone_1,
          p.address,
          m.name_ar as modality_name_ar,
          m.name_en as modality_name_en,
          m.code as modality_code,
          m.safety_workflow_type as modality_safety_workflow_type,
          case when screening.result is not null then jsonb_build_object(
            'result', screening.result,
            'implantSite', screening.implant_site,
            'implantDescription', screening.implant_description,
            'previousReviewerNameReported', screening.previous_reviewer_name_reported,
            'screenedByUserId', screening.screened_by_user_id,
            'screenedAt', screening.screened_at
          ) else null end as mri_primary_screening,
          m.general_instruction_ar as modality_general_instruction_ar,
          m.general_instruction_en as modality_general_instruction_en,
          et.name_ar as exam_name_ar,
          et.name_en as exam_name_en,
          et.specific_instruction_ar as exam_specific_instruction_ar,
          et.specific_instruction_en as exam_specific_instruction_en,
          rp.name_ar as priority_name_ar,
          rp.name_en as priority_name_en,
          ${PROTOCOL_ASSIGNMENT_SELECT},
          (
            select count(*)::int
            from patient_web_push_booking_subscriptions bs
            join patient_web_push_subscriptions s on s.id = bs.subscription_id
            where bs.booking_id = b.id
              and bs.enabled = true
              and s.enabled = true
          ) as patient_web_push_subscription_count,
          null::int as modality_slot_number
        from appointments_v2.bookings b
        join patients p on p.id = b.patient_id
        join modalities m on m.id = b.modality_id
        left join appointments_v2.mri_primary_screenings screening on screening.booking_id = b.id
        left join exam_types et on et.id = b.exam_type_id
        left join reporting_priorities rp on rp.id = b.reporting_priority_id
        left join users created_by_user on created_by_user.id = b.created_by_user_id
        ${PROTOCOL_ASSIGNMENT_JOIN}
        ${whereClause}
      )
      select *
      from filtered
      order by ${
        sort === "time-asc"
          ? "appointment_date asc, booking_time asc nulls last, daily_sequence asc, id asc"
          : sort === "patient-asc"
            ? "arabic_full_name asc, english_full_name asc, appointment_date asc, id asc"
            : "appointment_date desc, daily_sequence desc, id desc"
      }
    `;

    const result = await pool.query(sql, params);
    const rowsWithNotes = await attachSonicDicomStudyNotesToAppointments(result.rows);
    const appointments = await Promise.all(rowsWithNotes.map(async (row) => {
      const publicCancelToken =
        patientQrSettings.enabled && patientQrSettings.printQrOnAppointmentSlip
          ? await issuePublicCancelToken(Number(row.id))
          : null;
      return {
        ...row,
        public_cancel_token: publicCancelToken,
        public_appointment_url: publicCancelToken
          ? safeBuildPublicAppointmentUrl(publicCancelToken, patientQrSettings, "read_v2_list")
          : null,
      };
    }));

    res.json({ appointments });
  })
);

router.get(
  "/appointments/:id",
  asyncRoute(async (req: Request, res: Response) => {
    const patientQrSettings = await readPatientQrSettings();
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
          b.case_category,
          ('V2-' || lpad(b.id::text, 6, '0')) as accession_number,
          b.booking_date::text as appointment_date,
          b.booking_time::text as booking_time,
          b.requires_report,
          b.study_instance_uid,
          (
            select count(*)::int
            from appointments_v2.bookings seq
            where seq.booking_date = b.booking_date
              and seq.id <= b.id
          ) as daily_sequence,
          b.status,
          b.is_walk_in,
          b.notes,
          b.arrived_at,
          b.waiting_started_at,
          b.completed_at,
          b.created_at,
          b.created_by_user_id,
          created_by_user.full_name as created_by_full_name,
          created_by_user.username as created_by_username,
          b.updated_at,
          p.arabic_full_name,
          p.english_full_name,
          p.national_id,
          p.mrn,
          p.age_years,
          p.demographics_estimated,
          p.sex,
          p.phone_1,
          p.address,
          m.name_ar as modality_name_ar,
          m.name_en as modality_name_en,
          m.code as modality_code,
          m.general_instruction_ar as modality_general_instruction_ar,
          m.general_instruction_en as modality_general_instruction_en,
          et.name_ar as exam_name_ar,
          et.name_en as exam_name_en,
          et.specific_instruction_ar as exam_specific_instruction_ar,
          et.specific_instruction_en as exam_specific_instruction_en,
          rp.name_ar as priority_name_ar,
          rp.name_en as priority_name_en,
          ${PROTOCOL_ASSIGNMENT_SELECT},
          (
            select count(*)::int
            from patient_web_push_booking_subscriptions bs
            join patient_web_push_subscriptions s on s.id = bs.subscription_id
            where bs.booking_id = b.id
              and bs.enabled = true
              and s.enabled = true
          ) as patient_web_push_subscription_count,
          null::int as modality_slot_number
        from appointments_v2.bookings b
        join patients p on p.id = b.patient_id
        join modalities m on m.id = b.modality_id
        left join exam_types et on et.id = b.exam_type_id
        left join reporting_priorities rp on rp.id = b.reporting_priority_id
        left join users created_by_user on created_by_user.id = b.created_by_user_id
        ${PROTOCOL_ASSIGNMENT_JOIN}
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

    const safetyResult = await pool.query<{
      modality_safety_workflow_type: "standard_acknowledgement" | "mri_primary_implant_screening";
      result: "no_known_implant_reported" | "implant_reported_review_required" | null;
      implant_site: string | null;
      implant_description: string | null;
      previous_reviewer_name_reported: string | null;
      screened_by_user_id: number | null;
      screened_at: string | null;
    }>(`
      select m.safety_workflow_type as modality_safety_workflow_type,
             screening.result, screening.implant_site, screening.implant_description,
             screening.previous_reviewer_name_reported, screening.screened_by_user_id,
             screening.screened_at
      from appointments_v2.bookings b
      join modalities m on m.id = b.modality_id
      left join appointments_v2.mri_primary_screenings screening on screening.booking_id = b.id
      where b.id = $1
    `, [bookingId]);
    const safety = safetyResult.rows[0];

    const [appointmentWithNote] = await attachSonicDicomStudyNotesToAppointments([appointment]);
    const publicCancelToken =
      patientQrSettings.enabled && patientQrSettings.printQrOnAppointmentSlip
        ? await issuePublicCancelToken(bookingId)
        : null;

    res.json({
      appointment: {
        ...appointmentWithNote,
        modality_safety_workflow_type: safety?.modality_safety_workflow_type ?? "standard_acknowledgement",
        mriPrimaryScreening: safety?.result ? {
          result: safety.result,
          implantSite: safety.implant_site,
          implantDescription: safety.implant_description,
          previousReviewerNameReported: safety.previous_reviewer_name_reported,
          screenedByUserId: Number(safety.screened_by_user_id),
          screenedAt: safety.screened_at,
        } : null,
        public_cancel_token: publicCancelToken,
        public_appointment_url: publicCancelToken
          ? safeBuildPublicAppointmentUrl(publicCancelToken, patientQrSettings, "read_v2_details")
          : null,
      },
    });
  })
);

router.get(
  "/statistics",
  requirePageAccess("statistics"),
  asyncRoute(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const compatibilityDate = parseStatisticsIsoDateQuery(query.date);
    const requestedDateFrom = parseStatisticsIsoDateQuery(query.dateFrom);
    const requestedDateTo = parseStatisticsIsoDateQuery(query.dateTo);

    if (compatibilityDate === "" || requestedDateFrom === "" || requestedDateTo === "") {
      res.status(400).json({ error: "date, dateFrom, and dateTo must be valid ISO dates (YYYY-MM-DD)." });
      return;
    }

    const dateFrom = compatibilityDate || requestedDateFrom || requestedDateTo || getTripoliToday();
    const dateTo = compatibilityDate || requestedDateTo || requestedDateFrom || dateFrom;
    if (dateFrom > dateTo) {
      res.status(400).json({ error: "dateFrom must be on or before dateTo." });
      return;
    }
    if (isoDateDay(dateTo) - isoDateDay(dateFrom) + 1 > 366) {
      res.status(400).json({ error: "Statistics date range must be 366 days or less." });
      return;
    }
    const modalityId = typeof query.modalityId === "string" ? Number(query.modalityId) : null;

    const params: unknown[] = [];
    const where: string[] = [];

    params.push(dateFrom);
    where.push(`b.booking_date >= $${params.length}::date`);
    params.push(dateTo);
    where.push(`b.booking_date <= $${params.length}::date`);

    if (modalityId && Number.isFinite(modalityId)) {
      params.push(modalityId);
      where.push(`b.modality_id = $${params.length}`);
    }

    const whereClause = where.length > 0 ? `where ${where.join(" and ")}` : "";

    const [summary, statusBreakdown, modalityBreakdown, dailyBreakdown] = await Promise.all([
      pool.query(
        `
          select
            (select count(*)::int from patients) as total_registered_patients,
            (select count(*)::int from patients where category = 'oncology') as oncology_patients,
            (select count(*)::int from patients where category = 'non_oncology') as non_oncology_patients,
            (select count(*)::int from patients where category is null) as uncategorized_patients,
            count(*)::int as total_appointments,
            count(distinct b.patient_id)::int as unique_patients,
            count(distinct b.modality_id)::int as unique_modalities,
            count(*) filter (where b.status = 'scheduled')::int as scheduled_count,
            count(*) filter (where b.status in ('arrived', 'waiting'))::int as in_queue_count,
            count(*) filter (where b.status = 'completed')::int as completed_count,
            count(*) filter (where b.status = 'discontinued')::int as discontinued_count,
            count(*) filter (where b.status = 'no-show')::int as no_show_count,
            count(*) filter (where b.status = 'cancelled')::int as cancelled_count,
            count(*) filter (where b.is_walk_in = true)::int as walk_in_count,
            count(*) filter (where b.case_category = 'oncology')::int as oncology_appointments,
            count(*) filter (where b.case_category = 'non_oncology')::int as non_oncology_appointments
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
          order by case b.status
            when 'scheduled' then 10
            when 'arrived' then 20
            when 'waiting' then 30
            when 'in-progress' then 40
            when 'completed' then 50
            when 'no-show' then 60
            when 'cancelled' then 70
            when 'discontinued' then 80
            when 'voided' then 90
            else 999
          end, b.status asc
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
            count(*) filter (where b.status = 'discontinued')::int as discontinued_count,
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
            count(*) filter (where b.status = 'discontinued')::int as discontinued_count,
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
      total_registered_patients: 0,
      total_appointments: 0,
      unique_patients: 0,
      unique_modalities: 0,
      scheduled_count: 0,
      in_queue_count: 0,
      completed_count: 0,
      discontinued_count: 0,
      no_show_count: 0,
      cancelled_count: 0,
      walk_in_count: 0,
      oncology_patients: 0,
      non_oncology_patients: 0,
      uncategorized_patients: 0,
      oncology_appointments: 0,
      non_oncology_appointments: 0,
    };

    res.json({
      metadata: {
        dateFrom,
        dateTo,
        modalityId: modalityId && Number.isFinite(modalityId) ? modalityId : null,
        generatedAt: new Date().toISOString(),
      },
      summary: {
        totalRegisteredPatients: summaryRow.total_registered_patients,
        totalAppointments: summaryRow.total_appointments,
        uniquePatients: summaryRow.unique_patients,
        uniqueModalities: summaryRow.unique_modalities,
        oncologyPatients: summaryRow.oncology_patients,
        nonOncologyPatients: summaryRow.non_oncology_patients,
        uncategorizedPatients: summaryRow.uncategorized_patients,
        scheduledCount: summaryRow.scheduled_count,
        inQueueCount: summaryRow.in_queue_count,
        completedCount: summaryRow.completed_count,
        discontinuedCount: summaryRow.discontinued_count,
        noShowCount: summaryRow.no_show_count,
        cancelledCount: summaryRow.cancelled_count,
        walkInCount: summaryRow.walk_in_count,
        oncologyAppointments: summaryRow.oncology_appointments,
        nonOncologyAppointments: summaryRow.non_oncology_appointments,
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
        discontinuedCount: r.discontinued_count,
        noShowCount: r.no_show_count,
        cancelledCount: r.cancelled_count,
      })),
      dailyBreakdown: dailyBreakdown.rows.map((r) => ({
        appointmentDate: r.appointment_date,
        totalCount: r.total_count,
        completedCount: r.completed_count,
        discontinuedCount: r.discontinued_count,
        cancelledCount: r.cancelled_count,
        noShowCount: r.no_show_count,
      })),
    });
  })
);

router.get(
  "/queue",
  requirePageAccess("queue"),
  asyncRoute(async (req: Request, res: Response) => {
    const today = getTripoliToday();
    const patientRequirementCleanupResult = await cleanupActiveQueuePatientRequirementViolations(
      today,
      Number((req as AuthedRequest).user?.sub ?? 0) || null
    );
    const noShowSettings = await getNoShowSettings();

    const [entries, summary] = await Promise.all([
      pool.query(
        `
          with active_same_day as (
            select
              rb.patient_id,
              rb.booking_date,
              count(*)::int as same_day_appointment_count,
              jsonb_agg(
                jsonb_build_object(
                  'appointment_id', rb.id,
                  'accession_number', ('V2-' || lpad(rb.id::text, 6, '0')),
                  'appointment_status', rb.status,
                  'modality_name_ar', rm.name_ar,
                  'modality_name_en', rm.name_en,
                  'exam_name_ar', ret.name_ar,
                  'exam_name_en', ret.name_en
                )
                order by rb.created_at asc, rb.id asc
              ) as related_appointments
            from appointments_v2.bookings rb
            join modalities rm on rm.id = rb.modality_id
            left join exam_types ret on ret.id = rb.exam_type_id
            where rb.booking_date = $1::date
              and rb.status in ('scheduled', 'arrived', 'waiting')
            group by rb.patient_id, rb.booking_date
          )
          select
            row_number() over (order by b.created_at asc, b.id asc)::int as queue_number,
            b.id,
            b.booking_date::text as queue_date,
            case when b.status = 'arrived' then 'called' else 'waiting' end as queue_status,
            b.arrived_at,
            b.waiting_started_at,
            b.completed_at,
            case when b.status in ('arrived', 'waiting') then b.arrived_at else null end as scanned_at,
            b.id as appointment_id,
            ('V2-' || lpad(b.id::text, 6, '0')) as accession_number,
            b.requires_report,
            b.study_instance_uid,
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
            et.name_en as exam_name_en,
            ap.protocol_status,
            ap.protocol_text,
            ap.contrast_required,
            ap.contrast_phase_or_protocol,
            ap.special_preparation,
            ap.technologist_notes,
            dp.display_name as protocol_assigned_by_doctor_name,
            ap.assigned_at as protocol_assigned_at,
            coalesce(asd.same_day_appointment_count, 1)::int as same_day_appointment_count,
            (coalesce(asd.same_day_appointment_count, 1) > 1) as has_multiple_appointments,
            coalesce(asd.related_appointments, '[]'::jsonb) as related_appointments
          from appointments_v2.bookings b
          join patients p on p.id = b.patient_id
          join modalities m on m.id = b.modality_id
          left join exam_types et on et.id = b.exam_type_id
          left join doctor_portal.appointment_protocols ap on ap.appointment_id = b.id and ap.protocol_status = 'assigned'
          left join doctor_portal.doctor_profiles dp on dp.id = ap.assigned_by_doctor_id
          left join active_same_day asd on asd.patient_id = b.patient_id and asd.booking_date = b.booking_date
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
            and status <> 'voided'
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
      review_time: noShowSettings.reviewTime,
      review_active: noShowSettings.reviewActive,
      auto_no_show_enabled: noShowSettings.autoNoShowEnabled,
      no_show_confirmation_required: noShowSettings.manualConfirmationRequired,
      no_show_grace_minutes: noShowSettings.graceMinutes,
      no_show_mode: noShowSettings.mode,
      auto_no_show_count: 0,
      auto_no_show_cleanup_days: noShowSettings.cleanupDays,
      patient_requirement_cleanup_count: patientRequirementCleanupResult.cleanedIds.length,
      summary: summaryRow,
      queue_entries: entries.rows,
      no_show_candidates: [],
      old_no_show_candidates: [],
    });
  })
);

router.get(
  "/queue/no-show-summary",
  requirePageAccess("queue"),
  asyncRoute(async (_req: Request, res: Response) => {
    const snapshot = await getNoShowReviewSnapshot();
    res.json({
      mode: snapshot.mode, reviewTime: snapshot.review_time, reviewActive: snapshot.review_active,
      pendingCount: snapshot.pending_count, oldCleanupCount: snapshot.old_cleanup_count,
      autoNoShowEnabled: snapshot.auto_no_show_enabled, manualConfirmationRequired: snapshot.no_show_confirmation_required,
      lastAutomaticRunAt: snapshot.last_automatic_run_at,
      lastAutomaticProcessedCount: snapshot.last_automatic_today_processed_count + snapshot.last_automatic_historical_processed_count,
    });
  })
);

router.get(
  "/queue/no-shows",
  requirePageAccess("queue"),
  asyncRoute(async (_req: Request, res: Response) => res.json(await getNoShowReviewSnapshot()))
);

router.post(
  "/queue/no-shows/confirm-bulk",
  requirePageAccess("queue"),
  requireActionPin("queue_confirm_no_show"),
  asyncRoute(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json(await confirmManualNoShowBulk(body.appointmentIds, String(body.reason || ""), Number((req as AuthedRequest).user?.sub ?? 0)));
  })
);

router.post(
  "/queue/old-no-shows/confirm",
  requirePageAccess("queue"),
  requireActionPin("queue_confirm_no_show"),
  asyncRoute(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json(await confirmOldNoShowCleanup(body.appointmentIds, String(body.reason || ""), Number((req as AuthedRequest).user?.sub ?? 0)));
  })
);

router.post(
  "/queue/no-shows/run-old-cleanup",
  requirePageAccess("queue"),
  requireActionPin("queue_confirm_no_show"),
  asyncRoute(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json(await runManualOldNoShowCleanup(String(body.reason || ""), Number((req as AuthedRequest).user?.sub ?? 0)));
  })
);

router.post(
  "/queue/scan",
  requirePageAccess("queue"),
  asyncRoute(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const scanValue = String(body.scanValue ?? "").trim();
    const bookingId = parseBookingIdFromScan(scanValue);
    if (!bookingId) {
      res.status(400).json({ error: "Invalid scan value. Use V2-<bookingId> or booking ID." });
      return;
    }

    const user = (req as AuthedRequest).user;
    const userId = Number(user?.sub ?? 0);
    const client = await pool.connect();
    let result: Awaited<ReturnType<typeof arriveSameDayQueueBookings>> | null = null;
    try {
      await client.query("begin");
      result = await arriveSameDayQueueBookings(client, bookingId, getTripoliToday(), userId, user?.role);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    if (!result) {
      throw new Error("Queue scan did not return an arrival result.");
    }
    for (const updatedBookingId of result.updatedBookingIds) {
      scheduleBookingWorklistSync(updatedBookingId);
    }
    res.json({ ok: true, ...result });
  })
);

router.post(
  "/queue/walk-in",
  requirePageAccess("queue"),
  requireActionPin("queue_walk_in"),
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
    const userRole = (req as AuthedRequest).user?.role;
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
      userRole,
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
  requirePageAccess("queue"),
  requireActionPin("queue_confirm_no_show"),
  asyncRoute(async (req: Request, res: Response) => {
    const bookingId = Number(req.params.id);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      res.status(400).json({ error: "Invalid booking ID" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json(await confirmManualNoShow(bookingId, String(body.reason || ""), Number((req as AuthedRequest).user?.sub ?? 0)));
  })
);

router.post(
  "/appointments/:id/status",
  asyncRoute(async (req: Request, res: Response) => {
    const bookingId = Number(req.params.id);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      res.status(400).json({ error: "Invalid booking ID" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const status = String(body.status || "").trim();
    const reason = body.reason == null ? null : String(body.reason);
    const result = await updateBookingStatusManual(
      bookingId,
      status,
      reason,
      Number((req as AuthedRequest).user?.sub ?? 0),
      (req as AuthedRequest).user?.role
    );
    res.json({ ok: true, ...result });
  })
);

router.get(
  "/modality/worklist",
  requirePageAccess("modality"),
  asyncRoute(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const scope = String(query.scope || "day");
    const modalityId = Number(query.modalityId);
    const date = String(query.date || "");

    if (!Number.isInteger(modalityId) || modalityId <= 0) {
      res.status(400).json({ error: "modalityId is required" });
      return;
    }

    await cleanupActiveQueuePatientRequirementViolations(
      date || getTripoliToday(),
      Number((req as AuthedRequest).user?.sub ?? 0) || null
    );

    const params: unknown[] = [modalityId];
    let dateClause = "";
    let worklistDateClause = "";
    if (scope !== "all") {
      params.push(date);
      const dateParam = `$${params.length}`;
      dateClause = `and b.booking_date = ${dateParam}::date`;
      worklistDateClause = `and wb.booking_date = ${dateParam}::date`;
    }

    const sql = `
      with worklist_rows as (
        select wb.id, wb.patient_id, wb.booking_date
        from appointments_v2.bookings wb
        where wb.modality_id = $1
          and wb.status in ('scheduled', 'waiting', 'arrived', 'completed', 'no-show', 'cancelled', 'discontinued')
          ${worklistDateClause}
      ),
      active_same_day as (
        select
          rb.patient_id,
          rb.booking_date,
          count(*)::int as same_day_appointment_count,
          jsonb_agg(
            jsonb_build_object(
              'appointment_id', rb.id,
              'accession_number', ('V2-' || lpad(rb.id::text, 6, '0')),
              'appointment_status', rb.status,
              'modality_name_ar', rm.name_ar,
              'modality_name_en', rm.name_en,
              'exam_name_ar', ret.name_ar,
              'exam_name_en', ret.name_en
            )
            order by rb.created_at asc, rb.id asc
          ) as related_appointments
        from appointments_v2.bookings rb
        join modalities rm on rm.id = rb.modality_id
        left join exam_types ret on ret.id = rb.exam_type_id
        where rb.status in ('scheduled', 'arrived', 'waiting')
          and exists (
            select 1
            from worklist_rows wr
            where wr.patient_id = rb.patient_id
              and wr.booking_date = rb.booking_date
          )
        group by rb.patient_id, rb.booking_date
      )
      select
        b.id,
        b.patient_id,
        b.modality_id,
        b.exam_type_id,
        b.reporting_priority_id,
        b.case_category,
        ('V2-' || lpad(b.id::text, 6, '0')) as accession_number,
        b.booking_date::text as appointment_date,
        b.requires_report,
        b.study_instance_uid,
        row_number() over (partition by b.booking_date, b.modality_id order by b.created_at asc, b.id asc)::int as daily_sequence,
        b.status,
        b.is_walk_in,
        b.notes,
        coalesce(b.arrived_at, status_times.arrived_at) as arrived_at,
        b.waiting_started_at,
        coalesce(b.completed_at, status_times.completed_at) as completed_at,
        b.auto_completed_at,
        coalesce(pacs_settings.enabled, false) as pacs_auto_completion_enabled,
        b.pacs_study_started_at,
        b.pacs_first_seen_at,
        b.pacs_timing_source,
        b.pacs_timing_confidence,
        b.created_at,
        b.updated_at,
        p.arabic_full_name,
        p.english_full_name,
        p.national_id,
        p.mrn,
        patient_primary_identifier.identifier_type as patient_primary_identifier_type,
        patient_primary_identifier.label_ar as patient_primary_identifier_label_ar,
        patient_primary_identifier.label_en as patient_primary_identifier_label_en,
        patient_primary_identifier.value as patient_primary_identifier_value,
        p.age_years,
        p.demographics_estimated,
        p.sex,
        p.phone_1,
        m.name_ar as modality_name_ar,
        m.name_en as modality_name_en,
        m.code as modality_code,
        m.safety_workflow_type as modality_safety_workflow_type,
        case when screening.result is not null then jsonb_build_object(
          'result', screening.result,
          'implantSite', screening.implant_site,
          'implantDescription', screening.implant_description,
          'previousReviewerNameReported', screening.previous_reviewer_name_reported,
          'screenedByUserId', screening.screened_by_user_id,
          'screenedAt', screening.screened_at
        ) else null end as mri_primary_screening,
        m.general_instruction_ar as modality_general_instruction_ar,
        m.general_instruction_en as modality_general_instruction_en,
        et.name_ar as exam_name_ar,
        et.name_en as exam_name_en,
        coalesce(rp.name_ar, 'روتيني') as priority_name_ar,
        coalesce(rp.name_en, 'Routine') as priority_name_en,
        protocol_assignment.assignment_id as protocol_assignment_id,
        protocol_assignment.protocol_id as assigned_protocol_id,
        protocol_assignment.protocol_version_id as assigned_protocol_version_id,
        protocol_assignment.protocol_name,
        protocol_assignment.version_number as protocol_version_number,
        protocol_assignment.free_text_protocol as assigned_free_text_protocol,
        protocol_assignment.scanner_name as protocol_scanner_name,
        protocol_assignment.assigned_by as protocol_assigned_by,
        protocol_assignment.assigned_at as protocol_assigned_at,
        protocol_assignment.protocol_notes as assigned_protocol_notes,
        protocol_assignment.contrast_notes as assigned_contrast_notes,
        row_number() over (partition by b.booking_date, b.modality_id order by b.created_at asc, b.id asc)::int as modality_slot_number,
        coalesce(asd.same_day_appointment_count, case when b.status in ('scheduled', 'arrived', 'waiting') then 1 else 0 end)::int as same_day_appointment_count,
        (coalesce(asd.same_day_appointment_count, 0) > 1) as has_multiple_appointments,
        coalesce(asd.related_appointments, '[]'::jsonb) as related_appointments
      from appointments_v2.bookings b
      join patients p on p.id = b.patient_id
      join modalities m on m.id = b.modality_id
      left join appointments_v2.mri_primary_screenings screening on screening.booking_id = b.id
      left join exam_types et on et.id = b.exam_type_id
      left join reporting_priorities rp on rp.id = b.reporting_priority_id
      left join appointments_v2.pacs_auto_completion_settings pacs_settings on pacs_settings.modality_id = b.modality_id
      left join active_same_day asd on asd.patient_id = b.patient_id and asd.booking_date = b.booking_date
      left join patient_identifier_types legacy_type on legacy_type.code = p.identifier_type
      left join lateral (
        select source.identifier_type, source.label_ar, source.label_en, source.value
        from (
          select
            1 as sort_order,
            pi.id as tie_order,
            pit.code as identifier_type,
            pit.label_ar,
            pit.label_en,
            pi.value
          from patient_identifiers pi
          join patient_identifier_types pit on pit.id = pi.identifier_type_id
          where pi.patient_id = p.id
            and pi.is_primary = true
            and nullif(pi.value, '') is not null

          union all

          select
            2 as sort_order,
            0 as tie_order,
            p.identifier_type,
            legacy_type.label_ar,
            legacy_type.label_en,
            p.identifier_value
          where nullif(p.identifier_type, '') is not null
            and nullif(p.identifier_value, '') is not null

          union all

          select
            3 as sort_order,
            0 as tie_order,
            'national_id' as identifier_type,
            'الرقم الوطني' as label_ar,
            'National ID' as label_en,
            p.national_id as value
          where nullif(p.national_id, '') is not null

          union all

          select
            4 as sort_order,
            0 as tie_order,
            'mrn' as identifier_type,
            'رقم الملف' as label_ar,
            'MRN' as label_en,
            p.mrn as value
          where nullif(p.mrn, '') is not null
        ) source
        order by source.sort_order asc, source.tie_order asc
        limit 1
      ) patient_primary_identifier on true
      left join lateral (
        select
          assignment.id as assignment_id,
          assignment.protocol_id,
          assignment.protocol_version_id,
          protocol.name as protocol_name,
          version.version_number,
          assignment.free_text_protocol,
          scanner.name as scanner_name,
          coalesce(doctor.display_name, assigned_user.full_name) as assigned_by,
          assignment.assigned_at::text as assigned_at,
          assignment.protocol_notes,
          assignment.contrast_notes
        from appointment_protocol_assignments assignment
        left join protocols protocol on protocol.id = assignment.protocol_id
        left join protocol_versions version on version.id = assignment.protocol_version_id
        left join imaging_scanners scanner on scanner.id = assignment.scanner_id
        left join users assigned_user on assigned_user.id = assignment.assigned_by
        left join doctor_portal.doctor_profiles doctor on doctor.user_id = assigned_user.id
        where assignment.appointment_id = b.id
          and assignment.status <> 'CANCELLED'
          and b.status not in ('cancelled', 'discontinued', 'voided')
          and upper(coalesce(protocol.modality, m.code)) in ('CT', 'MRI')
        order by assignment.updated_at desc, assignment.id desc
        limit 1
      ) protocol_assignment on true
      left join lateral (
        select
          coalesce(
            min(audit_log.created_at) filter (where audit_log.new_values->>'status' = 'arrived'),
            min(audit_log.created_at) filter (where audit_log.new_values->>'status' = 'waiting')
          ) as arrived_at,
          max(audit_log.created_at) filter (where audit_log.new_values->>'status' = 'completed') as completed_at
        from audit_log
        where audit_log.entity_type in ('appointment_v2_booking', 'appointments_v2_booking')
          and audit_log.entity_id = b.id
          and audit_log.new_values->>'status' in ('arrived', 'waiting', 'completed')
      ) status_times on true
      where b.modality_id = $1
        and b.status in ('scheduled', 'waiting', 'arrived', 'completed', 'no-show', 'cancelled', 'discontinued')
      ${dateClause}
      order by
        b.booking_date desc,
        case
          when b.status in ('arrived', 'waiting') then 1
          when b.status = 'scheduled' then 2
          when b.status = 'completed' then 3
          else 4
        end asc,
        coalesce(b.arrived_at, status_times.arrived_at) asc nulls last,
        b.booking_time asc nulls last,
        coalesce(b.completed_at, status_times.completed_at) desc nulls last,
        modality_slot_number asc,
        b.id asc
      limit 300
    `;

    const result = await pool.query(sql, params);
    res.json({ appointments: result.rows });
  })
);

router.get(
  "/modality/appointments/:appointmentId/protocol-assignment",
  requirePageAccess("modality"),
  asyncRoute(async (req: Request, res: Response) => {
    const appointmentId = Number(req.params.appointmentId);
    if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
      res.status(400).json({ error: "Invalid appointment ID" });
      return;
    }

    const assignment = await getModalityProtocolAssignment(appointmentId);
    res.json({ assignment });
  })
);

router.get(
  "/registrations/appointments/:appointmentId/protocol-assignment",
  requirePageAccess("registrations"),
  asyncRoute(async (req: Request, res: Response) => {
    const appointmentId = Number(req.params.appointmentId);
    if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
      res.status(400).json({ error: "Invalid appointment ID" });
      return;
    }
    const assignment = await getModalityProtocolAssignment(appointmentId);
    res.json({ assignment });
  })
);

router.post(
  "/appointments/:id/complete",
  requirePageAccess("modality"),
  asyncRoute(async (req: Request, res: Response) => {
    const bookingId = Number(req.params.id);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      res.status(400).json({ error: "Invalid booking ID" });
      return;
    }

    await updateBookingStatusManual(
      bookingId,
      "completed",
      null,
      Number((req as AuthedRequest).user?.sub ?? 0),
      (req as AuthedRequest).user?.role
    );
    res.json({ ok: true });
  })
);

export { router as readV2Router };
