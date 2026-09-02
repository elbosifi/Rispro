import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { HttpError } from "../utils/http-error.js";

process.env.DATABASE_URL ||= "postgresql://127.0.0.1/rispro_test";

type Direction = "RECEIVED" | "SENT";
type Status = "ACTIVE" | "SUCCESS" | "FAILED";

test("lists durable DICOM transfer history with filters, pagination, and a safe response", async () => {
  const [{ pool }, { listDicomTransferHistory }] = await Promise.all([
    import("../db/pool.js"),
    import("./dicom-transfer-event-service.js")
  ]);
  const token = randomUUID().replaceAll("-", "").slice(0, 12);
  const createdIds: string[] = [];
  const studyUid = (name: string) => `2.25.${Date.now()}${Math.floor(Math.random() * 1_000_000)}.${name}`;
  const insertEvent = async (input: {
    direction?: Direction;
    status?: Status;
    patientId?: string | null;
    patientName?: string | null;
    accessionNumber?: string | null;
    studyInstanceUid?: string;
    studyDescription?: string | null;
    sourceAet?: string | null;
    sourceIp?: string | null;
    destinationAet?: string | null;
    instanceCount?: number | null;
    firstSeenAt?: string;
    lastSeenAt?: string;
    completedAt?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    orthancJobId?: string | null;
    orthancChangeSequence?: number | null;
    orthancResourceId?: string | null;
    idempotencyKey?: string | null;
    createdAt?: string;
    updatedAt?: string;
  } = {}) => {
    const firstSeenAt = input.firstSeenAt ?? "2026-01-01T00:00:00.000Z";
    const lastSeenAt = input.lastSeenAt ?? firstSeenAt;
    const createdAt = input.createdAt ?? firstSeenAt;
    const result = await pool.query<{ id: string }>(
      `insert into dicom_transfer_events (
        direction, status, patient_id, patient_name, accession_number, study_instance_uid, study_description,
        source_aet, source_ip, destination_aet, instance_count, first_seen_at, last_seen_at, completed_at,
        error_code, error_message, orthanc_job_id, orthanc_change_sequence, orthanc_resource_id,
        idempotency_key, created_at, updated_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      returning id::text`,
      [
        input.direction ?? "RECEIVED",
        input.status ?? "SUCCESS",
        input.patientId ?? null,
        input.patientName ?? null,
        input.accessionNumber ?? null,
        input.studyInstanceUid ?? studyUid(token),
        input.studyDescription ?? null,
        input.sourceAet ?? null,
        input.sourceIp ?? null,
        input.destinationAet ?? null,
        input.instanceCount ?? null,
        firstSeenAt,
        lastSeenAt,
        input.completedAt === undefined ? lastSeenAt : input.completedAt,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        input.orthancJobId ?? null,
        input.orthancChangeSequence ?? null,
        input.orthancResourceId ?? null,
        input.idempotencyKey ?? null,
        createdAt,
        input.updatedAt ?? createdAt
      ]
    );
    const id = result.rows[0]!.id;
    createdIds.push(id);
    return id;
  };

  const bulkSource = `BULK_SOURCE_${token}`;
  const bulkIp = `10.88.${token.slice(0, 2)}.1`;
  const bulkDestination = `BULK_DESTINATION_${token}`;
  const filterSource = `FILTER_SOURCE_${token}`;
  const searchSource = `SEARCH_SOURCE_${token}`;
  const routingPatient = `Routing Patient ${token}`;
  const timeSource = `TIME_SOURCE_${token}`;
  const bulkIds: string[] = [];

  try {
    for (let index = 0; index < 101; index += 1) {
      const occurredAt = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
      bulkIds.push(await insertEvent({
        patientId: `BULK_PATIENT_${index}`,
        patientName: `Bulk Patient ${index}`,
        accessionNumber: `BULK_ACCESSION_${index}`,
        studyInstanceUid: studyUid(`bulk-${index}`),
        sourceAet: bulkSource,
        sourceIp: bulkIp,
        destinationAet: bulkDestination,
        instanceCount: index,
        firstSeenAt: occurredAt,
        completedAt: occurredAt
      }));
    }
    const tieAt = "2026-08-31T12:00:00.000Z";
    const tieOneId = await insertEvent({ sourceAet: bulkSource, sourceIp: bulkIp, destinationAet: bulkDestination, studyInstanceUid: studyUid("tie-one"), firstSeenAt: tieAt, completedAt: tieAt });
    const tieTwoId = await insertEvent({ sourceAet: bulkSource, sourceIp: bulkIp, destinationAet: bulkDestination, studyInstanceUid: studyUid("tie-two"), firstSeenAt: tieAt, completedAt: tieAt });

    const defaultPage = await listDicomTransferHistory({ source: bulkSource });
    assert.equal(defaultPage.page, 1);
    assert.equal(defaultPage.pageSize, 25);
    assert.equal(defaultPage.total, 103);
    assert.equal(defaultPage.totalPages, 5);
    assert.equal(defaultPage.items.length, 25);
    assert.equal(defaultPage.items[0]!.id, tieTwoId);
    assert.equal(defaultPage.items[1]!.id, tieOneId);
    assert.equal(defaultPage.items[0]!.direction, "RECEIVED");
    assert.equal(defaultPage.items[0]!.status, "SUCCESS");

    const secondPage = await listDicomTransferHistory({ source: bulkSource, page: "2", pageSize: "25" });
    assert.equal(secondPage.page, 2);
    assert.equal(secondPage.pageSize, 25);
    assert.equal(secondPage.total, 103);
    assert.equal(secondPage.totalPages, 5);
    assert.equal(secondPage.items.length, 25);
    const firstPageIds = new Set(defaultPage.items.map((item) => item.id));
    assert.equal(secondPage.items.filter((item) => firstPageIds.has(item.id)).length, 0);

    for (const pageSize of [50, 100] as const) {
      const page = await listDicomTransferHistory({ source: bulkSource, pageSize });
      assert.equal(page.pageSize, pageSize);
      assert.equal(page.items.length, pageSize);
      assert.equal(page.total, 103);
      assert.equal(page.totalPages, Math.ceil(103 / pageSize));
    }

    await insertEvent({ direction: "RECEIVED", status: "SUCCESS", sourceAet: filterSource, sourceIp: `192.0.2.${token.slice(0, 2)}`, destinationAet: `FILTER_DEST_${token}`, studyInstanceUid: studyUid("received-success") });
    await insertEvent({ direction: "SENT", status: "SUCCESS", sourceAet: filterSource, sourceIp: `192.0.2.${token.slice(0, 2)}`, destinationAet: `FILTER_DEST_${token}`, studyInstanceUid: studyUid("sent-success") });
    await insertEvent({ direction: "RECEIVED", status: "FAILED", sourceAet: filterSource, sourceIp: `192.0.2.${token.slice(0, 2)}`, destinationAet: `FILTER_DEST_${token}`, studyInstanceUid: studyUid("received-failed"), errorCode: "failed_received", errorMessage: "received failure" });
    await insertEvent({ direction: "SENT", status: "FAILED", sourceAet: filterSource, sourceIp: `192.0.2.${token.slice(0, 2)}`, destinationAet: `FILTER_DEST_${token}`, studyInstanceUid: studyUid("sent-failed"), errorCode: "failed_sent", errorMessage: "sent failure" });
    await insertEvent({ direction: "RECEIVED", status: "ACTIVE", sourceAet: filterSource, sourceIp: `192.0.2.${token.slice(0, 2)}`, destinationAet: `FILTER_DEST_${token}`, studyInstanceUid: studyUid("received-active") });

    const received = await listDicomTransferHistory({ source: filterSource, direction: "received" });
    assert.equal(received.total, 3);
    assert.ok(received.items.every((item) => item.direction === "RECEIVED"));
    const sent = await listDicomTransferHistory({ source: filterSource, direction: "sent" });
    assert.equal(sent.total, 2);
    assert.ok(sent.items.every((item) => item.direction === "SENT"));
    const successfulSent = await listDicomTransferHistory({ source: filterSource, direction: "sent", status: "successful" });
    assert.equal(successfulSent.total, 1);
    assert.equal(successfulSent.items[0]!.status, "SUCCESS");
    const failed = await listDicomTransferHistory({ source: filterSource, status: "failed" });
    assert.equal(failed.total, 2);
    assert.ok(failed.items.every((item) => item.status === "FAILED"));
    const active = await listDicomTransferHistory({ source: filterSource, status: "active" });
    assert.equal(active.total, 1);
    assert.equal(active.items[0]!.status, "ACTIVE");

    const searchCases = [
      { patientName: `Patient Name ${token}`, patientId: "PATIENT-A", accessionNumber: "ACCESSION-A", studyInstanceUid: studyUid("search-name"), term: `Patient Name ${token}` },
      { patientName: "Patient B", patientId: `PATIENT-ID-${token}`, accessionNumber: "ACCESSION-B", studyInstanceUid: studyUid("search-id"), term: `PATIENT-ID-${token}` },
      { patientName: "Patient C", patientId: "PATIENT-C", accessionNumber: `ACCESSION-${token}`, studyInstanceUid: studyUid("search-accession"), term: `ACCESSION-${token}` },
      { patientName: "Patient D", patientId: "PATIENT-D", accessionNumber: "ACCESSION-D", studyInstanceUid: `2.25.999.${token}`, term: `2.25.999.${token}` }
    ];
    for (const searchCase of searchCases) {
      await insertEvent({
        patientName: searchCase.patientName,
        patientId: searchCase.patientId,
        accessionNumber: searchCase.accessionNumber,
        studyInstanceUid: searchCase.studyInstanceUid,
        sourceAet: searchSource,
        sourceIp: `198.51.100.${token.slice(0, 2)}`,
        destinationAet: `SEARCH_DEST_${token}`
      });
    }
    const percentName = `Literal 100% marker ${token}`;
    await insertEvent({ patientName: percentName, sourceAet: searchSource, sourceIp: `198.51.100.${token.slice(0, 2)}`, destinationAet: `SEARCH_DEST_${token}`, idempotencyKey: `SECRET_IDEMPOTENCY_${token}` });
    await insertEvent({ patientName: `Literal 1000 marker ${token}`, sourceAet: searchSource, sourceIp: `198.51.100.${token.slice(0, 2)}`, destinationAet: `SEARCH_DEST_${token}` });
    const backslashName = `Literal \\_ marker ${token}`;
    await insertEvent({ patientName: backslashName, sourceAet: searchSource, sourceIp: `198.51.100.${token.slice(0, 2)}`, destinationAet: `SEARCH_DEST_${token}` });
    await insertEvent({ patientName: `Literal _ marker ${token}`, sourceAet: searchSource, sourceIp: `198.51.100.${token.slice(0, 2)}`, destinationAet: `SEARCH_DEST_${token}` });

    for (const searchCase of searchCases) {
      const result = await listDicomTransferHistory({ source: searchSource, search: searchCase.term });
      assert.equal(result.total, 1);
      assert.equal(result.items[0]!.patientName, searchCase.patientName);
    }
    const percentSearch = await listDicomTransferHistory({ source: searchSource, search: `100% marker ${token}` });
    assert.equal(percentSearch.total, 1);
    assert.equal(percentSearch.items[0]!.patientName, percentName);
    const backslashSearch = await listDicomTransferHistory({ source: searchSource, search: `\\_ marker ${token}` });
    assert.equal(backslashSearch.total, 1);
    assert.equal(backslashSearch.items[0]!.patientName, backslashName);
    assert.equal(Object.hasOwn(percentSearch.items[0]!, "idempotency_key"), false);
    assert.equal(JSON.stringify(percentSearch.items[0]!).includes("SECRET_IDEMPOTENCY"), false);
    assert.equal(typeof percentSearch.items[0]!.id, "string");

    await insertEvent({ patientName: routingPatient, sourceAet: `SOURCE_AET_TARGET_${token}`, sourceIp: "203.0.113.1", destinationAet: `DESTINATION_A_${token}` });
    await insertEvent({ patientName: routingPatient, sourceAet: `SOURCE_AET_OTHER_${token}`, sourceIp: "203.0.113.2", destinationAet: `DESTINATION_B_${token}` });
    await insertEvent({ patientName: routingPatient, sourceAet: `SOURCE_AET_OTHER_${token}`, sourceIp: `SOURCE_IP_TARGET_${token}`, destinationAet: `DESTINATION_C_${token}` });
    await insertEvent({ patientName: routingPatient, sourceAet: `SOURCE_AET_OTHER_${token}`, sourceIp: "203.0.113.4", destinationAet: `DESTINATION_TARGET_${token}` });
    const sourceAet = await listDicomTransferHistory({ search: routingPatient, source: ` ${`SOURCE_AET_TARGET_${token}`} ` });
    assert.equal(sourceAet.total, 1);
    assert.equal(sourceAet.items[0]!.sourceAet, `SOURCE_AET_TARGET_${token}`);
    const sourceIp = await listDicomTransferHistory({ search: routingPatient, source: `SOURCE_IP_TARGET_${token}` });
    assert.equal(sourceIp.total, 1);
    assert.equal(sourceIp.items[0]!.sourceIp, `SOURCE_IP_TARGET_${token}`);
    const destination = await listDicomTransferHistory({ search: routingPatient, destination: ` DESTINATION_TARGET_${token} ` });
    assert.equal(destination.total, 1);
    assert.equal(destination.items[0]!.destinationAet, `DESTINATION_TARGET_${token}`);

    const coalescedOccurredAt = "2026-08-15T00:00:00.000Z";
    await insertEvent({ sourceAet: timeSource, studyInstanceUid: studyUid("time-before"), firstSeenAt: "2026-08-01T00:00:00.000Z", completedAt: "2026-08-01T00:00:00.000Z" });
    const fromInclusive = "2026-08-10T00:00:00.000Z";
    await insertEvent({ sourceAet: timeSource, studyInstanceUid: studyUid("time-from"), firstSeenAt: fromInclusive, completedAt: fromInclusive });
    await insertEvent({ sourceAet: timeSource, studyInstanceUid: studyUid("time-coalesced"), firstSeenAt: "2026-08-05T00:00:00.000Z", lastSeenAt: coalescedOccurredAt, completedAt: null, createdAt: "2026-08-01T00:00:00.000Z" });
    const toInclusive = "2026-08-20T00:00:00.000Z";
    await insertEvent({ sourceAet: timeSource, studyInstanceUid: studyUid("time-to"), firstSeenAt: toInclusive, completedAt: toInclusive });
    await insertEvent({ sourceAet: timeSource, studyInstanceUid: studyUid("time-after"), firstSeenAt: "2026-08-30T00:00:00.000Z", completedAt: "2026-08-30T00:00:00.000Z" });
    const timeRange = await listDicomTransferHistory({ source: timeSource, from: fromInclusive, to: toInclusive });
    assert.equal(timeRange.total, 3);
    const coalesced = timeRange.items.find((item) => item.studyInstanceUid.includes("time-coalesced"));
    assert.ok(coalesced);
    assert.equal(coalesced!.occurredAt, coalescedOccurredAt);
    assert.equal(coalesced!.completedAt, null);
    assert.equal(timeRange.items.some((item) => item.studyInstanceUid.includes("time-before")), false);
    assert.equal(timeRange.items.some((item) => item.studyInstanceUid.includes("time-after")), false);

    const assertBad = async (input: Parameters<typeof listDicomTransferHistory>[0]) => {
      await assert.rejects(() => listDicomTransferHistory(input), (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 400);
        return true;
      });
    };
    await assertBad({ direction: "RECEIVED" });
    await assertBad({ status: "SUCCESS" });
    await assertBad({ page: 0 });
    await assertBad({ page: "1.5" });
    await assertBad({ pageSize: 30 });
    await assertBad({ from: "not-a-timestamp" });
    await assertBad({ to: "not-a-timestamp" });
    await assertBad({ from: "2026-08-21T00:00:00.000Z", to: "2026-08-20T00:00:00.000Z" });
    await assertBad({ search: "x".repeat(201) });
    await assertBad({ source: "x".repeat(129) });
    await assertBad({ destination: "x".repeat(129) });
  } finally {
    if (createdIds.length) await pool.query("delete from dicom_transfer_events where id=any($1::bigint[])", [createdIds]);
  }
});
