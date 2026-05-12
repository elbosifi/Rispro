import { pool } from "../../db/pool.js";
import type { UserId } from "../../types/http.js";
import { insertDoctorAuditEvent } from "./profile-repository.js";
import { classifyCaseRule, isRosterMatch, type CaseAssignmentType, type CaseBookingSignal, type RosterAssignmentSignal } from "./case-assignment-rules.js";
import type { AssignmentRunSummary, DoctorCaseRow } from "./cases-types.js";

interface AssignmentActor {
  userId: UserId;
  doctorId: number;
}

interface AssignCasesInput {
  dateFrom: string;
  dateTo: string;
  modalityId: number | null;
}

interface BookingRow extends CaseBookingSignal {
  status: string;
  requiresReport: boolean;
}

const CASE_SELECT = `
  select
    b.id as "appointmentId",
    b.booking_date::text as "appointmentDate",
    b.booking_time::text as "appointmentTime",
    b.patient_id as "patientId",
    p.mrn as "patientMrn",
    p.national_id as "patientNationalId",
    p.arabic_full_name as "patientArabicName",
    p.english_full_name as "patientEnglishName",
    b.modality_id as "modalityId",
    m.code as "modalityCode",
    m.name_en as "modalityName",
    b.exam_type_id as "examTypeId",
    et.name_en as "examTypeName",
    b.case_category as "caseCategory",
    b.requires_report as "requiresReport",
    b.status as "appointmentStatus",
    cta.roster_assignment_id as "rosterAssignmentId",
    cta.assigned_doctor_id as "assignedDoctorId",
    assigned_doctor.display_name as "assignedDoctorName",
    dra.team_name as "teamName",
    dra.duty_type as "dutyType",
    cta.expected_reporting_date::text as "expectedReportingDate",
    cta.assignment_type as "assignmentType",
    cta.status as "assignmentStatus",
    coalesce(cwu.workload_units, catalog.workload_units)::float as "workloadPoints",
    (cwu.id is null and catalog.workload_units is null) as "workloadDefaulted",
    null::text as "protocolStatus",
    null::text as "reportStatus"
  from appointments_v2.bookings b
  join patients p on p.id = b.patient_id
  join modalities m on m.id = b.modality_id
  left join exam_types et on et.id = b.exam_type_id
  left join doctor_portal.case_team_assignments cta on cta.appointment_id = b.id and cta.status = 'active'
  left join doctor_portal.doctor_roster_assignments dra on dra.id = cta.roster_assignment_id
  left join doctor_portal.doctor_profiles assigned_doctor on assigned_doctor.id = cta.assigned_doctor_id
  left join doctor_portal.case_workload_units cwu on cwu.case_team_assignment_id = cta.id and cwu.status = 'active'
  left join lateral (
    select (wuc.base_units * wuc.report_required_multiplier) as workload_units
    from doctor_portal.workload_unit_catalog wuc
    where wuc.active = true
      and wuc.assignment_type = 'reporting'
      and wuc.modality_id = b.modality_id
      and (wuc.exam_type_id is null or wuc.exam_type_id = b.exam_type_id)
      and (wuc.case_category is null or wuc.case_category = b.case_category)
      and (wuc.effective_from is null or wuc.effective_from <= b.booking_date)
      and (wuc.effective_to is null or wuc.effective_to >= b.booking_date)
    order by
      case when wuc.exam_type_id = b.exam_type_id then 0 else 1 end,
      case when wuc.case_category = b.case_category then 0 else 1 end,
      wuc.effective_from desc nulls last,
      wuc.id desc
    limit 1
  ) catalog on b.requires_report = true
`;

function filters(params: { dateFrom: string; dateTo: string; modalityId?: number | null; status?: string | null; requiresReport?: boolean | null; caseCategory?: string | null }) {
  const values: unknown[] = [params.dateFrom, params.dateTo];
  const where = ["b.booking_date >= $1::date", "b.booking_date <= $2::date", "b.requires_report = true"];
  if (params.modalityId) {
    values.push(params.modalityId);
    where.push(`b.modality_id = $${values.length}`);
  }
  if (params.status) {
    values.push(params.status);
    where.push(`coalesce(cta.status, 'unassigned') = $${values.length}`);
  }
  if (params.caseCategory) {
    values.push(params.caseCategory);
    where.push(`b.case_category = $${values.length}`);
  }
  return { values, where };
}

