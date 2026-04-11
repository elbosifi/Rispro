/**
 * Appointments V2 — Supervisor authentication helper for booking overrides.
 *
 * Validates supervisor credentials and returns the authenticated user row.
 * This is a thin wrapper around the legacy auth service, kept isolated in V2.
 */

import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";

interface AuthUserRow {
  id: number;
  username: string;
  passwordHash: string;
  role: string;
  fullName: string;
  isActive: boolean;
}

const AUTHENTICATE_SQL = `
  select id, username, password_hash as "passwordHash", role,
    full_name as "fullName", is_active as "isActive"
  from users
  where username = $1 and role = 'supervisor' and is_active = true
  limit 1
`;

export async function authenticateSupervisor(
  client: PoolClient,
  username: string,
  password: string
): Promise<AuthUserRow> {
  if (!username || !password) {
    throw new SchedulingError(
      403,
      "Supervisor username and password are required for override.",
      ["override_auth_missing_credentials"]
    );
  }

  const result = await client.query<AuthUserRow>(AUTHENTICATE_SQL, [username]);
  const user = result.rows[0];

  if (!user) {
    throw new SchedulingError(
      401,
      "Invalid supervisor credentials.",
      ["override_auth_invalid_supervisor"]
    );
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new SchedulingError(
      401,
      "Invalid supervisor password.",
      ["override_auth_invalid_password"]
    );
  }

  return user;
}
