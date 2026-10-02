import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const installerPath = path.join(scriptDirectory, "install-spl-liver-atlas.mjs");
const manifestTemplate = JSON.parse(await readFile(path.join(repositoryRoot, "src/modules/teaching/anatomy/liver-manifest.template.json"), "utf8"));

function createNrrd(sizes, values) {
  const header = Buffer.from([
    "NRRD0005", "type: short", "dimension: 3", "space: left-posterior-superior", `sizes: ${sizes.join(" ")}`,
    "space directions: (1,0,0) (0,1,0) (0,0,1)", "space origin: (0,0,0)", "encoding: raw", "endian: little", "", "",
  ].join("\n"));
  const data = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => data.writeInt16LE(value, index * 2));
  return Buffer.concat([header, data]);
}

function createBinaryStl(point) {
  const data = Buffer.alloc(134);
  data.write("Synthetic aligned mesh", 0, "ascii");
  data.writeUInt32LE(1, 80);
  const vertices = [
    [point[0] - 0.2, point[1] - 0.2, point[2]],
    [point[0] + 0.2, point[1] - 0.2, point[2]],
    [point[0], point[1] + 0.2, point[2]],
  ];
  vertices.forEach((vertex, index) => vertex.forEach((coordinate, axis) => data.writeFloatLE(coordinate, 96 + index * 12 + axis * 4)));
  return data;
}

test("SPL installer installs a tiny synthetic atlas and records label-to-mesh spatial checks", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "rispro-teaching-anatomy-"));
  try {
    const source = path.join(temporaryRoot, "SPLLiverAtlas");
    const target = path.join(temporaryRoot, "assets");
    const atlasDirectory = path.join(source, "Atlas");
    const meshDirectory = path.join(source, "Models", "STL");
    await mkdir(atlasDirectory, { recursive: true });
    await mkdir(meshDirectory, { recursive: true });
    const sizes = [51, 5, 5];
    const elementCount = sizes.reduce((total, size) => total * size, 1);
    const ctValues = Array(elementCount).fill(0);
    const labelValues = Array(elementCount).fill(0);
    const meshPointByLabel = new Map();
    manifestTemplate.structures.forEach((structure, structureIndex) => {
      const x = structureIndex * 3 + 1;
      const y = 2;
      const z = 2;
      labelValues[x + sizes[0] * (y + sizes[1] * z)] = structure.labelValue;
      meshPointByLabel.set(structure.id, [-x, -y, z]);
    });
    await writeFile(path.join(atlasDirectory, "SPLLiverAtlasVolume.nrrd"), createNrrd(sizes, ctValues));
    await writeFile(path.join(atlasDirectory, "SPLLiverAtlasLabels.nrrd"), createNrrd(sizes, labelValues));
    await writeFile(path.join(atlasDirectory, "SPLLiverAtlasColors.ctbl"), `${manifestTemplate.structures.map((structure) => `${structure.labelValue} ${structure.id} 1 1 1 1`).join("\n")}\n`);
    await writeFile(path.join(source, "README.md"), "Synthetic fixture README.\n");
    await writeFile(path.join(source, "LICENSE"), "Synthetic fixture upstream license.\n");
    for (const structure of manifestTemplate.structures) {
      const filename = manifestTemplate.assets[structure.meshAsset].sourceFile;
      await writeFile(path.join(meshDirectory, filename), createBinaryStl(meshPointByLabel.get(structure.id)));
    }

    execFileSync(process.execPath, [installerPath, "--source", source, "--target", target], { cwd: repositoryRoot, stdio: "pipe" });
    const installDirectory = path.join(target, "spl-liver");
    const manifest = JSON.parse(await readFile(path.join(installDirectory, "manifest.json"), "utf8"));
    assert.equal(manifest.spatialValidation.status, "passed");
    assert.equal(manifest.spatialValidation.meshLabelAgreement["segment-viii"], 1);
    assert.equal(manifest.structures.find((structure) => structure.id === "segment-viii").labelValue, 33);
    assert.match(await readFile(path.join(installDirectory, "UPSTREAM-LICENSE.txt"), "utf8"), /synthetic fixture upstream license/i);
    assert.equal(await readFile(path.join(installDirectory, manifest.assets["mesh-segment-viii"].file)).then((data) => data.length), 134);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("SPL installer rejects Git LFS pointer files before treating them as NRRD images", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "rispro-teaching-lfs-pointer-"));
  try {
    const source = path.join(temporaryRoot, "SPLLiverAtlas");
    await mkdir(path.join(source, "Atlas"), { recursive: true });
    await writeFile(path.join(source, "Atlas", "SPLLiverAtlasVolume.nrrd"), "version https://git-lfs.github.com/spec/v1\noid sha256:deadbeef\nsize 123\n");
    const result = spawnSync(process.execPath, [installerPath, "--source", source, "--target", path.join(temporaryRoot, "assets")], { cwd: repositoryRoot, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Git LFS pointer/i);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
