import { pool } from "../../db/pool.js";
import type { PoolClient } from "pg";
import type { UserId } from "../../types/http.js";
import { insertDoctorAuditEvent } from "./profile-repository.js";
import { findRosterWeekByStart, findRosterWeekById } from "./roster-repository.js";
import type {
  ApplyRosterTemplateResult,
  RosterTemplateAssignmentInput,
  RosterTemplateAssignmentRow,
  RosterTemplateCopyMode,
  RosterTemplateInput,
  RosterTemplateMemberRow,
  RosterTemplateRow,
} from "./roster-template-types.js";
import { validateRosterWeekConflicts } from "./roster-conflicts.js";

type Db = Pick<PoolClient, "query"> | typeof pool;

const TEMPLATE_SELECT = `
  select
    rt.id,
    rt.name,
    rt.description,
    rt.modality_id as "modalityId",
    m.code as "modalityCode",
    m.name_en as "modalityNameEn",
    m.name_ar as "modalityNameAr",
    rt.template_type as "templateType",
    rt.active,
    rt.created_by as "createdBy",
    rt.created_at as "createdAt",
    rt.updated_at as "updatedAt"
  from doctor_portal.roster_templates rt
  left join modalities m on m.id = rt.modality_id
`;

async function listTemplateAssignments(db: Db, templateId: number): Promise<RosterTemplateAssignmentRow[]> {
  const assignmentResult = await db.query<Omit<RosterTemplateAssignmentRow, "members">>(
    `
      select
        rta.id,
        rta.template_id as "templateId",
        rta.day_of_week as "dayOfWeek",
        rta.modality_id as "modalityId",
        m.code as "modalityCode",
        m.name_en as "modalityNameEn",
        m.name_ar as "modalityNameAr",
        rta.duty_type as "dutyType",
        rta.session_name as "sessionName",
        rta.start_time::text as "startTime",
        rta.end_time::text as "endTime",
        rta.team_name as "teamName",
        rta.sort_order as "sortOrder",
        rta.created_at as "createdAt",
        rta.updated_at as "updatedAt"
      from doctor_portal.roster_template_assignments rta
      left join modalities m on m.id = rta.modality_id
      where rta.template_id = $1
      order by rta.day_of_week asc, rta.sort_order asc, rta.id asc
    `,
    [templateId]
  );
  const assignments: RosterTemplateAssignmentRow[] = assignmentResult.rows.map((row) => ({ ...row, members: [] }));
  if (assignments.length === 0) return assignments;

  const memberResult = await db.query<RosterTemplateMemberRow>(
    `
      select
        rtm.id,
        rtm.template_assignment_id as "templateAssignmentId",
        rtm.doctor_id as "doctorId",
        dp.display_name as "doctorName",
        rtm.team_role as "teamRole",
        rtm.placeholder_label as "placeholderLabel",
        rtm.required_role as "requiredRole",
        rtm.created_at as "createdAt",
        rtm.updated_at as "updatedAt"
      from doctor_portal.roster_template_members rtm
      left join doctor_portal.doctor_profiles dp on dp.id = rtm.doctor_id
      where rtm.template_assignment_id = any($1::bigint[])
      order by rtm.id asc
    `,
    [assignments.map((assignment) => assignment.id)]
  );
  const byAssignmentId = new Map(assignments.map((assignment) => [Number(assignment.id), assignment.members]));
  for (const member of memberResult.rows) {
    byAssignmentId.get(Number(member.templateAssignmentId))?.push(member);
  }
  return assignments;
}

async function hydrateTemplate(db: Db, row: Omit<RosterTemplateRow, "assignments">): Promise<RosterTemplateRow> {
  return { ...row, assignments: await listTemplateAssignments(db, Number(row.id)) };
}

export async function listRosterTemplates(includeInactive = false): Promise<RosterTemplateRow[]> {
  const result = await pool.query<Omit<RosterTemplateRow, "assignments">>(
    `
      ${TEMPLATE_SELECT}
      ${includeInactive ? "" : "where rt.active = true"}
      order by rt.active desc, rt.template_type asc, rt.name asc, rt.id asc
    `
  );
  return Promise.all(result.rows.map((row) => hydrateTemplate(pool, row)));
}

export async function findRosterTemplateById(db: Db, templateId: number): Promise<RosterTemplateRow | null> {
  const result = await db.query<Omit<RosterTemplateRow, "assignments">>(`${TEMPLATE_SELECT} where rt.id = $1 limit 1`, [templateId]);
  const row = result.rows[0];
  return row ? hydrateTemplate(db, row) : null;
}

