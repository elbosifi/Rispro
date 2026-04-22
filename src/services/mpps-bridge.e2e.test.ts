import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db/pool.js";
import { createApp } from "../app.js";
import { env } from "../config/env.js";
import {
  canReachDatabase,
  cleanupTestData,
  isDatabaseAvailable,
  seedTestData,
  setupTestDatabase,
} from "../modules/appointments-v2/tests/integration/helpers.js";

const PREFIX = "BRIDGE_E2E_";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const bridgeScript = path.join(repoRoot, "docker", "mpps-bridge", "app.py");
const senderScript = path.join(repoRoot, "scripts", "dicom-gateway", "send-mpps-fixture.py");

async function commandSucceeds(command: string, args: string[]): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

async function getFreePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep polling until the bridge is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for bridge health at ${url}`);
}

async function stopProcess(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function runSender(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const sender = spawn("python3", [senderScript, ...args], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdout: string[] = [];
  const stderr: string[] = [];
  sender.stdout?.on("data", (chunk: Buffer | string) => stdout.push(chunk.toString()));
  sender.stderr?.on("data", (chunk: Buffer | string) => stderr.push(chunk.toString()));
  const exitCode = await new Promise<number>((resolve) => sender.on("exit", (code) => resolve(code ?? 1)));

  return {
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    exitCode,
  };
}

async function startBridge(options: {
  baseUrl: string;
  storageDir: string;
  bridgePort: number;
  adminPort: number;
  aeTitle?: string;
}): Promise<ChildProcess> {
  const startedBridge = spawn("python3", [bridgeScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      MPPS_BRIDGE_PORT: String(options.bridgePort),
      MPPS_ADMIN_PORT: String(options.adminPort),
      MPPS_BRIDGE_AE_TITLE: options.aeTitle || "RISPRO_MPPS_E2E",
      MPPS_STORAGE_DIR: options.storageDir,
      RISPRO_BASE_URL: options.baseUrl,
      RISPRO_INTERNAL_SECRET: env.jwtSecret,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stderr: string[] = [];
  startedBridge.stderr?.on("data", (chunk: Buffer | string) => stderr.push(chunk.toString()));
  startedBridge.on("exit", (code) => {
    if (code !== null && code !== 0) {
      process.stderr.write(`MPPS bridge exited early with code ${code}\n${stderr.join("")}`);
    }
  });

  await waitForHealth(`http://127.0.0.1:${options.adminPort}/healthz`, 15000);
  return startedBridge;
}

