import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../db/pool.js";
import type { OrthancStudyDetails } from "./authoritative-orthanc-service.js";
import { reconcileProtocolingPatientHistory } from "../modules/doctor-portal/protocoling-history.js";
import {
  dicomPatientNameVariants,
  discoverHistoricalPacsForPatient,
  getHistoricalPacsAdminStatus,
  getHistoricalPacsIndexState,
  HISTORICAL_PACS_INDEX_FRESHNESS_MS,
  lookupHistoricalPacsByPatientId,
  reconcileHistoricalPacsIndex,
  runHistoricalPacsSyncCycle,
  upsertHistoricalPacsStudies,
} from "./historical-pacs-index-service.js";

const suffix = () => `${Date.now()}${Math.floor(Math.random() * 100000)}`;

function study(overrides: Partial<OrthancStudyDetails> & Pick<OrthancStudyDetails, "orthancStudyId" | "patientId" | "patientName">): OrthancStudyDetails {
  return {
    studyInstanceUid: `1.2.840.${suffix()}`,
    accessionNumber: `ACC-${suffix()}`,
    patientBirthDate: null,
    patientSex: null,
    studyDate: "20250101",
    studyDescription: "Historical study",
    modalitiesInStudy: ["CT"],
    seriesCount: 2,
    instanceCount: 10,
    ...overrides,
  };
}

async function createPatient(input: { englishName: string; arabicName?: string; identifier?: string; dob?: string | null; estimated?: boolean; sex?: string }): Promise<number> {
  const id = suffix().slice(-12).padStart(12, "0");
  const identifier = input.identifier || `R-${suffix()}`;
  const result = await pool.query<{ id: number }>(
    `insert into patients (
      national_id,identifier_type,identifier_value,arabic_full_name,english_full_name,
      normalized_arabic_name,normalized_arabic_name_compact,age_years,estimated_date_of_birth,
      demographics_estimated,sex,phone_1,address
    ) values ($1,'other',$2,$3,$4,$5,$6,40,$7,$8,$9,'0912345678','test') returning id`,
    [id, identifier, input.arabicName || `اختبار ${suffix()}`, input.englishName, input.arabicName || `اختبار ${suffix()}`, (input.arabicName || `اختبار ${suffix()}`).replace(/\s+/g, ""), input.dob ?? null, input.estimated ?? false, input.sex || "M"],
  );
  return Number(result.rows[0]!.id);
}

async function removePatient(id: number): Promise<void> {
  await pool.query(`delete from patient_identifiers where patient_id=$1`, [id]);
  await pool.query(`delete from patients where id=$1`, [id]);
}

async function readyIndex(): Promise<void> {
  await pool.query(`update historical_pacs_sync_state set last_full_sync_at=now(),last_success_at=now(),last_error=null,
    sync_run_status='idle',sync_mode=null,sync_started_at=null,sync_progress_at=now(),sync_processed=0,sync_total=null where singleton_key=true`);
}

