import { pool } from "../../db/pool.js";
import type { UserId } from "../../types/http.js";
import { insertDoctorAuditEvent } from "./profile-repository.js";
import { findRosterWeekById, findRosterWeekByStart, listAssignmentsForWeek } from "./roster-repository.js";
import type { RosterAssignmentRow, RosterTeamRole, RosterWeekRow } from "./roster-types.js";
import type { CandidateDoctor, GenerateDraftRosterInput, RosterNotificationRow, RosterNotificationSummary } from "./roster-planning-types.js";
import { validateRosterWeekConflicts } from "./roster-conflicts.js";
import { applyRosterTemplate } from "./roster-template-repository.js";

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createOrFindDraftWeek(weekStartDate: string, actor: { userId: UserId; doctorId: number }): Promise<RosterWeekRow> {
  const existing = await findRosterWeekByStart(weekStartDate);
  if (existing) {
    if (existing.status !== "draft") throw new Error("target_week_not_draft");
    return existing;
  }
  const result = await pool.query<RosterWeekRow>(
    `
      insert into doctor_portal.doctor_roster_weeks (week_start_date, week_end_date, created_by)
      values ($1::date, $2::date, $3)
      returning id, week_start_date::text as "weekStartDate", week_end_date::text as "weekEndDate", status,
        created_by as "createdBy", published_by as "publishedBy", published_at as "publishedAt",
        created_at as "createdAt", updated_at as "updatedAt"
    `,
    [weekStartDate, addDays(weekStartDate, 6), actor.userId]
  );
  const week = result.rows[0];
  await insertDoctorAuditEvent(pool, {
    actorUserId: actor.userId,
    actorDoctorId: actor.doctorId,
    eventType: "roster_generated_draft_week_created",
    targetType: "doctor_roster_week",
    targetId: week.id,
    metadata: { weekStartDate: week.weekStartDate, weekEndDate: week.weekEndDate },
    reason: null,
  });
  return week;
}

export async function listCandidateDoctorsForAssignment(assignment: RosterAssignmentRow): Promise<CandidateDoctor[]> {
  const values: unknown[] = [];
  const where = ["dp.active = true"];
  if (assignment.modalityId) {
    values.push(assignment.modalityId);
    where.push(`exists (
      select 1
      from doctor_portal.doctor_modality_permissions dmp
      where dmp.doctor_id = dp.id
        and dmp.modality_id = $${values.length}
        and dmp.active = true
    )`);
  }
  values.push(assignment.date);
  const dateParam = values.length;
  where.push(`not exists (
    select 1
    from doctor_portal.doctor_availability da
    where da.doctor_id = dp.id
      and da.date = $${dateParam}::date
      and da.availability_status in ('unavailable', 'leave', 'conference', 'admin', 'teaching')
  )`);
  where.push(`not exists (
    select 1
    from doctor_portal.doctor_leave_requests dl
    where dl.doctor_id = dp.id
      and dl.status in ('pending', 'approved')
      and dl.start_date <= $${dateParam}::date
      and dl.end_date >= $${dateParam}::date
  )`);
  values.push(assignment.date, assignment.startTime ?? "00:00", assignment.endTime ?? "23:59:59");
  where.push(`not exists (
    select 1
    from doctor_portal.doctor_roster_members rm
    join doctor_portal.doctor_roster_assignments ra on ra.id = rm.roster_assignment_id
    where rm.doctor_id = dp.id
      and ra.date = $${values.length - 2}::date
      and coalesce(ra.start_time, '00:00'::time) < $${values.length}::time
      and $${values.length - 1}::time < coalesce(ra.end_time, '23:59:59'::time)
  )`);

  const result = await pool.query<CandidateDoctor>(
    `
      select dp.id, dp.display_name as "displayName", dp.doctor_role as "doctorRole"
      from doctor_portal.doctor_profiles dp
      where ${where.join(" and ")}
      order by
        case when dp.doctor_role in ('consultant', 'specialist') then 0 else 1 end,
        dp.display_name asc,
        dp.id asc
    `,
    values
  );
  return result.rows;
}

function roleForCandidate(candidate: CandidateDoctor, hasLead: boolean): RosterTeamRole | null {
  if (!hasLead && (candidate.doctorRole === "consultant" || candidate.doctorRole === "specialist")) return "lead";
  if (candidate.doctorRole === "consultant" || candidate.doctorRole === "specialist") return "specialist";
  return "sho";
}