describe("mpps bridge end-to-end", () => {
  let closeServer: (() => Promise<void>) | null = null;
  let baseUrl = "";
  let bridge: ChildProcess | null = null;
  let bridgeStorageDir = "";
  let bridgePort = 0;
  let bridgeAdminPort = 0;
  let skipReason = "";
  let testData: Awaited<ReturnType<typeof seedTestData>>;
  let bookingIds: number[] = [];

  before(async () => {
    if (!isDatabaseAvailable() || !(await canReachDatabase())) {
      skipReason = "Database is not reachable in this environment";
      return;
    }

    const pythonAvailable = await commandSucceeds("python3", ["--version"]);
    if (!pythonAvailable) {
      skipReason = "python3 is not available in this environment";
      return;
    }

    const pythonDepsAvailable = await commandSucceeds("python3", [
      "-c",
      "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('pydicom') and importlib.util.find_spec('pynetdicom') else 1)",
    ]);
    if (!pythonDepsAvailable) {
      skipReason = "pydicom/pynetdicom are not installed locally";
      return;
    }

    await setupTestDatabase(PREFIX);
    await pool.query(`
      alter table appointments_v2.bookings
      drop constraint if exists bookings_status_check
    `);
    await pool.query(`
      alter table appointments_v2.bookings
      add constraint bookings_status_check
      check (status in ('scheduled', 'arrived', 'waiting', 'completed', 'no-show', 'cancelled', 'discontinued'))
    `);
    await pool.query(`
      create table if not exists mpps_event_log (
        id bigserial primary key,
        dedupe_key text not null unique,
        event_type text not null check (event_type in ('n-create', 'n-set')),
        source_ae_title text not null,
        patient_id text,
        accession_number text,
        study_instance_uid text,
        mpps_instance_uid text,
        performed_step_status text not null,
        requested_procedure_id text,
        scheduled_step_id text,
        modality text,
        scheduled_start_date text,
        scheduled_start_time text,
        payload_json jsonb not null default '{}'::jsonb,
        correlated_appointment_id bigint,
        correlation_status text not null default 'unmatched' check (correlation_status in ('matched', 'unmatched', 'ambiguous')),
        processing_status text not null default 'received' check (processing_status in ('received', 'processed', 'ignored', 'failed')),
        processing_error text,
        received_at timestamptz not null default now(),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);

    testData = await seedTestData("appointments_v2", PREFIX);

    const app = createApp();
    const server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    closeServer = async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    };

    bridgePort = await getFreePort();
    bridgeAdminPort = await getFreePort();
    bridgeStorageDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-mpps-bridge-e2e-"));

    bridge = await startBridge({
      baseUrl,
      storageDir: bridgeStorageDir,
      bridgePort,
      adminPort: bridgeAdminPort,
    });
  });

  after(async () => {
    await stopProcess(bridge);
    if (bridgeStorageDir) {
      await fs.rm(bridgeStorageDir, { recursive: true, force: true }).catch(() => undefined);
    }
    if (bookingIds.length > 0) {
      await pool.query(`delete from mpps_event_log where correlated_appointment_id = any($1::bigint[])`, [bookingIds]);
      await pool.query(`delete from appointments_v2.bookings where id = any($1::bigint[])`, [bookingIds]);
    }
    await cleanupTestData(PREFIX);
    if (closeServer) await closeServer();
  });

  async function createBooking(status: string = "scheduled", bookingTime: string | null = "09:00:00"): Promise<number> {
    const result = await pool.query<{ id: number }>(
      `
        insert into appointments_v2.bookings (
          patient_id, modality_id, exam_type_id, reporting_priority_id,
          booking_date, booking_time, case_category, status, notes,
          policy_version_id, capacity_resolution_mode, uses_special_quota,
          special_reason_code, special_reason_note, is_walk_in,
          created_by_user_id, updated_by_user_id
        ) values (
          $1, $2, $3, null,
          current_date, $4, 'non_oncology', $5, null,
          $6, 'standard', false,
          null, null, false,
          $7, $7
        )
        returning id
      `,
      [
        testData.patientId,
        testData.modalityId,
        testData.examTypeId,
        bookingTime,
        status,
        testData.policyVersionId,
        testData.userId,
      ]
    );
    const id = Number(result.rows[0].id);
    bookingIds.push(id);
    return id;
  }

  async function getBookingStatus(bookingId: number): Promise<string> {
    const result = await pool.query<{ status: string }>(
      `select status from appointments_v2.bookings where id = $1`,
      [bookingId]
    );
    return String(result.rows[0]?.status || "");
  }

  async function getPatientIdentifier(): Promise<string> {
    const result = await pool.query<{ national_id: string }>(
      `select national_id from patients where id = $1`,
      [testData.patientId]
    );
    return String(result.rows[0]?.national_id || "");
  }

  function buildFixtureArgs(params: {
    bookingId: number;
    patientId: string;
    mppsInstanceUid: string;
    studyInstanceUid: string;
    scheduledDate: string;
    scheduledTime?: string;
    setStatus?: string;
    skipCreate?: boolean;
    skipSet?: boolean;
  }): string[] {
    return [
      "--host", "127.0.0.1",
      "--port", String(bridgePort),
      "--called-ae", "RISPRO_MPPS_E2E",
      "--calling-ae", "CT_MODALITY_E2E",
      "--patient-id", params.patientId,
      "--accession-number", `V2-${params.bookingId}`,
      "--study-instance-uid", params.studyInstanceUid,
      "--mpps-instance-uid", params.mppsInstanceUid,
      "--requested-procedure-id", `V2-${params.bookingId}`,
      "--scheduled-step-id", `V2-${params.bookingId}-STEP`,
      "--modality", "CT",
      "--scheduled-date", params.scheduledDate,
      "--scheduled-time", params.scheduledTime || "09:00:00",
      ...(params.setStatus ? ["--set-status", params.setStatus] : []),
      ...(params.skipCreate ? ["--skip-create"] : []),
      ...(params.skipSet ? ["--skip-set"] : []),
    ];
  }

  it("processes N-CREATE and N-SET through the real bridge into RISpro", async (t) => {
    if (skipReason) {
      t.skip(skipReason);
      return;
    }

    if (!bridge) {
      t.skip("Bridge process was not started");
      return;
    }

    const bookingId = await createBooking("scheduled", "09:00:00");
    const patientId = await getPatientIdentifier();
    const scheduledDate = new Date().toISOString().slice(0, 10);
    const uniqueSuffix = `${bookingId}${Date.now()}`;
    const mppsInstanceUid = `1.2.826.0.1.3680043.10.543.${uniqueSuffix}.1`;
    const studyInstanceUid = `1.2.826.0.1.3680043.10.543.${uniqueSuffix}.2`;
    const senderResult = await runSender(buildFixtureArgs({
      bookingId,
      patientId,
      mppsInstanceUid,
      studyInstanceUid,
      scheduledDate,
    }));
    assert.equal(
      senderResult.exitCode,
      0,
      `MPPS fixture sender failed.\nSTDOUT:\n${senderResult.stdout}\nSTDERR:\n${senderResult.stderr}`
    );

    const eventsResponse = await fetch(`http://127.0.0.1:${bridgeAdminPort}/events`);
    assert.equal(eventsResponse.status, 200);
    const eventsPayload = await eventsResponse.json() as {
      events: Array<{ event_type: string; sop_instance_uid: string; delivery_error?: string | null }>;
    };

    const matchingEvents = eventsPayload.events.filter((event) => event.sop_instance_uid === mppsInstanceUid);
    assert.equal(matchingEvents.length, 2);
    assert.deepEqual(
      matchingEvents.map((event) => event.event_type),
      ["n-create", "n-set"]
    );
    assert.equal(matchingEvents.every((event) => !event.delivery_error), true);

    const eventRows = await pool.query<{
      event_type: string;
      performed_step_status: string;
      processing_status: string;
      correlation_status: string;
    }>(
      `
        select event_type, performed_step_status, processing_status, correlation_status
        from mpps_event_log
        where mpps_instance_uid = $1
        order by id asc
      `,
      [mppsInstanceUid]
    );

    assert.equal(eventRows.rows.length, 2);
    assert.deepEqual(
      eventRows.rows.map((row) => [row.event_type, row.performed_step_status, row.processing_status, row.correlation_status]),
      [
        ["n-create", "IN PROGRESS", "processed", "matched"],
        ["n-set", "COMPLETED", "processed", "matched"],
      ]
    );
    assert.equal(await getBookingStatus(bookingId), "completed");
  });

  it("maps DISCONTINUED to the dedicated discontinued workflow state", async (t) => {
    if (skipReason) {
      t.skip(skipReason);
      return;
    }

    const bookingId = await createBooking("scheduled", "10:00:00");
    const patientId = await getPatientIdentifier();
    const scheduledDate = new Date().toISOString().slice(0, 10);
    const uniqueSuffix = `${bookingId}${Date.now()}`;
    const mppsInstanceUid = `1.2.826.0.1.3680043.10.543.${uniqueSuffix}.3`;
    const studyInstanceUid = `1.2.826.0.1.3680043.10.543.${uniqueSuffix}.4`;

    const senderResult = await runSender(buildFixtureArgs({
      bookingId,
      patientId,
      mppsInstanceUid,
      studyInstanceUid,
      scheduledDate,
      scheduledTime: "10:00:00",
      setStatus: "DISCONTINUED",
    }));
    assert.equal(
      senderResult.exitCode,
      0,
      `DISCONTINUED fixture sender failed.\nSTDOUT:\n${senderResult.stdout}\nSTDERR:\n${senderResult.stderr}`
    );

    const eventRows = await pool.query<{
      event_type: string;
      performed_step_status: string;
      processing_status: string;
    }>(
      `
        select event_type, performed_step_status, processing_status
        from mpps_event_log
        where mpps_instance_uid = $1
        order by id asc
      `,
      [mppsInstanceUid]
    );

    assert.deepEqual(
      eventRows.rows.map((row) => [row.event_type, row.performed_step_status, row.processing_status]),
      [
        ["n-create", "IN PROGRESS", "processed"],
        ["n-set", "DISCONTINUED", "processed"],
      ]
    );
    assert.equal(await getBookingStatus(bookingId), "discontinued");
  });

  it("retries safely after temporary RISpro intake unavailability", async (t) => {
    if (skipReason) {
      t.skip(skipReason);
      return;
    }

    const bookingId = await createBooking("scheduled", "11:00:00");
    const patientId = await getPatientIdentifier();
    const scheduledDate = new Date().toISOString().slice(0, 10);
    const uniqueSuffix = `${bookingId}${Date.now()}`;
    const mppsInstanceUid = `1.2.826.0.1.3680043.10.543.${uniqueSuffix}.5`;
    const studyInstanceUid = `1.2.826.0.1.3680043.10.543.${uniqueSuffix}.6`;

    await stopProcess(bridge);
    bridge = null;

    const unavailableBaseUrl = `http://127.0.0.1:${await getFreePort()}`;
    bridge = await startBridge({
      baseUrl: unavailableBaseUrl,
      storageDir: bridgeStorageDir,
      bridgePort,
      adminPort: bridgeAdminPort,
    });

    const failedAttempt = await runSender(buildFixtureArgs({
      bookingId,
      patientId,
      mppsInstanceUid,
      studyInstanceUid,
      scheduledDate,
      scheduledTime: "11:00:00",
      skipSet: true,
    }));
    assert.notEqual(failedAttempt.exitCode, 0, "Expected delivery failure while RISpro intake is unavailable");
    assert.equal(await getBookingStatus(bookingId), "scheduled");

    const failedEventsResponse = await fetch(`http://127.0.0.1:${bridgeAdminPort}/events`);
    assert.equal(failedEventsResponse.status, 200);
    const failedEventsPayload = await failedEventsResponse.json() as {
      events: Array<{ sop_instance_uid: string; delivery_error?: string | null }>;
    };
    const failedEvent = failedEventsPayload.events.find((event) => event.sop_instance_uid === mppsInstanceUid);
    assert.ok(failedEvent?.delivery_error, "Bridge should record a delivery error for the failed attempt");

    await stopProcess(bridge);
    bridge = await startBridge({
      baseUrl,
      storageDir: bridgeStorageDir,
      bridgePort,
      adminPort: bridgeAdminPort,
    });

    const retryAttempt = await runSender(buildFixtureArgs({
      bookingId,
      patientId,
      mppsInstanceUid,
      studyInstanceUid,
      scheduledDate,
      scheduledTime: "11:00:00",
      skipSet: true,
    }));
    assert.equal(
      retryAttempt.exitCode,
      0,
      `Retry sender failed.\nSTDOUT:\n${retryAttempt.stdout}\nSTDERR:\n${retryAttempt.stderr}`
    );

    const countResult = await pool.query<{ count: string }>(
      `select count(*)::text as count from mpps_event_log where mpps_instance_uid = $1 and event_type = 'n-create'`,
      [mppsInstanceUid]
    );
    assert.equal(Number(countResult.rows[0]?.count || 0), 1);
    assert.equal(await getBookingStatus(bookingId), "waiting");
  });
});
