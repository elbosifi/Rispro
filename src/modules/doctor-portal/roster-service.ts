import { validateRosterDates } from "./roster-dates.js";
import { HttpError } from "../../utils/http-error.js";
import type { Role } from "../../types/domain.js";
import type { UserId } from "../../types/http.js";
import { getDoctorMe } from "./profile-service.js";
import {
  listDoctorProfiles,
  type DoctorProfileRow,
} from "./profile-repository.js";
import {
  addMember,
  archiveWeek,
  copyPreviousWeek,
  createRosterWeek,
  deleteAssignment,
  getRosterWeekDetails,
  insertAssignment,
  listMyRoster,
  publishWeek,
  removeMember,
  updateRosterWeekDates,
  updateAssignment,
  type AssignmentInput,
  type RosterCopyOptions,
  withDraftRosterWeek,
  listSavedRosterWeeks,
  listAssignmentsForWeek,
} from "./roster-repository.js";
import type { RosterTeamRole } from "./roster-types.js";
import { pool } from "../../db/pool.js";
import { insertDoctorAuditEvent } from "./profile-repository.js";
import {
  validateRosterAssignmentConflicts,
  validateRosterWeekConflicts,
} from "./roster-conflicts.js";

interface Actor {
  userId: UserId;
  appRole: Role;
}

export async function requireRosterDoctor(actor: Actor) {
  const me = await getDoctorMe(actor.userId, actor.appRole);
  if (!me.hasActiveDoctorProfile || !me.profile) {
    throw new HttpError(403, "Active doctor profile is required.");
  }
  return me;
}

export async function requireRosterManager(actor: Actor) {
  const me = await requireRosterDoctor(actor);
  if (
    !me.moduleCapabilities.includes("doctor_supervisor") &&
    !me.moduleCapabilities.includes("doctor_admin")
  ) {
    throw new HttpError(403, "Doctor supervisor access is required.");
  }
  return me;
}

async function rosterWeekIdForAssignment(
  assignmentId: number,
): Promise<number> {
  const result = await pool.query<{ roster_week_id: number }>(
    `select roster_week_id from doctor_portal.doctor_roster_assignments where id = $1 limit 1`,
    [assignmentId],
  );
  const row = result.rows[0];
  if (!row) throw new HttpError(404, "Roster assignment not found.");
  return Number(row.roster_week_id);
}

export async function getRosterWeekForManager(actor: Actor, weekStart: string) {
  await requireRosterManager(actor);
  return getRosterWeekDetails(weekStart);
}

export async function getMyRosterForDoctor(
  actor: Actor,
  weekStart: string | null,
) {
  const me = await requireRosterDoctor(actor);
  return listMyRoster(me.profile!.id, weekStart);
}

export async function listRosterDoctors(
  actor: Actor,
): Promise<DoctorProfileRow[]> {
  await requireRosterManager(actor);
  return (await listDoctorProfiles()).filter(
    (profile) => profile.active && profile.userActive !== false,
  );
}

export async function getSavedRosterWeeks(actor: Actor) {
  await requireRosterManager(actor);
  return listSavedRosterWeeks();
}

export async function createDraftRosterWeek(
  actor: Actor,
  input: { weekStartDate: string; weekEndDate: string } & RosterCopyOptions,
) {
  const me = await requireRosterManager(actor);
  validateRosterDates(input.weekStartDate, input.weekEndDate);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const week = await createRosterWeek(
      { ...input, actorUserId: actor.userId, actorDoctorId: me.profile!.id },
      client,
    );
    if (input.sourceRosterWeekId) {
      await copyPreviousWeek(
        week.id,
        { userId: actor.userId, doctorId: me.profile!.id },
        input,
        client,
      );
      await validateRosterWeekConflicts(week.id, client);
    }
    await client.query("commit");
    return week;
  } catch (error) {
    await client.query("rollback");
    if ((error as { code?: string }).code === "23505")
      throw new HttpError(
        409,
        "A roster already exists for this start date. Open that roster instead.",
      );
    throw error;
  } finally {
    client.release();
  }
}

