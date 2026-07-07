import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

process.env.DATABASE_URL ||= "postgresql://127.0.0.1/rispro_test";
process.env.JWT_SECRET ||= "test-secret";

const TEST_PREFIX = "PVIS_";
const PAGE_VISIBILITY_CATEGORY = "users_and_roles";
const PAGE_VISIBILITY_KEY = "page_visibility_by_role";
const TEST_PASSWORD_HASH = "$2a$10$ztv9Kx3klEC1wiHttYuwUeCN9KMI3yHuGjvRVEGFFVnbRu7YSfTyS";

function createAuthCookie(cookieName: string, userId: number, role: string, username: string): string {
  const token = jwt.sign(
    {
      sub: userId,
      role,
      username,
      fullName: `${TEST_PREFIX}${role}`,
    },
    process.env.JWT_SECRET as string,
    { expiresIn: "1h" }
  );
  return `${cookieName}=${token}`;
}

function createSupervisorReauthCookie(cookieName: string, userId: number, role: string, username: string): string {
  const token = jwt.sign(
    {
      sub: userId,
      role,
      username,
      purpose: "supervisor-reauth",
    },
    process.env.JWT_SECRET as string,
    { expiresIn: "10m" }
  );
  return `${cookieName}=${token}`;
}

async function startTestServer(createApp: () => import("express").Application): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(createApp());

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
  };
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  options: { method?: string; body?: unknown; cookie?: string } = {}
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.cookie) {
    headers.Cookie = options.cookie;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  const data = (await response.json().catch(() => ({}))) as T;
  return { status: response.status, data };
}

