import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";

process.env.DATABASE_URL ||= "postgresql://127.0.0.1/rispro_test";
process.env.JWT_SECRET ||= "test-secret";

function createAuthCookie(cookieName: string, userId: number, role: string): string {
  const token = jwt.sign(
    {
      sub: userId,
      role,
      username: "test_user",
      fullName: "Test User",
    },
    process.env.JWT_SECRET as string,
    { expiresIn: "1h" }
  );
  return `${cookieName}=${token}`;
}

function createSupervisorReauthCookie(cookieName: string, userId: number, role: string): string {
  const token = jwt.sign(
    {
      sub: userId,
      role,
      username: "test_user",
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
  const modalityStaffCookie = createAuthCookie(cookieName, 101, "modality_staff");
  const superAdminCookie = createAuthCookie(cookieName, 102, "super_admin");
  const superAdminReauthCookie = `${superAdminCookie}; ${createSupervisorReauthCookie(reauthCookieName, 102, "super_admin")}`;

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
    await server.close();
  }
});