async function insertTemplateAssignments(db: Db, templateId: number, assignments: RosterTemplateAssignmentInput[]) {
  for (const assignment of assignments) {
    const inserted = await db.query<{ id: number }>(
      `
        insert into doctor_portal.roster_template_assignments (
          template_id, day_of_week, modality_id, duty_type, session_name, start_time, end_time, team_name, sort_order
        )
        values ($1, $2, $3, $4, $5, $6::time, $7::time, $8, $9)
        returning id
      `,
      [
        templateId,
        assignment.dayOfWeek,
        assignment.modalityId,
        assignment.dutyType,
        assignment.sessionName,
        assignment.startTime,
        assignment.endTime,
        assignment.teamName,
        assignment.sortOrder,
      ]
    );
    const assignmentId = Number(inserted.rows[0].id);
    for (const member of assignment.members) {
      await db.query(
        `
          insert into doctor_portal.roster_template_members (
            template_assignment_id, doctor_id, team_role, placeholder_label, required_role
          )
          values ($1, $2, $3, $4, $5)
        `,
        [assignmentId, member.doctorId, member.teamRole, member.placeholderLabel, member.requiredRole]
      );
    }
  }
}

export async function createRosterTemplate(input: RosterTemplateInput, actor: { userId: UserId; doctorId: number }): Promise<RosterTemplateRow> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query<Omit<RosterTemplateRow, "assignments">>(
      `
        insert into doctor_portal.roster_templates (name, description, modality_id, template_type, created_by)
        values ($1, $2, $3, $4, $5)
        returning id, name, description, modality_id as "modalityId", null::text as "modalityCode",
          null::text as "modalityNameEn", null::text as "modalityNameAr", template_type as "templateType",
          active, created_by as "createdBy", created_at as "createdAt", updated_at as "updatedAt"
      `,
      [input.name, input.description, input.modalityId, input.templateType, actor.userId]
    );
    const templateId = Number(result.rows[0].id);
    await insertTemplateAssignments(client, templateId, input.assignments);
    await insertDoctorAuditEvent(client, {
      actorUserId: actor.userId,
      actorDoctorId: actor.doctorId,
      eventType: "roster_template_created",
      targetType: "roster_template",
      targetId: templateId,
      metadata: { name: input.name, templateType: input.templateType, assignmentCount: input.assignments.length },
      reason: null,
    });
    await client.query("commit");
    const template = await findRosterTemplateById(pool, templateId);
    if (!template) throw new Error("template_not_found");
    return template;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateRosterTemplate(templateId: number, input: Partial<RosterTemplateInput>, actor: { userId: UserId; doctorId: number }): Promise<RosterTemplateRow | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query<{ id: number }>(
      `
        update doctor_portal.roster_templates
        set name = coalesce($2, name),
            description = case when $6::boolean then $3 else description end,
            modality_id = case when $7::boolean then $4 else modality_id end,
            template_type = coalesce($5, template_type),
            updated_at = now()
        where id = $1 and active = true
        returning id
      `,
      [
        templateId,
        input.name ?? null,
        input.description ?? null,
        input.modalityId ?? null,
        input.templateType ?? null,
        Object.prototype.hasOwnProperty.call(input, "description"),
        Object.prototype.hasOwnProperty.call(input, "modalityId"),
      ]
    );
    if (!result.rows[0]) {
      await client.query("rollback");
      return null;
    }
    if (input.assignments) {
      await client.query(`delete from doctor_portal.roster_template_assignments where template_id = $1`, [templateId]);
      await insertTemplateAssignments(client, templateId, input.assignments);
    }
    await insertDoctorAuditEvent(client, {
      actorUserId: actor.userId,
      actorDoctorId: actor.doctorId,
      eventType: "roster_template_updated",
      targetType: "roster_template",
      targetId: templateId,
      metadata: { assignmentCount: input.assignments?.length ?? null },
      reason: null,
    });
    await client.query("commit");
    return findRosterTemplateById(pool, templateId);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function deactivateRosterTemplate(templateId: number, actor: { userId: UserId; doctorId: number }): Promise<boolean> {
  const result = await pool.query<{ id: number }>(
    `
      update doctor_portal.roster_templates
      set active = false, updated_at = now()
      where id = $1 and active = true
      returning id
    `,
    [templateId]
  );
  const row = result.rows[0];
  if (!row) return false;
  await insertDoctorAuditEvent(pool, {
    actorUserId: actor.userId,
    actorDoctorId: actor.doctorId,
    eventType: "roster_template_deactivated",
    targetType: "roster_template",
    targetId: Number(row.id),
    metadata: {},
    reason: null,
  });
  return true;
}