export async function generateDraftRoster(
  input: GenerateDraftRosterInput,
  actor: { userId: UserId; doctorId: number }
) {
  const warnings: string[] = [];
  const unfilledRequirements: string[] = [];
  let assignmentsCreated = 0;
  let membersAssigned = 0;

  if (input.templateId) {
    const applied = await applyRosterTemplate(input.templateId, {
      targetWeekStartDate: input.weekStartDate,
      copyMode: "structure_only",
      overwriteExisting: false,
      modalityId: input.modalityId,
    }, actor);
    assignmentsCreated += applied.createdAssignmentCount;
    warnings.push(...applied.conflicts.filter((conflict) => conflict.severity !== "error").map((conflict) => conflict.message));
  }

  const week = await createOrFindDraftWeek(input.weekStartDate, actor);
  if (week.status !== "draft") throw new Error("target_week_not_draft");
  const assignments = await listAssignmentsForWeek(pool, week.id);

  if (input.includeDoctors) {
    for (const assignment of assignments) {
      if (assignment.members.length > 0) continue;
      const candidates = await listCandidateDoctorsForAssignment(assignment);
      let hasLead = false;
      for (const candidate of candidates.slice(0, 2)) {
        const teamRole = roleForCandidate(candidate, hasLead);
        if (!teamRole) continue;
        await pool.query(
          `
            insert into doctor_portal.doctor_roster_members (roster_assignment_id, doctor_id, team_role)
            values ($1, $2, $3)
            on conflict do nothing
          `,
          [assignment.id, candidate.id, teamRole]
        );
        membersAssigned += 1;
        hasLead = hasLead || teamRole === "lead";
      }
      if (!hasLead) {
        unfilledRequirements.push(`${assignment.date} ${assignment.teamName}: lead specialist unfilled`);
      }
    }
  }

  await insertDoctorAuditEvent(pool, {
    actorUserId: actor.userId,
    actorDoctorId: actor.doctorId,
    eventType: "roster_draft_generated",
    targetType: "doctor_roster_week",
    targetId: week.id,
    metadata: {
      templateId: input.templateId,
      includeDoctors: input.includeDoctors,
      balanceStrategy: input.balanceStrategy,
      assignmentsCreated,
      membersAssigned,
      unfilledRequirements,
    },
    reason: null,
  });

  const refreshedWeek = await findRosterWeekById(pool, week.id);
  if (!refreshedWeek) throw new Error("target_week_not_found");
  const conflicts = await validateRosterWeekConflicts(week.id);
  return { week: refreshedWeek, assignmentsCreated, membersAssigned, conflicts, unfilledRequirements, warnings };
}

export async function listRosterNotifications(weekId: number): Promise<RosterNotificationRow[]> {
  const result = await pool.query<RosterNotificationRow>(
    `
      select
        rn.id,
        rn.roster_week_id as "rosterWeekId",
        rn.doctor_id as "doctorId",
        dp.display_name as "doctorName",
        rn.notification_type as "notificationType",
        rn.status,
        rn.sent_at as "sentAt",
        rn.error,
        rn.created_at as "createdAt"
      from doctor_portal.doctor_roster_notifications rn
      join doctor_portal.doctor_profiles dp on dp.id = rn.doctor_id
      where rn.roster_week_id = $1
      order by dp.display_name asc, rn.id asc
    `,
    [weekId]
  );
  return result.rows;
}

export async function createRosterNotifications(
  weekId: number,
  actor: { userId: UserId; doctorId: number }
): Promise<RosterNotificationSummary> {
  const week = await findRosterWeekById(pool, weekId);
  if (!week) throw new Error("week_not_found");
  if (week.status !== "published") throw new Error("week_not_published");

  const doctorRows = await pool.query<{ doctor_id: number }>(
    `
      select distinct rm.doctor_id
      from doctor_portal.doctor_roster_assignments ra
      join doctor_portal.doctor_roster_members rm on rm.roster_assignment_id = ra.id
      where ra.roster_week_id = $1
        and ra.status = 'active'
    `,
    [weekId]
  );
  let createdCount = 0;
  let alreadyExistingCount = 0;
  for (const row of doctorRows.rows) {
    const result = await pool.query<{ inserted: boolean }>(
      `
        insert into doctor_portal.doctor_roster_notifications (roster_week_id, doctor_id, notification_type, status, sent_at)
        values ($1, $2, 'roster_published', 'created', now())
        on conflict (roster_week_id, doctor_id, notification_type) do nothing
        returning true as inserted
      `,
      [weekId, row.doctor_id]
    );
    if (result.rowCount) createdCount += 1;
    else alreadyExistingCount += 1;
  }
  await insertDoctorAuditEvent(pool, {
    actorUserId: actor.userId,
    actorDoctorId: actor.doctorId,
    eventType: "roster_notifications_created",
    targetType: "doctor_roster_week",
    targetId: weekId,
    metadata: { createdCount, alreadyExistingCount },
    reason: null,
  });
  return { createdCount, alreadyExistingCount, notifications: await listRosterNotifications(weekId) };
}
