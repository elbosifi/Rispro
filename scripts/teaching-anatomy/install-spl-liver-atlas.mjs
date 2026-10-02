#!/usr/bin/env node
import { copyFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const templatePath = path.join(repositoryRoot, "src/modules/teaching/anatomy/liver-manifest.template.json");
const EXPECTED_MESH_LABEL_AGREEMENT = 0.2;

function usage() {
  return [
    "Usage: node scripts/teaching-anatomy/install-spl-liver-atlas.mjs --source <SPLLiverAtlas-checkout> [--target <asset-root>] [--replace]",
    "The target defaults to TEACHING_ANATOMY_ASSET_ROOT or storage/uploads/teaching/anatomy.",
    "The installer places the atlas in <asset-root>/spl-liver and refuses Git LFS pointer files.",
  ].join("\n");
}

export function parseArgs(args) {
  const options = { replace: false, source: "", target: process.env.TEACHING_ANATOMY_ASSET_ROOT || path.join(process.env.UPLOADS_DIR || "storage/uploads", "teaching", "anatomy") };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--replace") options.replace = true;
    else if (value === "--source" && args[index + 1]) options.source = args[++index];
    else if (value === "--target" && args[index + 1]) options.target = args[++index];
    else if (value === "--help" || value === "-h") return { ...options, help: true };
    else throw new Error(`Unknown or incomplete option: ${value}\n${usage()}`);
  }
  if (!options.source) throw new Error(`--source is required.\n${usage()}`);
  return options;
}

function findNrrdHeader(buffer) {
  for (let index = 0; index < Math.min(buffer.length - 1, 128 * 1024); index += 1) {
    if (buffer[index] === 10 && buffer[index + 1] === 10) return { end: index, delimiter: 2 };
    if (buffer[index] === 13 && buffer[index + 1] === 10 && buffer[index + 2] === 13 && buffer[index + 3] === 10) return { end: index, delimiter: 4 };
  }
  throw new Error("NRRD header is missing its data separator.");
}

function parseNrrd(buffer, filename) {
  const { end, delimiter } = findNrrdHeader(buffer);
  const text = buffer.subarray(0, end).toString("utf8");
  if (!text.startsWith("NRRD")) throw new Error(`${filename} is not a NRRD file.`);
  const fields = new Map();
  for (const line of text.split(/\r?\n/).slice(1)) {
    const row = line.trim();
    if (!row || row.startsWith("#")) continue;
    const separator = row.indexOf(":");
    if (separator > 0) fields.set(row.slice(0, separator).trim().toLowerCase(), row.slice(separator + 1).trim());
  }
  if (fields.has("data file")) throw new Error(`${filename} uses a detached data file; install the complete single-file NRRD volume.`);
  if (Number(fields.get("dimension")) !== 3) throw new Error(`${filename} must be a 3D volume.`);
  const sizes = fields.get("sizes")?.split(/[\s,]+/).map(Number) ?? [];
  if (sizes.length !== 3 || sizes.some((size) => !Number.isSafeInteger(size) || size < 1)) throw new Error(`${filename} has invalid dimensions.`);
  const spaceRaw = fields.get("space")?.toLowerCase();
  const space = spaceRaw === "lps" || spaceRaw === "left-posterior-superior" ? "LPS"
    : spaceRaw === "ras" || spaceRaw === "right-anterior-superior" ? "RAS" : null;
  if (!space) throw new Error(`${filename} must declare a supported LPS or RAS space.`);
  const originMatch = fields.get("space origin")?.match(/\(([^)]+)\)/);
  const origin = originMatch?.[1].split(/[\s,]+/).map(Number) ?? [];
  const directionString = fields.get("space directions") ?? "";
  const directions = Array.from(directionString.matchAll(/\(([^)]+)\)/g), (match) => match[1].split(/[\s,]+/).map(Number));
  if (origin.length !== 3 || origin.some((value) => !Number.isFinite(value)) || directions.length !== 3
    || directions.some((vector) => vector.length !== 3 || vector.some((value) => !Number.isFinite(value)))) {
    throw new Error(`${filename} must include valid space origin and three space direction vectors.`);
  }
  if (fields.has("endian") && !["little", "big"].includes(fields.get("endian").toLowerCase())) throw new Error(`${filename} has invalid endian metadata.`);
  const payload = buffer.subarray(end + delimiter);
  const encoding = (fields.get("encoding") ?? "raw").toLowerCase();
  let data;
  try {
    data = encoding === "raw" ? payload : ["gzip", "gz"].includes(encoding) ? gunzipSync(payload) : null;
  } catch {
    throw new Error(`${filename} compressed voxel data could not be decompressed.`);
  }
  if (!data) throw new Error(`${filename} uses unsupported NRRD encoding ${encoding}.`);
  const type = (fields.get("type") ?? "").toLowerCase().replaceAll("_", " ").replace(/\s+/g, " ");
  const byteLengthByType = { char: 1, "signed char": 1, uchar: 1, "unsigned char": 1, short: 2, "signed short": 2, ushort: 2, "unsigned short": 2, int: 4, "signed int": 4, uint: 4, "unsigned int": 4, float: 4, double: 8 };
  const bytesPerVoxel = byteLengthByType[type];
  const expectedByteLength = sizes.reduce((product, size) => product * size, 1) * bytesPerVoxel;
  if (!bytesPerVoxel || data.length !== expectedByteLength) throw new Error(`${filename} voxel data length or type is invalid (expected ${expectedByteLength} bytes).`);
  return { fields, sizes, space, origin, directions, data, type, littleEndian: (fields.get("endian") ?? "little").toLowerCase() !== "big" };
}

