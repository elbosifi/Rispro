import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ensureSplLiverAtlas, validateAtlasLock } from "./provision-spl-liver-atlas.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const commit = "859f4c078ff5c1fb33c29bbfd007d39c3728dec0";
const upstream = {
  repository: "https://github.com/lorensen/SPLLiverAtlas",
  commit,
  mediaBaseUrl: `https://media.githubusercontent.com/media/lorensen/SPLLiverAtlas/${commit}`,
};

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function bashPath(value) {
  if (process.platform !== "win32") return value;
  return value.replace(/^([A-Z]):\\/i, (_, drive) => `/${drive.toLowerCase()}/`).replaceAll("\\", "/");
}

function fixtureTemplate() {
  return {
    schemaVersion: "1.0",
    atlasId: "spl-liver",
    volumes: {
      ct: { assetKey: "ct", file: "Volume.nrrd" },
      segmentation: { assetKey: "labels", file: "Labels.nrrd" },
    },
    assets: {
      ct: { file: "Volume.nrrd" },
      labels: { file: "Labels.nrrd" },
      colors: { file: "Colors.ctbl" },
      "mesh-segment-viii": { file: "segment-viii.stl", sourceFile: "SegmentVIII-33.stl" },
    },
    structures: [{ id: "segment-viii", meshAsset: "mesh-segment-viii" }],
  };
}

function fixtureLock(files, managedVersion = "test-v1") {
  return {
    schemaVersion: "1.0",
    atlasId: "spl-liver",
    managedVersion,
    upstream,
    assets: Object.entries(files).map(([assetPath, bytes]) => ({
      path: assetPath,
      size: bytes.length,
      sha256: hash(bytes),
      url: `${upstream.mediaBaseUrl}/${assetPath}`,
    })),
  };
}

function fixtureFiles(suffix = "v1") {
  return {
    "Atlas/Volume.nrrd": Buffer.from(`CT-${suffix}`),
    "Atlas/Labels.nrrd": Buffer.from(`LABELS-${suffix}`),
    "Atlas/Colors.ctbl": Buffer.from(`COLORS-${suffix}`),
    "Models/STL/SegmentVIII-33.stl": Buffer.from(`STL-${suffix}`),
  };
}