export async function listMyCases(doctorId: number, params: { dateFrom: string; dateTo: string; modalityId?: number | null; status?: string | null; requiresReport?: boolean | null; caseCategory?: string | null }): Promise<DoctorCaseRow[]> {
  const scoped = filters(params);
  scoped.values.push(doctorId);
  scoped.where.push(`
    (cta.assigned_doctor_id = $${scoped.values.length} or exists (
      select 1
      from doctor_portal.doctor_roster_members drm
      where drm.roster_assignment_id = cta.roster_assignment_id
        and drm.doctor_id = $${scoped.values.length}
    ))
  `);
  const result = await pool.query<DoctorCaseRow>(
    `${CASE_SELECT} where ${scoped.where.join(" and ")} order by b.booking_date asc, b.booking_time asc nulls first, b.id asc limit 500`,
    scoped.values
  );
  return result.rows;
}

export async function listTeamCases(params: { dateFrom: string; dateTo: string; modalityId?: number | null; status?: string | null; requiresReport?: boolean | null; caseCategory?: string | null; rosterAssignmentId?: number | null }): Promise<DoctorCaseRow[]> {
  const scoped = filters(params);
  if (params.rosterAssignmentId) {
    scoped.values.push(params.rosterAssignmentId);
    scoped.where.push(`cta.roster_assignment_id = $${scoped.values.length}`);
  }
  const result = await pool.query<DoctorCaseRow>(
    `${CASE_SELECT} where ${scoped.where.join(" and ")} and cta.id is not null order by b.booking_date asc, b.booking_time asc nulls first, b.id asc limit 1000`,
    scoped.values
  );
  return result.rows;
}

export async function listUnassignedCases(params: { dateFrom: string; dateTo: string; modalityId?: number | null }): Promise<DoctorCaseRow[]> {
  const scoped = filters(params);
  const result = await pool.query<DoctorCaseRow>(
    `${CASE_SELECT} where ${scoped.where.join(" and ")} and cta.id is null and b.status not in ('cancelled', 'discontinued', 'voided') order by b.booking_date asc, b.booking_time asc nulls first, b.id asc limit 1000`,
    scoped.values
  );
  return result.rows;
}

async function listAssignableBookings(input: AssignCasesInput): Promise<BookingRow[]> {
  const values: unknown[] = [input.dateFrom, input.dateTo];
  const modalityFilter = input.modalityId ? `and b.modality_id = $3` : "";
  if (input.modalityId) values.push(input.modalityId);
  const result = await pool.query<BookingRow>(
    `
      select
        b.id as "appointmentId",
        b.booking_date::text as "bookingDate",
        b.modality_id as "modalityId",
        m.code as "modalityCode",
        m.name_en as "modalityName",
        et.name_en as "examTypeName",
        null::text as "sessionName",
        b.status,
        b.requires_report as "requiresReport"
      from appointments_v2.bookings b
      join modalities m on m.id = b.modality_id
      left join exam_types et on et.id = b.exam_type_id
      where b.booking_date >= $1::date
        and b.booking_date <= $2::date
        and b.requires_report = true
        and b.status not in ('cancelled', 'discontinued', 'voided')
        ${modalityFilter}
      order by b.booking_date asc, b.booking_time asc nulls first, b.id asc
    `,
    values
  );
  return result.rows;
}

async function listPublishedRosterAssignments(dateFrom: string, dateTo: string): Promise<RosterAssignmentSignal[]> {
  const result = await pool.query<RosterAssignmentSignal>(
    `
      select
        a.id,
        a.date::text as "date",
        a.modality_id as "modalityId",
        m.code as "modalityCode",
        m.name_en as "modalityName",
        a.duty_type as "dutyType",
        a.session_name as "sessionName"
      from doctor_portal.doctor_roster_assignments a
      join doctor_portal.doctor_roster_weeks w on w.id = a.roster_week_id
      left join modalities m on m.id = a.modality_id
      where w.status = 'published'
        and a.status = 'active'
        and a.date >= $1::date
        and a.date <= $2::date
      order by a.date asc, a.start_time asc nulls first, a.id asc
    `,
    [dateFrom, dateTo]
  );
  return result.rows;
}

async function activeAssignmentExists(appointmentId: number, assignmentType: CaseAssignmentType): Promise<boolean> {
  const result = await pool.query(
    `select 1 from doctor_portal.case_team_assignments where appointment_id = $1 and assignment_type = $2 and status = 'active' limit 1`,
    [appointmentId, assignmentType]
  );
  return Boolean(result.rows[0]);
}

