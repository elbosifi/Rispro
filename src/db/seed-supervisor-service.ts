import bcrypt from "bcryptjs";
import type { Pool } from "pg";
import { normalizeUsername } from "../utils/credentials.js";

interface SeedAccountInput {
  username: string;
  password: string;
  fullName: string;
  role: "supervisor" | "super_admin";
}

export interface SeedAdminAccountsInput {
  supervisor: Omit<SeedAccountInput, "role">;
  superAdmin: Omit<SeedAccountInput, "role">;
}

export async function seedAdminAccounts(db: Pick<Pool, "query">, input: SeedAdminAccountsInput): Promise<{ supervisorSeeded: boolean; superAdminSeeded: boolean }> {
  const accounts: SeedAccountInput[] = [
    { ...input.supervisor, role: "supervisor" },
    { ...input.superAdmin, role: "super_admin" },
  ];
  const results: boolean[] = [];

  for (const account of accounts) {
    const username = normalizeUsername(account.username);
    if (!username) {
      throw new Error(`${account.role === "supervisor" ? "SEED_SUPERVISOR_USERNAME" : "SEED_SUPER_ADMIN_USERNAME"} must not be empty after trimming.`);
    }

    const existing = await db.query(`select 1 from users where lower(btrim(username)) = $1 limit 1`, [username]);
    if (Number(existing.rowCount ?? existing.rows.length) > 0) {
      results.push(false);
      continue;
    }

    const passwordHash = await bcrypt.hash(account.password, 10);
    const inserted = await db.query(
      `
        insert into users (username, full_name, password_hash, role, is_active)
        values ($1, $2, $3, $4, true)
        on conflict do nothing
      `,
      [username, account.fullName, passwordHash, account.role]
    );
    results.push(Number(inserted.rowCount ?? 0) > 0);
  }

  return { supervisorSeeded: results[0], superAdminSeeded: results[1] };
}
