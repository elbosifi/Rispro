import { pool } from "../../db/pool.js";
import type { PoolClient } from "pg";
import type { UserId } from "../../types/http.js";
import { insertDoctorAuditEvent } from "./profile-repository.js";
import type {
  RosterAssignmentRow,
  RosterDutyType,
  RosterMemberRow,
  RosterTeamRole,
  RosterWeekDetails,
  RosterWeekRow,
} from "./roster-types.js";

type Db = Pick<PoolClient, "query"> | typeof pool;

export interface AssignmentInput {
  rosterWeekId: number;
  date: string;
  modalityId: number | null;
  dutyType: RosterDutyType;
  sessionName: string | null;
  startTime: string | null;
  endTime: string | null;
  teamName: string;
  status?: string;
}

const WEEK_SELECT = `
  select
    id,
    week_start_date::text as "weekStartDate",
    week_end_date::text as "weekEndDate",
    status,
    created_by as "createdBy",
    published_by as "publishedBy",
    published_at as "publishedAt",
    created_at as "createdAt",
    updated_at as "updatedAt"
  from doctor_portal.doctor_roster_weeks
`;

const ASSIGNMENT_SELECT = `
  select
    a.id,
    a.roster_week_id as "rosterWeekId",
    a.date::text as "date",
    a.modality_id as "modalityId",
    m.code as "modalityCode",
    m.name_en as "modalityNameEn",
    m.name_ar as "modalityNameAr",
    a.duty_type as "dutyType",
    a.session_name as "sessionName",
    a.start_time::text as "startTime",
    a.end_time::text as "endTime",
    a.team_name as "teamName",
    a.status,
    a.created_at as "createdAt",
    a.updated_at as "updatedAt"
  from doctor_portal.doctor_roster_assignments a
  left join modalities m on m.id = a.modality_id
`;

export async function findRosterWeekByStart(weekStart: string): Promise<RosterWeekRow | null> {
  const result = await pool.query<RosterWeekRow>(
    `${WEEK_SELECT} where week_start_date = $1::date limit 1`,
    [weekStart]
  );
  return result.rows[0] ?? null;
}

export async function findRosterWeekById(db: Db, weekId: number): Promise<RosterWeekRow | null> {
  const result = await db.query<RosterWeekRow>(`${WEEK_SELECT} where id = $1 limit 1`, [weekId]);
  return result.rows[0] ?? null;
}

export async function getRosterWeekDetails(weekStart: string): Promise<RosterWeekDetails> {
  const week = await findRosterWeekByStart(weekStart);
  if (!week) return { week: null, assignments: [] };
  return { week, assignments: await listAssignmentsForWeek(pool, week.id) };
}

export async function listAssignmentsForWeek(db: Db, weekId: number): Promise<RosterAssignmentRow[]> {
  const result = await db.query<Omit<RosterAssignmentRow, "members">>(
    `
      ${ASSIGNMENT_SELECT}
      where a.roster_week_id = $1
      order by a.date asc, a.start_time asc nulls first, a.id asc
    `,
    [weekId]
  );
  const assignments: RosterAssignmentRow[] = result.rows.map((row) => ({ ...row, members: [] }));
  if (assignments.length === 0) return assignments;

  const memberResult = await db.query<RosterMemberRow>(
    `
      select
        rm.id,
        rm.roster_assignment_id as "rosterAssignmentId",
        rm.doctor_id as "doctorId",
        dp.display_name as "displayName",
        dp.doctor_role as "doctorRole",
        rm.team_role as "teamRole",
        rm.created_at as "createdAt",
        rm.updated_at as "updatedAt"
      from doctor_portal.doctor_roster_members rm
      join doctor_portal.doctor_profiles dp on dp.id = rm.doctor_id
      where rm.roster_assignment_id = any($1::bigint[])
      order by rm.id asc
    `,
    [assignments.map((assignment) => assignment.id)]
  );

  const byAssignmentId = new Map(assignments.map((assignment) => [assignment.id, assignment.members]));
  for (const member of memberResult.rows) {
    byAssignmentId.get(member.rosterAssignmentId)?.push(member);
  }

  return assignments;
}