function geometryEqual(left, right) {
  const close = (a, b) => Math.abs(a - b) <= 1e-4;
  return left.space === right.space && left.sizes.every((value, index) => value === right.sizes[index])
    && left.origin.every((value, index) => close(value, right.origin[index]))
    && left.directions.every((vector, axis) => vector.every((value, component) => close(value, right.directions[axis][component])));
}

function assertAxialGeometry(volume, filename) {
  const [x, y, z] = volume.directions;
  const cross = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  const crossLength = Math.hypot(...cross);
  const zLength = Math.hypot(...z);
  if (crossLength === 0 || zLength === 0) throw new Error(`${filename} has a zero-length spatial direction.`);
  const normal = cross.map((value) => value / crossLength);
  const zAlignment = Math.abs(normal[0] * z[0] / zLength + normal[1] * z[1] / zLength + normal[2] * z[2] / zLength);
  if (zAlignment < 0.99 || Math.abs(normal[2]) < 0.95) throw new Error(`${filename} does not describe an axial slice stack in patient space.`);
}

function readVoxel(volume, index) {
  const view = volume.data;
  const offset = index * ({ char: 1, "signed char": 1, uchar: 1, "unsigned char": 1, short: 2, "signed short": 2, ushort: 2, "unsigned short": 2, int: 4, "signed int": 4, uint: 4, "unsigned int": 4, float: 4, double: 8 }[volume.type]);
  switch (volume.type) {
    case "char": case "signed char": return view.readInt8(offset);
    case "uchar": case "unsigned char": return view.readUInt8(offset);
    case "short": case "signed short": return volume.littleEndian ? view.readInt16LE(offset) : view.readInt16BE(offset);
    case "ushort": case "unsigned short": return volume.littleEndian ? view.readUInt16LE(offset) : view.readUInt16BE(offset);
    case "int": case "signed int": return volume.littleEndian ? view.readInt32LE(offset) : view.readInt32BE(offset);
    case "uint": case "unsigned int": return volume.littleEndian ? view.readUInt32LE(offset) : view.readUInt32BE(offset);
    case "float": return volume.littleEndian ? view.readFloatLE(offset) : view.readFloatBE(offset);
    case "double": return volume.littleEndian ? view.readDoubleLE(offset) : view.readDoubleBE(offset);
    default: throw new Error(`Unsupported NRRD type ${volume.type}.`);
  }
}

