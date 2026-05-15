import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { runCycle, validateDumpFile } from "../../scripts/dicom-gateway/build-worklists.mjs";

const REQUIRED_DUMP = [
  "# test",
  "(0008,0005) CS [ISO_IR 192]",
  "(0010,0010) PN [PATIENT^ONE]",
  "(0010,0020) LO [P-1]",
  "(0010,0030) DA [19800101]",
  "(0010,0040) CS [M]",
  "(0040,0100) SQ (Sequence with undefined length)",
  "(0008,0060) CS [CT]",
  "(0040,0002) DA [20300101]",
  "(0040,0007) LO [CT Exam]"
].join("\n");

async function withTempLayout<T>(fn: (layout: { rootDir: string; sourceDir: string; outputDir: string }) => Promise<T>): Promise<T> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-dicom-builder-"));
  const sourceDir = path.join(rootDir, "source");
  const outputDir = path.join(rootDir, "output");
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  try {
    return await fn({ rootDir, sourceDir, outputDir });
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

test("runCycle writes worklists into the gateway MWL AE directory", async () => {
  await withTempLayout(async ({ sourceDir, outputDir }) => {
    await fs.writeFile(path.join(sourceDir, "ACC-1--CT_ROOM_1.dump"), REQUIRED_DUMP, "utf8");

    await runCycle(sourceDir, outputDir, "cp", "RISPRO_MWL");

    const centralPath = path.join(outputDir, "RISPRO_MWL", "ACC-1--CT_ROOM_1.wl");
    const stationPath = path.join(outputDir, "CT_ROOM_1", "ACC-1--CT_ROOM_1.wl");

    assert.equal(Boolean(await fs.stat(centralPath).catch(() => null)), true, "Expected .wl in central gateway AE directory");
    assert.equal(Boolean(await fs.stat(stationPath).catch(() => null)), false, "Expected no .wl in per-station directory");
  });
});

test("validateDumpFile rejects dumps missing required SPS tags", async () => {
  await withTempLayout(async ({ sourceDir }) => {
    const sourcePath = path.join(sourceDir, "ACC-2.dump");
    await fs.writeFile(sourcePath, "(0040,0100) SQ\n(0008,0060) CS [CT]\n", "utf8");

    const result = await validateDumpFile(sourcePath);
    assert.equal(result.ok, false);
    assert.ok(result.missingTags.includes("(0010,0010)"));
    assert.ok(result.missingTags.includes("(0040,0002)"));
  });
});

test("active MWL dump includes canonical accession from worklist context", () => {
  process.env.DATABASE_URL ||= "postgres://user:password@localhost:5432/rispro_test";
  process.env.JWT_SECRET ||= "test-secret";
  return import("./dicom-service.js").then(({ buildWorklistDump }) => {
  const dump = buildWorklistDump({
    appointment: {
      id: 123,
      accession_number: "V2-000123",
      modality_code: "CT",
      appointment_date: "2030-01-01",
      patient_primary_id: "P-1",
      mrn: "MRN-1",
      national_id: "NID-1",
      patient_id: 1,
      english_full_name: "Patient One",
      arabic_full_name: "Patient One",
      estimated_date_of_birth: "1980-01-01",
      sex: "male",
      exam_name_en: "CT Exam",
      exam_name_ar: "CT Exam",
      modality_name_en: "CT",
      modality_name_ar: "CT",
    } as never,
  });

  assert.equal(dump.includes("(0008,0050) SH [V2-000123]"), true);
  });
});

test("active MWL manifest uses the same appointment accession", async () => {
  const source = await fs.readFile(new URL("./dicom-service.ts", import.meta.url), "utf8");
  assert.match(source, /accessionNumber: appointment\.accession_number/);
  assert.match(source, /\('V2-' \|\| lpad\(bookings\.id::text, 6, '0'\)\) as accession_number/);
  assert.ok(!source.includes("('V2-' || bookings.id::text) as accession_number"));
});