test("settings page visibility route permissions", async () => {
  const [{ pool }, appModule, envModule] = await Promise.all([
    import("../db/pool.js"),
    import("../app.js"),
    import("../config/env.js"),
  ]);

  try {
    await pool.query("select 1");
  } catch {
    return;
  }

  const cookieName = envModule.env.cookieName;
  const reauthCookieName = envModule.env.reauthCookieName;
  const runSuffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const createdUsernames: string[] = [];
  const createTestUser = async (role: string): Promise<{ id: number; username: string; cookie: string }> => {
    const username = `${TEST_PREFIX.toLowerCase()}${role}_${runSuffix}`;
    const result = await pool.query<{ id: string }>(
      `
        insert into users (username, full_name, password_hash, role, is_active)
        values ($1, $2, $3, $4, true)
        returning id::text as id
      `,
      [username, `${TEST_PREFIX}${role}`, TEST_PASSWORD_HASH, role]
    );
    createdUsernames.push(username);
    const id = Number(result.rows[0].id);
    return { id, username, cookie: createAuthCookie(cookieName, id, role, username) };
  };

  const [{ rows: originalSettingRows }, modalityStaff, superAdmin] = await Promise.all([
    pool.query<{ setting_value: unknown; updated_by_user_id: string | null }>(
      `
        select setting_value, updated_by_user_id::text as updated_by_user_id
        from system_settings
        where category = $1 and setting_key = $2
        limit 1
      `,
      [PAGE_VISIBILITY_CATEGORY, PAGE_VISIBILITY_KEY]
    ),
    createTestUser("modality_staff"),
    createTestUser("super_admin"),
  ]);
  const originalSetting = originalSettingRows[0] ?? null;
  const modalityStaffCookie = modalityStaff.cookie;
  const superAdminCookie = superAdmin.cookie;
  const superAdminReauthCookie = `${superAdminCookie}; ${createSupervisorReauthCookie(
    reauthCookieName,
    superAdmin.id,
    "super_admin",
    superAdmin.username
  )}`;

  const server = await startTestServer(appModule.createApp);
  let originalMatrix: Record<string, unknown> | null = null;
  try {
    const initial = await requestJson<{ matrix: Record<string, unknown> }>(
      server.baseUrl,
      "/api/settings/users-and-roles/page-visibility",
      { cookie: superAdminCookie }
    );

    assert.equal(initial.status, 200);
    originalMatrix = initial.data.matrix;
    assert.ok(Array.isArray(originalMatrix["pacs.remap"]));

    const originalPatients = Array.isArray(originalMatrix.patients) ? originalMatrix.patients : [];
    const originalStatistics = Array.isArray(originalMatrix.statistics) ? originalMatrix.statistics : [];
    const deniedMatrix = {
      ...originalMatrix,
      patients: originalPatients.filter((role) => role !== "modality_staff"),
      statistics: originalStatistics.filter((role) => role !== "modality_staff"),
    };

    const seededDeniedMatrix = await requestJson<{ matrix: Record<string, unknown> }>(
      server.baseUrl,
      "/api/settings/users-and-roles/page-visibility",
      {
        method: "PUT",
        cookie: superAdminReauthCookie,
        body: { matrix: deniedMatrix },
      }
    );
    assert.equal(seededDeniedMatrix.status, 200);

    const anonymous = await requestJson<{ message?: string }>(server.baseUrl, "/api/settings/users-and-roles/page-visibility");
    assert.equal(anonymous.status, 401);

    const modalityStaff = await requestJson<{ matrix: Record<string, unknown> }>(
      server.baseUrl,
      "/api/settings/users-and-roles/page-visibility",
      { cookie: modalityStaffCookie }
    );
    assert.equal(modalityStaff.status, 200);
    assert.ok(Array.isArray(modalityStaff.data.matrix.patients));

    const blockedPatientsApi = await requestJson<{ message?: string }>(
      server.baseUrl,
      "/api/patients/identifier-types",
      { cookie: modalityStaffCookie }
    );
    assert.equal(blockedPatientsApi.status, 403);

    const blockedStatisticsApi = await requestJson<{ message?: string }>(
      server.baseUrl,
      "/api/v2/read/statistics",
      { cookie: modalityStaffCookie }
    );
    assert.equal(blockedStatisticsApi.status, 403);

    const denied = await requestJson<{ message?: string }>(
      server.baseUrl,
      "/api/settings/users-and-roles/page-visibility",
      {
        method: "PUT",
        cookie: modalityStaffCookie,
        body: { matrix: { ...originalMatrix } },
      }
    );
    assert.equal(denied.status, 403);

    const existingPacsRemap = Array.isArray(originalMatrix["pacs.remap"]) ? originalMatrix["pacs.remap"] : [];
    const updatedMatrix = {
      ...originalMatrix,
      patients: ["modality_staff", ...originalPatients.filter((role) => role !== "modality_staff")],
      "pacs.remap": ["doctor", ...existingPacsRemap.filter((role) => role !== "doctor")],
    };

    const allowed = await requestJson<{ matrix: Record<string, unknown> }>(
      server.baseUrl,
      "/api/settings/users-and-roles/page-visibility",
      {
        method: "PUT",
        cookie: superAdminReauthCookie,
        body: { matrix: updatedMatrix },
      }
    );

    assert.equal(allowed.status, 200);
    assert.equal(Array.isArray(allowed.data.matrix.patients), true);
    assert.equal((allowed.data.matrix.patients as unknown[]).includes("modality_staff"), true);
    assert.equal(Array.isArray(allowed.data.matrix["pacs.remap"]), true);
    assert.equal((allowed.data.matrix["pacs.remap"] as unknown[]).includes("doctor"), true);

    const allowedPatientsApi = await requestJson<{ items?: unknown[] }>(
      server.baseUrl,
      "/api/patients/identifier-types",
      { cookie: modalityStaffCookie }
    );
    assert.equal(allowedPatientsApi.status, 200);

    const restored = await requestJson<{ matrix: Record<string, unknown> }>(
      server.baseUrl,
      "/api/settings/users-and-roles/page-visibility",
      {
        method: "PUT",
        cookie: superAdminReauthCookie,
        body: { matrix: originalMatrix },
      }
    );

    assert.equal(restored.status, 200);
  } finally {
    if (originalMatrix) {
      await requestJson<{ matrix: Record<string, unknown> }>(
        server.baseUrl,
        "/api/settings/users-and-roles/page-visibility",
        {
          method: "PUT",
          cookie: superAdminReauthCookie,
          body: { matrix: originalMatrix },
        }
      ).catch(() => undefined);
    }
    if (originalSetting) {
      await pool.query(
        `
          update system_settings
          set setting_value = $1::jsonb,
              updated_by_user_id = $2,
              updated_at = now()
          where category = $3 and setting_key = $4
        `,
        [
          JSON.stringify(originalSetting.setting_value),
          originalSetting.updated_by_user_id,
          PAGE_VISIBILITY_CATEGORY,
          PAGE_VISIBILITY_KEY,
        ]
      );
    } else {
      await pool.query("delete from system_settings where category = $1 and setting_key = $2", [
        PAGE_VISIBILITY_CATEGORY,
        PAGE_VISIBILITY_KEY,
      ]);
    }
    if (createdUsernames.length > 0) {
      await pool.query("delete from users where username = any($1::text[]) and username like $2", [
        createdUsernames,
        `${TEST_PREFIX.toLowerCase()}%`,
      ]);
    }
    await server.close();
  }
});
