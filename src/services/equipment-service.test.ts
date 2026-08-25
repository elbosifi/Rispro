import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { pool } from "../db/pool.js";
import { errorHandler } from "../middleware/error-handler.js";
import { settingsRouter } from "../routes/settings.js";
import { createEquipment, deactivateEquipment, getEquipment, listEquipment, updateEquipment } from "./equipment-service.js";
import { HttpError } from "../utils/http-error.js";
import { canReachDatabase, createTestAuthCookie, createTestSupervisorReauthCookie, fetchJson } from "../modules/appointments-v2/tests/integration/helpers.js";

const prefix = `equipment_test_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
let userId = 0;
let modalityIds = { ct: 0, mr: 0, us: 0 };
let dicomIds = { ct: 0, mr: 0 };
let app: { baseUrl: string; close: () => Promise<void> } | null = null;

async function expectHttpError(run: () => Promise<unknown>, statusCode: number): Promise<void> {
  await assert.rejects(run, (error: unknown) => error instanceof HttpError && error.statusCode === statusCode);
}

async function createSettingsTestApp(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const http = await import("node:http");
  const testApp = express();
  testApp.use(express.json());
  testApp.use(cookieParser());
  testApp.use("/api/settings", settingsRouter);
  testApp.use(errorHandler);
  const server = http.createServer(testApp);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { baseUrl: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

async function createModality(code: string): Promise<number> {
  const result = await pool.query<{ id: number }>(`insert into modalities (code, name_ar, name_en, daily_capacity, is_active) values ($1, $2, $2, 20, true) returning id`, [code, `${prefix} ${code}`]);
  return Number(result.rows[0]!.id);
}

async function compatibleModalityId(codes: string[]): Promise<number> {
  const result = await pool.query<{ id: number }>("select id from modalities where upper(trim(code)) = any($1::text[]) order by case upper(trim(code)) when $2 then 0 else 1 end, id limit 1", [codes, codes[0]]);
  assert.equal(result.rows.length, 1, `expected a ${codes.join("/")} modality`);
  return Number(result.rows[0]!.id);
}

async function createDicomDevice(modalityId: number, suffix: string): Promise<number> {
  const result = await pool.query<{ id: number }>(`insert into dicom_devices (modality_id, device_name, modality_ae_title, scheduled_station_ae_title, created_by_user_id) values ($1, $2, $3, $3, $4) returning id`, [modalityId, `${prefix} ${suffix}`, `${prefix}_${suffix}`.toUpperCase(), userId]);
  return Number(result.rows[0]!.id);
}

describe("equipment service and Settings API", { skip: !process.env.DATABASE_URL ? "DATABASE_URL not set" : undefined }, () => {
  before(async () => {
    if (!await canReachDatabase()) return;
    const user = await pool.query<{ id: number }>(`insert into users (username, password_hash, full_name, role, is_active) values ($1, 'test-hash', $2, 'supervisor', true) returning id`, [`${prefix}_supervisor`, `${prefix} Supervisor`]);
    userId = Number(user.rows[0]!.id);
    modalityIds = { ct: await compatibleModalityId(["CT"]), mr: await compatibleModalityId(["MR", "MRI"]), us: await createModality(`US${prefix}`) };
    dicomIds = { ct: await createDicomDevice(modalityIds.ct, "CT"), mr: await createDicomDevice(modalityIds.mr, "MR") };
    app = await createSettingsTestApp();
  });

  after(async () => {
    await app?.close();
    if (!userId) return;
    await pool.query("delete from audit_log where changed_by_user_id=$1", [userId]);
    await pool.query("delete from equipment where name like $1", [`${prefix}%`]);
    await pool.query("delete from dicom_devices where id=any($1::bigint[])", [Object.values(dicomIds)]);
    await pool.query("delete from modalities where id=$1", [modalityIds.us]);
    await pool.query("delete from users where id=$1", [userId]);
  });

  it("lists active equipment by default and includes inactive records on request", async () => {
    const active = await createEquipment({ name: `${prefix} Active`, equipmentType: "WORKSTATION" }, userId);
    const inactive = await createEquipment({ name: `${prefix} Inactive`, equipmentType: "PRINTER" }, userId);
    await deactivateEquipment(inactive.id, userId);
    const activeOnly = await listEquipment();
    assert.ok(activeOnly.some((item) => item.id === active.id));
    assert.ok(!activeOnly.some((item) => item.id === inactive.id));
    assert.ok((await listEquipment(true)).some((item) => item.id === inactive.id && !item.isActive));
  });

  it("creates non-imaging equipment with no modality and a null legacy modality", async () => {
    const equipment = await createEquipment({ name: `${prefix} Workstation`, equipmentType: "WORKSTATION", location: "Reading room" }, userId);
    assert.equal(equipment.equipmentType, "WORKSTATION"); assert.equal(equipment.modalityId, null); assert.equal(equipment.modality, null); assert.equal(equipment.location, "Reading room");
  });

  it("creates CT and MRI equipment with their canonical legacy modalities", async () => {
    const ct = await createEquipment({ name: `${prefix} CT`, equipmentType: "CT", modalityId: modalityIds.ct }, userId);
    const mri = await createEquipment({ name: `${prefix} MRI`, equipmentType: "MRI", modalityId: modalityIds.mr }, userId);
    assert.equal(ct.modality, "CT"); assert.equal(ct.modalityId, modalityIds.ct); assert.equal(mri.modality, "MRI"); assert.equal(mri.modalityId, modalityIds.mr);
  });

  it("updates ordinary fields and keeps the legacy modality synchronized across type changes", async () => {
    const equipment = await createEquipment({ name: `${prefix} Update`, equipmentType: "CT", modalityId: modalityIds.ct }, userId);
    const mri = await updateEquipment(equipment.id, { equipmentType: "MRI", modalityId: modalityIds.mr, vendor: "Philips", model: "Ingenia", location: "MRI 1" }, userId);
    assert.equal(mri.modality, "MRI"); assert.equal(mri.vendor, "Philips"); assert.equal(mri.model, "Ingenia"); assert.equal(mri.location, "MRI 1");
    const workstation = await updateEquipment(equipment.id, { equipmentType: "WORKSTATION", modalityId: null }, userId);
    assert.equal(workstation.modality, null); assert.equal(workstation.equipmentType, "WORKSTATION");
  });

  it("deactivates equipment without deleting the record", async () => {
    const equipment = await createEquipment({ name: `${prefix} Deactivate`, equipmentType: "OTHER" }, userId);
    assert.equal((await deactivateEquipment(equipment.id, userId)).isActive, false); assert.equal((await getEquipment(equipment.id))?.id, equipment.id);
  });

  it("rejects invalid equipment types and incompatible or missing modalities", async () => {
    await expectHttpError(() => createEquipment({ name: `${prefix} Bad type`, equipmentType: "LASER" }, userId), 400);
    await expectHttpError(() => createEquipment({ name: `${prefix} Missing CT`, equipmentType: "CT" }, userId), 400);
    await expectHttpError(() => createEquipment({ name: `${prefix} Unknown modality`, equipmentType: "CT", modalityId: 999999999 }, userId), 400);
    await expectHttpError(() => createEquipment({ name: `${prefix} CT wrong modality`, equipmentType: "CT", modalityId: modalityIds.us }, userId), 400);
    await expectHttpError(() => createEquipment({ name: `${prefix} MRI wrong modality`, equipmentType: "MRI", modalityId: modalityIds.us }, userId), 400);
  });

  it("rejects missing, duplicate, and modality-mismatched DICOM links", async () => {
    await expectHttpError(() => createEquipment({ name: `${prefix} Missing DICOM`, equipmentType: "WORKSTATION", dicomDeviceId: 999999999 }, userId), 400);
    const linked = await createEquipment({ name: `${prefix} DICOM linked`, equipmentType: "CT", modalityId: modalityIds.ct, dicomDeviceId: dicomIds.ct }, userId);
    assert.equal(linked.dicomDeviceId, dicomIds.ct);
    await expectHttpError(() => createEquipment({ name: `${prefix} Duplicate DICOM`, equipmentType: "WORKSTATION", dicomDeviceId: dicomIds.ct }, userId), 409);
    await expectHttpError(() => createEquipment({ name: `${prefix} DICOM mismatch`, equipmentType: "MRI", modalityId: modalityIds.mr, dicomDeviceId: dicomIds.ct }, userId), 400);
  });

  it("writes equipment audit entries for create, update, and deactivate operations", async () => {
    const equipment = await createEquipment({ name: `${prefix} Audit`, equipmentType: "OTHER" }, userId);
    await updateEquipment(equipment.id, { location: "Archive" }, userId); await deactivateEquipment(equipment.id, userId);
    const entries = await pool.query<{ action_type: string }>("select action_type from audit_log where entity_type='equipment' and entity_id=$1 order by id", [equipment.id]);
    assert.deepEqual(entries.rows.map((row) => row.action_type), ["create", "update", "update"]);
  });

  it("applies Settings authentication, supervisor, and recent re-auth protections", async () => {
    assert.ok(app);
    assert.equal((await fetchJson(app.baseUrl, "/api/settings/equipment")).status, 401);
    assert.equal((await fetchJson(app.baseUrl, "/api/settings/equipment", { cookie: createTestAuthCookie(userId, "supervisor") })).status, 403);
    assert.equal((await fetchJson(app.baseUrl, "/api/settings/equipment", { cookie: `${createTestAuthCookie(userId, "receptionist")}; ${createTestSupervisorReauthCookie(userId, "supervisor")}` })).status, 403);
  });

  it("serves the protected Equipment list/create/update/deactivate API", async () => {
    assert.ok(app); const cookie = `${createTestAuthCookie(userId, "supervisor")}; ${createTestSupervisorReauthCookie(userId, "supervisor")}`;
    assert.equal((await fetchJson(app.baseUrl, "/api/settings/equipment", { cookie })).status, 200);
    const created = await fetchJson<{ equipment: { id: number; name: string } }>(app.baseUrl, "/api/settings/equipment", { method: "POST", cookie, body: { name: `${prefix} API`, equipmentType: "WORKSTATION", location: "Desk" } });
    assert.equal(created.status, 201); assert.equal(created.data.equipment.name, `${prefix} API`);
    const updated = await fetchJson<{ equipment: { location: string } }>(app.baseUrl, `/api/settings/equipment/${created.data.equipment.id}`, { method: "PATCH", cookie, body: { location: "Updated desk" } });
    assert.equal(updated.status, 200); assert.equal(updated.data.equipment.location, "Updated desk");
    const deactivated = await fetchJson<{ equipment: { isActive: boolean } }>(app.baseUrl, `/api/settings/equipment/${created.data.equipment.id}/deactivate`, { method: "POST", cookie });
    assert.equal(deactivated.status, 200); assert.equal(deactivated.data.equipment.isActive, false);
  });
});
