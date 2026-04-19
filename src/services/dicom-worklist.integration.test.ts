import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { pool } from "../db/pool.js";
import { syncBookingWorklistSources } from "./dicom-service.js";

interface FixtureContext {
  userId: number;
  policyVersionId: number;
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

type GatewaySettingKey = "bind_host" | "worklist_source_dir" | "worklist_output_dir" | "mwl_ae_title";

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

async function restoreGatewaySettings(previousMap: Map<string, string>): Promise<void> {
  await pool.query(
    `
      update system_settings
      set setting_value = case
        when setting_key = 'bind_host' then $1::jsonb
        when setting_key = 'worklist_source_dir' then $2::jsonb
        when setting_key = 'worklist_output_dir' then $3::jsonb
        when setting_key = 'mwl_ae_title' then $4::jsonb
        else setting_value
      end,
      updated_by_user_id = null,
      updated_at = now()
      where category = 'dicom_gateway'
        and setting_key in ('bind_host', 'worklist_source_dir', 'worklist_output_dir', 'mwl_ae_title')
    `,
    [
      JSON.stringify({ value: previousMap.get("bind_host") || "0.0.0.0" }),
      JSON.stringify({ value: previousMap.get("worklist_source_dir") || "storage/dicom/worklist-source" }),
      JSON.stringify({ value: previousMap.get("worklist_output_dir") || "storage/dicom/worklists" }),
      JSON.stringify({ value: previousMap.get("mwl_ae_title") || "RISPRO_MWL" })
    ]
  );
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
  let userId: number | null = null;
  let policyVersionId: number | null = null;
  let ownsPolicyVersion = false;
  let ctModalityId: number | null = null;
  let mriModalityId: number | null = null;
  let ctExamTypeId: number | null = null;
  let mriExamTypeId: number | null = null;
  let patientAId: number | null = null;
  let patientBId: number | null = null;
  let patientCId: number | null = null;

  const previousSettings = await pool.query<{ setting_key: GatewaySettingKey; setting_value: { value?: string } }>(
    `
      select setting_key, setting_value
      from system_settings
      where category = 'dicom_gateway'
        and setting_key in ('bind_host', 'worklist_source_dir', 'worklist_output_dir', 'mwl_ae_title')
    `
  );

  const previousMap = new Map(previousSettings.rows.map((row) => [row.setting_key, row.setting_value?.value || ""]));

  try {
    const user = await pool.query<{ id: number }>(
      `
        insert into users (username, full_name, password_hash, role, is_active)
        values ($1, $2, $3, 'supervisor', true)
        returning id
      `,
      [`dicom_admin_${suffix}`, `DICOM Admin ${suffix}`, passwordHash]
    );
    userId = Number(user.rows[0]?.id);
    const publishedPolicy = await pool.query<{ id: number }>(
      `
        select pv.id
        from appointments_v2.policy_versions pv
        join appointments_v2.policy_sets ps on ps.id = pv.policy_set_id
        where ps.key = 'default'
          and pv.status = 'published'
        order by pv.published_at desc nulls last, pv.id desc
        limit 1
      `
    );

    if (publishedPolicy.rows[0]?.id) {
      policyVersionId = Number(publishedPolicy.rows[0].id);
    } else {
      const policyVersion = await pool.query<{ id: number }>(
        `
          insert into appointments_v2.policy_versions (
            policy_set_id,
            version_no,
            status,
            config_hash,
            created_by_user_id
          )
          values (
            (select id from appointments_v2.policy_sets where key = 'default' limit 1),
            9000 + floor(random() * 1000)::int,
            'published',
            $1,
            $2
          )
          returning id
        `,
        [uniqueSuffix(), userId]
      );
      policyVersionId = Number(policyVersion.rows[0]?.id);
      ownsPolicyVersion = true;
    }

    const ctModality = await pool.query<{ id: number }>(
      `
        insert into modalities (code, name_ar, name_en, daily_capacity, is_active)
        values ($1, $2, $3, 10, true)
        returning id
      `,
      [`CT${suffix.slice(-4)}`, `أشعة مقطعية ${suffix}`, `CT ${suffix}`]
    );
    ctModalityId = Number(ctModality.rows[0]?.id);

    const mriModality = await pool.query<{ id: number }>(
      `
        insert into modalities (code, name_ar, name_en, daily_capacity, is_active)
        values ($1, $2, $3, 10, true)
        returning id
      `,
      [`MR${suffix.slice(-4)}`, `رنين ${suffix}`, `MRI ${suffix}`]
    );
    mriModalityId = Number(mriModality.rows[0]?.id);

    const ctExamType = await pool.query<{ id: number }>(
      `
        insert into exam_types (modality_id, name_ar, name_en, is_active)
        values ($1, $2, $3, true)
        returning id
      `,
      [ctModalityId, `فحص CT ${suffix}`, `CT Exam ${suffix}`]
    );
    ctExamTypeId = Number(ctExamType.rows[0]?.id);

    const mriExamType = await pool.query<{ id: number }>(
      `
        insert into exam_types (modality_id, name_ar, name_en, is_active)
        values ($1, $2, $3, true)
        returning id
      `,
      [mriModalityId, `فحص MRI ${suffix}`, `MRI Exam ${suffix}`]
    );
    mriExamTypeId = Number(mriExamType.rows[0]?.id);

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

    patientAId = await createPatient(`8${suffix.padStart(11, "0").slice(-11)}`);
    patientBId = await createPatient(`7${suffix.padStart(11, "0").slice(-11)}`);
    patientCId = await createPatient(`6${suffix.padStart(11, "0").slice(-11)}`);

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
      await restoreGatewaySettings(previousMap);

      if (ctModalityId && mriModalityId) {
        await pool.query(`delete from dicom_devices where modality_id = any($1::bigint[])`, [[ctModalityId, mriModalityId]]);
        await pool.query(`delete from appointments_v2.bookings where modality_id = any($1::bigint[])`, [[ctModalityId, mriModalityId]]);
      }
      if (ctExamTypeId && mriExamTypeId) {
        await pool.query(`delete from exam_types where id = any($1::bigint[])`, [[ctExamTypeId, mriExamTypeId]]);
      }
      if (ctModalityId && mriModalityId) {
        await pool.query(`delete from modalities where id = any($1::bigint[])`, [[ctModalityId, mriModalityId]]);
      }
      if (patientAId && patientBId && patientCId) {
        await pool.query(`delete from patients where id = any($1::bigint[])`, [[patientAId, patientBId, patientCId]]);
      }
      if (policyVersionId && ownsPolicyVersion) {
        await pool.query(`delete from appointments_v2.policy_versions where id = $1`, [policyVersionId]);
      }
      if (userId) {
        await pool.query(`delete from users where id = $1`, [userId]);
      }
      await fs.rm(tempRoot, { recursive: true, force: true });
    };

    return {
      userId,
      policyVersionId,
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
  } catch (error) {
    await restoreGatewaySettings(previousMap).catch(() => undefined);

    if (ctModalityId && mriModalityId) {
      await pool.query(`delete from dicom_devices where modality_id = any($1::bigint[])`, [[ctModalityId, mriModalityId]]).catch(() => undefined);
      await pool.query(`delete from appointments_v2.bookings where modality_id = any($1::bigint[])`, [[ctModalityId, mriModalityId]]).catch(() => undefined);
    }
    if (ctExamTypeId && mriExamTypeId) {
      await pool.query(`delete from exam_types where id = any($1::bigint[])`, [[ctExamTypeId, mriExamTypeId]]).catch(() => undefined);
    }
    if (ctModalityId && mriModalityId) {
      await pool.query(`delete from modalities where id = any($1::bigint[])`, [[ctModalityId, mriModalityId]]).catch(() => undefined);
    }
    if (patientAId && patientBId && patientCId) {
      await pool.query(`delete from patients where id = any($1::bigint[])`, [[patientAId, patientBId, patientCId]]).catch(() => undefined);
    }
    if (policyVersionId && ownsPolicyVersion) {
      await pool.query(`delete from appointments_v2.policy_versions where id = $1`, [policyVersionId]).catch(() => undefined);
    }
    if (userId) {
      await pool.query(`delete from users where id = $1`, [userId]).catch(() => undefined);
    }
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

test("syncBookingWorklistSources creates V2 MWL dumps and removes files for terminal status", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();

  try {
    const bookingDate = "2030-01-15";

    const insertBooking = async (params: {
      patientId: number;
      modalityId: number;
      examTypeId: number;
      bookingTime?: string | null;
    }) => {
      const result = await pool.query<{ id: number }>(
        `
          insert into appointments_v2.bookings (
            patient_id,
            modality_id,
            exam_type_id,
            reporting_priority_id,
            booking_date,
            booking_time,
            case_category,
            status,
            notes,
            policy_version_id,
            capacity_resolution_mode,
            uses_special_quota,
            is_walk_in,
            created_by_user_id,
            updated_by_user_id
          )
          values ($1, $2, $3, null, $4::date, $5::time, 'non_oncology', 'scheduled', null, $6, 'standard', false, false, $7, $7)
          returning id
        `,
        [
          params.patientId,
          params.modalityId,
          params.examTypeId,
          bookingDate,
          params.bookingTime || null,
          fx.policyVersionId,
          fx.userId
        ]
      );

      return Number(result.rows[0]?.id);
    };

    const ctCentralId = await insertBooking({
      patientId: fx.patientAId,
      modalityId: fx.ctModalityId,
      examTypeId: fx.ctExamTypeId,
      bookingTime: "09:15:00"
    });
    const mriCentralId = await insertBooking({
      patientId: fx.patientBId,
      modalityId: fx.mriModalityId,
      examTypeId: fx.mriExamTypeId,
      bookingTime: "10:30:00"
    });
    const ctThirdId = await insertBooking({
      patientId: fx.patientCId,
      modalityId: fx.ctModalityId,
      examTypeId: fx.ctExamTypeId,
      bookingTime: "11:45:00"
    });

    const [ctCentral, mriCentral, ctThird] = await Promise.all([
      syncBookingWorklistSources(ctCentralId),
      syncBookingWorklistSources(mriCentralId),
      syncBookingWorklistSources(ctThirdId)
    ]);

    assert.equal(ctCentral.removedOnly, false);
    assert.equal(mriCentral.removedOnly, false);
    assert.equal(ctThird.removedOnly, false);
    assert.equal((ctCentral.files || []).length, 1, "Expected a central MWL file even without device rows");

    const dumpPaths = [
      ctCentral.files?.[0]?.dumpPath || "",
      mriCentral.files?.[0]?.dumpPath || "",
      ctThird.files?.[0]?.dumpPath || ""
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

    assert.equal(allResults.length, 3, "Query without modality or station AE should keep all items eligible");
    assert.equal(ctResults.length, 2, "CT query should keep only CT items");
    assert.equal(mriResults.length, 1, "MRI query should keep only MRI items");
    assert.ok(
      dumps.every((dump) => extractTagValue(dump, "(0040,0001") === "RISPRO_MWL"),
      "V2 booking projection should route through central MWL AE when no explicit station override exists."
    );
    assert.equal(extractTagValue(dumps[0], "(0040,0003"), "091500", "SPS start time should map from booking_time");

    const dumpPathToRemove = ctThird.files?.[0]?.dumpPath || "";
    const manifestPathToRemove = ctThird.files?.[0]?.manifestPath || "";
    await pool.query(
      `update appointments_v2.bookings set status = 'cancelled', updated_at = now(), updated_by_user_id = $2 where id = $1`,
      [ctThirdId, fx.userId]
    );
    const removed = await syncBookingWorklistSources(ctThirdId);
    assert.equal(removed.removedOnly, true, "Cancelled booking should remove worklist artifacts.");

    const [dumpExistsAfterCancel, manifestExistsAfterCancel] = await Promise.all([
      fs.access(dumpPathToRemove).then(() => true).catch(() => false),
      fs.access(manifestPathToRemove).then(() => true).catch(() => false),
    ]);
    assert.equal(dumpExistsAfterCancel, false, "Dump file should be removed for cancelled booking.");
    assert.equal(manifestExistsAfterCancel, false, "Manifest file should be removed for cancelled booking.");
  } finally {
    await fx.cleanup();
  }
});
