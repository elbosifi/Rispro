import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "rispro-anatomy-service-tests-"));
process.env.TEACHING_ANATOMY_ASSET_ROOT = runtimeRoot;
process.env.DATABASE_URL ||= "postgres://anatomy-test:anatomy-test@127.0.0.1:5432/anatomy-test";
process.env.JWT_SECRET ||= "teaching-anatomy-service-test-secret";
const service = await import("../anatomy/anatomy-asset-service.js");
after(async () => rm(runtimeRoot, { recursive: true, force: true }));

function bodyPartsManifest(assetCount: number) {
  const assets: Record<string, { file: string; mediaType: string; integrity?: { sizeBytes: number; sha256: string } }> = Object.fromEntries(Array.from({ length: assetCount }, (_, index) => [`mesh-${index + 1}`, { file: `mesh-${index + 1}.obj`, mediaType: "model/obj", integrity: { sizeBytes: 10, sha256: "a".repeat(64) } }]));
  const structures = Object.keys(assets).map((assetKey, index) => ({ id: `part-${index + 1}`, name: `Part ${index + 1}`, category: "BodyParts3D", synonyms: [], color: "#aabbcc", meshAsset: assetKey }));
  return {
    schemaVersion: "2.0", atlasId: "bodyparts3d", title: "Whole-body 3D Navigator", bodyRegion: "Whole body",
    organs: [], systems: [], modality: "3D", correlatedImaging: false, supportedPlanes: [], coordinateSystem: "LPS", meshCoordinateSystem: "LPS",
    volumes: {}, assets, overviewAsset: "mesh-1", structures,
    provenance: { sourceRepository: "https://example.org/source", project: "BodyParts3D", attribution: "Upstream", license: "CC BY 4.0", licenseUrl: "https://example.org/license", use: "Teaching reference." },
    spatialValidation: { status: "not-applicable", method: "Independent whole-body surface reference." },
  };
}

