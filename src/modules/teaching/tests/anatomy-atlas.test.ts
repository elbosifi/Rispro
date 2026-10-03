import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { anatomyAssetPath, parseAnatomyAtlasManifest } from "../anatomy/anatomy-atlas.js";
import { TEACHING_ANATOMY_CATALOG, validateTeachingAnatomyCatalog } from "../anatomy/anatomy-catalog.js";

const templatePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../anatomy/liver-manifest.template.json");

async function installedFixture() {
  const manifest = JSON.parse(await readFile(templatePath, "utf8")) as Record<string, unknown>;
  const structures = manifest.structures as Array<{ id: string }>;
  manifest.spatialValidation = {
    status: "passed",
    method: "synthetic test fixture",
    minimumMeshLabelAgreement: 0.2,
    meshLabelAgreement: Object.fromEntries(structures.map(({ id }) => [id, 0.5])),
  };
  return manifest;
}

test("Teaching anatomy manifest validates its general structure and Segment VIII label mapping", async () => {
  const manifest = parseAnatomyAtlasManifest(await installedFixture());
  assert.equal(manifest.schemaVersion, "2.0");
  assert.deepEqual(manifest.supportedPlanes, ["axial", "coronal", "sagittal"]);
  const segmentEight = manifest.structures.find((structure) => structure.id === "segment-viii");
  assert.equal(segmentEight?.labelValue, 33);
  assert.equal(segmentEight?.meshAsset, "mesh-segment-viii");
  assert.equal(manifest.structures.length, 17);
});

test("correlated anatomy manifests permit non-rendered hierarchy groups without label values", async () => {
  const fixture = await installedFixture();
  const structures = fixture.structures as Array<Record<string, unknown>>;
  structures.push({ id: "liver-segments", name: "Liver segments", category: "Hierarchy", color: "#6688aa", synonyms: [], note: "Grouping node." });
  const manifest = parseAnatomyAtlasManifest(fixture);
  assert.equal(manifest.structures.find(({ id }) => id === "liver-segments")?.meshAsset, undefined);
  const cyclic = structuredClone(fixture) as Record<string, unknown>;
  const cyclicStructures = cyclic.structures as Array<Record<string, unknown>>;
  cyclicStructures[0]!.parentId = cyclicStructures[1]!.id;
  cyclicStructures[1]!.parentId = cyclicStructures[0]!.id;
  assert.throws(() => parseAnatomyAtlasManifest(cyclic), /cycle/i);
});

test("Teaching anatomy V2 accepts a 3D-only structure atlas while retaining attribution and asset integrity", () => {
  const source = {
    schemaVersion: "2.0",
    atlasId: "bodyparts3d",
    title: "Whole-body 3D Navigator",
    bodyRegion: "Whole body",
    organs: ["Liver"],
    systems: ["Gastrointestinal"],
    modality: "3D",
    correlatedImaging: false,
    supportedPlanes: [],
    coordinateSystem: "RAS",
    meshCoordinateSystem: "RAS",
    volumes: {},
    assets: { liver: { file: "liver.obj", mediaType: "model/obj", integrity: { sizeBytes: 128, sha256: "a".repeat(64) } } },
    structures: [{ id: "liver", name: "Liver", category: "Abdominal organs", synonyms: ["hepatic organ"], organ: "Liver", color: "#53ad7a", meshAsset: "liver" }],
    provenance: { sourceRepository: "https://example.org/source", project: "BodyParts3D", attribution: "BodyParts3D contributors.", license: "CC BY 4.0", licenseUrl: "https://example.org/license", use: "Internal educational use." },
    spatialValidation: { status: "not-applicable", method: "Independent 3D reference; not registered to a regional image atlas." },
  };
  const manifest = parseAnatomyAtlasManifest(source);
  assert.equal(manifest.modality, "3D");
  assert.equal(manifest.volumes.primary, undefined);
  assert.deepEqual(manifest.structures[0]?.synonyms, ["hepatic organ"]);
  assert.equal(manifest.assets.liver?.integrity?.sizeBytes, 128);
  assert.throws(() => parseAnatomyAtlasManifest({ ...source, atlasId: "../outside" }), /missing required fields|unsupported schema/i);
  assert.throws(() => parseAnatomyAtlasManifest({ ...source, assets: { liver: { file: "liver.obj", mediaType: "model/obj", integrity: { sizeBytes: 128, sha256: "invalid" } } } }), /integrity metadata/i);
  assert.throws(() => parseAnatomyAtlasManifest({ ...source, provenance: { ...source.provenance, licenseUrl: "http://example.org/license" } }), /must use HTTPS/i);
});

