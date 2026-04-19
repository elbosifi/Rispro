import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { runCycle, validateDumpFile } from "../../scripts/dicom-gateway/build-worklists.mjs";

const REQUIRED_DUMP = [
  "# test",
  "(0040,0100) SQ (Sequence with undefined length)",
  "(0008,0060) CS [CT]",
  "(0040,0001) AE [CT_ROOM_1]",
  "(0040,0002) DA [20300101]",
  "(0040,0003) TM [080000]",
  "(0040,0007) LO [CT Exam]",
  "(0040,0009) SH [ACC-1]"
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
    assert.ok(result.missingTags.includes("(0040,0001)"));
    assert.ok(result.missingTags.includes("(0040,0009)"));
  });
});
