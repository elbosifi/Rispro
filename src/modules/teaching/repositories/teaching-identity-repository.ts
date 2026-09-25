import { pool } from "../../../db/pool.js";
import type { TeachingIdentityCandidate } from "../domain/teaching-identity.js";
import { isTeachingPermission, type TeachingPermission } from "../domain/teaching-permission.js";

interface ProfileRow {
  display_name: string;
}

interface PermissionRow {
  permission: string;
}

export async function loadOrProvisionTeachingIdentity(
  identity: TeachingIdentityCandidate,
  bootstrapPermissions: readonly TeachingPermission[],
): Promise<{ identityIssuer: string; identitySubject: string; displayName: string; permissions: TeachingPermission[] }> {
  const client = await pool.connect();
  const displayName = identity.displayName.trim() || "Teaching user";

  try {
    await client.query("begin");

    let profile = await client.query<ProfileRow>(
      `select display_name
       from teaching.user_profiles
       where identity_issuer = $1 and identity_subject = $2
       for update`,
      [identity.identityIssuer, identity.identitySubject],
    );

    if (profile.rowCount === 0 && bootstrapPermissions.length > 0) {
      profile = await client.query<ProfileRow>(
        `insert into teaching.user_profiles (identity_issuer, identity_subject, display_name)
         values ($1, $2, $3)
         on conflict (identity_issuer, identity_subject) do nothing
         returning display_name`,
        [identity.identityIssuer, identity.identitySubject, displayName],
      );

      if (profile.rowCount === 1) {
        await client.query(
          `insert into teaching.user_permissions (identity_issuer, identity_subject, permission)
           select $1, $2, requested.permission
           from unnest($3::text[]) as requested(permission)
           on conflict (identity_issuer, identity_subject, permission) do nothing`,
          [identity.identityIssuer, identity.identitySubject, bootstrapPermissions],
        );
      } else {
        profile = await client.query<ProfileRow>(
          `select display_name
           from teaching.user_profiles
           where identity_issuer = $1 and identity_subject = $2
           for update`,
          [identity.identityIssuer, identity.identitySubject],
        );
      }
    }

    if (profile.rowCount === 1 && profile.rows[0]!.display_name !== displayName) {
      await client.query(
        `update teaching.user_profiles
         set display_name = $3, updated_at = now()
         where identity_issuer = $1 and identity_subject = $2`,
        [identity.identityIssuer, identity.identitySubject, displayName],
      );
    }

    const permissionRows = await client.query<PermissionRow>(
      `select permission
       from teaching.user_permissions
       where identity_issuer = $1 and identity_subject = $2
       order by permission`,
      [identity.identityIssuer, identity.identitySubject],
    );

    await client.query("commit");

    return {
      identityIssuer: identity.identityIssuer,
      identitySubject: identity.identitySubject,
      displayName,
      permissions: permissionRows.rows
        .map((row) => row.permission)
        .filter(isTeachingPermission),
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