function parseColorTable(buffer, filename) {
  const labels = new Set();
  for (const line of buffer.toString("utf8").split(/\r?\n/)) {
    const first = line.trim().split(/\s+/, 1)[0];
    if (/^\d+$/.test(first ?? "")) labels.add(Number(first));
  }
  if (labels.size === 0) throw new Error(`${filename} does not contain a readable label color table.`);
  return labels;
}

function vectorWorld(volume, voxel) {
  const [i, j, k] = voxel;
  return [0, 1, 2].map((axis) => volume.origin[axis] + volume.directions[0][axis] * i + volume.directions[1][axis] * j + volume.directions[2][axis] * k);
}

function invertAffine(volume) {
  const [a, b, c] = [volume.directions[0], volume.directions[1], volume.directions[2]];
  const determinant = a[0] * (b[1] * c[2] - b[2] * c[1]) - b[0] * (a[1] * c[2] - a[2] * c[1]) + c[0] * (a[1] * b[2] - a[2] * b[1]);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) throw new Error("NRRD spatial transform is singular.");
  const adjugate = [
    [b[1] * c[2] - c[1] * b[2], c[0] * b[2] - b[0] * c[2], b[0] * c[1] - c[0] * b[1]],
    [c[1] * a[2] - a[1] * c[2], a[0] * c[2] - c[0] * a[2], c[0] * a[1] - a[0] * c[1]],
    [a[1] * b[2] - b[1] * a[2], b[0] * a[2] - a[0] * b[2], a[0] * b[1] - b[0] * a[1]],
  ];
  return (world) => {
    const delta = world.map((value, axis) => value - volume.origin[axis]);
    return adjugate.map((row) => (row[0] * delta[0] + row[1] * delta[1] + row[2] * delta[2]) / determinant);
  };
}

function parseStl(buffer, filename) {
  if (buffer.length < 84) throw new Error(`${filename} is too short to be a valid STL mesh.`);
  const triangleCount = buffer.readUInt32LE(80);
  const isBinary = buffer.length === 84 + triangleCount * 50;
  const vertices = [];
  if (isBinary) {
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const base = 84 + triangle * 50 + 12;
      for (let vertex = 0; vertex < 3; vertex += 1) {
        const offset = base + vertex * 12;
        vertices.push([buffer.readFloatLE(offset), buffer.readFloatLE(offset + 4), buffer.readFloatLE(offset + 8)]);
      }
    }
  } else {
    const text = buffer.toString("utf8");
    for (const match of text.matchAll(/vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/gi)) vertices.push(match.slice(1, 4).map(Number));
  }
  if (vertices.length < 3 || vertices.some((vertex) => vertex.some((coordinate) => !Number.isFinite(coordinate)))) throw new Error(`${filename} contains no readable finite STL vertices.`);
  return vertices;
}

function findMeshFile(meshDirectory, expectedFile) {
  const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const expected = normalize(path.parse(expectedFile).name);
  const files = [...meshDirectory.entries()];
  const match = files.find(([name, item]) => item.isFile() && path.extname(name).toLowerCase() === ".stl" && normalize(path.parse(name).name) === expected);
  if (match) return match[0];
  if (expected === "ivc") {
    const alias = files.find(([name, item]) => item.isFile() && path.extname(name).toLowerCase() === ".stl" && normalize(path.parse(name).name) === "inferiorvenacava");
    if (alias) return alias[0];
  }
  throw new Error(`Required STL for ${expectedFile} was not found in Models/STL. Expected a matching source filename.`);
}

function transformCoordinateSystem(point, sourceSpace, targetSpace) {
  return sourceSpace === targetSpace ? point : [-point[0], -point[1], point[2]];
}

