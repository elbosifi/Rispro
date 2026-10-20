import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import {
  deleteDocumentsByScope,
  getDocumentAbsolutePath,
  moveDocumentsToConfiguredStorage,
  uploadDocument,
} from "./document-service.js";
import { getPatientIdentityDocumentState, verifyPatientIdentityDocument } from "./patient-identity-document-service.js";

const settingKeys = ["storage_path", "storage_fallback_enabled", "ha_hot_storage_enabled"];

async function setDocumentSetting(key: string, value: unknown): Promise<void> {
  await pool.query(
    `
      insert into system_settings(category, setting_key, setting_value)
      values('documents_and_uploads', $1, $2::jsonb)
      on conflict(category, setting_key)
      do update set setting_value=excluded.setting_value, updated_at=now()
    `,
    [key, JSON.stringify({ value: String(value) })],
  );
}

type DisposableDatabaseSafety =
  | { ok: true; databaseUrl: URL }
  | { ok: false; reason: string };

function parseDatabaseUrl(value: string | undefined): URL | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function databaseIdentity(url: URL): string {
  const port = url.port || "5432";
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  return `${url.hostname.toLowerCase()}:${port}/${database}`;
}

async function verifyDisposableDatabaseSafety(): Promise<DisposableDatabaseSafety> {
  const databaseUrl = parseDatabaseUrl(process.env.DATABASE_URL ?? env.databaseUrl);
  const testDatabaseUrl = parseDatabaseUrl(process.env.TEST_DATABASE_URL);

  if (!databaseUrl || !testDatabaseUrl) {
    return {
      ok: false,
      reason: "DATABASE_URL and TEST_DATABASE_URL must both be valid PostgreSQL URLs.",
    };
  }

  if (!["localhost", "127.0.0.1"].includes(databaseUrl.hostname.toLowerCase())) {
    return {
      ok: false,
      reason: "DATABASE_URL must point to localhost or 127.0.0.1.",
    };
  }

  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ""));
  const username = decodeURIComponent(databaseUrl.username);
  if (!/test/i.test(databaseName) || !/test/i.test(username)) {
    return {
      ok: false,
      reason: "DATABASE_URL database name and username must both contain test.",
    };
  }

  if (databaseIdentity(databaseUrl) !== databaseIdentity(testDatabaseUrl)) {
    return {
      ok: false,
      reason: "DATABASE_URL and TEST_DATABASE_URL must identify the same database.",
    };
  }

  let inspectedContainer: Array<{
    State?: { Running?: boolean };
    Config?: { Labels?: Record<string, string> };
    NetworkSettings?: {
      Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
    };
  }>;

  try {
    inspectedContainer = JSON.parse(
      execFileSync("docker", ["inspect", "rispro-test-postgres"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ) as typeof inspectedContainer;
  } catch {
    return {
      ok: false,
      reason: "Docker container rispro-test-postgres could not be inspected.",
    };
  }

  const container = inspectedContainer[0];
  if (!container?.State?.Running) {
    return {
      ok: false,
      reason: "Docker container rispro-test-postgres is not running.",
    };
  }

  if (container.Config?.Labels?.["rispro.role"] !== "test-db") {
    return {
      ok: false,
      reason: "Docker container rispro-test-postgres is not labeled rispro.role=test-db.",
    };
  }

  const publishedPorts = container.NetworkSettings?.Ports?.["5432/tcp"] ?? [];
  const databasePort = databaseUrl.port || "5432";
  const matchingPort = publishedPorts.find(
    (publishedPort) =>
      publishedPort.HostIp === "127.0.0.1"
      && publishedPort.HostPort === databasePort,
  );
  if (!matchingPort) {
    return {
      ok: false,
      reason: "Docker PostgreSQL must publish container port 5432 to DATABASE_URL on 127.0.0.1.",
    };
  }

  return { ok: true, databaseUrl };
}

test("bulk document deletion preserves patient identity documents", async (t) => {
  const safety = await verifyDisposableDatabaseSafety();
  if (!safety.ok) {
    t.skip(`Destructive bulk-delete test safety guard: ${safety.reason}`);
    return;
  }

  try {
    await pool.query("select 1");
  } catch {
    t.skip("PostgreSQL is not reachable at the configured disposable test database.");
    return;
  }

  const existingDocuments = await pool.query<{ count: number }>(
    "select count(*)::int as count from documents",
  );
  assert.equal(
    Number(existingDocuments.rows[0]?.count ?? 0),
    0,
    "Bulk-delete test refused: unexpected documents exist in the test database.",
  );

  const marker = crypto.randomUUID();
  const tempUploadsDir = path.join(os.tmpdir(), `rispro-document-delete-${marker}`);
  const tempNetworkDir = path.join(os.tmpdir(), `rispro-document-delete-network-${marker}`);
  const originalUploadsDir = env.uploadsDir;
  const settingsBefore = new Map<string, unknown | null>();
  const createdDocumentIds: number[] = [];
  let userId = 0;
  let patientId = 0;

  try {
    await fs.mkdir(tempUploadsDir, { recursive: true });
    await fs.mkdir(tempNetworkDir, { recursive: true });
    env.uploadsDir = tempUploadsDir;
    for (const key of settingKeys) {
      const result = await pool.query<{ setting_value: unknown }>(
        "select setting_value from system_settings where category='documents_and_uploads' and setting_key=$1",
        [key],
      );
      settingsBefore.set(key, result.rows[0]?.setting_value ?? null);
    }
    await setDocumentSetting("storage_path", "");
    await setDocumentSetting("storage_fallback_enabled", "true");
    await setDocumentSetting("ha_hot_storage_enabled", "false");

    const user = await pool.query<{ id: number }>(
      "insert into users(username,full_name,password_hash,role,is_active) values($1,$2,'test','supervisor',true) returning id",
      [`document_delete_${marker}`, `Document Delete ${marker}`],
    );
    userId = Number(user.rows[0]!.id);
    const patient = await pool.query<{ id: number }>(
      `
        insert into patients(
          national_id,identifier_type,identifier_value,arabic_full_name,english_full_name,
          normalized_arabic_name,age_years,estimated_date_of_birth,sex,phone_1,address,
          created_by_user_id,updated_by_user_id
        ) values($1,'national_id',$2,$3,$4,$3,35,'1991-01-01','M','0912345678','Test',$5,$5)
        returning id
      `,
      [
        `9${marker.replace(/\D/g, "").slice(-11).padStart(11, "0")}`,
        `9${marker.replace(/\D/g, "").slice(-11).padStart(11, "0")}`,
        `مريض حذف ${marker}`,
        `Delete Patient ${marker}`,
        userId,
      ],
    );
    patientId = Number(patient.rows[0]!.id);

    const identity = await uploadDocument({
      patientId,
      documentType: "patient_identity_document",
      originalFilename: "identity.pdf",
      mimeType: "application/pdf",
      source: "manual_upload",
      fileContentBase64: Buffer.from(`identity-${marker}`).toString("base64"),
    }, userId);
    createdDocumentIds.push(Number(identity.id));
    await verifyPatientIdentityDocument(patientId, identity.id, userId);
    const identityPathBeforeDelete = getDocumentAbsolutePath(identity);

    const ordinary = await uploadDocument({
      patientId,
      documentType: "appointment_request",
      originalFilename: "ordinary.pdf",
      mimeType: "application/pdf",
      source: "manual_upload",
      fileContentBase64: Buffer.from(`ordinary-${marker}`).toString("base64"),
    }, userId);
    createdDocumentIds.push(Number(ordinary.id));
    const ordinaryPath = getDocumentAbsolutePath(ordinary);

    const documentsBeforeDelete = await pool.query<{ id: number }>(
      "select id from documents order by id",
    );
    const expectedDocumentIds = [...new Set(createdDocumentIds)].sort((left, right) => left - right);
    const actualDocumentIds = documentsBeforeDelete.rows
      .map((document) => Number(document.id))
      .sort((left, right) => left - right);
    assert.deepEqual(
      actualDocumentIds,
      expectedDocumentIds,
      "Bulk-delete test refused: document IDs changed unexpectedly before deletion.",
    );

    const result = await deleteDocumentsByScope({ mode: "all" }, userId);

    assert.equal(result.deletedCount, 1);
    assert.equal(result.failures.length, 0);
    assert.equal((await pool.query("select 1 from documents where id=$1", [ordinary.id])).rowCount, 0);
    assert.equal((await pool.query("select 1 from documents where id=$1", [identity.id])).rowCount, 1);
    await assert.rejects(() => fs.stat(ordinaryPath), { code: "ENOENT" });
    assert.equal((await fs.stat(identityPathBeforeDelete)).isFile(), true);
    assert.equal((await getPatientIdentityDocumentState(patientId)).status, "verified");

    await setDocumentSetting("storage_path", tempNetworkDir);
    await setDocumentSetting("storage_fallback_enabled", "false");
    const moveResult = await moveDocumentsToConfiguredStorage({ mode: "all" }, userId);
    assert.equal(moveResult.movedCount, 1);
    const moved = (await pool.query<{ stored_path: string; storage_location_type: string }>(
      "select stored_path,storage_location_type from documents where id=$1",
      [identity.id],
    )).rows[0]!;
    assert.equal(moved.storage_location_type, "network");
    assert.equal((await fs.stat(getDocumentAbsolutePath(moved))).isFile(), true);
  } finally {
    if (createdDocumentIds.length) {
      await pool.query("delete from documents where id=any($1::bigint[])", [createdDocumentIds]).catch(() => undefined);
    }
    if (userId) {
      await pool.query("delete from audit_log where changed_by_user_id=$1", [userId]).catch(() => undefined);
    }
    if (patientId) {
      await pool.query("delete from patients where id=$1", [patientId]).catch(() => undefined);
    }
    if (userId) {
      await pool.query("delete from users where id=$1", [userId]).catch(() => undefined);
    }
    for (const key of settingKeys) {
      const previous = settingsBefore.get(key);
      if (previous == null) {
        await pool.query(
          "delete from system_settings where category='documents_and_uploads' and setting_key=$1",
          [key],
        ).catch(() => undefined);
      } else {
        await pool.query(
          "update system_settings set setting_value=$2::jsonb,updated_at=now() where category='documents_and_uploads' and setting_key=$1",
          [key, JSON.stringify(previous)],
        ).catch(() => undefined);
      }
    }
    env.uploadsDir = originalUploadsDir;
    await fs.rm(tempUploadsDir, { recursive: true, force: true });
    await fs.rm(tempNetworkDir, { recursive: true, force: true });
  }
});