export async function updateDraftRosterWeek(
  actor: Actor,
  weekId: number,
  input: { weekStartDate: string; weekEndDate: string },
) {
  const me = await requireRosterManager(actor);
  validateRosterDates(input.weekStartDate, input.weekEndDate);
  return withDraftRosterWeek(weekId, async (db) => {
    const assignments = await listAssignmentsForWeek(db, weekId);
    if (
      assignments.some(
        (row) => row.date < input.weekStartDate || row.date > input.weekEndDate,
      )
    )
      throw new HttpError(
        409,
        "Existing sections fall outside the new date range.",
      );
    return updateRosterWeekDates(
      weekId,
      input,
      { userId: actor.userId, doctorId: me.profile!.id },
      db,
    );
  });
}

function validateSection(input: AssignmentInput, start: string, end: string) {
  if (input.date < start || input.date > end)
    throw new HttpError(400, "Section date must be inside the roster range.");
  if (!input.teamName.trim())
    throw new HttpError(400, "Section name is required.");
  if (!input.dutyType.trim())
    throw new HttpError(400, "Duty type is required.");
}

export async function addRosterAssignment(
  actor: Actor,
  input: AssignmentInput,
) {
  const me = await requireRosterManager(actor);
  return withDraftRosterWeek(input.rosterWeekId, async (db, week) => {
    validateSection(input, week.weekStartDate, week.weekEndDate);
    return insertAssignment(
      input,
      { userId: actor.userId, doctorId: me.profile!.id },
      db,
    );
  });
}

export async function patchRosterAssignment(
  actor: Actor,
  assignmentId: number,
  input: Partial<AssignmentInput>,
) {
  const me = await requireRosterManager(actor);
  const weekId = await rosterWeekIdForAssignment(assignmentId);
  return withDraftRosterWeek(weekId, async (db, week) => {
    const current = (await listAssignmentsForWeek(db, weekId)).find(
      (row) => Number(row.id) === assignmentId,
    );
    if (!current) throw new HttpError(404, "Roster section not found.");
    const merged = {
      ...current,
      ...Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined),
      ),
    };
    validateSection(merged, week.weekStartDate, week.weekEndDate);
    return updateAssignment(
      assignmentId,
      merged,
      { userId: actor.userId, doctorId: me.profile!.id },
      db,
    );
  });
}

export async function removeRosterAssignment(
  actor: Actor,
  assignmentId: number,
) {
  const me = await requireRosterManager(actor);
  return withDraftRosterWeek(
    await rosterWeekIdForAssignment(assignmentId),
    async (db) => {
      if (
        !(await deleteAssignment(
          assignmentId,
          { userId: actor.userId, doctorId: me.profile!.id },
          db,
        ))
      )
        throw new HttpError(404, "Roster section not found.");
    },
  );
}

export async function addRosterMember(
  actor: Actor,
  assignmentId: number,
  doctorId: number,
  teamRole?: RosterTeamRole,
) {
  const me = await requireRosterManager(actor);
  const weekId = await rosterWeekIdForAssignment(assignmentId);
  return withDraftRosterWeek(weekId, async (db) => {
    const section = (await listAssignmentsForWeek(db, weekId)).find(
      (row) => Number(row.id) === assignmentId,
    );
    if (!section || section.status !== "active")
      throw new HttpError(409, "Choose an active roster section.");
    const profile = (
      await db.query<{ doctor_role: string }>(
        "select doctor_role from doctor_portal.doctor_profiles where id = $1 and active = true and exists (select 1 from users u where u.id = doctor_portal.doctor_profiles.user_id and u.is_active = true)",
        [doctorId],
      )
    ).rows[0];
    if (!profile) throw new HttpError(400, "Choose an active doctor.");
    const existing = section.members.find(
      (row) => Number(row.doctorId) === doctorId,
    );
    if (existing && !teamRole) return existing;
    const qualified =
      profile.doctor_role === "consultant" ||
      profile.doctor_role === "specialist";
    const suggested = qualified
      ? section.members.some((row) => row.teamRole === "lead")
        ? "specialist"
        : "lead"
      : "sho";
    return addMember(
      assignmentId,
      doctorId,
      teamRole ?? suggested,
      { userId: actor.userId, doctorId: me.profile!.id },
      db,
    );
  });
}

export async function removeRosterMember(
  actor: Actor,
  assignmentId: number,
  memberId: number,
) {
  const me = await requireRosterManager(actor);
  return withDraftRosterWeek(
    await rosterWeekIdForAssignment(assignmentId),
    async (db) => {
      const belongs = await db.query(
        "select id from doctor_portal.doctor_roster_members where id = $1 and roster_assignment_id = $2",
        [memberId, assignmentId],
      );
      if (!belongs.rowCount)
        throw new HttpError(404, "Roster member not found in this section.");
      await removeMember(
        memberId,
        { userId: actor.userId, doctorId: me.profile!.id },
        db,
      );
    },
  );
}