function assertMeshMatchesLabel(meshFile, structure, ct, labels, vertices, meshCoordinateSystem) {
  const dimensions = ct.sizes;
  const worldToIndex = invertAffine(ct);
  const stride = Math.max(1, Math.floor(vertices.length / 1500));
  let samples = 0;
  let matching = 0;
  const bounds = { minimum: [Infinity, Infinity, Infinity], maximum: [-Infinity, -Infinity, -Infinity] };
  const toAtlasWorld = (point) => transformCoordinateSystem(point, meshCoordinateSystem, ct.space);
  for (let vertexIndex = 0; vertexIndex < vertices.length; vertexIndex += 1) {
    const world = toAtlasWorld(vertices[vertexIndex]);
    for (let axis = 0; axis < 3; axis += 1) {
      bounds.minimum[axis] = Math.min(bounds.minimum[axis], world[axis]);
      bounds.maximum[axis] = Math.max(bounds.maximum[axis], world[axis]);
    }
  }
  const volumeCorners = [];
  for (const i of [0, dimensions[0] - 1]) for (const j of [0, dimensions[1] - 1]) for (const k of [0, dimensions[2] - 1]) volumeCorners.push(vectorWorld(ct, [i, j, k]));
  const worldMinimum = [0, 1, 2].map((axis) => Math.min(...volumeCorners.map((point) => point[axis])));
  const worldMaximum = [0, 1, 2].map((axis) => Math.max(...volumeCorners.map((point) => point[axis])));
  const margin = Math.max(...ct.directions.map((vector) => Math.hypot(...vector))) * 1.5;
  for (let axis = 0; axis < 3; axis += 1) {
    if (bounds.minimum[axis] < worldMinimum[axis] - margin || bounds.maximum[axis] > worldMaximum[axis] + margin) {
      throw new Error(`${meshFile} lies outside the CT physical bounds in the declared LPS coordinate system; refusing an unproven spatial offset.`);
    }
  }
  for (let vertexIndex = 0; vertexIndex < vertices.length; vertexIndex += stride) {
    const index = worldToIndex(toAtlasWorld(vertices[vertexIndex]));
    const nearest = index.map(Math.round);
    if (nearest.some((coordinate, axis) => coordinate < 0 || coordinate >= dimensions[axis])) continue;
    samples += 1;
    let found = false;
    for (let dz = -1; dz <= 1 && !found; dz += 1) for (let dy = -1; dy <= 1 && !found; dy += 1) for (let dx = -1; dx <= 1 && !found; dx += 1) {
      const x = nearest[0] + dx; const y = nearest[1] + dy; const z = nearest[2] + dz;
      if (x < 0 || y < 0 || z < 0 || x >= dimensions[0] || y >= dimensions[1] || z >= dimensions[2]) continue;
      const value = readVoxel(labels, x + dimensions[0] * (y + dimensions[1] * z));
      if (value === structure.labelValue) found = true;
    }
    if (found) matching += 1;
  }
  const agreement = samples > 0 ? matching / samples : 0;
  if (agreement < EXPECTED_MESH_LABEL_AGREEMENT) {
    throw new Error(`${meshFile} spatial registration with label ${structure.labelValue} could not be verified (sample agreement ${(agreement * 100).toFixed(1)}%; minimum is ${EXPECTED_MESH_LABEL_AGREEMENT * 100}%). Check the STL coordinate system and source files.`);
  }
  return agreement;
}

async function assertRealFile(filename) {
  const info = await stat(filename);
  if (!info.isFile() || info.size === 0) throw new Error(`${filename} is missing or empty.`);
  const file = await open(filename, "r");
  try {
    const prefix = Buffer.alloc(64);
    const { bytesRead } = await file.read(prefix, 0, prefix.length, 0);
    if (prefix.subarray(0, bytesRead).toString("utf8").startsWith("version https://git-lfs.github.com/spec/v1")) {
      throw new Error(`${filename} is a Git LFS pointer, not the real atlas asset. Fetch Git LFS objects before installing.`);
    }
  } finally {
    await file.close();
  }
}