export async function listMyRoster(doctorId: number, weekStart: string | null): Promise<RosterWeekDetails> {
  const params: unknown[] = [doctorId];
  const weekFilter = weekStart ? "and w.week_start_date = $2::date" : "";
  if (weekStart) params.push(weekStart);

  const weekResult = await pool.query<RosterWeekRow>(
    `
      ${WEEK_SELECT} w
      where w.status in ('draft', 'published')
        ${weekFilter}
        and exists (
          select 1
          from doctor_portal.doctor_roster_assignments a
          join doctor_portal.doctor_roster_members rm on rm.roster_assignment_id = a.id
          where a.roster_week_id = w.id
            and rm.doctor_id = $1
        )
      order by w.week_start_date desc
      limit 1
    `,
    params
  );

  const week = weekResult.rows[0] ?? null;
  if (!week) return { week: null, assignments: [] };

  const assignmentResult = await pool.query<Omit<RosterAssignmentRow, "members">>(
    `
      ${ASSIGNMENT_SELECT}
      where a.roster_week_id = $1
        and exists (
          select 1
          from doctor_portal.doctor_roster_members rm
          where rm.roster_assignment_id = a.id
            and rm.doctor_id = $2
        )
      order by a.date asc, a.start_time asc nulls first, a.id asc
    `,
    [week.id, doctorId]
  );

  const assignments: RosterAssignmentRow[] = assignmentResult.rows.map((row) => ({ ...row, members: [] }));
  for (const assignment of assignments) {
    assignment.members = await listMembersForAssignment(pool, assignment.id);
  }
  return { week, assignments };
}

export async function createRosterWeek(input: { weekStartDate: string; weekEndDate: string; actorUserId: UserId; actorDoctorId: number }): Promise<RosterWeekRow> {
  const result = await pool.query<RosterWeekRow>(
    `
      insert into doctor_portal.doctor_roster_weeks (week_start_date, week_end_date, created_by)
      values ($1::date, $2::date, $3)
      returning id, week_start_date::text as "weekStartDate", week_end_date::text as "weekEndDate", status,
        created_by as "createdBy", published_by as "publishedBy", published_at as "publishedAt",
        created_at as "createdAt", updated_at as "updatedAt"
    `,
    [input.weekStartDate, input.weekEndDate, input.actorUserId]
  );
  const week = result.rows[0];
  await insertDoctorAuditEvent(pool, {
    actorUserId: input.actorUserId,
    actorDoctorId: input.actorDoctorId,
    eventType: "roster_week_created",
    targetType: "doctor_roster_week",
    targetId: week.id,
    metadata: { weekStartDate: week.weekStartDate, weekEndDate: week.weekEndDate },
    reason: null,
  });
  return week;
}

export async function updateRosterWeekDates(
  weekId: number,
  input: { weekStartDate: string; weekEndDate: string },
  actor: { userId: UserId; doctorId: number }
): Promise<RosterWeekRow | null> {
  const result = await pool.query<RosterWeekRow>(
    `
      update doctor_portal.doctor_roster_weeks
      set week_start_date = $2::date, week_end_date = $3::date, updated_at = now()
      where id = $1
      returning id, week_start_date::text as "weekStartDate", week_end_date::text as "weekEndDate", status,
        created_by as "createdBy", published_by as "publishedBy", published_at as "publishedAt",
        created_at as "createdAt", updated_at as "updatedAt"
    `,
    [weekId, input.weekStartDate, input.weekEndDate]
  );
  const week = result.rows[0] ?? null;
  if (week) {
    await insertDoctorAuditEvent(pool, {
      actorUserId: actor.userId,
      actorDoctorId: actor.doctorId,
      eventType: "roster_week_updated",
      targetType: "doctor_roster_week",
      targetId: week.id,
      metadata: { weekStartDate: week.weekStartDate, weekEndDate: week.weekEndDate },
      reason: null,
    });
  }
  return week;
}

