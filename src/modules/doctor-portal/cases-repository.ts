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
    dra.team_name as "teamName",
    dra.duty_type as "dutyType",
    cta.expected_reporting_date::text as "expectedReportingDate",
    cta.assignment_type as "assignmentType",
    cta.status as "assignmentStatus",
    null::text as "protocolStatus",
    null::text as "reportStatus"
  from appointments_v2.bookings b
  join patients p on p.id = b.patient_id
  join modalities m on m.id = b.modality_id
  left join exam_types et on et.id = b.exam_type_id
  left join doctor_portal.case_team_assignments cta on cta.appointment_id = b.id and cta.status = 'active'
  left join doctor_portal.doctor_roster_assignments dra on dra.id = cta.roster_assignment_id
`;

function filters(params: { dateFrom: string; dateTo: string; modalityId?: number | null; status?: string | null; requiresReport?: boolean | null; caseCategory?: string | null }) {
  const values: unknown[] = [params.dateFrom, params.dateTo];
  const where = ["b.booking_date >= $1::date", "b.booking_date <= $2::date"];
  if (params.modalityId) {
    values.push(params.modalityId);
    where.push(`b.modality_id = $${values.length}`);
  }
  if (params.status) {
    values.push(params.status);
    where.push(`coalesce(cta.status, 'unassigned') = $${values.length}`);
  }
  if (params.requiresReport !== null && params.requiresReport !== undefined) {
    values.push(params.requiresReport);
    where.push(`b.requires_report = $${values.length}`);
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
    exists (
      select 1
      from doctor_portal.doctor_roster_members drm
      where drm.roster_assignment_id = cta.roster_assignment_id
        and drm.doctor_id = $${scoped.values.length}
    )
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
        b.status
      from appointments_v2.bookings b
      join modalities m on m.id = b.modality_id
      left join exam_types et on et.id = b.exam_type_id
      where b.booking_date >= $1::date
        and b.booking_date <= $2::date
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
          b.status
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