export async function assignCases(input: AssignCasesInput, actor: AssignmentActor): Promise<AssignmentRunSummary> {
  const summary: AssignmentRunSummary = {
    assignedCount: 0,
    alreadyAssignedCount: 0,
    unassignedNoRosterCount: 0,
    skippedCancelledCount: 0,
    errors: [],
  };

  await insertDoctorAuditEvent(pool, {
    actorUserId: actor.userId,
    actorDoctorId: actor.doctorId,
    eventType: "case_assignment_run_started",
    targetType: "case_team_assignment",
    targetId: null,
    metadata: { dateFrom: input.dateFrom, dateTo: input.dateTo, modalityId: input.modalityId },
    reason: null,
  });

  const bookings = await listAssignableBookings(input);
  const rosterAssignments = await listPublishedRosterAssignments(input.dateFrom, input.dateTo);

  for (const booking of bookings) {
    if (["cancelled", "discontinued", "voided"].includes(booking.status)) {
      summary.skippedCancelledCount += 1;
      continue;
    }
    const rule = classifyCaseRule(booking);
    if (await activeAssignmentExists(booking.appointmentId, rule.assignmentType)) {
      summary.alreadyAssignedCount += 1;
      continue;
    }
    const roster = rosterAssignments.find((candidate) => isRosterMatch(booking, candidate, rule));
    if (!roster) {
      summary.unassignedNoRosterCount += 1;
      continue;
    }
    try {
      const result = await pool.query<{ id: number }>(
        `
          insert into doctor_portal.case_team_assignments (
            appointment_id, roster_assignment_id, modality_id, assignment_type, expected_reporting_date, status
          )
          values ($1, $2, $3, $4, $5::date, 'active')
          on conflict (appointment_id, assignment_type) where status = 'active'
          do nothing
          returning id
        `,
        [booking.appointmentId, roster.id, booking.modalityId, rule.assignmentType, rule.expectedReportingDate]
      );
      if (result.rows[0]) {
        summary.assignedCount += 1;
        await insertDoctorAuditEvent(pool, {
          actorUserId: actor.userId,
          actorDoctorId: actor.doctorId,
          eventType: "case_assigned",
          targetType: "case_team_assignment",
          targetId: result.rows[0].id,
          metadata: {
            appointmentId: booking.appointmentId,
            rosterAssignmentId: roster.id,
            assignmentType: rule.assignmentType,
            expectedReportingDate: rule.expectedReportingDate,
          },
          reason: null,
        });
      } else {
        summary.alreadyAssignedCount += 1;
      }
    } catch (error) {
      summary.errors.push({ appointmentId: booking.appointmentId, reason: error instanceof Error ? error.message : "assignment_failed" });
    }
  }

  await insertDoctorAuditEvent(pool, {
    actorUserId: actor.userId,
    actorDoctorId: actor.doctorId,
    eventType: "case_assignment_run_completed",
    targetType: "case_team_assignment",
    targetId: null,
    metadata: {
      assignedCount: summary.assignedCount,
      alreadyAssignedCount: summary.alreadyAssignedCount,
      unassignedNoRosterCount: summary.unassignedNoRosterCount,
      skippedCancelledCount: summary.skippedCancelledCount,
      errors: summary.errors,
    },
    reason: null,
  });
  return summary;
}