function sourceRevision(source) {
  try { return execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

export async function install(options) {
  const source = path.resolve(options.source);
  const targetRoot = path.resolve(options.target);
  const target = path.join(targetRoot, "spl-liver");
  const sourceAtlas = path.join(source, "Atlas");
  const meshPath = path.join(source, "Models", "STL");
  const ctSource = path.join(sourceAtlas, "SPLLiverAtlasVolume.nrrd");
  const labelsSource = path.join(sourceAtlas, "SPLLiverAtlasLabels.nrrd");
  const colorsSource = path.join(sourceAtlas, "SPLLiverAtlasColors.ctbl");

  await assertRealFile(ctSource);
  await assertRealFile(labelsSource);
  await assertRealFile(colorsSource);
  const ct = parseNrrd(await readFile(ctSource), ctSource);
  const labels = parseNrrd(await readFile(labelsSource), labelsSource);
  if (!geometryEqual(ct, labels)) throw new Error("CT and label-map NRRD dimensions, coordinate systems, directions, or origins do not match.");
  assertAxialGeometry(ct, ctSource);
  const template = JSON.parse(await readFile(templatePath, "utf8"));
  template.coordinateSystem = ct.space;
  if (template.meshCoordinateSystem !== "LPS" && template.meshCoordinateSystem !== "RAS") {
    throw new Error("Atlas manifest template must declare STL coordinates as LPS or RAS.");
  }
  const sourceColorLabels = parseColorTable(await readFile(colorsSource), colorsSource);
  const requiredLabels = new Set(template.structures.map((structure) => structure.labelValue));
  for (const labelValue of requiredLabels) if (!sourceColorLabels.has(labelValue)) throw new Error(`SPLLiverAtlasColors.ctbl is missing required label ${labelValue}.`);
  const foundLabels = new Set();
  for (let index = 0; index < labels.sizes.reduce((product, size) => product * size, 1); index += 1) {
    const value = readVoxel(labels, index);
    if (requiredLabels.has(value)) foundLabels.add(value);
  }
  for (const labelValue of requiredLabels) if (!foundLabels.has(labelValue)) throw new Error(`The label-map volume contains no voxels with required label ${labelValue}.`);
  const meshEntries = await readdir(meshPath, { withFileTypes: true });
  const meshDirectory = new Map(meshEntries.map((entry) => [entry.name, entry]));
  const spatialAgreement = {};
  const meshSources = new Map();
  for (const structure of template.structures) {
    const asset = template.assets[structure.meshAsset];
    const sourceFilename = findMeshFile(meshDirectory, asset.sourceFile);
    const sourceFile = path.join(meshPath, sourceFilename);
    await assertRealFile(sourceFile);
    const vertices = parseStl(await readFile(sourceFile), sourceFile);
    spatialAgreement[structure.id] = assertMeshMatchesLabel(sourceFilename, structure, ct, labels, vertices, template.meshCoordinateSystem);
    meshSources.set(structure.meshAsset, { sourceFile, sourceFilename });
    asset.sourceFile = sourceFilename;
  }

  const upstreamReadme = path.join(source, "README.md");
  await assertRealFile(upstreamReadme);
  const upstreamLicenseCandidates = ["LICENSE", "LICENSE.txt", "License.txt", "License.md", "COPYING"];
  const licenseSource = await firstExistingFile(source, upstreamLicenseCandidates);
  if (await exists(target) && !options.replace) throw new Error(`${target} already exists. Pass --replace to replace this installed atlas.`);

  await mkdir(targetRoot, { recursive: true });
  const stage = path.join(targetRoot, `.spl-liver-install-${process.pid}`);
  const backup = path.join(targetRoot, `.spl-liver-backup-${process.pid}`);
  await rm(stage, { recursive: true, force: true });
  await rm(backup, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  try {
    await copyFile(ctSource, path.join(stage, template.assets.ct.file));
    await copyFile(labelsSource, path.join(stage, template.assets.labels.file));
    await copyFile(colorsSource, path.join(stage, template.assets.colors.file));
    for (const structure of template.structures) {
      const asset = template.assets[structure.meshAsset];
      const sourceInfo = meshSources.get(structure.meshAsset);
      await copyFile(sourceInfo.sourceFile, path.join(stage, asset.file));
      asset.sourceFile = sourceInfo.sourceFilename;
    }
    await copyFile(upstreamReadme, path.join(stage, "UPSTREAM-README.md"));
    if (licenseSource) await copyFile(licenseSource, path.join(stage, "UPSTREAM-LICENSE.txt"));
    else await writeFile(path.join(stage, "UPSTREAM-LICENSE.txt"), "The upstream repository does not include a root license file. The SPL atlas is described by the Open Anatomy Project as distributed under the 3D Slicer Contribution and Software License Agreement. See the linked license in manifest.json and docs/teaching-anatomy.md; preserve this notice and consult the upstream source before redistributing.\n", "utf8");
    template.spatialValidation = {
      status: "passed",
      method: "CT and label-map affine metadata matched exactly within 0.0001 mm; each STL was transformed only between its declared LPS/RAS coordinate system and the CT coordinate system, its bounding box fit inside the CT physical bounds, and at least 20% of deterministic mesh vertex samples matched its declared label within a 3x3x3 voxel neighborhood.",
      minimumMeshLabelAgreement: EXPECTED_MESH_LABEL_AGREEMENT,
      meshLabelAgreement: spatialAgreement,
    };
    template.provenance.sourceRevision = sourceRevision(source);
    template.provenance.installedAt = new Date().toISOString();
    const notice = [
      "SPL Liver Atlas educational data",
      "Source: https://github.com/lorensen/SPLLiverAtlas",
      template.provenance.attribution,
      template.provenance.license,
      `License details: ${template.provenance.licenseUrl}`,
      "Installed by RISpro as educational material. Preserve UPSTREAM-README.md, UPSTREAM-LICENSE.txt, and this notice with the atlas files.",
    ].join("\n\n") + "\n";
    await writeFile(path.join(stage, "NOTICE.txt"), notice, "utf8");
    await writeFile(path.join(stage, "manifest.json"), `${JSON.stringify(template, null, 2)}\n`, "utf8");
    if (options.managedMetadata) {
      await writeFile(path.join(stage, "installed-atlas.json"), `${JSON.stringify(options.managedMetadata, null, 2)}\n`, "utf8");
    }
    if (await exists(target)) await rename(target, backup);
    try {
      await rename(stage, target);
      if (await exists(backup)) await rm(backup, { recursive: true, force: true });
    } catch (error) {
      if (await exists(backup) && !(await exists(target))) await rename(backup, target);
      throw error;
    }
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  return { target, structures: template.structures.length, sliceCount: ct.sizes[2], dimensions: ct.sizes, coordinateSystem: ct.space };
}

async function firstExistingFile(directory, names) {
  for (const name of names) {
    const candidate = path.join(directory, name);
    if (await exists(candidate)) return candidate;
  }
  return null;
}

async function exists(filename) {
  try { await stat(filename); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) process.stdout.write(`${usage()}\n`);
  else {
    const result = await install(options);
    process.stdout.write(`Installed SPL Liver Atlas to ${result.target}\n`);
    process.stdout.write(`Verified ${result.structures} structures; ${result.dimensions.join(" × ")} voxels; ${result.sliceCount} axial slices; ${result.coordinateSystem} coordinates.\n`);
  }
} catch (error) {
  process.stderr.write(`SPL Liver Atlas installation failed: ${error.message}\n`);
  process.exitCode = 1;
}
}
