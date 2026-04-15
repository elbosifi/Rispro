/**
 * Appointments V2 — Integration test helpers.
 *
 * Provides database setup/teardown, test data seeding, and HTTP test client utilities
 * for PostgreSQL-backed integration tests.
 */

import pg from "pg";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { pool } from "../../../../db/pool.js";
import { env } from "../../../../config/env.js";

export const TEST_DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "";

if (!TEST_DB_URL) {
  console.warn("WARNING: DATABASE_URL is not set. Integration tests will be skipped.");
}

export function isDatabaseAvailable(): boolean {
  return !!TEST_DB_URL && TEST_DB_URL.length > 0;
}

export async function canReachDatabase(): Promise<boolean> {
  if (!isDatabaseAvailable()) return false;
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  }
}

export function createTestAuthCookie(userId: number, role: string = "supervisor"): string {
  const payload = { sub: userId, role, username: "test_user", fullName: "Test User" };
  const token = jwt.sign(payload, env.jwtSecret, { expiresIn: "1h" });
  return `${env.cookieName}=${token}`;
}

export async function setupTestDatabase(
  dataPrefix: string = "TEST_"
): Promise<{ cleanup: () => Promise<void>; schemaName: string }> {
  if (!isDatabaseAvailable()) {
    throw new Error("Database not available. Set DATABASE_URL or TEST_DATABASE_URL.");
  }

  const schemaCheck = await pool.query(
    `select schema_name from information_schema.schemata where schema_name = 'appointments_v2'`
  );
  if (schemaCheck.rows.length === 0) {
    throw new Error("appointments_v2 schema not found. Run 'npm run migrate' first.");
  }

  const cleanup = async () => {
    await cleanupTestData(dataPrefix);
  };

  return { cleanup, schemaName: "appointments_v2" };
}

export interface TestData {
  userId: number;
  modalityId: number;
  examTypeId: number;
  patientId: number;
  policySetId: number;
  policyVersionId: number;
  schemaName: string;
}

export async function seedTestData(
  _schemaName: string,
  dataPrefix: string = "TEST_"
): Promise<TestData> {
  const s = (table: string) => `appointments_v2.${table}`;

  // Clean up any stale V2 test data from previous runs (prefix-aware)
  await pool.query(`delete from ${s("override_audit_events")}`);
  await pool.query(`delete from ${s("bookings")}`);
  await pool.query(`delete from ${s("category_daily_limits")}`);
  await pool.query(`delete from ${s("policy_versions")} where status = 'draft'`);
  await pool.query(`delete from ${s("policy_sets")} where key like '${dataPrefix.toLowerCase()}%' or key = 'default'`);

  // Create test supervisor user (unique per prefix to avoid conflicts)
  // password "test_password" — bcrypt hash generated via bcrypt.hash('test_password', 10)
  const bcryptHash = "$2a$10$ztv9Kx3klEC1wiHttYuwUeCN9KMI3yHuGjvRVEGFFVnbRu7YSfTyS";
  const username = `${dataPrefix.toLowerCase().replace(/[^a-z0-9]/g, "")}supervisor`;
  const userResult = await pool.query(
    `insert into users (username, password_hash, full_name, role, is_active)
     values ($1, $2, $3, 'supervisor', true)
     on conflict (username) do update set password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, is_active = EXCLUDED.is_active
     returning id`,
    [username, bcryptHash, `${dataPrefix}Supervisor`]
  );
  const userId = Number(userResult.rows[0].id);

  // Create test modality (unique per prefix)
  const modalityCode = `${dataPrefix}CT`;
  const modalityResult = await pool.query(
    `insert into modalities (name_ar, name_en, code, daily_capacity, is_active)
     values ($1, $2, $3, 10, true)
     on conflict (code) do update set is_active = true
     returning id`,
    [`${dataPrefix}اشعة مقطعية`, `${dataPrefix}CT`, modalityCode]
  );
  const modalityId = Number(modalityResult.rows[0].id);

  // Create test exam type (unique per prefix)
  const examTypeName = `${dataPrefix}CT Head`;
  await pool.query(`delete from appointments_v2.bookings where exam_type_id in (select id from exam_types where name_en = $1)`, [examTypeName]);
  await pool.query(`delete from exam_types where name_en = $1`, [examTypeName]);
  const examTypeResult = await pool.query(
    `insert into exam_types (modality_id, name_ar, name_en, is_active)
     values ($1, $2, $3, true)
     returning id`,
    [modalityId, `${dataPrefix}اشعة راس`, examTypeName]
  );
  const examTypeId = Number(examTypeResult.rows[0].id);

  // Create test patient with truly unique national ID (must be exactly 12 digits)
  const uniqueNationalId = `1${randomUUID().replace(/-/g, "").slice(0, 11)}`;
  const patientResult = await pool.query(
    `insert into patients (arabic_full_name, english_full_name, national_id, normalized_arabic_name, sex, age_years, identifier_type, identifier_value)
     values ($1, $2, $3, $4, 'M', 30, 'national_id', $5)
     returning id`,
    [`${dataPrefix}مريض اختبار`, `${dataPrefix}Test Patient`, uniqueNationalId, "مريضاختبار", uniqueNationalId]
  );
  const patientId = Number(patientResult.rows[0].id);

  // Create a published policy (use "default" key for all - policy is read-only in tests)
  // Clean up any existing default policy from previous runs of THIS suite only
  const policyKey = "default";
  const policySetResult = await pool.query(
    `insert into ${s("policy_sets")} (key, name, created_by_user_id)
     values ($1, $2, $3)
     on conflict (key) do nothing
     returning id`,
    [policyKey, `${dataPrefix}Policy`, userId]
  );
  
  // If the policy already exists, use it
  let policySetId = policySetResult.rows[0]?.id;
  if (!policySetId) {
    const existing = await pool.query(`select id from ${s("policy_sets")} where key = $1`, [policyKey]);
    policySetId = Number(existing.rows[0].id);
  }

  // Create published policy version (version_no = 1)
  const configHash = `${dataPrefix.toLowerCase()}_hash_1`;
  
  const policyVersionResult = await pool.query(
    `insert into ${s("policy_versions")}
       (policy_set_id, version_no, status, config_hash, created_by_user_id, published_at, published_by_user_id)
     values ($1, 1, 'published', $2, $3, now(), $3)
     on conflict (policy_set_id, version_no) do nothing
     returning id`,
    [policySetId, configHash, userId]
  );
  
  let policyVersionId = policyVersionResult.rows[0]?.id;
  if (!policyVersionId) {
    const existing = await pool.query(`select id from ${s("policy_versions")} where policy_set_id = $1 and version_no = 1`, [policySetId]);
    policyVersionId = Number(existing.rows[0].id);
  }

  // Add category daily limit
  await pool.query(
    `insert into ${s("category_daily_limits")}
       (policy_version_id, modality_id, case_category, daily_limit, is_active)
     values ($1, $2, 'non_oncology', 5, true)
     on conflict (policy_version_id, modality_id, case_category) do nothing`,
    [policyVersionId, modalityId]
  );

  return { userId, modalityId, examTypeId, patientId, policySetId, policyVersionId, schemaName: "appointments_v2" };
}