export async function insertAssignment(input: AssignmentInput, actor: { userId: UserId; doctorId: number }): Promise<RosterAssignmentRow> {
  const result = await pool.query<Omit<RosterAssignmentRow, "members">>(
    `
      insert into doctor_portal.doctor_roster_assignments (
        roster_week_id, date, modality_id, duty_type, session_name, start_time, end_time, team_name, status
      )
      values ($1, $2::date, $3, $4, $5, $6::time, $7::time, $8, coalesce($9, 'active'))
      returning id, roster_week_id as "rosterWeekId", date::text as "date", modality_id as "modalityId",
        null::text as "modalityCode", null::text as "modalityNameEn", null::text as "modalityNameAr",
        duty_type as "dutyType", session_name as "sessionName", start_time::text as "startTime",
        end_time::text as "endTime", team_name as "teamName", status,
        created_at as "createdAt", updated_at as "updatedAt"
    `,
    [
      input.rosterWeekId,
      input.date,
      input.modalityId,
      input.dutyType,
      input.sessionName,
      input.startTime,
      input.endTime,
      input.teamName,
      input.status ?? "active",
    ]
  );
  const assignment = { ...result.rows[0], members: [] };
  await insertDoctorAuditEvent(pool, {
    actorUserId: actor.userId,
    actorDoctorId: actor.doctorId,
    eventType: "roster_assignment_created",
    targetType: "doctor_roster_assignment",
    targetId: assignment.id,
    metadata: { rosterWeekId: assignment.rosterWeekId, dutyType: assignment.dutyType, date: assignment.date },
    reason: null,
  });
  return assignment;
}

export async function updateAssignment(
  assignmentId: number,
  input: Partial<AssignmentInput>,
  actor: { userId: UserId; doctorId: number }
): Promise<RosterAssignmentRow | null> {
  const result = await pool.query<Omit<RosterAssignmentRow, "members">>(
    `
      update doctor_portal.doctor_roster_assignments
      set
        date = coalesce($2::date, date),
        modality_id = case when $10::boolean then $3 else modality_id end,
        duty_type = coalesce($4, duty_type),
        session_name = $5,
        start_time = $6::time,
        end_time = $7::time,
        team_name = coalesce($8, team_name),
        status = coalesce($9, status),
        updated_at = now()
      where id = $1
      returning id, roster_week_id as "rosterWeekId", date::text as "date", modality_id as "modalityId",
        null::text as "modalityCode", null::text as "modalityNameEn", null::text as "modalityNameAr",
        duty_type as "dutyType", session_name as "sessionName", start_time::text as "startTime",
        end_time::text as "endTime", team_name as "teamName", status,
        created_at as "createdAt", updated_at as "updatedAt"
    `,
    [
      assignmentId,
      input.date ?? null,
      input.modalityId ?? null,
      input.dutyType ?? null,
      input.sessionName ?? null,
      input.startTime ?? null,
      input.endTime ?? null,
      input.teamName ?? null,
      input.status ?? null,
      Object.prototype.hasOwnProperty.call(input, "modalityId"),
    ]
  );
  const row = result.rows[0];
  if (!row) return null;
  await insertDoctorAuditEvent(pool, {
    actorUserId: actor.userId,
    actorDoctorId: actor.doctorId,
    eventType: "roster_assignment_updated",
    targetType: "doctor_roster_assignment",
    targetId: row.id,
    metadata: { rosterWeekId: row.rosterWeekId, dutyType: row.dutyType, date: row.date },
    reason: null,
  });
  return { ...row, members: await listMembersForAssignment(pool, row.id) };
}