test("historical PACS index discovery and synchronization", async (t) => {
  await readyIndex();

  await t.test("sync progress migration has valid singleton defaults", async () => {
    const state = await pool.query(`select sync_run_status,sync_mode,sync_started_at,sync_processed,sync_total,last_observed_orthanc_study_count from historical_pacs_sync_state where singleton_key=true`);
    assert.equal(state.rows[0]?.sync_run_status, "idle");
    assert.equal(state.rows[0]?.sync_mode, null);
    assert.equal(state.rows[0]?.sync_started_at, null);
    assert.equal(state.rows[0]?.sync_processed, 0);
    assert.equal(state.rows[0]?.sync_total, null);
  });

  await t.test("exact known PatientID is authoritative, excluded from fuzzy candidates, and outranks fuzzy", async () => {
    const patientId = await createPatient({ englishName: "Muhammad Salem", identifier: "LEGACY-EXACT", dob: "1980-01-02", sex: "M" });
    try {
      await upsertHistoricalPacsStudies([
        study({ orthancStudyId: "exact-study", patientId: "LEGACY-EXACT", patientName: "MUHAMMAD^SALEM", patientBirthDate: "19800102", patientSex: "M" }),
        study({ orthancStudyId: "fuzzy-study", patientId: "LEGACY-FUZZY", patientName: "MOHAMED^SALEM" }),
      ]);
      const result = await discoverHistoricalPacsForPatient(patientId);
      assert.equal(result.exactStudies[0]?.orthancStudyId, "exact-study");
      assert.equal(result.candidates.some((candidate) => candidate.historicalPatientId === "LEGACY-EXACT"), false);
      assert.ok(result.candidates.some((candidate) => candidate.historicalPatientId === "LEGACY-FUZZY"));
      const exactStudy = result.exactStudies[0]!;
      const history = reconcileProtocolingPatientHistory([{
        appointmentId: 7, studyInstanceUid: exactStudy.studyInstanceUid, accessionNumber: exactStudy.accessionNumber,
        date: "2025-01-01", time: "09:00:00", modalityCode: "CT", description: "Exam",
        appointmentStatus: "completed", reportAvailable: true,
      }], result.exactStudies, null, null, result.knownPatientIds);
      assert.equal(history.find((item) => item.appointmentId === 7)?.source, "rispro_pacs");
    } finally {
      await pool.query(`delete from historical_pacs_studies where orthanc_study_id in ('exact-study','fuzzy-study')`);
      await removePatient(patientId);
    }
  });

  await t.test("manual old PatientID lookup uses live Orthanc without requiring a local index row", async () => {
    const exact = study({ orthancStudyId: "live-manual-exact", patientId: "LIVE-OLD-ID", patientName: "LIVE^PATIENT" });
    const mismatch = study({ orthancStudyId: "live-manual-mismatch", patientId: "OTHER-ID", patientName: "OTHER^PATIENT" });
    await pool.query(`delete from historical_pacs_studies where patient_id in ('LIVE-OLD-ID','OTHER-ID')`);
    let queriedPatientId = "";
    const manual = await lookupHistoricalPacsByPatientId(" LIVE-OLD-ID ", {
      async listStudiesByPatientId(patientId) { queriedPatientId = patientId; return [exact, mismatch]; },
    });
    assert.equal(queriedPatientId, "LIVE-OLD-ID");
    assert.equal(Number((await pool.query(`select count(*)::int count from historical_pacs_studies where patient_id='LIVE-OLD-ID'`)).rows[0]?.count), 0);
    assert.deepEqual(manual.map((candidate) => candidate.historicalPatientId), ["LIVE-OLD-ID"]);
    assert.deepEqual(manual[0]?.studies.map((item) => item.orthancStudyId), ["live-manual-exact"]);
    assert.equal(manual[0]?.authoritative, false);
  });

  await t.test("canonical phonetic variants Muhammad/Mohamed and Salim/Salem remain possible", async () => {
    for (const [currentName, historicalName] of [["Muhammad Ali", "MOHAMED^ALI"], ["Salim Nasser", "SALEM^NASSER"]]) {
      const patientId = await createPatient({ englishName: currentName });
      const orthancStudyId = `phonetic-${suffix()}`;
      try {
        await upsertHistoricalPacsStudies([study({ orthancStudyId, patientId: `OLD-${suffix()}`, patientName: historicalName })]);
        const result = await discoverHistoricalPacsForPatient(patientId);
        assert.ok(result.candidates.some((candidate) => candidate.studies.some((item) => item.orthancStudyId === orthancStudyId)));
        const candidate = result.candidates.find((item) => item.studies.some((entry) => entry.orthancStudyId === orthancStudyId));
        assert.ok(candidate?.reasons.includes("double_metaphone") || candidate?.reasons.includes("fuzzy_english_name"), JSON.stringify(result.candidates));
        if (currentName === "Muhammad Ali") assert.ok(candidate?.reasons.includes("soundex"), JSON.stringify(candidate));
      } finally {
        await pool.query(`delete from historical_pacs_studies where orthanc_study_id=$1`, [orthancStudyId]);
        await removePatient(patientId);
      }
    }
  });

  await t.test("ISSA/EISA phonetic overlap remains below the canonical short-token guard", async () => {
    const evidence = await pool.query<{ codes_overlap: boolean; token_similarity: number }>(
      `select patient_english_name_dmetaphone_tokens('issa') && patient_english_name_dmetaphone_tokens('eisa') codes_overlap,
        similarity('issa','eisa')::real token_similarity`,
    );
    assert.equal(evidence.rows[0]?.codes_overlap, true);
    assert.ok(Number(evidence.rows[0]?.token_similarity) < 0.25);
  });

  await t.test("Soundex corroborates gated English matches but cannot introduce a candidate alone", async () => {
    assert.equal((await pool.query<{ matches: boolean }>(`select soundex('Knuth') = soundex('Kant') matches`)).rows[0]?.matches, true);
    const patientId = await createPatient({ englishName: "Knuth Example" });
    const orthancStudyId = `soundex-only-${suffix()}`;
    try {
      await upsertHistoricalPacsStudies([study({ orthancStudyId, patientId: `SOUNDEX-${suffix()}`, patientName: "KANT^DIFFERENT" })]);
      const result = await discoverHistoricalPacsForPatient(patientId);
      assert.equal(result.candidates.some((candidate) => candidate.studies.some((item) => item.orthancStudyId === orthancStudyId)), false);
    } finally {
      await pool.query(`delete from historical_pacs_studies where orthanc_study_id=$1`, [orthancStudyId]);
      await removePatient(patientId);
    }
  });

  await t.test("ordered BEN ISSA chains retain contextual EISA and trailing-prefix transliterations", async () => {
    const patientId = await createPatient({ englishName: "BEN ISSA YOUSSEF MOHAMMED SHALWI", dob: "1963-01-01", estimated: false, sex: "M" });
    const fixtures = [
      ["REAL-BEN-1", "BEN EISA YOUSEF MOHAMMED", "19610101"],
      ["REAL-BEN-1-FAR", "BEN EISA YOUSEF MOHAMMED", "19400101"],
      ["REAL-BEN-2", "BEN ESSA YOSEF MOHAMED", null],
      ["FALSE-REPEATED", "BEN ISSA MOHAMMED BEN ISSA", "19610101"],
      ["FALSE-TWO-COMMON", "MOHAMMED MOUSA YOUSEF", "19610101"],
      ["FALSE-BELHASSAN", "YOUSSEF MOHAMMED BELHASSAN MAJID", "19610101"],
      ["FALSE-MOHAMMED-REPEATED", "MOHAMMED YOUSEF MOHAMMED", "19610101"],
      ["FALSE-TWO-TOKEN", "YOUSEF MOHAMMED", "19610101"],
      ["FALSE-MOSTAFA", "MOSTAFA YOUSSEF MOHAMMED", "19610101"],
      ["FALSE-MEFTAH", "MEFTAH YOUSSEF MOHAMMED", "19610101"],
      ["FALSE-SALAH", "SALAH MOHAMMED YOUSEF", "19610101"],
      ["FALSE-SALEM", "YOUSEF SALEM MOHAMMED", "19610101"],
    ] as const;
    try {
      await upsertHistoricalPacsStudies(fixtures.map(([legacyId, patientName, patientBirthDate], index) => study({
        orthancStudyId: `ben-gate-${index}`,
        patientId: legacyId,
        patientName,
        patientBirthDate,
        patientSex: "M",
      })));
      const candidates = (await discoverHistoricalPacsForPatient(patientId)).candidates;
      const returnedIds = new Set(candidates.map((candidate) => candidate.historicalPatientId));
      assert.equal(returnedIds.has("REAL-BEN-1"), true, JSON.stringify(candidates));
      assert.equal(returnedIds.has("REAL-BEN-1-FAR"), true, JSON.stringify(candidates));
      assert.equal(returnedIds.has("REAL-BEN-2"), true, JSON.stringify(candidates));
      assert.ok(candidates.findIndex((candidate) => candidate.historicalPatientId === "REAL-BEN-2") < candidates.findIndex((candidate) => candidate.historicalPatientId === "REAL-BEN-1"), JSON.stringify(candidates));
      for (const [legacyId] of fixtures.filter(([legacyId]) => legacyId.startsWith("FALSE-"))) assert.equal(returnedIds.has(legacyId), false, legacyId);
    } finally {
      await pool.query(`delete from historical_pacs_studies where orthanc_study_id like 'ben-gate-%'`);
      await removePatient(patientId);
    }
  });

  await t.test("ordered trailing prefixes preserve NAEEMA, RABHA, and SALWA transliterations", async () => {
    const fixtures = [
      ["Naeema Mohammed Ibrahim Alkaraghli", "ORDERED-NAEEMA", "NAEEMA MOHAMED IBRAHIM", []],
      ["Rabha Ahmed Hamed Alalwani", "ORDERED-RABHA", "RABHA AHMED HAMAD", []],
      ["Salwa Nouri Abdelkarim", "ORDERED-SALWA", "SALWA NOURI A.ALKREM", ["SALAH AWAD ABDULLAH", "SALHA ABED ABDALNE", "SALWA A.ALKREM NOURI", "SALWA NOURI SOMETHING A.ALKREM"]],
    ] as const;
    const patientIds: number[] = [];
    try {
      for (const [currentName, historicalId, historicalName, rejectedNames] of fixtures) {
        const patientId = await createPatient({ englishName: currentName });
        patientIds.push(patientId);
        await upsertHistoricalPacsStudies([
          study({ orthancStudyId: historicalId.toLowerCase(), patientId: historicalId, patientName: historicalName }),
          ...rejectedNames.map((patientName, index) => study({ orthancStudyId: `${historicalId.toLowerCase()}-reject-${index}`, patientId: `${historicalId}-REJECT-${index}`, patientName })),
        ]);
        const candidates = (await discoverHistoricalPacsForPatient(patientId)).candidates;
        assert.ok(candidates.some((candidate) => candidate.historicalPatientId === historicalId), `${historicalId}: ${JSON.stringify(candidates)}`);
        for (let index = 0; index < rejectedNames.length; index += 1) assert.equal(candidates.some((candidate) => candidate.historicalPatientId === `${historicalId}-REJECT-${index}`), false);
      }
    } finally {
      await pool.query(`delete from historical_pacs_studies where patient_id like 'ORDERED-%'`);
      for (const patientId of patientIds) await removePatient(patientId);
    }
  });

  await t.test("ABD-family A. abbreviations are strong positional matches but never a general wildcard", async () => {
    const fixtures = [
      ["ABD-ABBREVIATION-FIRST", "Abdelkarim Mohammed Salem", "A.ALKREM MOHAMED SALEM", true],
      ["ABD-ABBREVIATION-MIDDLE", "Mohammed Abdulrahman Salem", "MOHAMED A.RAHMAN SALEM", true],
      ["ABD-ABBREVIATION-ALI", "Ali Mohammed Salem", "A.LI MOHAMED SALEM", false],
      ["ABD-ABBREVIATION-AHMED", "Ahmed Mohammed Salem", "A.HMED MOHAMED SALEM", false],
      ["ABD-ABBREVIATION-MOHAMMED", "Abdelkarim Mohammed Salem", "A.MOHAMMED MOHAMED SALEM", false],
      ["ABD-ABBREVIATION-SALEM", "Abdelkarim Mohammed Salem", "A.SALEM MOHAMED SALEM", false],
    ] as const;
    const patientIds: number[] = [];
    try {
      for (const [historicalId, currentName, historicalName, expected] of fixtures) {
        const patientId = await createPatient({ englishName: currentName });
        patientIds.push(patientId);
        await upsertHistoricalPacsStudies([study({ orthancStudyId: historicalId.toLowerCase(), patientId: historicalId, patientName: historicalName })]);
        const candidates = (await discoverHistoricalPacsForPatient(patientId)).candidates;
        assert.equal(candidates.some((candidate) => candidate.historicalPatientId === historicalId), expected, `${historicalId}: ${JSON.stringify(candidates)}`);
      }
    } finally {
      await pool.query(`delete from historical_pacs_studies where patient_id like 'ABD-ABBREVIATION-%'`);
      for (const patientId of patientIds) await removePatient(patientId);
    }
  });

  await t.test("ordered chains reject skipped, restarted, reordered, and disagreeing components despite demographics", async () => {
    const fixtures = [
      ["Ali Khayri Faraj", ["ALI FARAJ", "FARAJ ALI FARAJ", "ALI FARAJ ALI"]],
      ["Amal Raheel Mohammed", ["AMAL MOHAMMED MOHAMMED", "AMAL ALHAMED MOHAMMED", "AMAL OMAR MOHAMMED", "AMAL FATHI MOHAMMED", "AMAL FAWZE MOHAMMED"]],
      ["Hamza Meftah Ahmed", ["HAMZA AHMED", "HAMZA AMJEHED MOFTAH", "HAMZA AMJAHED MUFTAH"]],
      ["Fatima Milad Alzwai", ["FATIMA MILAD MOKHTAR", "FATIMA MILAD"]],
    ] as const;
    const patientIds: number[] = [];
    const historicalIds: string[] = [];
    try {
      for (const [groupIndex, [currentName, historicalNames]] of fixtures.entries()) {
        const patientId = await createPatient({ englishName: currentName, dob: "1980-01-01", estimated: false, sex: "M" });
        patientIds.push(patientId);
        const studies = historicalNames.map((patientName, candidateIndex) => {
          const historicalId = `ORDER-REJECT-${groupIndex}-${candidateIndex}`;
          historicalIds.push(historicalId);
          return study({ orthancStudyId: historicalId.toLowerCase(), patientId: historicalId, patientName, patientBirthDate: "19820101", patientSex: "M" });
        });
        await upsertHistoricalPacsStudies(studies);
        const returnedIds = new Set((await discoverHistoricalPacsForPatient(patientId)).candidates.map((candidate) => candidate.historicalPatientId));
        for (const historicalId of historicalIds.slice(-historicalNames.length)) assert.equal(returnedIds.has(historicalId), false, `${historicalId}: ${JSON.stringify([...returnedIds])}`);
      }
    } finally {
      await pool.query(`delete from historical_pacs_studies where patient_id like 'ORDER-REJECT-%'`);
      for (const patientId of patientIds) await removePatient(patientId);
    }
  });

  await t.test("contextual phonetic bridge requires strong neighbors, cannot anchor, and is limited to one", async () => {
    const fixtures = [
      ["BRIDGE-SURROUNDED", "Ben Issa Youssef Mohammed", "BEN EISA YOUSEF MOHAMMED", true],
      ["BRIDGE-FIRST", "Issa Youssef Mohammed", "EISA YOUSEF MOHAMMED", false],
      ["BRIDGE-NO-FOLLOW", "Ben Issa Youssef Mohammed", "BEN EISA DIFFERENT", false],
      ["BRIDGE-TWICE", "Ben Issa Youssef Issa Mohammed", "BEN EISA YOUSEF EISA MOHAMMED", false],
    ] as const;
    const patientIds: number[] = [];
    try {
      for (const [historicalId, currentName, historicalName, expected] of fixtures) {
        const patientId = await createPatient({ englishName: currentName });
        patientIds.push(patientId);
        await upsertHistoricalPacsStudies([study({ orthancStudyId: historicalId.toLowerCase(), patientId: historicalId, patientName: historicalName })]);
        const candidates = (await discoverHistoricalPacsForPatient(patientId)).candidates;
        assert.equal(candidates.some((candidate) => candidate.historicalPatientId === historicalId), expected, `${historicalId}: ${JSON.stringify(candidates)}`);
      }
    } finally {
      await pool.query(`delete from historical_pacs_studies where patient_id like 'BRIDGE-%'`);
      for (const patientId of patientIds) await removePatient(patientId);
    }
  });

  await t.test("Soundex cannot supply structural coverage or the current-name anchor", async () => {
    assert.equal((await pool.query<{ matches: boolean }>(`select soundex('Knuth') = soundex('Kant') matches`)).rows[0]?.matches, true);
    const patientId = await createPatient({ englishName: "Knuth Example Third" });
    try {
      await upsertHistoricalPacsStudies([study({ orthancStudyId: "soundex-structural", patientId: "SOUNDEX-STRUCTURAL", patientName: "KANT^EXAMPLE^DIFFERENT" })]);
      const candidates = await discoverHistoricalPacsForPatient(patientId);
      assert.equal(candidates.candidates.some((candidate) => candidate.historicalPatientId === "SOUNDEX-STRUCTURAL"), false);
    } finally {
      await pool.query(`delete from historical_pacs_studies where orthanc_study_id='soundex-structural'`);
      await removePatient(patientId);
    }
  });

  await t.test("indexed StudyInstanceUID reconciles a study while surfacing a different PACS PatientID", async () => {
    const patientId = await createPatient({ englishName: "UID Match Patient", identifier: "CURRENT-PID" });
    const indexed = study({ orthancStudyId: "uid-patient-mismatch", studyInstanceUid: "1.2.840.uid-mismatch", accessionNumber: "PACS-OTHER", patientId: "OTHER-PID", patientName: "UNRELATED^NAME" });
    try {
      await upsertHistoricalPacsStudies([indexed]);
      const discovery = await discoverHistoricalPacsForPatient(patientId, [indexed.studyInstanceUid!]);
      const history = reconcileProtocolingPatientHistory([{
        appointmentId: 8, studyInstanceUid: indexed.studyInstanceUid, accessionNumber: "RISPRO-ACCESSION",
        date: "2025-01-01", time: "10:00:00", modalityCode: "CT", description: "Exam",
        appointmentStatus: "completed", reportAvailable: false,
      }], discovery.exactStudies, null, null, discovery.knownPatientIds);
      assert.equal(history[0]?.source, "rispro_pacs");
      assert.equal(history[0]?.identityDiscrepancy, "patient_id_mismatch");
    } finally {
      await pool.query(`delete from historical_pacs_studies where orthanc_study_id='uid-patient-mismatch'`);
      await removePatient(patientId);
    }
  });

  await t.test("Arabic dictionary fallback still applies the English PACS structural gate", async () => {
    const dictionary = await pool.query<{ arabic_text: string; english_text: string }>(
      `select arabic_text,english_text from name_dictionary where is_active=true and arabic_text=any($1::text[])`,
      [["محمد", "علي"]],
    );
    assert.deepEqual(new Map(dictionary.rows.map((row) => [row.arabic_text, row.english_text])), new Map([["محمد", "Mohamed"], ["علي", "Ali"]]));
    const patientId = await createPatient({ englishName: "", arabicName: "محمد علي" });
    try {
      await upsertHistoricalPacsStudies([
        study({ orthancStudyId: "arabic-dictionary-adequate", patientId: "ARABIC-DICTIONARY-ADEQUATE", patientName: "MOHAMED^ALI" }),
        study({ orthancStudyId: "arabic-dictionary-weak", patientId: "ARABIC-DICTIONARY-WEAK", patientName: "KAREEM^ALI" }),
      ]);
      const result = await discoverHistoricalPacsForPatient(patientId);
      assert.ok(result.candidates.some((candidate) => candidate.historicalPatientId === "ARABIC-DICTIONARY-ADEQUATE"), JSON.stringify(result.candidates));
      assert.equal(result.candidates.some((candidate) => candidate.historicalPatientId === "ARABIC-DICTIONARY-WEAK"), false);
    } finally {
      await pool.query(`delete from historical_pacs_studies where orthanc_study_id in ('arabic-dictionary-adequate','arabic-dictionary-weak')`);
      await removePatient(patientId);
    }
  });

  await t.test("DICOM Family^Given^Middle produces both family-first and human-order variants", async () => {
    assert.deepEqual(dicomPatientNameVariants("ALSIFI^SERAJ^ALI"), ["ALSIFI SERAJ ALI", "SERAJ ALI ALSIFI"]);
    assert.deepEqual(dicomPatientNameVariants("السيفي^سراج^علي=ALSIFI^SERAJ^ALI"), ["السيفي سراج علي", "سراج علي السيفي", "ALSIFI SERAJ ALI", "SERAJ ALI ALSIFI"]);
    const patientId = await createPatient({ englishName: "Seraj Ali Alsifi" });
    const orthancStudyId = `pn-${suffix()}`;
    try {
      await upsertHistoricalPacsStudies([study({ orthancStudyId, patientId: `PN-${suffix()}`, patientName: "ALSIFI^SERAJ^ALI" })]);
      const candidate = (await discoverHistoricalPacsForPatient(patientId)).candidates.find((item) => item.studies.some((entry) => entry.orthancStudyId === orthancStudyId));
      assert.ok(candidate);
      assert.equal(candidate.matchRank, 4);
    } finally {
      await pool.query(`delete from historical_pacs_studies where orthanc_study_id=$1`, [orthancStudyId]);
      await removePatient(patientId);
    }
  });

  await t.test("DOB is positive-only evidence while populated-sex mismatch still rejects", async () => {
    const patientId = await createPatient({ englishName: "Kareem Ali", dob: "1985-04-03", estimated: false, sex: "M" });
    try {
      await upsertHistoricalPacsStudies([
        study({ orthancStudyId: "dob-compatible", patientId: "DOB-YES", patientName: "KAREEM^ALI", patientBirthDate: "19850403", patientSex: "M" }),
        study({ orthancStudyId: "dob-near", patientId: "DOB-NEAR", patientName: "KAREEM^ALI", patientBirthDate: "19820403", patientSex: "M" }),
        study({ orthancStudyId: "dob-far", patientId: "DOB-FAR", patientName: "KAREEM^ALI", patientBirthDate: "19700403", patientSex: "M" }),
        study({ orthancStudyId: "sex-mismatch", patientId: "SEX-NO", patientName: "KAREEM^ALI", patientBirthDate: "19850403", patientSex: "F" }),
      ]);
      const result = await discoverHistoricalPacsForPatient(patientId);
      assert.deepEqual(result.candidates.filter((item) => item.historicalPatientId.startsWith("DOB-")).map((item) => item.historicalPatientId), ["DOB-YES", "DOB-NEAR", "DOB-FAR"]);
      const compatible = result.candidates.find((item) => item.historicalPatientId === "DOB-YES");
      assert.equal(compatible?.classification, "strong_demographic");
      assert.ok(compatible?.reasons.includes("exact_dob"));
      const near = result.candidates.find((item) => item.historicalPatientId === "DOB-NEAR");
      assert.ok(near?.reasons.includes("age_within_5_years"));
      assert.equal(near?.reasons.includes("exact_dob"), false);
      const far = result.candidates.find((item) => item.historicalPatientId === "DOB-FAR");
      assert.ok(far);
      assert.equal(far.reasons.includes("age_within_5_years"), false);
      assert.equal(far.reasons.includes("exact_dob"), false);
      assert.equal(result.candidates.some((item) => item.historicalPatientId === "SEX-NO"), false);
    } finally {
      await pool.query(`delete from historical_pacs_studies where orthanc_study_id in ('dob-compatible','dob-near','dob-far','sex-mismatch')`);
      await removePatient(patientId);
    }
  });

  await t.test("demographics cannot rescue a broken ordered chain and far DOB does not reject a valid prefix", async () => {
    const patientId = await createPatient({ englishName: "Nabil Hassan Ali Salem Omar", dob: "1980-01-01", estimated: false, sex: "M" });
    try {
      await upsertHistoricalPacsStudies([
        study({ orthancStudyId: "borderline-rescued", patientId: "BORDERLINE-RESCUED", patientName: "NABIL^HASSAN^ALI^DIFFERENT^EXTRA", patientBirthDate: "19800101", patientSex: "M" }),
        study({ orthancStudyId: "borderline-wrong-anchor", patientId: "BORDERLINE-WRONG-ANCHOR", patientName: "KAREEM^HASSAN^ALI^SALEM^EXTRA", patientBirthDate: "19800101", patientSex: "M" }),
        study({ orthancStudyId: "far-dob-strong-name", patientId: "FAR-DOB-STRONG-NAME", patientName: "NABIL^HASSAN^ALI^SALEM", patientBirthDate: "19500101", patientSex: "M" }),
      ]);
      const candidates = (await discoverHistoricalPacsForPatient(patientId)).candidates;
      assert.equal(candidates.some((candidate) => candidate.historicalPatientId === "BORDERLINE-RESCUED"), false, JSON.stringify(candidates));
      assert.equal(candidates.some((candidate) => candidate.historicalPatientId === "BORDERLINE-WRONG-ANCHOR"), false);
      assert.ok(candidates.some((candidate) => candidate.historicalPatientId === "FAR-DOB-STRONG-NAME"), JSON.stringify(candidates));
    } finally {
      await pool.query(`delete from historical_pacs_studies where orthanc_study_id in ('borderline-rescued','borderline-wrong-anchor','far-dob-strong-name')`);
      await removePatient(patientId);
    }
  });

  await t.test("a one-component name requires exact reliable DOB and compatible known sex", async () => {
    const patientId = await createPatient({ englishName: "Fatima", dob: "1990-02-03", estimated: false, sex: "F" });
    try {
      await upsertHistoricalPacsStudies([
        study({ orthancStudyId: "single-proven", patientId: "SINGLE-PROVEN", patientName: "FATIMA", patientBirthDate: "19900203", patientSex: "F" }),
        study({ orthancStudyId: "single-no-dob", patientId: "SINGLE-NO-DOB", patientName: "FATIMA", patientBirthDate: null, patientSex: "F" }),
        study({ orthancStudyId: "single-wrong-anchor", patientId: "SINGLE-WRONG-ANCHOR", patientName: "KHADIJA^ALI^MOHAMMED", patientBirthDate: "19900203", patientSex: "F" }),
      ]);
      const candidates = (await discoverHistoricalPacsForPatient(patientId)).candidates;
      assert.ok(candidates.some((candidate) => candidate.historicalPatientId === "SINGLE-PROVEN"), JSON.stringify(candidates));
      assert.equal(candidates.some((candidate) => candidate.historicalPatientId === "SINGLE-NO-DOB"), false);
      assert.equal(candidates.some((candidate) => candidate.historicalPatientId === "SINGLE-WRONG-ANCHOR"), false);
    } finally {
      await pool.query(`delete from historical_pacs_studies where orthanc_study_id in ('single-proven','single-no-dob','single-wrong-anchor')`);
      await removePatient(patientId);
    }
  });

  await t.test("calendar-year boundary and leap-day clamping are deterministic", async () => {
    const boundaryPatient = await createPatient({ englishName: "Calendar Boundary", dob: "1980-01-01", estimated: false });
    const leapPatient = await createPatient({ englishName: "Leap Boundary", dob: "1980-02-29", estimated: false });
    try {
      await upsertHistoricalPacsStudies([
        study({ orthancStudyId: "calendar-exact", patientId: "CAL-EXACT", patientName: "CALENDAR^BOUNDARY", patientBirthDate: "19800101", patientSex: null }),
        study({ orthancStudyId: "calendar-within", patientId: "CAL-WITHIN", patientName: "CALENDAR^BOUNDARY", patientBirthDate: "19850101", patientSex: null }),
        study({ orthancStudyId: "calendar-outside", patientId: "CAL-OUTSIDE", patientName: "CALENDAR^BOUNDARY", patientBirthDate: "19850102", patientSex: null }),
        study({ orthancStudyId: "leap-within", patientId: "LEAP-WITHIN", patientName: "LEAP^BOUNDARY", patientBirthDate: "19850228", patientSex: null }),
        study({ orthancStudyId: "leap-outside", patientId: "LEAP-OUTSIDE", patientName: "LEAP^BOUNDARY", patientBirthDate: "19850301", patientSex: null }),
      ]);
      const boundary = await discoverHistoricalPacsForPatient(boundaryPatient);
      assert.ok(boundary.candidates.find((item) => item.historicalPatientId === "CAL-EXACT")?.reasons.includes("exact_dob"));
      assert.equal(boundary.candidates.find((item) => item.historicalPatientId === "CAL-EXACT")?.reasons.includes("age_within_5_years"), false);
      assert.ok(boundary.candidates.find((item) => item.historicalPatientId === "CAL-WITHIN")?.reasons.includes("age_within_5_years"));
      assert.equal(boundary.candidates.find((item) => item.historicalPatientId === "CAL-OUTSIDE")?.reasons.includes("age_within_5_years"), false);
      const leap = await discoverHistoricalPacsForPatient(leapPatient);
      assert.ok(leap.candidates.find((item) => item.historicalPatientId === "LEAP-WITHIN")?.reasons.includes("age_within_5_years"));
      assert.equal(leap.candidates.find((item) => item.historicalPatientId === "LEAP-OUTSIDE")?.reasons.includes("age_within_5_years"), false);
    } finally {
      await pool.query(`delete from historical_pacs_studies where orthanc_study_id in ('calendar-exact','calendar-within','calendar-outside','leap-within','leap-outside')`);
      await removePatient(boundaryPatient);
      await removePatient(leapPatient);
    }
  });

  await t.test("compatible sex breaks otherwise identical name ties without rejecting missing sex", async () => {
    const patientId = await createPatient({ englishName: "Sex Ranking", dob: null, sex: "M" });
    try {
      await upsertHistoricalPacsStudies([
        study({ orthancStudyId: "sex-rank-missing", patientId: "AA-SEX-MISSING", patientName: "SEX^RANKING", patientSex: null }),
        study({ orthancStudyId: "sex-rank-compatible", patientId: "ZZ-SEX-COMPATIBLE", patientName: "SEX^RANKING", patientSex: "M" }),
      ]);
      const ranked = (await discoverHistoricalPacsForPatient(patientId)).candidates.filter((item) => item.historicalPatientId.includes("SEX-"));
      assert.deepEqual(ranked.map((item) => item.historicalPatientId), ["ZZ-SEX-COMPATIBLE", "AA-SEX-MISSING"]);
      assert.ok(ranked[0]?.reasons.includes("compatible_sex"));
    } finally {
      await pool.query(`delete from historical_pacs_studies where orthanc_study_id in ('sex-rank-missing','sex-rank-compatible')`);
      await removePatient(patientId);
    }
  });

  await t.test("materially stronger name evidence remains ahead of demographic bonuses", async () => {
    const patientId = await createPatient({ englishName: "Muhammad Ali", dob: "1980-01-01", estimated: false, sex: "M" });
    try {
      await upsertHistoricalPacsStudies([
        study({ orthancStudyId: "name-primary-strong", patientId: "ZZ-NAME-STRONG", patientName: "MUHAMMAD^ALI", patientBirthDate: null, patientSex: null }),
        study({ orthancStudyId: "name-primary-demographic", patientId: "AA-NAME-DEMOGRAPHIC", patientName: "MOHAMED^ALI", patientBirthDate: "19800101", patientSex: "M" }),
      ]);
      const ranked = (await discoverHistoricalPacsForPatient(patientId)).candidates.filter((item) => item.historicalPatientId.includes("NAME-"));
      assert.deepEqual(ranked.map((item) => item.historicalPatientId), ["ZZ-NAME-STRONG", "AA-NAME-DEMOGRAPHIC"]);
      assert.ok(ranked[0]!.matchRank < ranked[1]!.matchRank || ranked[0]!.nameSimilarity > ranked[1]!.nameSimilarity);
    } finally {
      await pool.query(`delete from historical_pacs_studies where orthanc_study_id in ('name-primary-strong','name-primary-demographic')`);
      await removePatient(patientId);
    }
  });

  await t.test("estimated RISpro DOB contributes no demographic ordering bonus", async () => {
    const patientId = await createPatient({ englishName: "Estimated Ranking", dob: "1980-01-01", estimated: true });
    try {
      await upsertHistoricalPacsStudies([
        study({ orthancStudyId: "estimated-rank-far", patientId: "AA-EST-FAR", patientName: "ESTIMATED^RANKING", patientBirthDate: "19600101", patientSex: null }),
        study({ orthancStudyId: "estimated-rank-exact", patientId: "ZZ-EST-EXACT", patientName: "ESTIMATED^RANKING", patientBirthDate: "19800101", patientSex: null }),
      ]);
      const ranked = (await discoverHistoricalPacsForPatient(patientId)).candidates.filter((item) => item.historicalPatientId.includes("EST-"));
      assert.deepEqual(ranked.map((item) => item.historicalPatientId), ["AA-EST-FAR", "ZZ-EST-EXACT"]);
      assert.ok(ranked.every((item) => !item.reasons.includes("exact_dob") && !item.reasons.includes("age_within_5_years")));
    } finally {
      await pool.query(`delete from historical_pacs_studies where orthanc_study_id in ('estimated-rank-far','estimated-rank-exact')`);
      await removePatient(patientId);
    }
  });

  await t.test("hard demographic rejection occurs before the final 20-candidate limit", async () => {
    const patientId = await createPatient({ englishName: "Kareem Ali", sex: "M" });
    const incompatibleIds = Array.from({ length: 21 }, (_, index) => `AA-INCOMPATIBLE-${String(index).padStart(2, "0")}`);
    try {
      await upsertHistoricalPacsStudies([
        ...incompatibleIds.map((legacyId, index) => study({ orthancStudyId: `limit-incompatible-${index}`, patientId: legacyId, patientName: "KAREEM^ALI", patientSex: "F" })),
        study({ orthancStudyId: "limit-compatible", patientId: "ZZ-COMPATIBLE", patientName: "KARIM^ALI", patientSex: "M" }),
      ]);
      const result = await discoverHistoricalPacsForPatient(patientId);
      assert.ok(result.candidates.some((candidate) => candidate.historicalPatientId === "ZZ-COMPATIBLE"), JSON.stringify(result.candidates));
      assert.equal(result.candidates.some((candidate) => incompatibleIds.includes(candidate.historicalPatientId)), false);
      assert.ok(result.candidates.length <= 20);
    } finally {
      await pool.query(`delete from historical_pacs_studies where orthanc_study_id like 'limit-incompatible-%' or orthanc_study_id='limit-compatible'`);
      await removePatient(patientId);
    }
  });

  await t.test("estimated or missing RISpro demographics never become exact proof", async () => {
    for (const input of [{ dob: "1985-04-03", estimated: true }, { dob: null, estimated: false }]) {
      const patientId = await createPatient({ englishName: "Nabil Hassan", ...input });
      const orthancStudyId = `estimated-${suffix()}`;
      try {
        await upsertHistoricalPacsStudies([study({ orthancStudyId, patientId: `EST-${suffix()}`, patientName: "NABIL^HASSAN", patientBirthDate: "19850403", patientSex: null })]);
        const candidate = (await discoverHistoricalPacsForPatient(patientId)).candidates.find((item) => item.studies.some((entry) => entry.orthancStudyId === orthancStudyId));
        assert.equal(candidate?.classification, "possible");
        assert.equal(candidate?.reasons.includes("exact_dob"), false);
      } finally {
        await pool.query(`delete from historical_pacs_studies where orthanc_study_id=$1`, [orthancStudyId]);
        await removePatient(patientId);
      }
    }
  });

  await t.test("competing legacy identities are ambiguous and one identity with many studies occupies one slot", async () => {
    const patientId = await createPatient({ englishName: "Abdullah Hussein" });
    const ids = ["AMB-A", "AMB-B"];
    try {
      await upsertHistoricalPacsStudies([
        ...Array.from({ length: 15 }, (_, index) => study({ orthancStudyId: `many-${index}`, patientId: ids[0]!, patientName: "ABDULLAH^HUSSEIN", studyDate: `2024${String(index % 12 + 1).padStart(2, "0")}01` })),
        study({ orthancStudyId: "ambiguous-peer", patientId: ids[1]!, patientName: "ABDULLAH^HUSSEIN" }),
      ]);
      const candidates = (await discoverHistoricalPacsForPatient(patientId)).candidates.filter((candidate) => ids.includes(candidate.historicalPatientId));
      assert.equal(candidates.length, 2);
      assert.ok(candidates.every((candidate) => candidate.classification === "ambiguous"));
      assert.equal(candidates.find((candidate) => candidate.historicalPatientId === ids[0])?.studyCount, 15);
    } finally {
      await pool.query(`delete from historical_pacs_studies where patient_id=any($1::text[])`, [ids]);
      await removePatient(patientId);
    }
  });

  await t.test("equivalent structural names with different demographic evidence are ranked without ambiguity", async () => {
    const patientId = await createPatient({ englishName: "Yousef Mohammed Ali Salem", dob: "1980-01-01", estimated: false, sex: "M" });
    try {
      await upsertHistoricalPacsStudies([
        study({ orthancStudyId: "demographic-rank-stronger", patientId: "ZZ-DEMOGRAPHIC-STRONGER", patientName: "YOUSEF^MOHAMMED^ALI^SALEM", patientBirthDate: "19830101", patientSex: "M" }),
        study({ orthancStudyId: "demographic-rank-weaker", patientId: "AA-DEMOGRAPHIC-WEAKER", patientName: "YOUSEF^MOHAMMED^ALI^SALEM", patientBirthDate: null, patientSex: "M" }),
      ]);
      const candidates = (await discoverHistoricalPacsForPatient(patientId)).candidates.filter((candidate) => candidate.historicalPatientId.includes("DEMOGRAPHIC-"));
      assert.deepEqual(candidates.map((candidate) => candidate.historicalPatientId), ["ZZ-DEMOGRAPHIC-STRONGER", "AA-DEMOGRAPHIC-WEAKER"]);
      assert.ok(candidates[0]?.reasons.includes("age_within_5_years"));
      assert.ok(candidates.every((candidate) => candidate.classification !== "ambiguous"));
    } finally {
      await pool.query(`delete from historical_pacs_studies where orthanc_study_id in ('demographic-rank-stronger','demographic-rank-weaker')`);
      await removePatient(patientId);
    }
  });

  await t.test("upsert is idempotent and a DB-clock reconciliation marker retains refreshed rows while removing stale rows", async (subtest) => {
    const retained = study({ orthancStudyId: "sync-retained", patientId: "SYNC-1", patientName: "SYNC^PATIENT" });
    await upsertHistoricalPacsStudies([retained]);
    await upsertHistoricalPacsStudies([{ ...retained, studyDescription: "Updated" }]);
    assert.equal(Number((await pool.query(`select count(*)::int count from historical_pacs_studies where orthanc_study_id='sync-retained'`)).rows[0]?.count), 1);
    assert.equal((await pool.query(`select study_description from historical_pacs_studies where orthanc_study_id='sync-retained'`)).rows[0]?.study_description, "Updated");
    await upsertHistoricalPacsStudies([study({ orthancStudyId: "sync-stale", patientId: "SYNC-2", patientName: "STALE^PATIENT" })]);
    await pool.query(`update historical_pacs_studies set synchronized_at=now()-interval '1 day' where orthanc_study_id in ('sync-retained','sync-stale')`);
    await pool.query(`update historical_pacs_sync_state set last_change_sequence=null,last_full_sync_at=null where singleton_key=true`);
    const client = {
      async getChanges() { return { changes: [], lastSequence: 77, done: true }; },
      async listStudiesForIndexPage() { return { studies: [retained], resourceCount: 1 }; },
      async getStudyForIndex(id: string) { return id === "sync-retained" ? retained : null; },
    };
    subtest.mock.timers.enable({ apis: ["Date"], now: Date.parse("2099-01-01T00:00:00Z") });
    try {
      const result = await reconcileHistoricalPacsIndex(client);
      assert.equal(result.removed, 1);
      assert.equal(Number((await pool.query(`select count(*)::int count from historical_pacs_studies where orthanc_study_id='sync-retained'`)).rows[0]?.count), 1);
      assert.equal(Number((await pool.query(`select count(*)::int count from historical_pacs_studies where orthanc_study_id='sync-stale'`)).rows[0]?.count), 0);
    } finally {
      subtest.mock.timers.reset();
      await pool.query(`delete from historical_pacs_studies where orthanc_study_id='sync-retained'`);
    }
  });

  await t.test("an interrupted full scan never removes existing indexed rows", async () => {
    await upsertHistoricalPacsStudies([study({ orthancStudyId: "interrupted-retained", patientId: "INT-1", patientName: "INTERRUPTED^PATIENT" })]);
    await pool.query(`update historical_pacs_studies set synchronized_at=now()-interval '1 day' where orthanc_study_id='interrupted-retained'`);
    let page = 0;
    const client = {
      async getChanges() { return { changes: [], lastSequence: 78, done: true }; },
      async listStudiesForIndexPage() { page += 1; if (page === 1) return { studies: [], resourceCount: 1000 }; throw new Error("scan interrupted"); },
      async getStudyForIndex() { return null; },
    };
    await assert.rejects(() => reconcileHistoricalPacsIndex(client), /scan interrupted/);
    assert.equal(Number((await pool.query(`select count(*)::int count from historical_pacs_studies where orthanc_study_id='interrupted-retained'`)).rows[0]?.count), 1);
    await pool.query(`delete from historical_pacs_studies where orthanc_study_id='interrupted-retained'`);
  });

  await t.test("index freshness distinguishes recent success, aged success, and explicit failure", async () => {
    await pool.query(`update historical_pacs_sync_state set last_full_sync_at=now(),last_success_at=now(),last_error=null where singleton_key=true`);
    let state = await getHistoricalPacsIndexState();
    assert.equal(state.status, "ready");
    assert.ok(state.lastSuccessAt);
    await pool.query(`update historical_pacs_sync_state set last_success_at=now()-($1::bigint * interval '1 millisecond')-interval '1 second' where singleton_key=true`, [HISTORICAL_PACS_INDEX_FRESHNESS_MS]);
    state = await getHistoricalPacsIndexState();
    assert.equal(state.status, "stale");
    await pool.query(`update historical_pacs_sync_state set last_success_at=now(),last_error='Orthanc unavailable' where singleton_key=true`);
    state = await getHistoricalPacsIndexState();
    assert.equal(state.status, "unavailable");
    await readyIndex();
  });

  await t.test("incremental stable and deleted study changes update the index idempotently", async () => {
    await upsertHistoricalPacsStudies([study({ orthancStudyId: "incremental-delete", patientId: "INC-OLD", patientName: "OLD^INDEX" })]);
    await pool.query(`update historical_pacs_sync_state set last_full_sync_at=now(),last_change_sequence=10,last_error=null where singleton_key=true`);
    const incoming = study({ orthancStudyId: "incremental-new", patientId: "INC-NEW", patientName: "NEW^INDEX" });
    const client = {
      async getChanges() { return { changes: [
        { sequence: 11, changeType: "StableStudy", resourceType: "Study", resourceId: "incremental-new" },
        { sequence: 12, changeType: "Deleted", resourceType: "Study", resourceId: "incremental-delete" },
      ], lastSequence: 12, done: true }; },
      async listStudiesForIndexPage() { return { studies: [], resourceCount: 0 }; },
      async getStudyForIndex(id: string) { return id === "incremental-new" ? incoming : null; },
    };
    const result = await runHistoricalPacsSyncCycle(async () => client);
    assert.equal(result.mode, "incremental");
    assert.equal(Number((await pool.query(`select count(*)::int count from historical_pacs_studies where orthanc_study_id='incremental-delete'`)).rows[0]?.count), 0);
    assert.equal(Number((await pool.query(`select count(*)::int count from historical_pacs_studies where orthanc_study_id='incremental-new'`)).rows[0]?.count), 1);
    await pool.query(`delete from historical_pacs_studies where orthanc_study_id='incremental-new'`);
  });

  await t.test("incremental synchronization drains every changes page before advancing success", async () => {
    const oldSuccess = "2000-01-01T00:00:00.000Z";
    await pool.query(`update historical_pacs_sync_state set last_full_sync_at=now(),last_change_sequence=10,last_success_at=$1,last_error=null where singleton_key=true`, [oldSuccess]);
    const incoming = study({ orthancStudyId: "multipage-new", patientId: "MULTI-NEW", patientName: "MULTI^PAGE" });
    const cursors: number[] = [];
    const client = {
      async getChanges(since: number, limit?: number) {
        assert.equal(limit, 500);
        cursors.push(since);
        if (since === 10) return { changes: Array.from({ length: 500 }, (_, index) => ({ sequence: 11 + index, changeType: "NewPatient", resourceType: "Patient", resourceId: `patient-${index}` })), lastSequence: 510, done: false };
        if (since === 510) {
          const state = await pool.query<{ last_success_at: string }>(`select last_success_at::text from historical_pacs_sync_state where singleton_key=true`);
          assert.match(state.rows[0]!.last_success_at, /^2000-01-01/);
          return { changes: [{ sequence: 511, changeType: "StableStudy", resourceType: "Study", resourceId: "multipage-new" }], lastSequence: 511, done: false };
        }
        return { changes: [], lastSequence: 511, done: true };
      },
      async listStudiesForIndexPage() { return { studies: [], resourceCount: 0 }; },
      async getStudyForIndex(id: string) { return id === "multipage-new" ? incoming : null; },
    };
    const result = await runHistoricalPacsSyncCycle(async () => client);
    assert.equal(result.mode, "incremental");
    assert.equal(result.indexed, 1);
    assert.deepEqual(cursors, [10, 510, 511]);
    const state = await pool.query<{ last_change_sequence: string; last_success_at: string }>(`select last_change_sequence::text,last_success_at::text from historical_pacs_sync_state where singleton_key=true`);
    assert.equal(state.rows[0]?.last_change_sequence, "511");
    assert.doesNotMatch(state.rows[0]!.last_success_at, /^2000-01-01/);
    await pool.query(`delete from historical_pacs_studies where orthanc_study_id='multipage-new'`);
  });

  await t.test("failure on a later changes page preserves the prior success timestamp and records an error", async () => {
    const oldSuccess = "2001-02-03T04:05:06.000Z";
    await pool.query(`update historical_pacs_sync_state set last_full_sync_at=now(),last_change_sequence=20,last_success_at=$1,last_error=null where singleton_key=true`, [oldSuccess]);
    const partial = study({ orthancStudyId: "partial-page-new", patientId: "PARTIAL-NEW", patientName: "PARTIAL^PAGE" });
    const client = {
      async getChanges(since: number) {
        if (since === 20) return { changes: [{ sequence: 21, changeType: "StableStudy", resourceType: "Study", resourceId: "partial-page-new" }], lastSequence: 21, done: false };
        throw new Error("changes page 2 unavailable");
      },
      async listStudiesForIndexPage() { return { studies: [], resourceCount: 0 }; },
      async getStudyForIndex(id: string) { return id === "partial-page-new" ? partial : null; },
    };
    const result = await runHistoricalPacsSyncCycle(async () => client);
    assert.equal(result.mode, "failed");
    const state = await pool.query<{ last_change_sequence: string; last_success_at: string; last_error: string }>(`select last_change_sequence::text,last_success_at::text,last_error from historical_pacs_sync_state where singleton_key=true`);
    assert.equal(state.rows[0]?.last_change_sequence, "20");
    assert.match(state.rows[0]!.last_success_at, /^2001-02-03/);
    assert.match(state.rows[0]!.last_error, /page 2 unavailable/);
    assert.equal(Number((await pool.query(`select count(*)::int count from historical_pacs_studies where orthanc_study_id='partial-page-new'`)).rows[0]?.count), 1);
    await pool.query(`delete from historical_pacs_studies where orthanc_study_id='partial-page-new'`);
  });

  await t.test("full reconciliation drains changes after its inventory baseline before success", async () => {
    await pool.query(`update historical_pacs_sync_state set last_full_sync_at=null,last_change_sequence=null,last_success_at='2002-01-01',last_error=null where singleton_key=true`);
    const concurrent = study({ orthancStudyId: "full-catchup-new", patientId: "FULL-CATCHUP", patientName: "FULL^CATCHUP" });
    const changeCalls: Array<{ since: number; limit: number | undefined }> = [];
    const client = {
      async getChanges(since: number, limit?: number) {
        changeCalls.push({ since, limit });
        if (limit === 1000) return { changes: [], lastSequence: 30, done: true };
        return { changes: [{ sequence: 31, changeType: "StableStudy", resourceType: "Study", resourceId: "full-catchup-new" }], lastSequence: 31, done: true };
      },
      async listStudiesForIndexPage() { return { studies: [], resourceCount: 0 }; },
      async getStudyForIndex(id: string) { return id === "full-catchup-new" ? concurrent : null; },
    };
    const result = await reconcileHistoricalPacsIndex(client);
    assert.equal(result.lastSequence, 31);
    assert.equal(result.indexed, 1);
    assert.deepEqual(changeCalls, [{ since: 0, limit: 1000 }, { since: 30, limit: 500 }]);
    const state = await pool.query<{ last_change_sequence: string; last_success_at: string }>(`select last_change_sequence::text,last_success_at::text from historical_pacs_sync_state where singleton_key=true`);
    assert.equal(state.rows[0]?.last_change_sequence, "31");
    assert.doesNotMatch(state.rows[0]!.last_success_at, /^2002-01-01/);
    assert.equal(Number((await pool.query(`select count(*)::int count from historical_pacs_studies where orthanc_study_id='full-catchup-new'`)).rows[0]?.count), 1);
    await pool.query(`delete from historical_pacs_studies where orthanc_study_id='full-catchup-new'`);
  });

  await t.test("Orthanc unavailability preserves indexed studies and records a stale synchronization state", async () => {
    await upsertHistoricalPacsStudies([study({ orthancStudyId: "offline-retained", patientId: "OFFLINE-1", patientName: "OFFLINE^PATIENT" })]);
    await pool.query(`update historical_pacs_sync_state set last_full_sync_at=now(),last_change_sequence=77,last_error=null where singleton_key=true`);
    const result = await runHistoricalPacsSyncCycle(async () => { throw new Error("Orthanc unavailable"); });
    assert.equal(result.mode, "failed");
    assert.equal(Number((await pool.query(`select count(*)::int count from historical_pacs_studies where orthanc_study_id='offline-retained'`)).rows[0]?.count), 1);
    assert.match(String((await pool.query(`select last_error from historical_pacs_sync_state where singleton_key=true`)).rows[0]?.last_error), /unavailable/);
    await pool.query(`delete from historical_pacs_studies where orthanc_study_id='offline-retained'`);
  });

  await t.test("admin status reuses index freshness and reports ready, stale, uninitialized, failed, and running modes", async () => {
    await readyIndex();
    let status = await getHistoricalPacsAdminStatus();
    assert.equal(status.indexStatus, "ready");
    assert.equal(status.runStatus, "idle");
    assert.ok(status.indexedStudies >= 0);
    assert.ok(status.historicalPatientIds >= 0);

    await pool.query(`update historical_pacs_sync_state set last_success_at=now()-interval '10 minutes' where singleton_key=true`);
    assert.equal((await getHistoricalPacsAdminStatus()).indexStatus, "stale");
    await pool.query(`update historical_pacs_sync_state set last_full_sync_at=null,last_error=null where singleton_key=true`);
    assert.equal((await getHistoricalPacsAdminStatus()).indexStatus, "uninitialized");

    await pool.query(`update historical_pacs_sync_state set last_full_sync_at=now(),sync_run_status='failed',sync_mode='incremental',sync_started_at=now(),sync_progress_at=now(),sync_processed=12,last_error=$1 where singleton_key=true`, ["x".repeat(500)]);
    status = await getHistoricalPacsAdminStatus();
    assert.equal(status.runStatus, "failed");
    assert.equal(status.mode, "incremental");
    assert.equal(status.processed, 12);
    assert.equal(status.lastError?.length, 500);

    await pool.query(`update historical_pacs_sync_state set sync_run_status='running',sync_mode='full',sync_processed=18000,sync_total=31192 where singleton_key=true`);
    status = await getHistoricalPacsAdminStatus();
    assert.equal(status.progressPercent, 57.7);
    assert.equal(status.total, 31192);
    await pool.query(`update historical_pacs_sync_state set sync_mode='incremental',sync_total=null where singleton_key=true`);
    status = await getHistoricalPacsAdminStatus();
    assert.equal(status.runStatus, "running");
    assert.equal(status.mode, "incremental");
    assert.equal(status.progressPercent, null);
    await readyIndex();
  });

  await t.test("forced full reconciliation records statistics and page progress, then clears active run state", async () => {
    await readyIndex();
    let pages = 0;
    let progressAfterFirstPage = 0;
    const client = {
      async getStatistics() { return { studies: 1001, series: null, instances: null, diskSizeBytes: null, diskSizeMb: null, uncompressedSizeBytes: null, uncompressedSizeMb: null }; },
      async getChanges() { return { changes: [], lastSequence: 91, done: true }; },
      async listStudiesForIndexPage() {
        pages += 1;
        if (pages === 2) progressAfterFirstPage = Number((await pool.query(`select sync_processed from historical_pacs_sync_state where singleton_key=true`)).rows[0]?.sync_processed);
        return pages === 1 ? { studies: [], resourceCount: 1000 } : { studies: [], resourceCount: 1 };
      },
      async getStudyForIndex() { return null; },
    };
    const result = await runHistoricalPacsSyncCycle(async () => {
      const running = await pool.query(`select sync_run_status,sync_mode,sync_started_at,sync_processed,sync_total,last_error from historical_pacs_sync_state where singleton_key=true`);
      assert.equal(running.rows[0]?.sync_run_status, "running");
      assert.equal(running.rows[0]?.sync_mode, "full");
      assert.ok(running.rows[0]?.sync_started_at);
      assert.equal(running.rows[0]?.sync_processed, 0);
      assert.equal(running.rows[0]?.sync_total, null);
      assert.equal(running.rows[0]?.last_error, null);
      return client;
    }, { forceFull: true });
    assert.equal(result.mode, "full");
    assert.equal(progressAfterFirstPage, 1000);
    const state = await pool.query(`select sync_run_status,sync_mode,sync_processed,sync_total,last_observed_orthanc_study_count,last_change_sequence,last_success_at from historical_pacs_sync_state where singleton_key=true`);
    assert.equal(state.rows[0]?.sync_run_status, "idle");
    assert.equal(state.rows[0]?.sync_mode, null);
    assert.equal(state.rows[0]?.sync_processed, 0);
    assert.equal(state.rows[0]?.sync_total, null);
    assert.equal(state.rows[0]?.last_observed_orthanc_study_count, 1001);
    assert.equal(String(state.rows[0]?.last_change_sequence), "91");
    assert.ok(state.rows[0]?.last_success_at);
  });

  await t.test("full reconciliation continues without statistics and advisory locking prevents overlap", async () => {
    await readyIndex();
    const client = {
      async getStatistics() { throw new Error("statistics unavailable"); },
      async getChanges() { return { changes: [], lastSequence: 92, done: true }; },
      async listStudiesForIndexPage() {
        const state = await pool.query(`select sync_run_status,sync_mode,sync_total from historical_pacs_sync_state where singleton_key=true`);
        assert.equal(state.rows[0]?.sync_run_status, "running");
        assert.equal(state.rows[0]?.sync_mode, "full");
        assert.equal(state.rows[0]?.sync_total, null);
        return { studies: [], resourceCount: 0 };
      },
      async getStudyForIndex() { return null; },
    };
    const result = await runHistoricalPacsSyncCycle(async () => client, { forceFull: true });
    assert.equal(result.mode, "full");
    const lockClient = await pool.connect();
    try {
      await lockClient.query(`select pg_advisory_lock(712364092)`);
      const blocked = await runHistoricalPacsSyncCycle(async () => client, { forceFull: true });
      assert.equal(blocked.lockAcquired, false);
    } finally {
      await lockClient.query(`select pg_advisory_unlock(712364092)`);
      lockClient.release();
    }
  });
});
