import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, stat, unlink } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import jwt from "jsonwebtoken";
import sharp from "sharp";
import { resolveStorageBasePath } from "../../../services/document-storage-path.js";

process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";
process.env.JWT_SECRET ||= "teaching-content-test-secret";

test("Teaching catalog, content APIs, authorization, and immutable revision lifecycle", async (t) => {
  const [{ createApp }, { pool }, { env }] = await Promise.all([
    import("../../../app.js"),
    import("../../../db/pool.js"),
    import("../../../config/env.js"),
  ]);
  try {
    await pool.query("select 1 from teaching.question_banks limit 1");
  } catch {
    t.skip("PostgreSQL is not reachable at the configured disposable DATABASE_URL.");
    return;
  }

  const marker = `TST-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const subjectSuffix = BigInt(`0x${randomUUID().replaceAll("-", "").slice(0, 12)}`).toString();
  const identities = {
    learner: `${subjectSuffix}1`,
    author: `${subjectSuffix}2`,
    reviewer: `${subjectSuffix}3`,
    publisher: `${subjectSuffix}4`,
  };
  const subjects = Object.values(identities);
  const questionIds: number[] = [];
  let caseId: number | null = null;
  let sourceId: number | null = null;
  let examSourceId: number | null = null;
  let referenceId: number | null = null;
  let assetId: number | null = null;
  let invalidAssetId: number | null = null;
  const assetPaths: string[] = [];
  const client = await pool.connect();
  try {
    for (const [name, subject] of Object.entries(identities)) {
      await client.query(
        "insert into teaching.user_profiles (identity_issuer, identity_subject, display_name) values ('rispro', $1, $2)",
        [subject, `Teaching ${name}`],
      );
      const capabilities = name === "learner"
        ? ["teaching.access", "teaching.learn"]
        : name === "author"
          ? ["teaching.access", "teaching.author", "teaching.manage_sources"]
          : name === "reviewer"
            ? ["teaching.access", "teaching.review"]
            : ["teaching.access", "teaching.publish"];
      await client.query(
        `insert into teaching.user_permissions (identity_issuer, identity_subject, permission)
         select 'rispro', $1, capability.permission from unnest($2::text[]) as capability(permission)`,
        [subject, capabilities],
      );
    }
  } finally {
    client.release();
  }

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  const request = async (pathname: string, identity: string | null, body?: unknown, method = "GET") => {
    const token = identity ? jwt.sign({ sub: identity, role: "receptionist", fullName: "Teaching Test" }, env.jwtSecret) : "";
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        ...(token ? { Cookie: `${env.cookieName}=${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data: unknown = await response.json();
    return { status: response.status, data };
  };
  const readObject = (data: unknown): Record<string, unknown> => {
    assert.equal(typeof data, "object");
    assert.ok(data !== null);
    return data as Record<string, unknown>;
  };
  const coreQuestion = (externalId: string, overrides: Record<string, unknown> = {}) => ({
    externalId,
    questionBankCode: "radiology-main",
    type: "single_best_answer",
    stem: "Which imaging finding is most likely?",
    specialtyCode: "radiology",
    domainCode: "neuroradiology",
    topicCode: "brain-tumors",
    subtopicCode: "glioma",
    difficulty: 3,
    trainingLevelCode: "junior_resident",
    explanation: { summary: "A short explanation.", teachingPoint: "A key teaching point." },
    options: [
      { key: "A", text: "Most likely answer", isCorrect: true, explanation: "Supporting detail." },
      { key: "B", text: "Alternative answer", isCorrect: false },
    ],
    modalityCodes: ["CT", "MRI"],
    competencyCodes: ["diagnosis", "imaging_findings"],
    tagCodes: ["oncology", "emergency"],
    sources: [],
    references: [],
    assetIds: [],
    assetAltTexts: [],
    authorship: { kind: "human_authored" },
    ...overrides,
  });

  try {
    const anonymousCatalog = await request("/api/teaching/catalog", null);
    assert.equal(anonymousCatalog.status, 401);
    const catalogResponse = await request("/api/teaching/catalog", identities.learner);
    assert.equal(catalogResponse.status, 200, JSON.stringify(catalogResponse.data));
    const catalog = readObject(catalogResponse.data);
    assert.equal(catalog.schemaVersion, 1);
    assert.equal((catalog.specialties as Array<{ code: string }>).some((item) => item.code === "radiology"), true);
    assert.equal((catalog.domains as Array<{ code: string; parentCode: string }>).length, 10);
    assert.equal((catalog.topics as Array<{ code: string; parentCode: string }>).some((item) => item.code === "brain-tumors" && item.parentCode === "neuroradiology"), true);
    assert.deepEqual(catalog.supportedQuestionTypes, ["single_best_answer", "image_based_sba", "case_based_sba"]);
    const clinicalCatalogKeys = ["patients", "appointments", "reports", "pacs", "modalitiesConfig"];
    for (const key of clinicalCatalogKeys) assert.equal(Object.hasOwn(catalog, key), false);

    const learnerList = await request("/api/teaching/admin/questions", identities.learner);
    assert.equal(learnerList.status, 403);
    const learnerSource = await request("/api/teaching/admin/sources", identities.learner, { sourceType: "textbook", title: "Denied" }, "POST");
    assert.equal(learnerSource.status, 403);
    const reader = await request("/api/teaching/admin/question-banks", identities.learner);
    assert.equal(reader.status, 403);

    const textbook = await request("/api/teaching/admin/sources", identities.author, {
      sourceType: "textbook", title: "Teaching Textbook", organization: "Education Press", authors: ["A. Author"], edition: "2nd", year: 2024,
    }, "POST");
    assert.equal(textbook.status, 201);
    sourceId = Number(readObject(textbook.data).id);
    const exam = await request("/api/teaching/admin/sources", identities.author, {
      sourceType: "exam", title: "Board question", examName: "Radiology Board", examSitting: "2024", examPaper: "Paper 1", questionNumber: "5",
    }, "POST");
    assert.equal(exam.status, 201);
    examSourceId = Number(readObject(exam.data).id);
    assert.equal(readObject(exam.data).examName, "Radiology Board");

    const reference = await request("/api/teaching/admin/references", identities.author, {
      referenceType: "journal_article", title: "Evidence review", organization: "Radiology Journal", authors: ["R. Reader"],
      year: 2025, doi: "10.1000/test", citationText: "R. Reader. Evidence review.",
    }, "POST");
    assert.equal(reference.status, 201);
    referenceId = Number(readObject(reference.data).id);
    assert.equal(readObject(reference.data).referenceType, "journal_article");
    const sourceList = await request("/api/teaching/admin/sources?search=Teaching%20Textbook", identities.author);
    assert.equal((readObject(sourceList.data).items as unknown[]).length >= 1, true);
    assert.equal((readObject((await request("/api/teaching/admin/references?search=Evidence", identities.author)).data).items as unknown[]).length >= 1, true);

    const caseResponse = await request("/api/teaching/admin/cases", identities.author, {
      externalId: `${marker}-CASE`, specialtyCode: "radiology", title: "Teaching case", clinicalHistory: "A de-identified educational vignette.", assetIds: [],
    }, "POST");
    assert.equal(caseResponse.status, 201);
    caseId = Number(readObject(caseResponse.data).id);
    assert.equal((readObject((await request(`/api/teaching/admin/cases?search=${marker}-CASE`, identities.author)).data).items as unknown[]).length, 1);

    const assetFilename = `${randomUUID()}.webp`;
    const assetPath = path.join(resolveStorageBasePath(env.uploadsDir), "teaching", "assets", assetFilename);
    assetPaths.push(assetPath);
    await mkdir(path.dirname(assetPath), { recursive: true });
    await sharp({ create: { width: 1, height: 1, channels: 3, background: "#aaccff" } }).webp().toFile(assetPath);
    const assetStat = await stat(assetPath);
    const asset = await pool.query<{ id: string }>(
      `insert into teaching.assets (asset_key, storage_key, mime_type, original_filename, alt_text, size_bytes, created_by_identity_issuer, created_by_identity_subject)
       values ($1,$2,'image/webp','teaching-image.webp','Representative image',$4,'rispro',$3) returning id`,
      [`${marker}-ASSET`, `teaching/assets/${assetFilename}`, identities.author, assetStat.size],
    );
    assetId = Number(asset.rows[0]!.id);
    const invalidAsset = await pool.query<{ id: string }>(
      `insert into teaching.assets (asset_key, storage_key, mime_type, original_filename, size_bytes, created_by_identity_issuer, created_by_identity_subject)
       values ($1,$2,'image/png','invalid-path.png',10,'rispro',$3) returning id`,
      [`${marker}-INVALID-ASSET`, `teaching/assets/../clinical/${randomUUID()}.png`, identities.author],
    );
    invalidAssetId = Number(invalidAsset.rows[0]!.id);
    assert.equal((await request("/api/teaching/admin/assets", identities.learner, {}, "POST")).status, 403);
    const manualImageBytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#dba68a" } }).png().toBuffer();
    const manualUpload = new FormData();
    manualUpload.append("file", new Blob([new Uint8Array(manualImageBytes)], { type: "image/png" }), `${marker}-manual.png`);
    const authorCookie = `${env.cookieName}=${jwt.sign({ sub: identities.author, role: "receptionist", fullName: "Teaching Test" }, env.jwtSecret)}`;
    const uploadResponse = await fetch(`${baseUrl}/api/teaching/admin/assets`, { method: "POST", headers: { Cookie: authorCookie }, body: manualUpload });
    const uploadResponseBody = await uploadResponse.text();
    assert.equal(uploadResponse.status, 201, uploadResponseBody);
    const uploadedAsset = readObject(JSON.parse(uploadResponseBody) as unknown);
    const uploadedAssetId = Number(uploadedAsset.id);
    assert.equal(uploadedAsset.mimeType, "image/png");
    assert.equal(uploadedAsset.originalFilename, `${marker}-manual.png`);
    assert.deepEqual(Object.keys(uploadedAsset).sort(), ["altText", "id", "mimeType", "originalFilename", "sizeBytes"]);
    const storedUpload = await pool.query<{ storage_key: string }>("select storage_key from teaching.assets where id = $1", [uploadedAssetId]);
    assert.match(storedUpload.rows[0]!.storage_key, /^teaching\/assets\/[0-9a-f-]{36}\.png$/i);
    const uploadedPath = path.join(resolveStorageBasePath(env.uploadsDir), ...storedUpload.rows[0]!.storage_key.split("/"));
    assetPaths.push(uploadedPath);
    const uploadCookie = authorCookie;
    const uploadedImage = await fetch(`${baseUrl}/api/teaching/assets/${uploadedAssetId}`, { headers: { Cookie: uploadCookie } });
    assert.equal(uploadedImage.status, 200);
    assert.equal(uploadedImage.headers.get("content-type"), "image/png");
    assert.ok((await uploadedImage.arrayBuffer()).byteLength > 0);
    const mismatchedUpload = new FormData();
    mismatchedUpload.append("file", new Blob([new Uint8Array(manualImageBytes)], { type: "image/png" }), `${marker}-manual.jpg`);
    const mismatchedResponse = await fetch(`${baseUrl}/api/teaching/admin/assets`, { method: "POST", headers: { Cookie: authorCookie }, body: mismatchedUpload });
    assert.equal(mismatchedResponse.status, 400);
    await assert.rejects(
      pool.query(
        `insert into teaching.assets (asset_key, storage_key, mime_type, original_filename, size_bytes, created_by_identity_issuer, created_by_identity_subject)
         values ($1,$2,'image/dicom','image.dcm',123,'rispro',$3)`,
        [`${marker}-BAD-ASSET`, `teaching/${marker}/bad.dcm`, identities.author],
      ),
    );

    const invalidOptions = await request("/api/teaching/admin/questions", identities.author, coreQuestion(`${marker}-BAD-1`, {
      options: [{ key: "A", text: "A", isCorrect: false }, { key: "B", text: "B", isCorrect: false }],
    }), "POST");
    assert.equal(invalidOptions.status, 400);
    const invalidType = await request("/api/teaching/admin/questions", identities.author, coreQuestion(`${marker}-BAD-2`, { type: "essay" }), "POST");
    assert.equal(invalidType.status, 400);
    const invalidHierarchy = await request("/api/teaching/admin/questions", identities.author, coreQuestion(`${marker}-BAD-3`, { topicCode: "liver", subtopicCode: "glioma" }), "POST");
    assert.equal(invalidHierarchy.status, 400);
    await pool.query("insert into teaching.tags (code, label, is_active) values ($1, 'Inactive test tag', false)", [`${marker}-inactive`]);
    const inactiveTaxonomy = await request("/api/teaching/admin/questions", identities.author, coreQuestion(`${marker}-BAD-4`, { tagCodes: [`${marker}-inactive`] }), "POST");
    assert.equal(inactiveTaxonomy.status, 400);

    const imageWithoutAsset = await request("/api/teaching/admin/questions", identities.author, coreQuestion(`${marker}-IMAGE-WITHOUT-ASSET`, { type: "image_based_sba" }), "POST");
    assert.equal(imageWithoutAsset.status, 201);
    const imageWithoutAssetId = Number(readObject(imageWithoutAsset.data).id);
    questionIds.push(imageWithoutAssetId);
    const missingImageReview = await request(`/api/teaching/admin/questions/${imageWithoutAssetId}/submit-review`, identities.author, {}, "POST");
    assert.equal(missingImageReview.status, 400);
    const stillDraftResponse = await request(`/api/teaching/admin/questions/${imageWithoutAssetId}`, identities.author);
    const stillDraft = readObject(stillDraftResponse.data);
    assert.equal(readObject((stillDraft.revisions as unknown[])[0]).status, "draft");

    const imageWithMissingFile = await request("/api/teaching/admin/questions", identities.author, coreQuestion(`${marker}-IMAGE-MISSING-FILE`, { type: "image_based_sba", assetIds: [invalidAssetId] }), "POST");
    assert.equal(imageWithMissingFile.status, 201);
    const imageWithMissingFileId = Number(readObject(imageWithMissingFile.data).id);
    questionIds.push(imageWithMissingFileId);
    const unavailableImageReview = await request(`/api/teaching/admin/questions/${imageWithMissingFileId}/submit-review`, identities.author, {}, "POST");
    assert.equal(unavailableImageReview.status, 404);

    const questionResponse = await request("/api/teaching/admin/questions", identities.author, coreQuestion(`${marker}-QUESTION-1`, {
      type: "image_based_sba",
      assetIds: [assetId],
      sources: [
        { sourceId, relationship: "adapted", notes: "Adapted for local teaching." },
        { sourceId: examSourceId, relationship: "inspired_by" },
      ],
      references: [{ referenceId, notes: "Supports the explanation." }],
      authorship: { kind: "ai_assisted", modelName: "Model name recorded as metadata" },
    }), "POST");
    assert.equal(questionResponse.status, 201, JSON.stringify(questionResponse.data));
    let question = readObject(questionResponse.data);
    const questionId = Number(question.id);
    questionIds.push(questionId);
    let revisions = question.revisions as Array<Record<string, unknown>>;
    assert.equal(revisions.length, 1);
    const revisionId = Number(revisions[0]!.id);
    const firstRevision = readObject(revisions[0]);
    assert.equal(firstRevision.status, "draft");
    assert.deepEqual(firstRevision.modalities, [{ code: "CT", label: "CT" }, { code: "MRI", label: "MRI" }]);
    assert.equal((firstRevision.competencies as unknown[]).length, 2);
    assert.equal((firstRevision.tags as unknown[]).length, 2);
    assert.equal((firstRevision.sources as unknown[]).length, 2);
    assert.equal((firstRevision.references as unknown[]).length, 1);
    assert.equal((firstRevision.assets as unknown[]).length, 1);
    assert.equal(readObject(firstRevision.authorship).kind, "ai_assisted");
    assert.equal(JSON.stringify(question).includes(assetPath ?? "missing-test-path"), false);

    const assetCookie = `${env.cookieName}=${jwt.sign({ sub: identities.author, role: "receptionist", fullName: "Teaching Test" }, env.jwtSecret)}`;
    const protectedAsset = await fetch(`${baseUrl}/api/teaching/assets/${assetId}`, { headers: { Cookie: assetCookie } });
    assert.equal(protectedAsset.status, 200);
    assert.equal(protectedAsset.headers.get("content-type"), "image/webp");
    assert.match(protectedAsset.headers.get("content-disposition") ?? "", /^inline;/);
    assert.equal(protectedAsset.headers.get("cache-control"), "private, no-store");
    assert.equal(protectedAsset.headers.get("x-content-type-options"), "nosniff");
    assert.ok((await protectedAsset.arrayBuffer()).byteLength > 0);
    const deniedAsset = await fetch(`${baseUrl}/api/teaching/assets/${assetId}`, {
      headers: { Cookie: `${env.cookieName}=${jwt.sign({ sub: `no-teaching-${subjectSuffix}`, role: "receptionist" }, env.jwtSecret)}` },
    });
    assert.equal(deniedAsset.status, 403);
    assert.equal((await fetch(`${baseUrl}/api/teaching/assets/999999999`, { headers: { Cookie: assetCookie } })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/teaching/assets/${invalidAssetId}`, { headers: { Cookie: assetCookie } })).status, 404);

    const caseQuestion = await request("/api/teaching/admin/questions", identities.author, coreQuestion(`${marker}-QUESTION-2`, {
      type: "case_based_sba", caseId,
      sources: [{ sourceId, relationship: "adapted" }],
      references: [{ referenceId }],
    }), "POST");
    assert.equal(caseQuestion.status, 201);
    questionIds.push(Number(readObject(caseQuestion.data).id));
    const caseQuestionDetail = readObject(caseQuestion.data);
    const caseQuestionRevision = readObject((caseQuestionDetail.revisions as Array<unknown>)[0]);
    assert.equal((caseQuestionRevision.sources as Array<Record<string, unknown>>)[0]!.id, sourceId);
    assert.equal((caseQuestionRevision.references as Array<Record<string, unknown>>)[0]!.id, referenceId);
    assert.equal(readObject(caseQuestionRevision.case).id, caseId);
    const secondCaseQuestion = await request("/api/teaching/admin/questions", identities.author, coreQuestion(`${marker}-QUESTION-3`, {
      type: "case_based_sba", caseId,
    }), "POST");
    assert.equal(secondCaseQuestion.status, 201);
    questionIds.push(Number(readObject(secondCaseQuestion.data).id));

    const edited = await request(`/api/teaching/admin/questions/${questionId}/revisions/${revisionId}`, identities.author, {
      expectedVersion: Number(firstRevision.version),
      stem: "Updated educational question stem.", explanation: { teachingPoint: "Updated teaching point." },
    }, "PATCH");
    assert.equal(edited.status, 200);
    question = readObject(edited.data);
    revisions = question.revisions as Array<Record<string, unknown>>;
    assert.equal(revisions[0]!.stem, "Updated educational question stem.");
    assert.equal(revisions[0]!.version, 2);
    const staleDraftEdit = await request(`/api/teaching/admin/questions/${questionId}/revisions/${revisionId}`, identities.author, {
      expectedVersion: Number(firstRevision.version), stem: "Must not overwrite concurrent edits.",
    }, "PATCH");
    assert.equal(staleDraftEdit.status, 409);

    const authorCannotReview = await request(`/api/teaching/admin/questions/${questionId}/revisions/${revisionId}/review`, identities.author, {}, "POST");
    assert.equal(authorCannotReview.status, 403);
    const submitted = await request(`/api/teaching/admin/questions/${questionId}/submit-review`, identities.author, {}, "POST");
    assert.equal(submitted.status, 200);
    question = readObject(submitted.data);
    revisions = question.revisions as Array<Record<string, unknown>>;
    assert.equal(revisions[0]!.status, "in_review");
    const returnedToDraft = await request(`/api/teaching/admin/questions/${questionId}/revisions/${revisionId}/return-draft`, identities.reviewer, {}, "POST");
    assert.equal(returnedToDraft.status, 200);
    question = readObject(returnedToDraft.data);
    revisions = question.revisions as Array<Record<string, unknown>>;
    assert.equal(revisions[0]!.status, "draft");
    const resubmitted = await request(`/api/teaching/admin/questions/${questionId}/submit-review`, identities.author, {}, "POST");
    assert.equal(resubmitted.status, 200);

    const reviewed = await request(`/api/teaching/admin/questions/${questionId}/revisions/${revisionId}/review`, identities.reviewer, {}, "POST");
    assert.equal(reviewed.status, 200);
    question = readObject(reviewed.data);
    revisions = question.revisions as Array<Record<string, unknown>>;
    assert.equal(readObject(revisions[0]!.audit).reviewedBy, identities.reviewer);
    const authorCannotPublish = await request(`/api/teaching/admin/questions/${questionId}/publish`, identities.author, {}, "POST");
    assert.equal(authorCannotPublish.status, 403);
    const published = await request(`/api/teaching/admin/questions/${questionId}/publish`, identities.publisher, {}, "POST");
    assert.equal(published.status, 200);
    question = readObject(published.data);
    revisions = question.revisions as Array<Record<string, unknown>>;
    assert.equal(revisions[0]!.status, "published");
    assert.equal(readObject(revisions[0]!.audit).publishedBy, identities.publisher);

    const stalePublishedEdit = await request(`/api/teaching/admin/questions/${questionId}/revisions/${revisionId}`, identities.author, { stem: "Attempt to rewrite publication." }, "PATCH");
    assert.equal(stalePublishedEdit.status, 409);
    const concurrentRevisionAttempts = await Promise.all([
      request(`/api/teaching/admin/questions/${questionId}/new-revision`, identities.author, {}, "POST"),
      request(`/api/teaching/admin/questions/${questionId}/new-revision`, identities.author, {}, "POST"),
    ]);
    assert.deepEqual(concurrentRevisionAttempts.map((attempt) => attempt.status).sort(), [201, 409]);
    const nextRevision = concurrentRevisionAttempts.find((attempt) => attempt.status === 201)!;
    question = readObject(nextRevision.data);
    revisions = question.revisions as Array<Record<string, unknown>>;
    assert.equal(revisions.length, 2);
    assert.equal(revisions[0]!.revisionNumber, 2);
    assert.equal(revisions[0]!.status, "draft");
    assert.equal(revisions[0]!.stem, "Updated educational question stem.");
    assert.equal(revisions[1]!.revisionNumber, 1);
    assert.equal(revisions[1]!.status, "published");
    assert.equal(revisions[1]!.stem, "Updated educational question stem.");

    const questionList = await request(`/api/teaching/admin/questions?search=${marker}-QUESTION-1&status=draft&limit=2&offset=0`, identities.author);
    assert.equal(questionList.status, 200);
    assert.equal((readObject(questionList.data).items as unknown[]).length, 1);
    const filteredList = await request(`/api/teaching/admin/questions?search=Updated%20educational%20question%20stem&status=draft&domainCode=neuroradiology&topicCode=brain-tumors&type=image_based_sba&difficulty=3&trainingLevelCode=junior_resident&tagCode=oncology&sourceType=textbook&hasImage=true&imported=false&page=1&pageSize=1&sort=externalId&direction=asc`, identities.author);
    assert.equal(filteredList.status, 200, JSON.stringify(filteredList.data));
    const filteredData = readObject(filteredList.data);
    assert.equal((filteredData.items as unknown[]).length, 1);
    assert.deepEqual(filteredData.pagination, { page: 1, pageSize: 1, total: 1, totalPages: 1, limit: 1, offset: 0 });
    const badSort = await request("/api/teaching/admin/questions?sort=external_id%3Bdrop%20table%20teaching.questions", identities.author);
    assert.equal(badSort.status, 400);
    const repeatedRevision = await request(`/api/teaching/admin/questions/${questionId}/new-revision`, identities.author, {}, "POST");
    assert.equal(repeatedRevision.status, 409);

    const retired = await request(`/api/teaching/admin/questions/${questionId}/retire`, identities.publisher, {}, "POST");
    assert.equal(retired.status, 200);
    question = readObject(retired.data);
    revisions = question.revisions as Array<Record<string, unknown>>;
    assert.equal(question.retiredAt !== null, true);
    assert.equal(revisions[0]!.status, "retired");
    assert.equal(revisions[1]!.status, "published");
    assert.equal(revisions[1]!.stem, "Updated educational question stem.");

    const detailKeys = Object.keys(readObject((readObject((await request(`/api/teaching/admin/questions/${questionId}`, identities.author)).data)))).sort();
    assert.ok(detailKeys.includes("revisions"));
    const serialized = JSON.stringify(question).toLowerCase();
    for (const forbidden of ["patientid", "appointmentid", "studyinstanceuid", "accessionnumber", "pacsurl"]) {
      assert.equal(serialized.includes(forbidden), false);
    }
    const learnerMe = await request("/api/teaching/me", identities.learner);
    assert.equal(learnerMe.status, 200);
    const me = readObject(learnerMe.data);
    assert.deepEqual(Object.keys(me).sort(), ["displayName", "identitySubject", "permissions"]);
    assert.deepEqual(me.permissions, ["teaching.access", "teaching.learn"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await Promise.all(assetPaths.map((assetPath) => unlink(assetPath).catch(() => undefined)));
    const cleanup = await pool.connect();
    try {
      await cleanup.query("begin");
      const ids = questionIds.length
        ? questionIds
        : (await cleanup.query<{ id: number }>("select id from teaching.questions where external_id like $1", [`${marker}-%`])).rows.map((row) => row.id);
      if (ids.length) {
        await cleanup.query("delete from teaching.question_options where question_revision_id in (select id from teaching.question_revisions where question_id = any($1::bigint[]))", [ids]);
        for (const table of ["question_revision_modalities", "question_revision_competencies", "question_revision_tags", "question_sources", "question_references", "question_revision_assets"]) {
          await cleanup.query(`delete from teaching.${table} where question_revision_id in (select id from teaching.question_revisions where question_id = any($1::bigint[]))`, [ids]);
        }
        await cleanup.query("delete from teaching.question_revisions where question_id = any($1::bigint[])", [ids]);
        await cleanup.query("delete from teaching.questions where id = any($1::bigint[])", [ids]);
      }
      await cleanup.query(
        `delete from teaching.case_assets link using teaching.cases case_row
         where link.case_id = case_row.id and case_row.created_by_identity_subject = any($1::text[])`,
        [subjects],
      );
      await cleanup.query("delete from teaching.cases where created_by_identity_subject = any($1::text[])", [subjects]);
      await cleanup.query("delete from teaching.sources where created_by_identity_subject = any($1::text[])", [subjects]);
      await cleanup.query('delete from teaching."references" where created_by_identity_subject = any($1::text[])', [subjects]);
      await cleanup.query("delete from teaching.assets where created_by_identity_subject = any($1::text[])", [subjects]);
      await cleanup.query("delete from teaching.tags where code like $1", [`${marker}-%`]);
      await cleanup.query("delete from teaching.user_profiles where identity_issuer = 'rispro' and identity_subject = any($1::text[])", [subjects]);
      await cleanup.query("commit");
    } catch (error) {
      await cleanup.query("rollback");
      throw error;
    } finally {
      cleanup.release();
    }
  }
});
