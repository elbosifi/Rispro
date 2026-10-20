import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getTripoliToday } from "../../utils/date.js";
import { mapRosterDate } from "./roster-dates.js";

const addDays = (date: string, days: number) =>
  new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);

describe(
  "roster board persistence",
  { skip: !process.env.TEST_DATABASE_URL },
  () => {
    let pool: typeof import("../../db/pool.js").pool;
    let service: typeof import("./roster-service.js");
    let repo: typeof import("./roster-repository.js");
    let manager: { userId: string; appRole: "supervisor" };
    let doctor: { userId: string; appRole: "doctor" };
    let managerDoctorId: number;
    let juniorId: number;
    let modalityId: number;
    const users: number[] = [];
    const weeks: number[] = [];
    let sourceId: number;
    let sourceStart: string;
    let targetId: number;
    let targetStart: string;
    let sourceSectionId: number;
    let targetSectionId: number;
    const prefix = `roster_board_${randomUUID().slice(0, 8)}`;
    const asNumber = (value: unknown) => Number(value);
    const actor = () => ({ userId: manager.userId, doctorId: managerDoctorId });

    before(async () => {
      pool = (await import("../../db/pool.js")).pool;
      assert.match(
        (await pool.query("select current_database() as db")).rows[0].db,
        /test/i,
      );
      service = await import("./roster-service.js");
      repo = await import("./roster-repository.js");
      for (const [suffix, role, grade, supervise] of [
        ["manager", "supervisor", "consultant", true],
        ["junior", "doctor", "resident", false],
      ] as const) {
        const user = (
          await pool.query(
            "insert into users (username, password_hash, full_name, role, is_active) values ($1, 'test-only', $1, $2, true) returning id",
            [`${prefix}_${suffix}`, role],
          )
        ).rows[0];
        users.push(Number(user.id));
        const profile = (
          await pool.query(
            "insert into doctor_portal.doctor_profiles (user_id, display_name, doctor_role, active, can_supervise) values ($1, $2, $3, true, $4) returning id",
            [user.id, `${prefix}_${suffix}`, grade, supervise],
          )
        ).rows[0];
        if (suffix === "manager") {
          manager = { userId: String(user.id), appRole: "supervisor" };
          managerDoctorId = Number(profile.id);
        } else {
          doctor = { userId: String(user.id), appRole: "doctor" };
          juniorId = Number(profile.id);
        }
      }
      modalityId = Number(
        (
          await pool.query(
            "insert into modalities (code, name_en, name_ar, is_active) values ($1, $1, $1, true) returning id",
            [prefix],
          )
        ).rows[0].id,
      );
      for (const id of [managerDoctorId, juniorId])
        await pool.query(
          "insert into doctor_portal.doctor_modality_permissions (doctor_id, modality_id, active) values ($1, $2, true)",
          [id, modalityId],
        );
      let candidate = addDays(getTripoliToday(), 7000);
      candidate = addDays(candidate, (7 - new Date(candidate).getUTCDay()) % 7);
      while (
        (
          await pool.query(
            "select id from doctor_portal.doctor_roster_weeks where week_start_date between $1::date and $1::date + 100",
            [candidate],
          )
        ).rowCount
      )
        candidate = addDays(candidate, 140);
      sourceStart = candidate;
      targetStart = addDays(candidate, 14);
      const source = await service.createDraftRosterWeek(manager, {
        weekStartDate: sourceStart,
        weekEndDate: addDays(sourceStart, 6),
      });
      sourceId = Number(source.id);
      weeks.push(sourceId);
      // Use a configured duty from this installation; do not alter shared configuration.
      const duties = await (
        await import("./roster-config-repository.js")
      ).listRosterDutyTypes(false);
      const dutyType =
        duties.find((row) => row.code === "general_reporting")?.code ??
        duties[0].code;
      for (const [offset, name] of [
        [0, "Sunday CT"],
        [1, "Monday MRI"],
        [5, "Friday excluded"],
      ] as const) {
        const section = await service.addRosterAssignment(manager, {
          rosterWeekId: sourceId,
          date: addDays(sourceStart, offset),
          modalityId,
          dutyType,
          sessionName: "AM",
          startTime: "08:00",
          endTime: "14:00",
          teamName: name,
        });
        if (offset === 0) sourceSectionId = Number(section.id);
        await service.addRosterMember(
          manager,
          Number(section.id),
          managerDoctorId,
          "lead",
        );
        await service.addRosterMember(
          manager,
          Number(section.id),
          juniorId,
          "observer",
        );
      }
      const target = await service.createDraftRosterWeek(manager, {
        weekStartDate: targetStart,
        weekEndDate: addDays(targetStart, 4),
      });
      targetId = Number(target.id);
      weeks.push(targetId);
    });
    after(async () => {
      if (!pool) return;
      await pool.query(
        "delete from doctor_portal.doctor_roster_weeks where id = any($1::bigint[])",
        [weeks],
      );
      await pool.query(
        "delete from doctor_portal.doctor_module_audit_events where actor_user_id = any($1::bigint[])",
        [users],
      );
      await pool.query(
        "delete from doctor_portal.doctor_profiles where user_id = any($1::bigint[])",
        [users],
      );
      await pool.query("delete from users where id = any($1::bigint[])", [
        users,
      ]);
      if (modalityId)
        await pool.query("delete from modalities where id = $1", [modalityId]);
      await pool.end();
    });

    it("copies an explicitly selected source by weekday with sections, hours, roles and source audit", async () => {
      const before = await repo.getRosterWeekDetails(sourceStart);
      await pool.query(
        "insert into doctor_portal.doctor_availability (doctor_id, date, availability_status) values ($1, $2, 'unavailable')",
        [managerDoctorId, targetStart],
      );
      const result = await service.copyPreviousRosterWeek(manager, targetId, {
        sourceRosterWeekId: sourceId,
      });
      assert.ok(
        result.conflicts.some((row) => row.code === "doctor_unavailable"),
      );
      await pool.query(
        "delete from doctor_portal.doctor_availability where doctor_id = $1",
        [managerDoctorId],
      );
      assert.equal(result.week?.status, "draft");
      assert.equal(result.assignments.length, 2);
      assert.deepEqual(
        result.assignments.map((row) => row.date),
        [targetStart, addDays(targetStart, 1)],
      );
      assert.deepEqual(
        result.assignments.map((row) => row.teamName),
        ["Sunday CT", "Monday MRI"],
      );
      assert.equal(Number(result.assignments[0].modalityId), modalityId);
      assert.equal(
        result.assignments[0].dutyType,
        before.assignments[0].dutyType,
      );
      assert.equal(result.assignments[0].sessionName, "AM");
      assert.equal(result.assignments[0].startTime, "08:00:00");
      assert.equal(result.assignments[0].endTime, "14:00:00");
      assert.deepEqual(
        result.assignments[0].members.map((row) => [
          asNumber(row.doctorId),
          row.teamRole,
        ]),
        [
          [managerDoctorId, "lead"],
          [juniorId, "observer"],
        ],
      );
      assert.deepEqual(await repo.getRosterWeekDetails(sourceStart), before);
      targetSectionId = Number(result.assignments[0].id);
      const audit = await pool.query(
        "select metadata_json as metadata from doctor_portal.doctor_module_audit_events where target_id = $1 and event_type = 'roster_copied'",
        [String(targetId)],
      );
      assert.equal(Number(audit.rows[0].metadata.sourceRosterWeekId), sourceId);
    });
    it("keeps My Roster's Monday viewing window compatible with Sunday-start rosters", async () => {
      const mine = await service.getMyRosterForDoctor(
        doctor,
        addDays(sourceStart, 1),
      );
      assert.equal(Number(mine.week?.id), sourceId);
      assert.deepEqual(
        mine.assignments.map((row) => row.date),
        [addDays(sourceStart, 1), addDays(sourceStart, 5)],
      );
    });
    it("protects a populated draft and repeated requests never append duplicates", async () => {
      const before = await repo.getRosterWeekDetails(targetStart);
      await assert.rejects(
        service.copyPreviousRosterWeek(manager, targetId, {
          sourceRosterWeekId: sourceId,
        }),
        /already contains/,
      );
      await assert.rejects(
        service.copyPreviousRosterWeek(manager, targetId, {
          sourceRosterWeekId: sourceId,
        }),
        /already contains/,
      );
      assert.deepEqual(await repo.getRosterWeekDetails(targetStart), before);
      const repeated = await service.addRosterMember(
        manager,
        targetSectionId,
        managerDoctorId,
      );
      assert.equal(repeated.teamRole, "lead");
      assert.equal(
        (await repo.getRosterWeekDetails(targetStart)).assignments[0].members
          .length,
        2,
      );
    });
    it("rolls back replacement, new-roster copying and audit together on an actual write failure", async () => {
      const before = await repo.getRosterWeekDetails(targetStart);
      // A connection-scoped statement trigger forces failure after the old draft is deleted.
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(
          "create function pg_temp.reject_roster_copy() returns trigger language plpgsql as $$ begin raise exception 'copy_write_failure'; end $$",
        );
        await client.query(
          "create trigger roster_copy_failure before insert on doctor_portal.doctor_roster_assignments for each statement execute function pg_temp.reject_roster_copy()",
        );
        await assert.rejects(
          repo.copyPreviousWeek(
            targetId,
            actor(),
            { sourceRosterWeekId: sourceId, replaceExisting: true },
            client,
          ),
          /copy_write_failure/,
        );
        await client.query("rollback");
      } finally {
        client.release();
      }
      assert.deepEqual(await repo.getRosterWeekDetails(targetStart), before);
      const newStart = addDays(targetStart, 70);
      await assert.rejects(
        service.createDraftRosterWeek(manager, {
          weekStartDate: newStart,
          weekEndDate: addDays(newStart, 4),
          sourceRosterWeekId: 2147483647,
        }),
        /source roster/,
      );
      assert.equal(await repo.findRosterWeekByStart(newStart), null);
    });
    it("supports explicit replacement and structure-only copying without changing the source", async () => {
      const before = await repo.getRosterWeekDetails(sourceStart);
      const result = await service.copyPreviousRosterWeek(manager, targetId, {
        sourceRosterWeekId: sourceId,
        replaceExisting: true,
        structureOnly: true,
      });
      assert.equal(result.assignments.length, 2);
      assert.ok(result.assignments.every((row) => !row.members.length));
      assert.deepEqual(await repo.getRosterWeekDetails(sourceStart), before);
      targetSectionId = Number(result.assignments[0].id);
    });
    it("suggests roles from professional grade and preserves membership responsibilities when moving atomically", async () => {
      const junior = await service.addRosterMember(
        manager,
        targetSectionId,
        juniorId,
      );
      assert.equal(junior.teamRole, "sho");
      const lead = await service.addRosterMember(
        manager,
        targetSectionId,
        managerDoctorId,
      );
      assert.equal(lead.teamRole, "lead");
      const destination = (await repo.getRosterWeekDetails(targetStart))
        .assignments[1];
      await service.transferRosterMember(
        manager,
        targetSectionId,
        Number(lead.id),
        Number(destination.id),
        false,
      );
      const after = await repo.getRosterWeekDetails(targetStart);
      assert.equal(after.assignments[0].members.length, 1);
      assert.equal(after.assignments[1].members[0].teamRole, "lead");
      const destinationMember = after.assignments[1].members[0];
      await service.addRosterMember(manager, targetSectionId, managerDoctorId);
      await assert.rejects(
        service.transferRosterMember(
          manager,
          Number(destination.id),
          Number(destinationMember.id),
          targetSectionId,
          false,
        ),
        /already assigned/,
      );
      assert.equal(
        (await repo.getRosterWeekDetails(targetStart)).assignments[1].members
          .length,
        1,
      );
      await assert.rejects(
        service.removeRosterMember(
          manager,
          targetSectionId,
          Number(destinationMember.id),
        ),
        /not found in this section/,
      );
    });
    it("rolls back both sides and their audit when removal fails during a move", async () => {
      const before = await repo.getRosterWeekDetails(targetStart);
      const member = before.assignments[0].members.find(
        (row) => Number(row.doctorId) === juniorId,
      )!;
      const destinationId = Number(before.assignments[1].id);
      const client = await pool.connect();
      const trigger = `${prefix}_move_failure`;
      try {
        await client.query(
          `create function pg_temp.reject_roster_move() returns trigger language plpgsql as $$ begin if old.id = ${Number(member.id)} then raise exception 'move_write_failure'; end if; return old; end $$`,
        );
        await client.query(
          `create trigger ${trigger} before delete on doctor_portal.doctor_roster_members for each row execute function pg_temp.reject_roster_move()`,
        );
        await assert.rejects(
          service.transferRosterMember(
            manager,
            targetSectionId,
            Number(member.id),
            destinationId,
            false,
          ),
          /move_write_failure/,
        );
      } finally {
        await client.query(
          `drop trigger if exists ${trigger} on doctor_portal.doctor_roster_members`,
        );
        await client.query("drop function pg_temp.reject_roster_move()");
        client.release();
      }
      assert.deepEqual(await repo.getRosterWeekDetails(targetStart), before);
    });
    it("blocks professional-grade and overlapping coverage errors without confusing other days", async () => {
      const original = (await repo.getRosterWeekDetails(sourceStart))
        .assignments[0];
      const overlap = await service.addRosterAssignment(manager, {
        ...original,
        teamName: "Overlap",
      });
      await service.addRosterMember(
        manager,
        Number(overlap.id),
        managerDoctorId,
      );
      assert.ok(
        (await service.getRosterWeekConflicts(manager, sourceId)).some(
          (row) => row.code === "overlapping_assignment",
        ),
      );
      await service.removeRosterAssignment(manager, Number(overlap.id));
      assert.ok(
        !(await service.getRosterWeekConflicts(manager, sourceId)).some(
          (row) => row.code === "overlapping_assignment",
        ),
      );
      await pool.query(
        "update doctor_portal.doctor_profiles set active = false where id = $1",
        [juniorId],
      );
      assert.ok(
        (await service.getRosterWeekConflicts(manager, sourceId)).some(
          (row) => row.code === "inactive_doctor",
        ),
      );
      await pool.query(
        "update doctor_portal.doctor_profiles set active = true where id = $1",
        [juniorId],
      );
      await pool.query(
        "update doctor_portal.doctor_modality_permissions set active = false where doctor_id = $1 and modality_id = $2",
        [juniorId, modalityId],
      );
      assert.ok(
        (await service.getRosterWeekConflicts(manager, sourceId)).some(
          (row) => row.code === "missing_modality_permission",
        ),
      );
      await pool.query(
        "update doctor_portal.doctor_modality_permissions set active = true where doctor_id = $1 and modality_id = $2",
        [juniorId, modalityId],
      );
    });
    it("returns live leave/overlap conflicts and keeps publish restrictions", async () => {
      const assigned = (
        await repo.getRosterWeekDetails(targetStart)
      ).assignments[0].members.find(
        (row) => Number(row.doctorId) === managerDoctorId,
      )!;
      await service.removeRosterMember(
        manager,
        targetSectionId,
        Number(assigned.id),
      );
      await pool.query(
        "insert into doctor_portal.doctor_availability (doctor_id, date, availability_status) values ($1, $2, 'unavailable')",
        [managerDoctorId, addDays(targetStart, 1)],
      );
      const conflicts = await service.getRosterWeekConflicts(manager, targetId);
      assert.ok(conflicts.some((row) => row.code === "doctor_unavailable"));
      assert.ok(
        conflicts.some((row) => row.code === "team_missing_specialist"),
      );
      await assert.rejects(
        service.publishRosterWeek(manager, targetId),
        /publish-blocking/,
      );
      assert.equal(
        (await repo.findRosterWeekById(pool, targetId))?.status,
        "draft",
      );
      await pool.query(
        "delete from doctor_portal.doctor_availability where doctor_id = $1",
        [managerDoctorId],
      );
      await service.removeRosterMember(
        manager,
        targetSectionId,
        Number(
          (
            await repo.getRosterWeekDetails(targetStart)
          ).assignments[0].members.find(
            (row) => Number(row.doctorId) === juniorId,
          )!.id,
        ),
      );
      await service.addRosterMember(manager, targetSectionId, managerDoctorId);
      await service.publishRosterWeek(manager, targetId);
      await assert.rejects(
        service.addRosterMember(manager, targetSectionId, juniorId),
        /draft/,
      );
      await assert.rejects(
        service.copyPreviousRosterWeek(manager, targetId, {
          sourceRosterWeekId: sourceId,
          replaceExisting: true,
        }),
        /draft/,
      );
    });
    it("enforces authorization and date boundaries", async () => {
      await assert.rejects(
        service.getSavedRosterWeeks(doctor),
        /supervisor access/,
      );
      await assert.rejects(
        service.copyPreviousRosterWeek(doctor, sourceId),
        /supervisor access/,
      );
      await assert.rejects(
        service.addRosterMember(doctor, sourceSectionId, juniorId),
        /supervisor access/,
      );
      await assert.rejects(
        service.createDraftRosterWeek(manager, {
          weekStartDate: "2090-02-30",
          weekEndDate: "2090-03-02",
        }),
        /YYYY-MM-DD/,
      );
      const original = (await repo.getRosterWeekDetails(sourceStart))
        .assignments[0];
      await assert.rejects(
        service.addRosterAssignment(manager, {
          ...original,
          date: addDays(sourceStart, 8),
        }),
        /inside the roster/,
      );
      await assert.rejects(
        service.updateDraftRosterWeek(manager, sourceId, {
          weekStartDate: sourceStart,
          weekEndDate: sourceStart,
        }),
        /outside the new date range/,
      );
    });
    it("maps differing weekday coverage and repeated weekdays predictably", () => {
      assert.equal(
        mapRosterDate("2026-10-19", "2026-10-19", "2026-10-25", "2026-10-29"),
        "2026-10-26",
      );
      assert.equal(
        mapRosterDate("2026-10-23", "2026-10-19", "2026-10-25", "2026-10-29"),
        null,
      );
      assert.equal(
        mapRosterDate("2026-10-26", "2026-10-19", "2026-11-01", "2026-11-12"),
        "2026-11-09",
      );
    });
    it("checks overlapping custom ranges against an already published roster", async () => {
      await service.publishRosterWeek(manager, sourceId);
      const custom = await service.createDraftRosterWeek(manager, {
        weekStartDate: addDays(sourceStart, -1),
        weekEndDate: addDays(sourceStart, 2),
      });
      weeks.push(Number(custom.id));
      const sourceSection = (await repo.getRosterWeekDetails(sourceStart))
        .assignments[0];
      const section = await service.addRosterAssignment(manager, {
        ...sourceSection,
        rosterWeekId: Number(custom.id),
        teamName: "Overlapping custom range",
      });
      await service.addRosterMember(
        manager,
        Number(section.id),
        managerDoctorId,
      );
      assert.ok(
        (await service.getRosterWeekConflicts(manager, Number(custom.id))).some(
          (row) => row.code === "overlapping_assignment",
        ),
      );
      await assert.rejects(
        service.publishRosterWeek(manager, Number(custom.id)),
        /publish-blocking/,
      );
    });
  },
);