export async function transferRosterMember(
  actor: Actor,
  assignmentId: number,
  memberId: number,
  targetAssignmentId: number,
  copy: boolean,
) {
  const me = await requireRosterManager(actor);
  const weekId = await rosterWeekIdForAssignment(assignmentId);
  if (weekId !== (await rosterWeekIdForAssignment(targetAssignmentId)))
    throw new HttpError(400, "Choose a section in the same roster.");
  return withDraftRosterWeek(weekId, async (db) => {
    const sections = await listAssignmentsForWeek(db, weekId);
    const source = sections.find((row) => Number(row.id) === assignmentId);
    const target = sections.find(
      (row) => Number(row.id) === targetAssignmentId,
    );
    const member = source?.members.find((row) => Number(row.id) === memberId);
    if (
      !member ||
      !target ||
      target.status !== "active" ||
      source?.status !== "active"
    )
      throw new HttpError(404, "Active roster section or member not found.");
    if (assignmentId === targetAssignmentId) return;
    if (
      target.members.some(
        (row) => Number(row.doctorId) === Number(member.doctorId),
      )
    )
      throw new HttpError(409, "Doctor is already assigned to that section.");
    await addMember(
      targetAssignmentId,
      Number(member.doctorId),
      member.teamRole,
      { userId: actor.userId, doctorId: me.profile!.id },
      db,
    );
    if (!copy)
      await removeMember(
        memberId,
        { userId: actor.userId, doctorId: me.profile!.id },
        db,
      );
    await insertDoctorAuditEvent(db, {
      actorUserId: actor.userId,
      actorDoctorId: me.profile!.id,
      eventType: copy ? "roster_member_copied" : "roster_member_moved",
      targetType: "doctor_roster_member",
      targetId: memberId,
      metadata: {
        sourceAssignmentId: assignmentId,
        targetAssignmentId,
        doctorId: member.doctorId,
      },
      reason: null,
    });
  });
}

export async function publishRosterWeek(actor: Actor, weekId: number) {
  const me = await requireRosterManager(actor);
  // A successful publish and its audit share the same draft lock and transaction.
  const result = await withDraftRosterWeek(weekId, async (db) => {
    const errors = (await validateRosterWeekConflicts(weekId, db)).filter(
      (row) => row.severity === "error",
    );
    if (errors.length) return { errors, week: null };
    return {
      errors,
      week: await publishWeek(
        weekId,
        { userId: actor.userId, doctorId: me.profile!.id },
        db,
      ),
    };
  });
  if (result.errors.length) {
    await insertDoctorAuditEvent(pool, {
      actorUserId: actor.userId,
      actorDoctorId: me.profile!.id,
      eventType: "roster_publish_blocked",
      targetType: "doctor_roster_week",
      targetId: weekId,
      metadata: { errorCount: result.errors.length, conflicts: result.errors },
      reason: null,
    });
    throw new HttpError(409, "Roster has publish-blocking conflicts.", {
      conflicts: result.errors,
    });
  }
  return result.week;
}

export async function getRosterWeekConflicts(actor: Actor, weekId: number) {
  await requireRosterManager(actor);
  return validateRosterWeekConflicts(weekId);
}

export async function validateRosterAssignment(
  actor: Actor,
  assignmentId: number,
) {
  await requireRosterManager(actor);
  return validateRosterAssignmentConflicts(assignmentId);
}

export async function archiveRosterWeek(actor: Actor, weekId: number) {
  const me = await requireRosterManager(actor);
  const week = await archiveWeek(weekId, {
    userId: actor.userId,
    doctorId: me.profile!.id,
  });
  if (!week)
    throw new HttpError(409, "Only published roster weeks can be archived.");
  return week;
}

export async function copyPreviousRosterWeek(
  actor: Actor,
  weekId: number,
  options: RosterCopyOptions = {},
) {
  const me = await requireRosterManager(actor);
  return withDraftRosterWeek(weekId, async (db) => {
    const roster = await copyPreviousWeek(
      weekId,
      { userId: actor.userId, doctorId: me.profile!.id },
      options,
      db,
    );
    return {
      ...roster,
      conflicts: await validateRosterWeekConflicts(weekId, db),
    };
  });
}
