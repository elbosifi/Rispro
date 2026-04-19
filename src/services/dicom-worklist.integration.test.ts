import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { pool } from "../db/pool.js";
import { syncAppointmentWorklistSources } from "./dicom-service.js";

interface FixtureContext {
  userId: number;
  ctModalityId: number;
  mriModalityId: number;
  ctExamTypeId: number;
  mriExamTypeId: number;
  patientAId: number;
  patientBId: number;
  patientCId: number;
  tempRoot: string;
  sourceDir: string;
  outputDir: string;
  cleanup: () => Promise<void>;
}

function uniqueSuffix(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

async function ensureDbOrSkip(t: { skip: (message?: string) => void }): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    t.skip("PostgreSQL is not reachable at configured DATABASE_URL.");
    return false;
  }
}

function extractTagValue(dump: string, tag: string): string {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = dump.match(new RegExp(`${escapedTag}\\)\\s+[A-Z]{2}\\s+\\[(.*?)\\]`));
  return match?.[1] || "";
}

function matchesWorklistQuery(dump: string, query: { modality?: string; stationAeTitle?: string }): boolean {
  const modality = extractTagValue(dump, "(0008,0060");
  const stationAeTitle = extractTagValue(dump, "(0040,0001");

  if (query.modality && modality !== query.modality) {
    return false;
  }

  if (query.stationAeTitle && stationAeTitle !== query.stationAeTitle) {
    return false;
  }

  return true;
}