export async function reassignCase(input: { appointmentId: number; rosterAssignmentId: number; reason: string }, actor: AssignmentActor) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const bookingResult = await client.query<BookingRow>(
      `
        select
          b.id as "appointmentId",
          b.booking_date::text as "bookingDate",
          b.modality_id as "modalityId",
          m.code as "modalityCode",
          m.name_en as "modalityName",
          et.name_en as "examTypeName",
          null::text as "sessionName",
          b.status,
          b.requires_report as "requiresReport"
        from appointments_v2.bookings b
        join modalities m on m.id = b.modality_id
        left join exam_types et on et.id = b.exam_type_id
        where b.id = $1
        limit 1
      `,
      [input.appointmentId]
    );
    const booking = bookingResult.rows[0];
    if (!booking) throw new Error("appointment_not_found");
    if (!booking.requiresReport) throw new Error("no_report_case_not_assignable");
    if (["cancelled", "discontinued", "voided"].includes(booking.status)) throw new Error("case_not_assignable");
    const rule = classifyCaseRule(booking);

    const rosterResult = await client.query<RosterAssignmentSignal>(
      `
        select
          a.id,
          a.date::text as "date",
          a.modality_id as "modalityId",
          m.code as "modalityCode",
          m.name_en as "modalityName",
          a.duty_type as "dutyType",
          a.session_name as "sessionName"
        from doctor_portal.doctor_roster_assignments a
        join doctor_portal.doctor_roster_weeks w on w.id = a.roster_week_id
        left join modalities m on m.id = a.modality_id
        where a.id = $1
          and a.status = 'active'
          and w.status = 'published'
        limit 1
      `,
      [input.rosterAssignmentId]
    );
    const roster = rosterResult.rows[0];
    if (!roster) throw new Error("published_roster_assignment_not_found");

    await client.query(
      `
        update doctor_portal.case_team_assignments
        set status = 'corrected', updated_at = now()
        where appointment_id = $1 and assignment_type = $2 and status = 'active'
      `,
      [booking.appointmentId, rule.assignmentType]
    );
    const inserted = await client.query<{ id: number }>(
      `
        insert into doctor_portal.case_team_assignments (
          appointment_id, roster_assignment_id, modality_id, assignment_type, expected_reporting_date, status
        )
        values ($1, $2, $3, $4, $5::date, 'active')
        on conflict (appointment_id, assignment_type) where status = 'active'
        do nothing
        returning id
      `,
      [booking.appointmentId, roster.id, booking.modalityId, rule.assignmentType, rule.expectedReportingDate]
    );
    const assignmentId = inserted.rows[0]?.id;
    if (!assignmentId) throw new Error("active_assignment_conflict");
    await insertDoctorAuditEvent(client, {
      actorUserId: actor.userId,
      actorDoctorId: actor.doctorId,
      eventType: "case_reassigned",
      targetType: "case_team_assignment",
      targetId: assignmentId,
      metadata: {
        appointmentId: booking.appointmentId,
        rosterAssignmentId: roster.id,
        assignmentType: rule.assignmentType,
      },
      reason: input.reason,
    });
    await client.query("commit");
    return { assignmentId };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function assignCaseToDoctor(
  input: { appointmentId: number; doctorId: number; rosterAssignmentId?: number | null; reason?: string | null },
  actor: AssignmentActor
) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const bookingResult = await client.query<BookingRow>(
      `
        select
          b.id as "appointmentId",
          b.booking_date::text as "bookingDate",
          b.modality_id as "modalityId",
          m.code as "modalityCode",
          m.name_en as "modalityName",
          et.name_en as "examTypeName",
          null::text as "sessionName",
          b.status,
          b.requires_report as "requiresReport"
        from appointments_v2.bookings b
        join modalities m on m.id = b.modality_id
        left join exam_types et on et.id = b.exam_type_id
        where b.id = $1
        limit 1
      `,
      [input.appointmentId]
    );
    const booking = bookingResult.rows[0];
    if (!booking) throw new Error("appointment_not_found");
    if (!booking.requiresReport) throw new Error("no_report_case_not_assignable");
    if (["cancelled", "discontinued", "voided"].includes(booking.status)) throw new Error("case_not_assignable");

    const doctorResult = await client.query<{ id: number }>(
      `select id from doctor_portal.doctor_profiles where id = $1 and active = true limit 1`,
      [input.doctorId]
    );
    if (!doctorResult.rows[0]) throw new Error("doctor_not_found");

    if (input.rosterAssignmentId) {
      const rosterResult = await client.query<{ id: number }>(
        `
          select a.id
          from doctor_portal.doctor_roster_assignments a
          join doctor_portal.doctor_roster_weeks w on w.id = a.roster_week_id
          where a.id = $1
            and a.status = 'active'
            and w.status in ('draft', 'published')
          limit 1
        `,
        [input.rosterAssignmentId]
      );
      if (!rosterResult.rows[0]) throw new Error("roster_assignment_not_found");
    }

    const existing = await client.query<{ id: number; assigned_doctor_id: number | null; roster_assignment_id: number | null }>(
      `
        select id, assigned_doctor_id, roster_assignment_id
        from doctor_portal.case_team_assignments
        where appointment_id = $1 and assignment_type = 'reporting' and status = 'active'
        limit 1
      `,
      [booking.appointmentId]
    );
    if (existing.rows[0] && (!input.reason || !input.reason.trim())) {
      throw new Error("reassignment_reason_required");
    }

    await client.query(
      `
        update doctor_portal.case_team_assignments
        set status = 'corrected', updated_at = now()
        where appointment_id = $1 and assignment_type = 'reporting' and status = 'active'
      `,
      [booking.appointmentId]
    );

    const inserted = await client.query<{ id: number }>(
      `
        insert into doctor_portal.case_team_assignments (
          appointment_id, roster_assignment_id, assigned_doctor_id, modality_id, assignment_type, expected_reporting_date, status
        )
        values ($1, $2, $3, $4, 'reporting', $5::date, 'active')
        returning id
      `,
      [booking.appointmentId, input.rosterAssignmentId ?? null, input.doctorId, booking.modalityId, booking.bookingDate]
    );
    const assignmentId = inserted.rows[0]?.id;
    if (!assignmentId) throw new Error("assignment_failed");

    await insertDoctorAuditEvent(client, {
      actorUserId: actor.userId,
      actorDoctorId: actor.doctorId,
      eventType: existing.rows[0] ? "case_doctor_reassigned" : "case_doctor_assigned",
      targetType: "case_team_assignment",
      targetId: assignmentId,
      metadata: {
        appointmentId: booking.appointmentId,
        doctorId: input.doctorId,
        rosterAssignmentId: input.rosterAssignmentId ?? null,
      },
      reason: input.reason ?? null,
    });
    await client.query("commit");
    return { assignmentId };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
