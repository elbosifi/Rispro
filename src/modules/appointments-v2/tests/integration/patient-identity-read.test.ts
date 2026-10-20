import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../../../db/pool.js";
import { uploadDocument } from "../../../../services/document-service.js";
import {
  revokePatientIdentityDocumentVerification,
  verifyPatientIdentityDocument,
} from "../../../../services/patient-identity-document-service.js";
import {
  canReachDatabase,
  createTestApp,
  createTestAuthCookie,
  isDatabaseAvailable,
  seedTestData,
  setupTestDatabase,
  type TestData,
} from "./helpers.js";

const skip = !isDatabaseAvailable() ? "DATABASE_URL not set" : undefined;
const PREFIX = "IDENTITY_READ_";

describe("appointment identity badge read responses — integration", { skip }, () => {
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;
  let testData: TestData;
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let authCookie: string;
  let documentId = 0;

  before(async () => {
    if (!await canReachDatabase()) return;
    testDb = await setupTestDatabase(PREFIX);
    testData = await seedTestData(testDb.schemaName, PREFIX);
    app = await createTestApp();
    authCookie = createTestAuthCookie(testData.userId, "supervisor");
  });

  after(async () => {
    if (!testData) return;
    if (documentId) {
      await pool.query("delete from documents where id = $1", [documentId]);
    }
    await app.close();
    await testDb.cleanup();
  });

  it("returns verified identity status in list and detail, then reflects revocation", async () => {
    if (!testData) throw new Error("Test setup failed — database unreachable");

    const bookingResponse = await fetch(`${app.baseUrl}/api/v2/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie },
      body: JSON.stringify({
        patientId: testData.patientId,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: "2040-01-09",
        caseCategory: "non_oncology",
        policySetKey: testData.policySetKey,
      }),
    });
    const booking = await bookingResponse.json() as { booking?: { id: number } };
    assert.equal(bookingResponse.status, 201);

    const document = await uploadDocument({
      patientId: testData.patientId,
      documentType: "patient_identity_document",
      originalFilename: "identity.pdf",
      mimeType: "application/pdf",
      source: "manual_upload",
      fileContentBase64: Buffer.from("identity-read-test").toString("base64"),
    }, testData.userId);
    documentId = Number(document.id);
    await verifyPatientIdentityDocument(testData.patientId, documentId, testData.userId);

    const list = await fetch(`${app.baseUrl}/api/v2/read/appointments?date=2040-01-09`, { headers: { Cookie: authCookie } });
    const listBody = await list.json() as { appointments: Array<Record<string, unknown>> };
    const listAppointment = listBody.appointments.find((row) => Number(row.id) === Number(booking.booking?.id));
    assert.equal(list.status, 200);
    assert.equal(listAppointment?.identity_document_verified, true);

    const details = await fetch(`${app.baseUrl}/api/v2/read/appointments/${booking.booking?.id}`, { headers: { Cookie: authCookie } });
    const detailBody = await details.json() as { appointment: Record<string, unknown> };
    assert.equal(details.status, 200);
    assert.equal(detailBody.appointment.identity_document_verified, true);

    await revokePatientIdentityDocumentVerification(testData.patientId, testData.userId);

    const refreshedList = await fetch(`${app.baseUrl}/api/v2/read/appointments?date=2040-01-09`, { headers: { Cookie: authCookie } });
    const refreshedListBody = await refreshedList.json() as { appointments: Array<Record<string, unknown>> };
    const refreshedListAppointment = refreshedListBody.appointments.find((row) => Number(row.id) === Number(booking.booking?.id));
    assert.equal(refreshedListAppointment?.identity_document_verified, false);

    const refreshedDetails = await fetch(`${app.baseUrl}/api/v2/read/appointments/${booking.booking?.id}`, { headers: { Cookie: authCookie } });
    const refreshedDetailBody = await refreshedDetails.json() as { appointment: Record<string, unknown> };
    assert.equal(refreshedDetailBody.appointment.identity_document_verified, false);
  });
});
