import assert from "node:assert/strict";
import AdmZip from "adm-zip";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { downloadPinned, ensureOpenAnatomyAtlas, ensureTeachingAnatomyAtlases, extractLockedArchive, safeEntryName } from "./provision-teaching-anatomy.mjs";
import { calculateLabelCentroidsLps as calculateOpenCentroidsLps } from "./install-open-anatomy-atlas.mjs";
import { calculateLabelCentroidsLps as calculateLiverCentroidsLps } from "./install-spl-liver-atlas.mjs";
import { buildOverviewObj, parseObjGeometry, relatedAtlasIdsForBodyPartsConcept, verifyInstalledBodyParts3d } from "./install-bodyparts3d.mjs";

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function withTemporaryDirectory(action) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rispro-anatomy-test-"));
  try { await action(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("atlas provisioning isolates failed optional sources and reports a partial catalog", async () => {
  const lines = [];
  const results = await ensureTeachingAnatomyAtlases({
    assetRoot: "/unused/test-assets",
    ensureLiver: async () => ({ status: "ready", atlasId: "spl-liver" }),
    fetchImpl: async () => { throw new Error("synthetic offline source"); },
    log: (line) => lines.push(line),
  });

  assert.deepEqual(results.map(({ atlasId, status }) => [atlasId, status]), [
    ["spl-liver", "ready"],
    ["spl-abdomen", "unavailable"],
    ["spl-head-neck", "unavailable"],
    ["spl-knee", "unavailable"],
    ["bodyparts3d", "unavailable"],
  ]);
  assert.ok(lines.includes("RISPRO_TEACHING_ANATOMY_STATUS=partial"));
  assert.ok(lines.includes("RISPRO_TEACHING_ANATOMY_ATLAS_SPL_LIVER=ready"));
  assert.ok(lines.includes("RISPRO_TEACHING_ANATOMY_ATLAS_BODYPARTS3D=unavailable"));
});

test("pinned source redirects cannot leave the allow-listed HTTPS hosts", async () => {
  let requests = 0;
  const result = await ensureOpenAnatomyAtlas({
    atlasId: "spl-abdomen",
    assetRoot: "/unused/test-assets",
    fetchImpl: async () => {
      requests += 1;
      return new Response(null, { status: 302, headers: { location: "https://attacker.invalid/archive.zip" } });
    },
  });

  assert.equal(requests, 1);
  assert.equal(result.status, "unavailable");
  assert.match(result.error, /untrusted URL/i);
});

test("pinned downloads stream to disk and verify exact byte count and SHA-256", async () => withTemporaryDirectory(async (directory) => {
  const bytes = Buffer.from("streamed archive bytes");
  const destination = path.join(directory, "source.zip");
  const result = await downloadPinned({
    name: "synthetic atlas archive", url: "https://openanatomy.org/source.zip", sizeBytes: bytes.length, sha256: sha256(bytes), destination,
    fetchImpl: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 7)); controller.enqueue(bytes.subarray(7)); controller.close(); } })),
  });
  assert.equal(result, destination);
  assert.deepEqual(await readFile(destination), bytes);
}));

test("pinned downloads reject streamed size overflow and checksum mismatch", async () => withTemporaryDirectory(async (directory) => {
  const overflowPath = path.join(directory, "overflow.zip");
  await assert.rejects(downloadPinned({ name: "large archive", url: "https://openanatomy.org/source.zip", sizeBytes: 2, sha256: "a".repeat(64), destination: overflowPath, fetchImpl: async () => new Response(new Uint8Array([1, 2, 3])) }), /exceeded the pinned byte size/i);
  const checksumPath = path.join(directory, "checksum.zip");
  await assert.rejects(downloadPinned({ name: "wrong archive", url: "https://openanatomy.org/source.zip", sizeBytes: 3, sha256: "a".repeat(64), destination: checksumPath, fetchImpl: async () => new Response(new Uint8Array([1, 2, 3])) }), /size or SHA-256/i);
}));

test("pinned download redirect loops and interrupted streams fail closed", async () => withTemporaryDirectory(async (directory) => {
  let redirects = 0;
  await assert.rejects(downloadPinned({ name: "redirected archive", url: "https://openanatomy.org/source.zip", sizeBytes: 1, sha256: "a".repeat(64), destination: path.join(directory, "redirect.zip"), fetchImpl: async () => { redirects += 1; return new Response(null, { status: 302, headers: { location: "https://openanatomy.org/again.zip" } }); } }), /redirect limit/i);
  assert.equal(redirects, 5);
  const interrupted = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.error(new Error("connection interrupted")); } });
  await assert.rejects(downloadPinned({ name: "interrupted archive", url: "https://openanatomy.org/source.zip", sizeBytes: 2, sha256: "a".repeat(64), destination: path.join(directory, "interrupted.zip"), fetchImpl: async () => new Response(interrupted) }), /connection interrupted/i);
}));