test("activation metadata gates catalog readiness without enumerating BodyParts3D assets", async () => {
  const root = runtimeRoot;
  const directory = path.join(root, "bodyparts3d");
  await rm(directory, { recursive: true, force: true });
  try {
    await mkdir(directory, { recursive: true });
    const manifestText = `${JSON.stringify(bodyPartsManifest(1258))}\n`;
    await writeFile(path.join(directory, "manifest.json"), manifestText);
    await writeFile(path.join(directory, "installed-atlas.json"), JSON.stringify({
      schemaVersion: "1.1", atlasId: "bodyparts3d", managedVersion: "bodyparts3d-4.0-obj-99", sourceSha256: "b".repeat(64),
      manifestSha256: sha256(manifestText), validationStatus: "passed", installedAt: "2026-10-04T00:00:00.000Z", assetCount: 1258,
    }));
    const catalog = await service.readTeachingAnatomyCatalog(root);
    assert.equal(catalog.find(({ atlasId }) => atlasId === "bodyparts3d")?.status, "ready");
    assert.equal(catalog.find(({ atlasId }) => atlasId === "bodyparts3d")?.structureCount, 1258);
    const manifest = await service.readTeachingAnatomyManifest("bodyparts3d", root, false);
    assert.equal(manifest?.structures.length, 1258);
    await assert.rejects(readFile(path.join(directory, "mesh-1258.obj")), { code: "ENOENT" });

    const invalidActivation = JSON.parse(await readFile(path.join(directory, "installed-atlas.json"), "utf8"));
    invalidActivation.manifestSha256 = "0".repeat(64);
    await writeFile(path.join(directory, "installed-atlas.json"), JSON.stringify(invalidActivation));
    assert.equal((await service.readTeachingAnatomyCatalog(root)).find(({ atlasId }) => atlasId === "bodyparts3d")?.status, "unavailable");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("declared assets use manifest SHA ETags without runtime full-file hashing; unversioned assets revalidate", async () => {
  const root = runtimeRoot;
  const directory = path.join(root, "bodyparts3d");
  await rm(directory, { recursive: true, force: true });
  try {
    await mkdir(directory, { recursive: true });
    const assetBuffer = Buffer.from("validated-overview");
    const manifest = bodyPartsManifest(1);
    manifest.assets["mesh-1"].integrity = { sizeBytes: assetBuffer.length, sha256: sha256(assetBuffer) };
    manifest.assets.legacy = { file: "legacy.obj", mediaType: "model/obj" };
    await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest));
    await writeFile(path.join(directory, "mesh-1.obj"), Buffer.from("x".repeat(assetBuffer.length)));
    await writeFile(path.join(directory, "legacy.obj"), "legacy-object");
    const versioned = await service.resolveTeachingAnatomyAsset("bodyparts3d", "mesh-1");
    assert.ok(versioned);
    assert.equal(versioned.etag, `"${sha256(assetBuffer)}"`);
    assert.equal(versioned.versioned, true);
    const legacy = await service.resolveTeachingAnatomyAsset("bodyparts3d", "legacy");
    assert.ok(legacy);
    assert.equal(legacy.versioned, false);
    assert.match(legacy.etag, /^W\//);
    await assert.rejects(service.resolveTeachingAnatomyAsset("bodyparts3d", "../outside"), /Invalid anatomy asset key/i);
    await assert.rejects(service.resolveTeachingAnatomyAsset("bodyparts3d", "undeclared"), /not declared/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("persistent download partials are not addressable as Teaching atlas assets", async () => {
  const downloads = path.join(runtimeRoot, ".downloads");
  await mkdir(downloads, { recursive: true });
  await writeFile(path.join(downloads, `${"a".repeat(64)}.partial`), "incomplete pinned archive");
  assert.throws(() => service.teachingAnatomyAtlasDirectory(".downloads"), /Unknown Teaching anatomy atlas ID/i);
  await assert.rejects(service.resolveTeachingAnatomyAsset(".downloads", "partial"), /Unknown Teaching anatomy atlas ID/i);
});

test("anatomy asset conditional requests use weak ETag comparison, lists and wildcard", () => {
  const etag = `"${"a".repeat(64)}"`;
  assert.equal(service.teachingAnatomyIfNoneMatchMatches(etag, etag), true);
  assert.equal(service.teachingAnatomyIfNoneMatchMatches(`W/${etag}`, etag), true);
  assert.equal(service.teachingAnatomyIfNoneMatchMatches(`"older", W/${etag}`, etag), true);
  assert.equal(service.teachingAnatomyIfNoneMatchMatches("*", etag), true);
  assert.equal(service.teachingAnatomyIfNoneMatchMatches(`"${"b".repeat(64)}"`, etag), false);
  assert.equal(service.teachingAnatomyIfNoneMatchMatches(undefined, etag), false);
});

test("only expected hash-versioned anatomy URLs receive immutable private cache headers", () => {
  const hash = "a".repeat(64);
  const etag = `"${hash}"`;
  assert.equal(service.teachingAnatomyAssetCacheControl(true, etag, hash), "private, max-age=31536000, immutable");
  assert.equal(service.teachingAnatomyAssetCacheControl(true, etag, hash.toUpperCase()), "private, max-age=31536000, immutable");
  assert.equal(service.teachingAnatomyAssetCacheControl(true, etag, "b".repeat(64)), "private, max-age=0, must-revalidate");
  assert.equal(service.teachingAnatomyAssetCacheControl(true, etag, undefined), "private, max-age=0, must-revalidate");
  assert.equal(service.teachingAnatomyAssetCacheControl(false, `W/"size-mtime"`, hash), "private, max-age=0, must-revalidate");
});

test("reviewed Teaching radiology notes overlay upstream structure metadata separately", async () => {
  process.env.DATABASE_URL ||= "postgres://anatomy-test:anatomy-test@127.0.0.1:5432/anatomy-test";
  process.env.JWT_SECRET ||= "teaching-anatomy-note-test-secret";
  const root = runtimeRoot;
  const directory = path.join(root, "spl-liver");
  await rm(directory, { recursive: true, force: true });
  try {
    await mkdir(directory, { recursive: true });
    const template = JSON.parse(await readFile(path.join(repositoryRoot, "src/modules/teaching/anatomy/liver-manifest.template.json"), "utf8"));
    for (const structure of template.structures) delete structure.note;
    template.spatialValidation = { status: "passed", method: "Synthetic fixture.", minimumMeshLabelAgreement: 0.2, meshLabelAgreement: Object.fromEntries(template.structures.map((structure: { id: string }) => [structure.id, 0.5])) };
    await writeFile(path.join(directory, "manifest.json"), JSON.stringify(template));
    const manifest = await service.readTeachingAnatomyManifest("spl-liver", root, false);
    const segmentEight = manifest?.structures.find(({ id }) => id === "segment-viii");
    assert.equal(segmentEight?.note, "");
    assert.match(segmentEight?.radiologyNote ?? "", /between the middle and right hepatic veins/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
