/**
 * Appointments V2 — Integration test helpers.
 *
 * Provides database setup/teardown, test data seeding, and HTTP test client utilities
 * for PostgreSQL-backed integration tests.
 */

import pg from "pg";
import jwt from "jsonwebtoken";
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

export async function setupTestDatabase(): Promise<{ cleanup: () => Promise<void>; schemaName: string }> {
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
    // Delete ALL V2 bookings first (before users are deleted, to avoid FK issues)
    await pool.query(`delete from appointments_v2.override_audit_events`);
    await pool.query(`delete from appointments_v2.bookings`);
    await pool.query(`delete from appointments_v2.category_daily_limits`);
    await pool.query(`delete from appointments_v2.policy_versions`);
    await pool.query(`delete from appointments_v2.policy_sets`);
    // Now safe to delete legacy test data
    await pool.query(`delete from users where username like 'test_%'`);
    await pool.query(`delete from modalities where code like 'TEST_%'`);
    await pool.query(`delete from exam_types where name_en = 'Test CT Head'`);
    await pool.query(`delete from patients where english_full_name = 'Test Patient'`);
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

export async function seedTestData(_schemaName: string): Promise<TestData> {
  const s = (table: string) => `appointments_v2.${table}`;

  // Create test supervisor user
  const bcryptHash = "$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234";
  const userResult = await pool.query(
    `insert into users (username, password_hash, full_name, role, is_active)
     values ($1, $2, $3, 'supervisor', true)
     on conflict (username) do update set role = 'supervisor', is_active = true
     returning id`,
    ["test_supervisor", bcryptHash, "Test Supervisor"]
  );
  const userId = Number(userResult.rows[0].id);

  // Create test modality
  const modalityResult = await pool.query(
    `insert into modalities (name_ar, name_en, code, daily_capacity, is_active)
     values ($1, $2, $3, 10, true)
     on conflict (code) do update set is_active = true
     returning id`,
    ["اشعة مقطعية", "Test CT", "TEST_CT"]
  );
  const modalityId = Number(modalityResult.rows[0].id);

  // Create test exam type
  await pool.query(`delete from appointments_v2.bookings where exam_type_id in (select id from exam_types where name_en = 'Test CT Head'); delete from exam_types where name_en = 'Test CT Head'`);
  const examTypeResult = await pool.query(
    `insert into exam_types (modality_id, name_ar, name_en, is_active)
     values ($1, $2, $3, true)
     returning id`,
    [modalityId, "اشعة راس", "Test CT Head"]
  );
  const examTypeId = Number(examTypeResult.rows[0].id);

  // Create test patient
  const uniqueNationalId = `1${String(Date.now()).slice(-10)}1`.padEnd(12, "0").slice(0, 12);
  const patientResult = await pool.query(
    `insert into patients (arabic_full_name, english_full_name, national_id, normalized_arabic_name, sex, age_years, identifier_type, identifier_value)
     values ($1, $2, $3, $4, 'M', 30, 'national_id', $5)
     returning id`,
    ["مريض اختبار", "Test Patient", uniqueNationalId, "مريضاختبار", uniqueNationalId]
  );
  const patientId = Number(patientResult.rows[0].id);

  // Create a published policy
  const policySetResult = await pool.query(
    `insert into ${s("policy_sets")} (key, name, created_by_user_id)
     values ($1, $2, $3)
     on conflict (key) do update set name = $2
     returning id`,
    ["default", "Default Policy", userId]
  );
  const policySetId = Number(policySetResult.rows[0].id);

  // Archive old published versions
  await pool.query(
    `update ${s("policy_versions")} set status = 'archived' where policy_set_id = $1 and status = 'published'`,
    [policySetId]
  );

  // Get next version number
  const nextVersionResult = await pool.query(
    `select coalesce(max(version_no), 0) + 1 as next_version from ${s("policy_versions")} where policy_set_id = $1`,
    [policySetId]
  );
  const nextVersion = Number(nextVersionResult.rows[0].next_version);

  // Clear drafts
  await pool.query(
    `delete from ${s("policy_versions")} where policy_set_id = $1 and status = 'draft'`,
    [policySetId]
  );

  // Create published policy version
  const configHash = `test_hash_${nextVersion}`;
  const policyVersionResult = await pool.query(
    `insert into ${s("policy_versions")}
       (policy_set_id, version_no, status, config_hash, created_by_user_id, published_at, published_by_user_id)
     values ($1, $2, 'published', $3, $4, now(), $4)
     returning id`,
    [policySetId, nextVersion, configHash, userId]
  );
  const policyVersionId = Number(policyVersionResult.rows[0].id);

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
    res.status(statusCode).json({ error: err.message });
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