async function createFixture(): Promise<FixtureContext> {
  const suffix = uniqueSuffix();
  const passwordHash = bcrypt.hashSync("dicom-pass", 10);
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-dicom-worklist-"));
  const sourceDir = path.join(tempRoot, "source");
  const outputDir = path.join(tempRoot, "output");
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  const user = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'supervisor', true)
      returning id
    `,
    [`dicom_admin_${suffix}`, `DICOM Admin ${suffix}`, passwordHash]
  );
  const userId = Number(user.rows[0]?.id);

  const ctModality = await pool.query<{ id: number }>(
    `
      insert into modalities (code, name_ar, name_en, daily_capacity, is_active)
      values ($1, $2, $3, 10, true)
      returning id
    `,
    [`CT${suffix.slice(-4)}`, `أشعة مقطعية ${suffix}`, `CT ${suffix}`]
  );
  const ctModalityId = Number(ctModality.rows[0]?.id);

  const mriModality = await pool.query<{ id: number }>(
    `
      insert into modalities (code, name_ar, name_en, daily_capacity, is_active)
      values ($1, $2, $3, 10, true)
      returning id
    `,
    [`MR${suffix.slice(-4)}`, `رنين ${suffix}`, `MRI ${suffix}`]
  );
  const mriModalityId = Number(mriModality.rows[0]?.id);

  const ctExamType = await pool.query<{ id: number }>(
    `
      insert into exam_types (modality_id, name_ar, name_en, is_active)
      values ($1, $2, $3, true)
      returning id
    `,
    [ctModalityId, `فحص CT ${suffix}`, `CT Exam ${suffix}`]
  );
  const ctExamTypeId = Number(ctExamType.rows[0]?.id);

  const mriExamType = await pool.query<{ id: number }>(
    `
      insert into exam_types (modality_id, name_ar, name_en, is_active)
      values ($1, $2, $3, true)
      returning id
    `,
    [mriModalityId, `فحص MRI ${suffix}`, `MRI Exam ${suffix}`]
  );
  const mriExamTypeId = Number(mriExamType.rows[0]?.id);

  const createPatient = async (seed: string) => {
    const result = await pool.query<{ id: number }>(
      `
        insert into patients (
          national_id,
          identifier_type,
          identifier_value,
          arabic_full_name,
          english_full_name,
          normalized_arabic_name,
          age_years,
          estimated_date_of_birth,
          sex,
          created_by_user_id,
          updated_by_user_id
        )
        values ($1, 'national_id', $2, $3, $4, $5, 40, '1985-01-01', 'M', $6, $6)
        returning id
      `,
      [seed, seed, `مريض ${seed}`, `Patient ${seed}`, `مريض${seed}`, userId]
    );
    return Number(result.rows[0]?.id);
  };

  const patientAId = await createPatient(`8${suffix.padStart(11, "0").slice(-11)}`);
  const patientBId = await createPatient(`7${suffix.padStart(11, "0").slice(-11)}`);
  const patientCId = await createPatient(`6${suffix.padStart(11, "0").slice(-11)}`);

  const previousSettings = await pool.query<{ setting_key: string; setting_value: { value?: string } }>(
    `
      select setting_key, setting_value
      from system_settings
      where category = 'dicom_gateway'
        and setting_key in ('worklist_source_dir', 'worklist_output_dir', 'mwl_ae_title')
    `
  );

  const previousMap = new Map(previousSettings.rows.map((row) => [row.setting_key, row.setting_value?.value || ""]));

  await pool.query(
    `
      update system_settings
      set setting_value = case
        when setting_key = 'worklist_source_dir' then $1::jsonb
        when setting_key = 'worklist_output_dir' then $2::jsonb
        when setting_key = 'mwl_ae_title' then $3::jsonb
        else setting_value
      end,
      updated_by_user_id = $4,
      updated_at = now()
      where category = 'dicom_gateway'
        and setting_key in ('worklist_source_dir', 'worklist_output_dir', 'mwl_ae_title')
    `,
    [
      JSON.stringify({ value: sourceDir }),
      JSON.stringify({ value: outputDir }),
      JSON.stringify({ value: "RISPRO_MWL" }),
      userId
    ]
  );

  const cleanup = async () => {
    await pool.query(
      `
        update system_settings
        set setting_value = case
          when setting_key = 'worklist_source_dir' then $1::jsonb
          when setting_key = 'worklist_output_dir' then $2::jsonb
          when setting_key = 'mwl_ae_title' then $3::jsonb
          else setting_value
        end,
        updated_by_user_id = null,
        updated_at = now()
        where category = 'dicom_gateway'
          and setting_key in ('worklist_source_dir', 'worklist_output_dir', 'mwl_ae_title')
      `,
      [
        JSON.stringify({ value: previousMap.get("worklist_source_dir") || "storage/dicom/worklist-source" }),
        JSON.stringify({ value: previousMap.get("worklist_output_dir") || "storage/dicom/worklists" }),
        JSON.stringify({ value: previousMap.get("mwl_ae_title") || "RISPRO_MWL" })
      ]
    );

    await pool.query(`delete from dicom_devices where modality_id = any($1::bigint[])`, [[ctModalityId, mriModalityId]]);
    await pool.query(`delete from appointments where modality_id = any($1::bigint[])`, [[ctModalityId, mriModalityId]]);
    await pool.query(`delete from exam_types where id = any($1::bigint[])`, [[ctExamTypeId, mriExamTypeId]]);
    await pool.query(`delete from modalities where id = any($1::bigint[])`, [[ctModalityId, mriModalityId]]);
    await pool.query(`delete from patients where id = any($1::bigint[])`, [[patientAId, patientBId, patientCId]]);
    await pool.query(`delete from users where id = $1`, [userId]);
    await fs.rm(tempRoot, { recursive: true, force: true });
  };

  return {
    userId,
    ctModalityId,
    mriModalityId,
    ctExamTypeId,
    mriExamTypeId,
    patientAId,
    patientBId,
    patientCId,
    tempRoot,
    sourceDir,
    outputDir,
    cleanup
  };
}

test("syncAppointmentWorklistSources creates central MWL dumps without dicom_devices rows", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();

  try {
    const appointmentDate = "2030-01-15";

    const insertAppointment = async (params: {
      patientId: number;
      modalityId: number;
      examTypeId: number;
      accessionNumber: string;
      dailySequence: number;
      stationAeTitle?: string | null;
    }) => {
      const result = await pool.query<{ id: number }>(
        `
          insert into appointments (
            patient_id,
            modality_id,
            exam_type_id,
            accession_number,
            appointment_date,
            daily_sequence,
            modality_slot_number,
            status,
            case_category,
            scheduled_station_ae_title,
            created_by_user_id,
            updated_by_user_id
          )
          values ($1, $2, $3, $4, $5::date, $6, $6, 'scheduled', 'non_oncology', $7, $8, $8)
          returning id
        `,
        [
          params.patientId,
          params.modalityId,
          params.examTypeId,
          params.accessionNumber,
          appointmentDate,
          params.dailySequence,
          params.stationAeTitle || null,
          fx.userId
        ]
      );

      return Number(result.rows[0]?.id);
    };

    const ctCentralId = await insertAppointment({
      patientId: fx.patientAId,
      modalityId: fx.ctModalityId,
      examTypeId: fx.ctExamTypeId,
      accessionNumber: `ACC-${uniqueSuffix()}-CTA`,
      dailySequence: 1
    });
    const mriCentralId = await insertAppointment({
      patientId: fx.patientBId,
      modalityId: fx.mriModalityId,
      examTypeId: fx.mriExamTypeId,
      accessionNumber: `ACC-${uniqueSuffix()}-MRI`,
      dailySequence: 2
    });
    const ctStationId = await insertAppointment({
      patientId: fx.patientCId,
      modalityId: fx.ctModalityId,
      examTypeId: fx.ctExamTypeId,
      accessionNumber: `ACC-${uniqueSuffix()}-CTS`,
      dailySequence: 3,
      stationAeTitle: "CT_ROOM_1"
    });

    const [ctCentral, mriCentral, ctStation] = await Promise.all([
      syncAppointmentWorklistSources(ctCentralId),
      syncAppointmentWorklistSources(mriCentralId),
      syncAppointmentWorklistSources(ctStationId)
    ]);

    assert.equal(ctCentral.removedOnly, false);
    assert.equal(mriCentral.removedOnly, false);
    assert.equal(ctStation.removedOnly, false);
    assert.equal((ctCentral.files || []).length, 1, "Expected a central MWL file even without device rows");

    const dumpPaths = [
      ctCentral.files?.[0]?.dumpPath || "",
      mriCentral.files?.[0]?.dumpPath || "",
      ctStation.files?.[0]?.dumpPath || ""
    ];
    const dumps = await Promise.all(dumpPaths.map((dumpPath) => fs.readFile(dumpPath, "utf8")));

    assert.ok(dumps.every((dump) => dump.includes("(0008,0060)")), "Expected SPS modality in every dump");
    assert.ok(dumps.every((dump) => dump.includes("(0040,0001)")), "Expected SPS station AE in every dump");
    assert.ok(dumps.every((dump) => dump.includes("(0040,0002)")), "Expected SPS start date in every dump");
    assert.ok(dumps.every((dump) => dump.includes("(0040,0003)")), "Expected SPS start time in every dump");
    assert.ok(dumps.every((dump) => dump.includes("(0040,0007)")), "Expected SPS description in every dump");
    assert.ok(dumps.every((dump) => dump.includes("(0040,0009)")), "Expected SPS ID in every dump");

    const allResults = dumps.filter((dump) => matchesWorklistQuery(dump, {}));
    const ctResults = dumps.filter((dump) => matchesWorklistQuery(dump, { modality: extractTagValue(dumps[0], "(0008,0060") }));
    const mriResults = dumps.filter((dump) => matchesWorklistQuery(dump, { modality: extractTagValue(dumps[1], "(0008,0060") }));
    const stationResults = dumps.filter((dump) => matchesWorklistQuery(dump, { stationAeTitle: "CT_ROOM_1" }));
    const stationOnlyResults = dumps.filter((dump) => matchesWorklistQuery(dump, { stationAeTitle: "CT_ROOM_1" }));

    assert.equal(allResults.length, 3, "Query without modality or station AE should keep all items eligible");
    assert.equal(ctResults.length, 2, "CT query should keep only CT items");
    assert.equal(mriResults.length, 1, "MRI query should keep only MRI items");
    assert.equal(stationResults.length, 1, "Station query should keep only matching station items");
    assert.equal(stationOnlyResults.length, 1, "Station-only query should keep all items for that station regardless of modality");

    const centralDump = dumps[0];
    assert.equal(extractTagValue(centralDump, "(0040,0001"), "RISPRO_MWL", "Unknown-device items should fall back to the central MWL AE");
  } finally {
    await fx.cleanup();
  }
});