export async function deleteAssignment(assignmentId: number, actor: { userId: UserId; doctorId: number }): Promise<boolean> {
  const result = await pool.query<{ id: number; roster_week_id: number }>(
    `
      delete from doctor_portal.doctor_roster_assignments
      where id = $1
      returning id, roster_week_id
    `,
    [assignmentId]
  );
  const removed = result.rows[0];
  if (!removed) return false;
  await insertDoctorAuditEvent(pool, {
    actorUserId: actor.userId,
    actorDoctorId: actor.doctorId,
    eventType: "roster_assignment_deleted",
    targetType: "doctor_roster_assignment",
    targetId: removed.id,
    metadata: { rosterWeekId: removed.roster_week_id },
    reason: null,
  });
  return true;
}

export async function addMember(
  assignmentId: number,
  doctorId: number,
  teamRole: RosterTeamRole,
  actor: { userId: UserId; doctorId: number }
): Promise<RosterMemberRow> {
  const result = await pool.query<RosterMemberRow>(
    `
      insert into doctor_portal.doctor_roster_members (roster_assignment_id, doctor_id, team_role)
      values ($1, $2, $3)
      on conflict (roster_assignment_id, doctor_id)
      do update set team_role = excluded.team_role, updated_at = now()
      returning id, roster_assignment_id as "rosterAssignmentId", doctor_id as "doctorId",
        ''::text as "displayName", ''::text as "doctorRole", team_role as "teamRole",
        created_at as "createdAt", updated_at as "updatedAt"
    `,
    [assignmentId, doctorId, teamRole]
  );
  const member = result.rows[0];
  await insertDoctorAuditEvent(pool, {
    actorUserId: actor.userId,
    actorDoctorId: actor.doctorId,
    eventType: "roster_member_added",
    targetType: "doctor_roster_member",
    targetId: member.id,
    metadata: { rosterAssignmentId: assignmentId, doctorId, teamRole },
    reason: null,
  });
  return member;
}

export async function removeMember(memberId: number, actor: { userId: UserId; doctorId: number }): Promise<boolean> {
  const result = await pool.query<{ id: number; roster_assignment_id: number; doctor_id: number }>(
    `
      delete from doctor_portal.doctor_roster_members
      where id = $1
      returning id, roster_assignment_id, doctor_id
    `,
    [memberId]
  );
  const removed = result.rows[0];
  if (!removed) return false;
  await insertDoctorAuditEvent(pool, {
    actorUserId: actor.userId,
    actorDoctorId: actor.doctorId,
    eventType: "roster_member_removed",
    targetType: "doctor_roster_member",
    targetId: removed.id,
    metadata: { rosterAssignmentId: removed.roster_assignment_id, doctorId: removed.doctor_id },
    reason: null,
  });
  return true;
}

export async function listMembersForAssignment(db: Db, assignmentId: number): Promise<RosterMemberRow[]> {
  const result = await db.query<RosterMemberRow>(
    `
      select
        rm.id,
        rm.roster_assignment_id as "rosterAssignmentId",
        rm.doctor_id as "doctorId",
        dp.display_name as "displayName",
        dp.doctor_role as "doctorRole",
        rm.team_role as "teamRole",
        rm.created_at as "createdAt",
        rm.updated_at as "updatedAt"
      from doctor_portal.doctor_roster_members rm
      join doctor_portal.doctor_profiles dp on dp.id = rm.doctor_id
      where rm.roster_assignment_id = $1
      order by rm.id asc
    `,
    [assignmentId]
  );
  return result.rows;
}

