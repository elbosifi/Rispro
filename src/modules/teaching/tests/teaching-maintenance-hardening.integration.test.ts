import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { Request } from "express";
import test from "node:test";
import { previewTeachingMaintenanceWorkbook, exportTeachingMaintenanceWorkbook } from "../import/maintenance-workbook-service.js";
import { readWorkbookFromBase64 } from "../../../services/workbook-service.js";

process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";

function multipartRequest(bytes: Buffer): Request {
  const boundary = "----teaching-maintenance-" + randomUUID();
  const body = Buffer.concat([
    Buffer.from("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"maintenance.xlsx\"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n"),
    bytes,
    Buffer.from("\r\n--" + boundary + "--\r\n"),
  ]);
  const request = Readable.from([body]) as unknown as Request;
  (request as unknown as { headers: Record<string, string> }).headers = {
    "content-type": "multipart/form-data; boundary=" + boundary,
    "content-length": String(body.length),
  };
  return request;
}

async function seedQuestions(pool: import("pg").Pool, prefix: string, count: number, withOptions: boolean) {
  const client = await pool.connect();
  const subject = String(BigInt("0x" + randomUUID().replaceAll("-", "").slice(0, 12)));
  const externalIds = Array.from({ length: count }, (_, index) => prefix + "-Q-" + String(index + 1).padStart(5, "0"));
  let questionIds: number[] = [];
  try {
    await client.query("begin");
    await client.query("insert into teaching.user_profiles (identity_issuer, identity_subject, display_name) values ('rispro', $1, $2)", [subject, "Synthetic maintenance scale test"]);
    const inserted = await client.query<{ id: string | number }>(
      "insert into teaching.questions (question_bank_id, specialty_id, external_id, created_by_identity_issuer, created_by_identity_subject) select bank.id, bank.specialty_id, supplied.external_id, 'rispro', $2 from teaching.question_banks bank cross join unnest($1::text[]) as supplied(external_id) where bank.code = 'radiology-main' returning id",
      [externalIds, subject],
    );
    questionIds = inserted.rows.map((row) => Number(row.id));
    assert.equal(questionIds.length, count);
    const revisions = await client.query<{ id: string | number }>(
      [
        "insert into teaching.question_revisions (question_id, revision_number, status, question_type, stem, specialty_id, domain_id, topic_id, subtopic_id, difficulty_id, training_level_id, explanation_summary, teaching_point, authorship_kind, created_by_identity_issuer, created_by_identity_subject, updated_by_identity_issuer, updated_by_identity_subject)",
        "select question_id, 1, 'draft', 'single_best_answer', $2 || ' synthetic teaching stem',",
        "(select id from teaching.specialties where code = 'radiology'),",
        "(select id from teaching.domains where code = 'neuroradiology' and specialty_id = (select id from teaching.specialties where code = 'radiology')),",
        "(select id from teaching.topics where code = 'brain-tumors'),",
        "(select id from teaching.subtopics where code = 'glioma'),",
        "(select id from teaching.difficulties where value = 3),",
        "(select id from teaching.training_levels where code = 'junior_resident'),",
        "'' , 'Synthetic explanation.', 'imported', 'rispro', $3, 'rispro', $3",
        "from unnest($1::bigint[]) as fixture(question_id) returning id",
      ].join("\n"),
      [questionIds, prefix, subject],
    );
    if (withOptions) {
      await client.query(
        [
          "insert into teaching.question_options (question_revision_id, option_key, text, is_correct, sort_order)",
          "select revision.id, option_row.option_key, option_row.text, option_row.is_correct, option_row.sort_order",
          "from teaching.question_revisions revision cross join (values ('A', 'Correct synthetic answer', true, 1), ('B', 'Incorrect synthetic answer', false, 2)) as option_row(option_key, text, is_correct, sort_order)",
          "where revision.question_id = any($1::bigint[])",
        ].join("\n"),
        [questionIds],
      );
    }
    await client.query("commit");
    return { questionIds, subject };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function removeQuestions(pool: import("pg").Pool, questionIds: number[]) {
  if (!questionIds.length) return;
  await pool.query("delete from teaching.question_revisions where question_id = any($1::bigint[])", [questionIds]);
  await pool.query("delete from teaching.questions where id = any($1::bigint[])", [questionIds]);
}

function worksheetRows(XLSX: typeof import("xlsx"), workbook: import("xlsx").WorkBook, name: string): unknown[][] {
  return XLSX.utils.sheet_to_json(workbook.Sheets[name]!, { header: 1, blankrows: false }) as unknown[][];
}

test("Teaching maintenance exports past 100, previews 3000 questions in batches, and rejects more than 5000", async (t) => {
  const { pool } = await import("../../../db/pool.js");
  try {
    const database = await pool.query<{ current_database: string }>("select current_database()");
    if (database.rows[0]?.current_database !== "rispro_test") {
      throw new Error("Teaching scale proof requires the disposable rispro_test database.");
    }
    await pool.query("select 1 from teaching.question_banks limit 1");
  } catch (error) {
    if (error instanceof Error && error.message.includes("requires the disposable")) throw error;
    t.skip("PostgreSQL is not reachable at the configured disposable DATABASE_URL.");
    return;
  }
  const marker = "TST-" + randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const questionSets: number[][] = [];
  const profileSubjects: string[] = [];
  try {
    const baseline = await pool.query<{ questions: string; options: string }>([
      "with latest as (select distinct on (question_id) id from teaching.question_revisions order by question_id, revision_number desc, id desc)",
      "select (select count(*)::text from latest) as questions,",
      "(select count(*)::text from teaching.question_options where question_revision_id in (select id from latest)) as options",
    ].join("\n"));
    const small = await seedQuestions(pool, marker + "-S150", 150, true);
    questionSets.push(small.questionIds);
    profileSubjects.push(small.subject);
    const smallWorkbook = await exportTeachingMaintenanceWorkbook({ search: marker + "-S150" });
    const parsedSmall = await readWorkbookFromBase64(smallWorkbook.toString("base64"));
    assert.equal(worksheetRows(parsedSmall.XLSX, parsedSmall.workbook, "Questions").length - 1, 150);
    assert.equal(worksheetRows(parsedSmall.XLSX, parsedSmall.workbook, "Options").length - 1, 300);
    const unfilteredWorkbook = await exportTeachingMaintenanceWorkbook();
    const parsedUnfiltered = await readWorkbookFromBase64(unfilteredWorkbook.toString("base64"));
    assert.equal(worksheetRows(parsedUnfiltered.XLSX, parsedUnfiltered.workbook, "Questions").length - 1, Number(baseline.rows[0]!.questions) + 150);
    assert.equal(worksheetRows(parsedUnfiltered.XLSX, parsedUnfiltered.workbook, "Options").length - 1, Number(baseline.rows[0]!.options) + 300);

    const large = await seedQuestions(pool, marker + "-S3000", 3000, true);
    questionSets.push(large.questionIds);
    profileSubjects.push(large.subject);
    const exportStarted = performance.now();
    const largeWorkbook = await exportTeachingMaintenanceWorkbook({ search: marker + "-S3000" });
    const exportDurationMs = Math.round(performance.now() - exportStarted);
    const workbookSizeBytes = largeWorkbook.byteLength;
    const parseStarted = performance.now();
    const parsedLarge = await readWorkbookFromBase64(largeWorkbook.toString("base64"));
    const questionRows = worksheetRows(parsedLarge.XLSX, parsedLarge.workbook, "Questions").length - 1;
    const optionRows = worksheetRows(parsedLarge.XLSX, parsedLarge.workbook, "Options").length - 1;
    const parseDurationMs = Math.round(performance.now() - parseStarted);
    assert.equal(questionRows, 3000);
    assert.equal(optionRows, 6000);
    const previewStarted = performance.now();
    const preview = await previewTeachingMaintenanceWorkbook(multipartRequest(largeWorkbook));
    const previewDurationMs = Math.round(performance.now() - previewStarted);
    assert.equal(preview.summary.total, 3000);
    assert.equal(preview.summary.unchanged, 3000);
    assert.equal(preview.errors.length, 0);
    console.log("[Teaching maintenance 3000-row proof] " + JSON.stringify({
      questionRows,
      optionRows,
      exportDurationMs,
      parseDurationMs,
      workbookSizeBytes,
      previewDurationMs,
      previewUnchanged: preview.summary.unchanged,
    }));

    const maximum = await seedQuestions(pool, marker + "-LIMIT-5000", 5000, false);
    questionSets.push(maximum.questionIds);
    profileSubjects.push(maximum.subject);
    const maxWorkbook = await exportTeachingMaintenanceWorkbook({ search: marker + "-LIMIT" });
    const parsedMaximum = await readWorkbookFromBase64(maxWorkbook.toString("base64"));
    assert.equal(worksheetRows(parsedMaximum.XLSX, parsedMaximum.workbook, "Questions").length - 1, 5000);
    const overflow = await seedQuestions(pool, marker + "-LIMIT-OVERFLOW", 1, false);
    questionSets.push(overflow.questionIds);
    profileSubjects.push(overflow.subject);
    await assert.rejects(
      exportTeachingMaintenanceWorkbook({ search: marker + "-LIMIT" }),
      (error: unknown) => typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 422
        && error instanceof Error && error.message.includes("5000"),
    );
  } finally {
    for (const ids of questionSets.reverse()) await removeQuestions(pool, ids);
    await pool.query("delete from teaching.user_profiles where identity_issuer = 'rispro' and identity_subject = any($1::text[])", [profileSubjects]);
    await pool.end();
  }
});