test("Teaching anatomy catalog IDs and provenance remain unique, safe, and source linked", () => {
  assert.doesNotThrow(() => validateTeachingAnatomyCatalog());
  assert.equal(TEACHING_ANATOMY_CATALOG.length, 9);
  assert.ok(TEACHING_ANATOMY_CATALOG.some((entry) => entry.atlasId === "spl-abdomen" && entry.modality === "CT"));
  assert.ok(TEACHING_ANATOMY_CATALOG.some((entry) => entry.atlasId === "spl-knee" && entry.modality === "MRI"));
  const abdomen = TEACHING_ANATOMY_CATALOG.find((entry) => entry.atlasId === "spl-abdomen");
  assert.deepEqual(abdomen?.crossSectionPlanes, ["axial", "coronal", "sagittal"]);
  assert.equal(abdomen?.structureCount, 105);
  const wholeBody = TEACHING_ANATOMY_CATALOG.find((entry) => entry.atlasId === "bodyparts3d");
  assert.equal(wholeBody?.structureCount, 2072);
  assert.match(wholeBody?.provenance.use ?? "", /adult male/i);
  const invalid = [...TEACHING_ANATOMY_CATALOG, { ...TEACHING_ANATOMY_CATALOG[0]!, atlasId: "../unsafe" }];
  assert.throws(() => validateTeachingAnatomyCatalog(invalid), /invalid/i);
});

test("Teaching anatomy manifest rejects unsafe asset paths and inconsistent structure declarations", async () => {
  const fixture = await installedFixture();
  const unsafe = structuredClone(fixture) as Record<string, unknown>;
  const assets = unsafe.assets as Record<string, { file: string }>;
  assets["mesh-segment-viii"]!.file = "../outside.stl";
  assert.throws(() => parseAnatomyAtlasManifest(unsafe), /unsafe or invalid asset entry/i);

  const inconsistent = structuredClone(fixture) as Record<string, unknown>;
  const structures = inconsistent.structures as Array<Record<string, unknown>>;
  structures[0]!.labelValue = 33;
  assert.throws(() => parseAnatomyAtlasManifest(inconsistent), /duplicate structure/i);
});

test("Teaching anatomy asset resolver accepts only declared manifest asset IDs", async () => {
  const manifest = parseAnatomyAtlasManifest(await installedFixture());
  const root = path.join("rispro", "storage", "anatomy", "spl-liver");
  assert.equal(anatomyAssetPath(root, manifest, "mesh-segment-viii"), path.resolve(root, "mesh_segment_viii.stl"));
  assert.throws(() => anatomyAssetPath("/srv/rispro/anatomy/spl-liver", manifest, "../secret"), /invalid anatomy asset key/i);
  assert.throws(() => anatomyAssetPath("/srv/rispro/anatomy/spl-liver", manifest, "secret"), /not declared/i);
});

test("Teaching anatomy manifest endpoint requires the normal authenticated session", async () => {
  process.env.DATABASE_URL ||= "postgres://anatomy-test:anatomy-test@127.0.0.1:5432/anatomy-test";
  process.env.JWT_SECRET ||= "teaching-anatomy-auth-test-secret";
  const { createTeachingRouter } = await import("../api/teaching-routes.js");
  const app = express();
  app.use(cookieParser());
  app.use("/api/teaching", createTeachingRouter());
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : 500;
    res.status(status).json({ error: { message: error instanceof Error ? error.message : "Request failed." } });
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const paths = [
      "/api/teaching/anatomy/catalog",
      "/api/teaching/anatomy/atlas/spl-knee/manifest",
      "/api/teaching/anatomy/atlas/spl-knee/assets/primary",
      "/api/teaching/anatomy/atlas/invalid-atlas/manifest",
      "/api/teaching/anatomy/liver/manifest",
    ];
    for (const route of paths) {
      const response: globalThis.Response = await globalThis.fetch(`http://127.0.0.1:${address.port}${route}`);
      assert.equal(response.status, 401, `${route} must require the normal authenticated session`);
      assert.match((await response.json()).error.message, /authentication required/i);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