export async function publishWeek(weekId: number, actor: { userId: UserId; doctorId: number }): Promise<RosterWeekRow | null> {
  const result = await pool.query<RosterWeekRow>(
    `
      update doctor_portal.doctor_roster_weeks
      set status = 'published', published_by = $2, published_at = now(), updated_at = now()
      where id = $1 and status = 'draft'
      returning id, week_start_date::text as "weekStartDate", week_end_date::text as "weekEndDate", status,
        created_by as "createdBy", published_by as "publishedBy", published_at as "publishedAt",
        created_at as "createdAt", updated_at as "updatedAt"
    `,
    [weekId, actor.userId]
  );
  const week = result.rows[0] ?? null;
  if (week) {
    await insertDoctorAuditEvent(pool, {
      actorUserId: actor.userId,
      actorDoctorId: actor.doctorId,
      eventType: "roster_published",
      targetType: "doctor_roster_week",
      targetId: week.id,
      metadata: { weekStartDate: week.weekStartDate, weekEndDate: week.weekEndDate },
      reason: null,
    });
  }
  return week;
}

export async function archiveWeek(weekId: number, actor: { userId: UserId; doctorId: number }): Promise<RosterWeekRow | null> {
  const result = await pool.query<RosterWeekRow>(
    `
      update doctor_portal.doctor_roster_weeks
      set status = 'archived', updated_at = now()
      where id = $1 and status = 'published'
      returning id, week_start_date::text as "weekStartDate", week_end_date::text as "weekEndDate", status,
        created_by as "createdBy", published_by as "publishedBy", published_at as "publishedAt",
        created_at as "createdAt", updated_at as "updatedAt"
    `,
    [weekId]
  );
  const week = result.rows[0] ?? null;
  if (week) {
    await insertDoctorAuditEvent(pool, {
      actorUserId: actor.userId,
      actorDoctorId: actor.doctorId,
      eventType: "roster_archived",
      targetType: "doctor_roster_week",
      targetId: week.id,
      metadata: { weekStartDate: week.weekStartDate },
      reason: null,
    });
  }
  return week;
}

export async function copyPreviousWeek(
  targetWeekId: number,
  actor: { userId: UserId; doctorId: number }
): Promise<RosterWeekDetails> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const target = await findRosterWeekById(client, targetWeekId);
    if (!target) throw new Error("target_not_found");

    const previousResult = await client.query<RosterWeekRow>(
      `
        ${WEEK_SELECT}
        where week_start_date < $1::date
          and status in ('draft', 'published')
        order by week_start_date desc
        limit 1
      `,
      [target.weekStartDate]
    );
    const previous = previousResult.rows[0];
    if (!previous) throw new Error("previous_not_found");

    const previousAssignments = await listAssignmentsForWeek(client, previous.id);
    const dayOffsetMs = Date.parse(target.weekStartDate) - Date.parse(previous.weekStartDate);

    for (const assignment of previousAssignments) {
      const copiedDate = new Date(Date.parse(assignment.date) + dayOffsetMs).toISOString().slice(0, 10);
      const inserted = await client.query<{ id: number }>(
        `
          insert into doctor_portal.doctor_roster_assignments (
            roster_week_id, date, modality_id, duty_type, session_name, start_time, end_time, team_name, status
          )
          values ($1, $2::date, $3, $4, $5, $6::time, $7::time, $8, $9)
          returning id
        `,
        [
          target.id,
          copiedDate,
          assignment.modalityId,
          assignment.dutyType,
          assignment.sessionName,
          assignment.startTime,
          assignment.endTime,
          assignment.teamName,
          assignment.status,
        ]
      );
      const newAssignmentId = inserted.rows[0].id;
      for (const member of assignment.members) {
        await client.query(
          `
            insert into doctor_portal.doctor_roster_members (roster_assignment_id, doctor_id, team_role)
            values ($1, $2, $3)
            on conflict do nothing
          `,
          [newAssignmentId, member.doctorId, member.teamRole]
        );
      }
    }

    await insertDoctorAuditEvent(client, {
      actorUserId: actor.userId,
      actorDoctorId: actor.doctorId,
      eventType: "roster_copied",
      targetType: "doctor_roster_week",
      targetId: target.id,
      metadata: { sourceRosterWeekId: previous.id, copiedAssignments: previousAssignments.length },
      reason: null,
    });
    await client.query("commit");
    return { week: target, assignments: await listAssignmentsForWeek(pool, target.id) };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