export async function cleanupTestData(dataPrefix: string = "TEST_"): Promise<void> {
  const prefixLower = dataPrefix.toLowerCase().replace(/[^a-z0-9]/g, "");
  
  // Delete V2 test data (all, since it's all prefixed the same)
  await pool.query(`delete from appointments_v2.override_audit_events`);
  await pool.query(`delete from appointments_v2.bookings`);
  await pool.query(`delete from appointments_v2.category_daily_limits`);
  await pool.query(`delete from appointments_v2.exam_type_rule_items`);
  await pool.query(`delete from appointments_v2.exam_type_rules`);
  await pool.query(`delete from appointments_v2.exam_type_special_quotas`);
  await pool.query(`delete from appointments_v2.modality_blocked_rules`);
  await pool.query(`delete from appointments_v2.policy_versions`);
  await pool.query(`delete from appointments_v2.policy_sets where key like '${prefixLower}%' or key = 'default'`);
  
  // Clean up legacy test data (prefix-aware)
  await pool.query(`update system_settings set updated_by_user_id = null where updated_by_user_id in (select id from users where username like '${prefixLower}%')`);
  await pool.query(`delete from users where username like '${prefixLower}%'`);
  await pool.query(`delete from modalities where code like '${dataPrefix}%'`);
  await pool.query(`delete from exam_types where name_en like '${dataPrefix}%'`);
  await pool.query(`delete from patients where english_full_name like '${dataPrefix}%'`);
}

export async function createTestApp(): Promise<{
  app: import("express").Application;
  server: import("http").Server;
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const http = await import("http");
  const { createAppointmentsV2Router } = await import("../../index.js");

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(cookieParser());

  const v2Router = createAppointmentsV2Router();
  app.use("/api/v2", v2Router);

  app.use((err: Error, _req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => {
    console.error("Test app error:", err);
    const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
    const details = (err as { details?: unknown }).details;
    const response: Record<string, unknown> = { error: err.message };
    if (details !== undefined) response.details = details;
    res.status(statusCode).json(response);
  });

  const server = http.createServer(app);

  return new Promise((resolve) => {
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 3000;
      resolve({
        app,
        server,
        baseUrl: `http://localhost:${port}`,
        close: async () => { server.close(); },
      });
    });
  });
}

export async function fetchJson<T = unknown>(
  baseUrl: string,
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string>; cookie?: string } = {}
): Promise<{ status: number; data: T }> {
  const { method = "GET", body, headers = {}, cookie } = options;
  const requestHeaders: Record<string, string> = { "Content-Type": "application/json", ...headers };
  if (cookie) requestHeaders["Cookie"] = cookie;

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: requestHeaders,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const data = (await response.json().catch(() => ({}))) as T;
  return { status: response.status, data };
}