function addDays(weekStart: string, dayOfWeek: number): string {
  const date = new Date(`${weekStart}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dayOfWeek - 1);
  return date.toISOString().slice(0, 10);
}

async function createOrFindDraftWeek(db: Db, weekStartDate: string, actor: { userId: UserId }) {
  const existing = await findRosterWeekByStart(weekStartDate);
  if (existing) return existing;
  const date = new Date(`${weekStartDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 6);
  const weekEndDate = date.toISOString().slice(0, 10);
  const result = await db.query(
    `
      insert into doctor_portal.doctor_roster_weeks (week_start_date, week_end_date, created_by)
      values ($1::date, $2::date, $3)
      returning id, week_start_date::text as "weekStartDate", week_end_date::text as "weekEndDate", status,
        created_by as "createdBy", published_by as "publishedBy", published_at as "publishedAt",
        created_at as "createdAt", updated_at as "updatedAt"
    `,
    [weekStartDate, weekEndDate, actor.userId]
  );
  return result.rows[0];
}

export async function applyRosterTemplate(
  templateId: number,
  input: {
    targetWeekStartDate: string;
    copyMode: RosterTemplateCopyMode;
    overwriteExisting: boolean;
    modalityId: number | null;
  },
  actor: { userId: UserId; doctorId: number }
): Promise<ApplyRosterTemplateResult> {
  const client = await pool.connect();
  let weekId = 0;
  let createdAssignmentCount = 0;
  let copiedMemberCount = 0;
  let skippedCount = 0;
  try {
    await client.query("begin");
    const template = await findRosterTemplateById(client, templateId);
    if (!template || !template.active) throw new Error("template_not_found");
    const week = await createOrFindDraftWeek(client, input.targetWeekStartDate, actor);
    weekId = Number(week.id);
    const currentWeek = await findRosterWeekById(client, weekId);
    if (!currentWeek || currentWeek.status !== "draft") throw new Error("target_week_not_draft");

    if (input.overwriteExisting) {
      await client.query(`delete from doctor_portal.doctor_roster_assignments where roster_week_id = $1`, [weekId]);
    }

    for (const assignment of template.assignments) {
      const modalityId = input.modalityId ?? assignment.modalityId;
      const date = addDays(input.targetWeekStartDate, assignment.dayOfWeek);
      const duplicate = await client.query<{ id: number }>(
        `
          select id
          from doctor_portal.doctor_roster_assignments
          where roster_week_id = $1
            and date = $2::date
            and duty_type = $3
            and coalesce(session_name, '') = coalesce($4, '')
            and coalesce(team_name, '') = coalesce($5, '')
            and coalesce(modality_id, -1) = coalesce($6, -1)
          limit 1
        `,
        [weekId, date, assignment.dutyType, assignment.sessionName, assignment.teamName, modalityId]
      );
      if (duplicate.rows[0]) {
        skippedCount += 1;
        continue;
      }
      const inserted = await client.query<{ id: number }>(
        `
          insert into doctor_portal.doctor_roster_assignments (
            roster_week_id, date, modality_id, duty_type, session_name, start_time, end_time, team_name, status
          )
          values ($1, $2::date, $3, $4, $5, $6::time, $7::time, $8, 'active')
          returning id
        `,
        [weekId, date, modalityId, assignment.dutyType, assignment.sessionName, assignment.startTime, assignment.endTime, assignment.teamName]
      );
      const assignmentId = Number(inserted.rows[0].id);
      createdAssignmentCount += 1;
      if (input.copyMode === "structure_only") {
        continue;
      }
      if (input.copyMode === "structure_with_named_doctors") {
        for (const member of assignment.members.filter((row) => row.doctorId != null)) {
          await client.query(
            `
              insert into doctor_portal.doctor_roster_members (roster_assignment_id, doctor_id, team_role)
              values ($1, $2, $3)
              on conflict do nothing
            `,
            [assignmentId, member.doctorId, member.teamRole]
          );
          copiedMemberCount += 1;
        }
      }
    }

    await insertDoctorAuditEvent(client, {
      actorUserId: actor.userId,
      actorDoctorId: actor.doctorId,
      eventType: "roster_template_applied",
      targetType: "roster_template",
      targetId: templateId,
      metadata: { weekId, createdAssignmentCount, copiedMemberCount, skippedCount, copyMode: input.copyMode },
      reason: null,
    });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  const week = await findRosterWeekById(pool, weekId);
  if (!week) throw new Error("target_week_not_found");
  const conflicts = await validateRosterWeekConflicts(weekId);
  if (conflicts.length > 0) {
    await insertDoctorAuditEvent(pool, {
      actorUserId: actor.userId,
      actorDoctorId: actor.doctorId,
      eventType: "roster_template_apply_conflicts",
      targetType: "doctor_roster_week",
      targetId: weekId,
      metadata: { templateId, conflictCount: conflicts.length, conflicts },
      reason: null,
    });
  }
  return { week, createdAssignmentCount, copiedMemberCount, skippedCount, conflicts };
}
