import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { anatomyAssetPath, parseAnatomyAtlasManifest } from "../anatomy/anatomy-atlas.js";

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
  const segmentEight = manifest.structures.find((structure) => structure.id === "segment-viii");
  assert.equal(segmentEight?.labelValue, 33);
  assert.equal(segmentEight?.meshAsset, "mesh-segment-viii");
  assert.equal(manifest.structures.length, 17);
});

test("Teaching anatomy manifest rejects unsafe asset paths and inconsistent structure declarations", async () => {
  const fixture = await installedFixture();
  const unsafe = structuredClone(fixture) as Record<string, unknown>;
  const assets = unsafe.assets as Record<string, { file: string }>;
  assets["mesh-segment-viii"]!.file = "../outside.stl";
  assert.throws(() => parseAnatomyAtlasManifest(unsafe), /unsafe asset filename/i);

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
    const response = await fetch(`http://127.0.0.1:${address.port}/api/teaching/anatomy/liver/manifest`);
    assert.equal(response.status, 401);
    assert.match((await response.json()).error.message, /authentication required/i);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
