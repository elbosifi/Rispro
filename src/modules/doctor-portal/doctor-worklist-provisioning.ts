import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../../db/pool.js";

type Queryable = Pick<PoolClient, "query"> | typeof pool;

export async function syncDoctorWorklistLifecycle(
  doctorId: number,
  db: Queryable = pool
): Promise<number | null> {
  const profileResult = await db.query<{
    id: number;
    display_name: string;
    doctor_active: boolean;
    user_active: boolean;
  }>(
    `
      select
        dp.id,
        dp.display_name,
        dp.active as doctor_active,
        u.is_active as user_active
      from doctor_portal.doctor_profiles dp
      join users u on u.id = dp.user_id
      where dp.id = $1
      limit 1
    `,
    [doctorId]
  );
  const profile = profileResult.rows[0];
  if (!profile) return null;

  const existing = await db.query<{ id: number }>(
    `
      select id
      from doctor_portal.reporting_board_saved_views
      where target_doctor_id = $1
        and link_kind = 'doctor_worklist'
        and system_managed = true
      limit 1
    `,
    [doctorId]
  );
  const shouldBeActive = profile.doctor_active && profile.user_active;

  if (!existing.rows[0]) {
    const inserted = await db.query<{ id: number }>(
      `
        insert into doctor_portal.reporting_board_saved_views (
          owner_user_id,
          owner_doctor_id,
          name,
          token,
          filters_json,
          notification_settings_json,
          active,
          link_kind,
          system_managed,
          target_doctor_id
        )
        values (null, null, $2, $3, '{}'::jsonb, '{}'::jsonb, $4, 'doctor_worklist', true, $1)
        on conflict (target_doctor_id)
          where link_kind = 'doctor_worklist' and system_managed = true
        do update set
          name = excluded.name,
          active = case
            when doctor_portal.reporting_board_saved_views.admin_disabled_at is null
              and doctor_portal.reporting_board_saved_views.revoked_at is null
            then $4
            else false
          end,
          updated_at = now()
        returning id
      `,
      [doctorId, `${profile.display_name} Worklist`, randomBytes(32).toString("base64url"), shouldBeActive]
    );
    return Number(inserted.rows[0]?.id ?? 0) || null;
  }

  await db.query(
    `
      update doctor_portal.reporting_board_saved_views
      set
        name = $2,
        active = $3
          and admin_disabled_at is null
          and revoked_at is null,
        updated_at = now()
      where id = $1
    `,
    [existing.rows[0].id, `${profile.display_name} Worklist`, shouldBeActive]
  );
  return Number(existing.rows[0].id);
}

export async function syncDoctorWorklistForUser(userId: number, db: Queryable = pool): Promise<void> {
  const result = await db.query<{ id: number }>(
    `select id from doctor_portal.doctor_profiles where user_id = $1 limit 1`,
    [userId]
  );
  if (result.rows[0]) await syncDoctorWorklistLifecycle(Number(result.rows[0].id), db);
}