test("ZIP extraction reads a temporary archive file, constrains roots and bounds expansion", async () => withTemporaryDirectory(async (directory) => {
  assert.throws(() => safeEntryName("atlas-root/../escape.nrrd"), /unsafe path component/i);
  const zipPath = path.join(directory, "source.zip");
  const zip = new AdmZip();
  zip.addFile("atlas-root/image.nrrd", Buffer.from("image-volume"));
  await writeFile(zipPath, zip.toBuffer());
  const target = path.join(directory, "extract");
  const result = await extractLockedArchive(zipPath, target, { expectedRoot: "atlas-root", kind: "open-anatomy", maximumUncompressedBytes: 100 });
  assert.equal(result.extracted, 1);
  assert.equal(await readFile(path.join(target, "atlas-root", "image.nrrd"), "utf8"), "image-volume");
  await assert.rejects(extractLockedArchive(zipPath, path.join(directory, "too-small"), { expectedRoot: "atlas-root", kind: "open-anatomy", maximumUncompressedBytes: 5 }), /uncompressed size/i);
  const traversal = new AdmZip();
  traversal.addFile("atlas-root/../escape.nrrd", Buffer.from("no"));
  const traversalPath = path.join(directory, "traversal.zip");
  await writeFile(traversalPath, traversal.toBuffer());
  await assert.rejects(extractLockedArchive(traversalPath, path.join(directory, "traversal"), { expectedRoot: "atlas-root", kind: "open-anatomy", maximumUncompressedBytes: 100 }), /outside its pinned package root|unsafe path component/i);
}));

test("segmentation representative points are precomputed in physical LPS coordinates for LPS and RAS sources", () => {
  const structures = [{ labelValue: 33 }];
  const makeVolume = (space) => ({ sizes: [2, 2, 2], space, origin: [10, 20, 30], directions: [[2, 0, 0], [0, 3, 0], [0, 0, 4]], type: "uchar", littleEndian: true, data: Buffer.from([33, 33, 0, 0, 0, 0, 0, 0]) });
  for (const calculator of [calculateOpenCentroidsLps, calculateLiverCentroidsLps]) {
    assert.deepEqual(calculator(makeVolume("LPS"), structures).get(33), [11, 20, 30]);
    assert.deepEqual(calculator(makeVolume("RAS"), structures).get(33), [-11, -20, 30]);
  }
});

test("whole-body overview geometry preserves OBJ surface picking IDs and source coordinates", () => {
  const triangle = (base) => Buffer.from(`o source-${base}\nv ${base} 0 0\nv ${base + 1} 0 0\nv ${base} 1 0\nf -3 -2 -1\n`);
  const overview = buildOverviewObj([
    { name: "skin-a", structureId: "element-fj0001", buffer: triangle(1) },
    { name: "skin-b", structureId: "fma-7163", buffer: triangle(3) },
  ]);
  const text = overview.toString("utf8");
  assert.match(text, /o RISPRO_STRUCTURE_ID_element-fj0001/);
  assert.match(text, /o RISPRO_STRUCTURE_ID_fma-7163/);
  assert.doesNotThrow(() => parseObjGeometry(overview, "overview.obj"));
  assert.match(text, /f 4 5 6/);
});

test("BodyParts3D atlas linkage follows stable FMA IDs and ancestry, never display-name substrings", () => {
  const parentByChild = new Map([["FMA7197", "FMA9577"], ["FMA7198", "FMA9577"], ["FMA24977", "FMA7187"]]);
  assert.deepEqual(relatedAtlasIdsForBodyPartsConcept("FMA7197", parentByChild), ["spl-liver", "spl-abdomen"]);
  assert.deepEqual(relatedAtlasIdsForBodyPartsConcept("FMA7198", parentByChild), ["spl-abdomen"]);
  assert.deepEqual(relatedAtlasIdsForBodyPartsConcept("FMA24977", parentByChild), ["spl-knee"]);
  assert.deepEqual(relatedAtlasIdsForBodyPartsConcept("FMA50801", parentByChild), ["spl-brain"]);
  assert.deepEqual(relatedAtlasIdsForBodyPartsConcept("FMA999999", parentByChild), []);
});

test("BodyParts3D activation records bind the validated manifest and generated asset hashes", async () => withTemporaryDirectory(async (directory) => {
  const lock = JSON.parse(await readFile(new URL("./open-atlas-sources.lock.json", import.meta.url), "utf8"));
  const source = lock.bodyParts3d;
  const atlasDirectory = path.join(directory, "bodyparts3d");
  await mkdir(atlasDirectory, { recursive: true });
  const asset = Buffer.from("validated generated overview");
  const manifestText = JSON.stringify({ atlasId: "bodyparts3d", spatialValidation: { status: "not-applicable" }, assets: { overview: { file: "overview.obj", integrity: { sizeBytes: asset.length, sha256: sha256(asset) } } } });
  await writeFile(path.join(atlasDirectory, "overview.obj"), asset);
  await writeFile(path.join(atlasDirectory, "manifest.json"), manifestText);
  const activation = { schemaVersion: "1.1", atlasId: source.atlasId, managedVersion: source.managedVersion, sourceSha256: source.archive.sha256, manifestSha256: sha256(Buffer.from(manifestText)), validationStatus: "passed", installedAt: "2026-10-04T00:00:00.000Z", assetCount: 1 };
  const activationPath = path.join(atlasDirectory, "installed-atlas.json");
  await writeFile(activationPath, JSON.stringify(activation));
  assert.equal(await verifyInstalledBodyParts3d(directory, source), true);
  await writeFile(activationPath, JSON.stringify({ ...activation, manifestSha256: "0".repeat(64) }));
  assert.equal(await verifyInstalledBodyParts3d(directory, source), false);
}));

test("installed SPL notices include the full Slicer Part B terms and non-clinical restriction", async () => {
  const terms = await readFile(new URL("./slicer-license-part-b.txt", import.meta.url), "utf8");
  assert.match(terms, /royalty-free, non-exclusive license/i);
  assert.match(terms, /incorporate the Software into proprietary programs/i);
  assert.match(terms, /CLINICAL APPLICATIONS ARE NEITHER RECOMMENDED NOR ADVISED/);
  assert.match(terms, /preserve and maintain all applicable attributions/i);
  assert.match(terms, /https:\/\/www\.openanatomy\.org\/atlas-pages\/slicer-license\.html/);
});
