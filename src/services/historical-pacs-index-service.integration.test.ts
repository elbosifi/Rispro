import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../db/pool.js";
import type { OrthancStudyDetails } from "./authoritative-orthanc-service.js";
import {
  dicomPatientNameVariants,
  discoverHistoricalPacsForPatient,
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
  await pool.query(`update historical_pacs_sync_state set last_full_sync_at=now(),last_success_at=now(),last_error=null where singleton_key=true`);
}

test("historical PACS index discovery and synchronization", async (t) => {
  await readyIndex();

  await t.test("exact known PatientID is authoritative, manual old-ID lookup is exact, and exact outranks fuzzy", async () => {
    const patientId = await createPatient({ englishName: "Muhammad Salem", identifier: "LEGACY-EXACT", dob: "1980-01-02", sex: "M" });
    try {
      await upsertHistoricalPacsStudies([
        study({ orthancStudyId: "exact-study", patientId: "LEGACY-EXACT", patientName: "MUHAMMAD^SALEM", patientBirthDate: "19800102", patientSex: "M" }),
        study({ orthancStudyId: "fuzzy-study", patientId: "LEGACY-FUZZY", patientName: "MOHAMED^SALEM" }),
      ]);
      const result = await discoverHistoricalPacsForPatient(patientId);
      assert.equal(result.candidates[0]?.classification, "exact");
      assert.equal(result.candidates[0]?.historicalPatientId, "LEGACY-EXACT");
      assert.equal(result.exactStudies[0]?.orthancStudyId, "exact-study");
      const manual = await lookupHistoricalPacsByPatientId("LEGACY-EXACT");
      assert.equal(manual.length, 1);
      assert.equal(manual[0]?.reasons[0], "exact_patient_id");
      assert.equal(manual[0]?.authoritative, false);
    } finally {
      await pool.query(`delete from historical_pacs_studies where orthanc_study_id in ('exact-study','fuzzy-study')`);
      await removePatient(patientId);
    }
  });

  await t.test("canonical phonetic variants Muhammad/Mohamed and Salim/Salem remain possible", async () => {
    for (const [currentName, historicalName] of [["Muhammad Ali", "MOHAMED^ALI"], ["Salim Nasser", "SALEM^NASSER"]]) {
      const patientId = await createPatient({ englishName: currentName });
      const orthancStudyId = `phonetic-${suffix()}`;
      try {
        await upsertHistoricalPacsStudies([study({ orthancStudyId, patientId: `OLD-${suffix()}`, patientName: historicalName })]);
        const result = await discoverHistoricalPacsForPatient(patientId);
        assert.ok(result.candidates.some((candidate) => candidate.studies.some((item) => item.orthancStudyId === orthancStudyId)));
        assert.ok(result.candidates.some((candidate) => candidate.reasons.includes("double_metaphone") || candidate.reasons.includes("fuzzy_english_name")), JSON.stringify(result.candidates));
      } finally {
        await pool.query(`delete from historical_pacs_studies where orthanc_study_id=$1`, [orthancStudyId]);
        await removePatient(patientId);
      }
    }
  });

  await t.test("Arabic normalization and one-character spelling variation reuse PostgreSQL name semantics", async () => {
    const patientId = await createPatient({ englishName: "Unrelated Latin Name", arabicName: "خالد علي" });
    const orthancStudyId = `arabic-${suffix()}`;
    try {
      await upsertHistoricalPacsStudies([study({ orthancStudyId, patientId: `AR-${suffix()}`, patientName: "حالد^علي" })]);
      const result = await discoverHistoricalPacsForPatient(patientId);
      const candidate = result.candidates.find((item) => item.studies.some((entry) => entry.orthancStudyId === orthancStudyId));
      assert.ok(candidate);
      assert.ok(candidate.reasons.includes("arabic_normalized_name"));
    } finally {
      await pool.query(`delete from historical_pacs_studies where orthanc_study_id=$1`, [orthancStudyId]);
      await removePatient(patientId);
    }
  });

  await t.test("DICOM Family^Given^Middle produces both family-first and human-order variants", async () => {
    assert.deepEqual(dicomPatientNameVariants("ALSIFI^SERAJ^ALI"), ["ALSIFI SERAJ ALI", "SERAJ ALI ALSIFI"]);
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

  await t.test("reliable exact DOB strengthens a name match while DOB and populated-sex mismatches reject", async () => {
    const patientId = await createPatient({ englishName: "Kareem Ali", dob: "1985-04-03", estimated: false, sex: "M" });
    try {
      await upsertHistoricalPacsStudies([
        study({ orthancStudyId: "dob-compatible", patientId: "DOB-YES", patientName: "KAREEM^ALI", patientBirthDate: "19850403", patientSex: "M" }),
        study({ orthancStudyId: "dob-mismatch", patientId: "DOB-NO", patientName: "KAREEM^ALI", patientBirthDate: "19860403", patientSex: "M" }),
        study({ orthancStudyId: "sex-mismatch", patientId: "SEX-NO", patientName: "KAREEM^ALI", patientBirthDate: "19850403", patientSex: "F" }),
      ]);
      const result = await discoverHistoricalPacsForPatient(patientId);
      const compatible = result.candidates.find((item) => item.historicalPatientId === "DOB-YES");
      assert.equal(compatible?.classification, "strong_demographic");
      assert.ok(compatible?.reasons.includes("exact_dob"));
      assert.equal(result.candidates.some((item) => item.historicalPatientId === "DOB-NO"), false);
      assert.equal(result.candidates.some((item) => item.historicalPatientId === "SEX-NO"), false);
    } finally {
      await pool.query(`delete from historical_pacs_studies where orthanc_study_id in ('dob-compatible','dob-mismatch','sex-mismatch')`);
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

  await t.test("upsert is idempotent and successful full reconciliation removes stale indexed studies", async () => {
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
      async listStudyIds() { return ["sync-retained"]; },
      async getStudyForIndex(id: string) { return id === "sync-retained" ? retained : null; },
    };
    const result = await reconcileHistoricalPacsIndex(client);
    assert.equal(result.removed, 1);
    assert.equal(Number((await pool.query(`select count(*)::int count from historical_pacs_studies where orthanc_study_id='sync-stale'`)).rows[0]?.count), 0);
    await pool.query(`delete from historical_pacs_studies where orthanc_study_id='sync-retained'`);
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
      async listStudyIds() { return []; },
      async getStudyForIndex(id: string) { return id === "incremental-new" ? incoming : null; },
    };
    const result = await runHistoricalPacsSyncCycle(async () => client);
    assert.equal(result.mode, "incremental");
    assert.equal(Number((await pool.query(`select count(*)::int count from historical_pacs_studies where orthanc_study_id='incremental-delete'`)).rows[0]?.count), 0);
    assert.equal(Number((await pool.query(`select count(*)::int count from historical_pacs_studies where orthanc_study_id='incremental-new'`)).rows[0]?.count), 1);
    await pool.query(`delete from historical_pacs_studies where orthanc_study_id='incremental-new'`);
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
});