async function withMockServer(files, callback) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    const sourcePath = decodeURIComponent((request.url ?? "").replace(/^\//, ""));
    const body = files[sourcePath];
    if (body instanceof Error) {
      response.writeHead(503);
      response.end("fixture failure");
    } else if (body?.interrupted === true) {
      response.writeHead(200, { "content-length": String(body.expectedSize) });
      response.write(body.partial);
      response.destroy();
    } else if (!body) {
      response.writeHead(404);
      response.end("missing");
    } else {
      response.writeHead(200, { "content-length": String(body.length) });
      response.end(body);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const fetchImpl = (url, options) => {
      const sourcePath = new URL(url).pathname.split(`/${commit}/`)[1];
      return fetch(`http://127.0.0.1:${address.port}/${sourcePath}`, options);
    };
    return await callback({ fetchImpl, requests });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function mockInstaller(template) {
  const plan = [
    ["Atlas/Volume.nrrd", "Volume.nrrd"],
    ["Atlas/Labels.nrrd", "Labels.nrrd"],
    ["Atlas/Colors.ctbl", "Colors.ctbl"],
    ["Models/STL/SegmentVIII-33.stl", "segment-viii.stl"],
  ];
  return async ({ source, target, managedMetadata }) => {
    const stage = path.join(target, `.fixture-atlas-${Date.now()}-${Math.random()}`);
    const active = path.join(target, "spl-liver");
    const backup = path.join(target, ".fixture-atlas-backup");
    await mkdir(stage, { recursive: true });
    for (const [sourcePath, destination] of plan) await copyFile(path.join(source, ...sourcePath.split("/")), path.join(stage, destination));
    await writeFile(path.join(stage, "manifest.json"), JSON.stringify({ atlasId: "spl-liver", spatialValidation: { status: "passed" }, template }));
    await writeFile(path.join(stage, "installed-atlas.json"), JSON.stringify(managedMetadata));
    await rm(backup, { recursive: true, force: true });
    try {
      await rename(active, backup);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await rename(stage, active);
    await rm(backup, { recursive: true, force: true });
  };
}

async function withFixture(callback) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "rispro-anatomy-provision-"));
  const template = fixtureTemplate();
  try {
    await callback({ assetRoot: path.join(temporaryRoot, "storage", "teaching", "anatomy"), template, installAtlas: mockInstaller(template) });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

test("valid installed managed version is retained without any download", async () => {
  await withFixture(async ({ assetRoot, template, installAtlas }) => {
    const files = fixtureFiles();
    const lock = fixtureLock(files);
    await withMockServer(files, async ({ fetchImpl }) => {
      const result = await ensureSplLiverAtlas({ assetRoot, template, lock, fetchImpl, installAtlas });
      assert.equal(result.status, "ready", result.error);
    });
    await withMockServer(files, async ({ fetchImpl, requests }) => {
      assert.equal((await ensureSplLiverAtlas({ assetRoot, template, lock, fetchImpl, installAtlas })).status, "already-current");
      assert.equal(requests.length, 0);
    });
  });
});

test("missing atlas downloads, validates, and installs only managed atlas files", async () => {
  await withFixture(async ({ assetRoot, template, installAtlas }) => {
    const files = fixtureFiles();
    const lock = fixtureLock(files);
    const unrelated = path.join(assetRoot, "other-teaching-upload.txt");
    await mkdir(assetRoot, { recursive: true });
    await writeFile(unrelated, "keep");
    await withMockServer(files, async ({ fetchImpl, requests }) => {
      assert.equal((await ensureSplLiverAtlas({ assetRoot, template, lock, fetchImpl, installAtlas })).status, "ready");
      assert.equal(requests.length, lock.assets.length);
    });
    assert.equal(await readFile(unrelated, "utf8"), "keep");
    assert.equal(JSON.parse(await readFile(path.join(assetRoot, "spl-liver", "installed-atlas.json"), "utf8")).managedVersion, "test-v1");
  });
});

test("checksum mismatch and a Git LFS pointer are rejected without an active atlas", async () => {
  await withFixture(async ({ assetRoot, template, installAtlas }) => {
    const files = fixtureFiles();
    const mismatched = fixtureLock(files);
    mismatched.assets[0].sha256 = "0".repeat(64);
    await withMockServer(files, async ({ fetchImpl }) => {
      assert.equal((await ensureSplLiverAtlas({ assetRoot, template, lock: mismatched, fetchImpl, installAtlas })).status, "unavailable");
    });
    const pointer = Buffer.from("version https://git-lfs.github.com/spec/v1\noid sha256:fixture\nsize 1\n");
    const pointerFiles = { ...files, "Atlas/Volume.nrrd": pointer };
    await withMockServer(pointerFiles, async ({ fetchImpl }) => {
      assert.match((await ensureSplLiverAtlas({ assetRoot, template, lock: fixtureLock(pointerFiles), fetchImpl, installAtlas })).error, /Git LFS pointer/i);
    });
    await assert.rejects(readFile(path.join(assetRoot, "spl-liver", "manifest.json")));
  });
});

test("failed download leaves no partial active install and preserves a valid older managed atlas", async () => {
  await withFixture(async ({ assetRoot, template, installAtlas }) => {
    const versionOneFiles = fixtureFiles("v1");
    const versionOne = fixtureLock(versionOneFiles, "test-v1");
    await withMockServer(versionOneFiles, async ({ fetchImpl }) => {
      assert.equal((await ensureSplLiverAtlas({ assetRoot, template, lock: versionOne, fetchImpl, installAtlas })).status, "ready");
    });
    const versionTwoFiles = fixtureFiles("v2");
    versionTwoFiles["Atlas/Labels.nrrd"] = new Error("network unavailable");
    const versionTwo = fixtureLock({ ...fixtureFiles("v2"), "Atlas/Labels.nrrd": Buffer.from("LABELS-v2") }, "test-v2");
    await withMockServer(versionTwoFiles, async ({ fetchImpl }) => {
      assert.equal((await ensureSplLiverAtlas({ assetRoot, template, lock: versionTwo, fetchImpl, installAtlas })).status, "unavailable");
    });
    assert.equal(JSON.parse(await readFile(path.join(assetRoot, "spl-liver", "installed-atlas.json"), "utf8")).managedVersion, "test-v1");
    assert.equal(await readFile(path.join(assetRoot, "spl-liver", "Volume.nrrd"), "utf8"), "CT-v1");
  });
});

test("an interrupted download leaves no partial active installation", async () => {
  await withFixture(async ({ assetRoot, template, installAtlas }) => {
    const files = fixtureFiles();
    const interruptedFiles = {
      ...files,
      "Atlas/Labels.nrrd": {
        interrupted: true,
        expectedSize: files["Atlas/Labels.nrrd"].length,
        partial: Buffer.from("LAB"),
      },
    };
    await withMockServer(interruptedFiles, async ({ fetchImpl }) => {
      const result = await ensureSplLiverAtlas({
        assetRoot,
        template,
        lock: fixtureLock(files),
        fetchImpl,
        installAtlas,
      });
      assert.equal(result.status, "unavailable");
    });
    await assert.rejects(readFile(path.join(assetRoot, "spl-liver", "manifest.json")));
  });
});

test("a managed-version mismatch upgrades atomically after full download validation", async () => {
  await withFixture(async ({ assetRoot, template, installAtlas }) => {
    const versionOneFiles = fixtureFiles("v1");
    const versionTwoFiles = fixtureFiles("v2");
    await withMockServer(versionOneFiles, async ({ fetchImpl }) => {
      await ensureSplLiverAtlas({ assetRoot, template, lock: fixtureLock(versionOneFiles, "test-v1"), fetchImpl, installAtlas });
    });
    await withMockServer(versionTwoFiles, async ({ fetchImpl, requests }) => {
      assert.equal((await ensureSplLiverAtlas({ assetRoot, template, lock: fixtureLock(versionTwoFiles, "test-v2"), fetchImpl, installAtlas })).status, "ready");
      assert.equal(requests.length, 4);
    });
    assert.equal(JSON.parse(await readFile(path.join(assetRoot, "spl-liver", "installed-atlas.json"), "utf8")).managedVersion, "test-v2");
  });
});

test("unsafe lock paths are rejected before requests and deployment scripts retain the shared noninteractive hook", async () => {
  const template = fixtureTemplate();
  const invalid = fixtureLock(fixtureFiles());
  invalid.assets[0].path = "../Volume.nrrd";
  assert.throws(() => validateAtlasLock(invalid, template), /unsafe path|do not match/i);
  const [setup, update, library, compose, dockerfile] = await Promise.all([
    readFile(path.join(repositoryRoot, "scripts/setup-docker.sh"), "utf8"),
    readFile(path.join(repositoryRoot, "scripts/update-docker.sh"), "utf8"),
    readFile(path.join(repositoryRoot, "scripts/docker-deployment-lib.sh"), "utf8"),
    readFile(path.join(repositoryRoot, "docker-compose.yml"), "utf8"),
    readFile(path.join(repositoryRoot, "Dockerfile"), "utf8"),
  ]);
  assert.match(library, /ensure_teaching_anatomy_assets\(\)/);
  assert.equal((setup.match(/ensure_teaching_anatomy_assets/g) ?? []).length, 2);
  assert.equal((update.match(/ensure_teaching_anatomy_assets/g) ?? []).length, 1);
  assert.doesNotMatch(setup, /Teaching Anatomy.*prompt|prompt.*Teaching Anatomy/i);
  assert.match(compose, /rispro-storage:\/app\/storage/);
  assert.match(library, /ensure_teaching_anatomy_assets\(\)[\s\S]*?return 0/);
  assert.match(library, /Teaching Anatomy: unavailable - provisioning failed\. RISpro remains available\./);
  assert.match(dockerfile, /COPY scripts\/teaching-anatomy\/provision-teaching-anatomy\.mjs/);
  assert.match(dockerfile, /COPY scripts\/teaching-anatomy\/spl-liver-atlas\.lock\.json/);
  assert.match(dockerfile, /COPY scripts\/teaching-anatomy\/slicer-license-part-b\.txt/);
  const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
  const shell = spawnSync(bash, ["-lc", [
    `source '${bashPath(path.join(repositoryRoot, "scripts/docker-deployment-lib.sh"))}'`,
    "COMPOSE_CMD=(false)",
    "COMPOSE_FILES=()",
    "ensure_teaching_anatomy_assets",
    "printf 'status=%s\\n' \"$TEACHING_ANATOMY_DEPLOYMENT_STATUS\"",
  ].join("\n")], { encoding: "utf8" });
  assert.equal(shell.status, 0, shell.stderr);
  assert.match(shell.stdout, /status=unavailable - provisioning failed/);
  assert.match(shell.stdout, /RISpro remains available/);
});
