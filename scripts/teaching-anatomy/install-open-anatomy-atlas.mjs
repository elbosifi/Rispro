#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import { convertLegacyVtkPolyDataToBinaryStl } from "./legacy-vtk-polydata.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const lockPath = path.join(scriptDirectory, "open-atlas-sources.lock.json");
const minimumMeshLabelAgreement = 0.2;
const maximumNrrdHeaderBytes = 128 * 1024;
const bytesPerType = { char: 1, "signed char": 1, uchar: 1, "unsigned char": 1, short: 2, "signed short": 2, ushort: 2, "unsigned short": 2, int: 4, "signed int": 4, uint: 4, "unsigned int": 4, float: 4, double: 8 };

function assertRecord(value, name) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value;
}

function safeRelativePath(value, name) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.startsWith("/")) throw new Error(`${name} must be a safe POSIX relative path.`);
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /^[A-Za-z]:/.test(part))) throw new Error(`${name} contains an unsafe path component.`);
  return value;
}

function resolveInside(root, relativePath, name) {
  const base = path.resolve(root);
  const target = path.resolve(base, ...safeRelativePath(relativePath, name).split("/"));
  if (!target.startsWith(`${base}${path.sep}`)) throw new Error(`${name} resolves outside its expected directory.`);
  return target;
}

function stableId(value, prefix = "") {
  const base = String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 65);
  const id = `${prefix}${base || "structure"}`;
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(id) ? id : `${prefix}${createHash("sha1").update(String(value)).digest("hex").slice(0, 12)}`;
}

function containsType(value, type) {
  return Array.isArray(value) ? value.some((item) => item === type) : value === type;
}

function hexColor(value, fallback = "#b8c3d1") {
  if (typeof value !== "string") return fallback;
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return `#${hex[1].toLowerCase()}`;
  const rgb = value.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (!rgb) return fallback;
  const components = rgb.slice(1).map(Number);
  if (components.some((component) => component > 255)) return fallback;
  return `#${components.map((component) => component.toString(16).padStart(2, "0")).join("")}`;
}

function findNrrdHeader(buffer, filename) {
  for (let index = 0; index < Math.min(buffer.length - 3, maximumNrrdHeaderBytes); index += 1) {
    if (buffer[index] === 10 && buffer[index + 1] === 10) return { end: index, delimiter: 2 };
    if (buffer[index] === 13 && buffer[index + 1] === 10 && buffer[index + 2] === 13 && buffer[index + 3] === 10) return { end: index, delimiter: 4 };
  }
  throw new Error(`${filename} is missing a bounded NRRD header separator.`);
}

export function parseSourceNrrd(buffer, filename = "NRRD volume") {
  const { end, delimiter } = findNrrdHeader(buffer, filename);
  const header = buffer.subarray(0, end).toString("utf8");
  if (!header.startsWith("NRRD")) throw new Error(`${filename} is not a NRRD volume.`);
  const fields = new Map();
  for (const line of header.split(/\r?\n/).slice(1)) {
    const row = line.trim();
    if (!row || row.startsWith("#")) continue;
    const separator = row.indexOf(":");
    if (separator > 0) fields.set(row.slice(0, separator).trim().toLowerCase(), row.slice(separator + 1).trim());
  }
  if (fields.has("data file") || Number(fields.get("dimension")) !== 3) throw new Error(`${filename} must contain one attached 3D NRRD volume.`);
  const sizes = fields.get("sizes")?.split(/[\s,]+/).map(Number) ?? [];
  const spaceValue = fields.get("space")?.toLowerCase();
  const space = spaceValue === "lps" || spaceValue === "left-posterior-superior" ? "LPS"
    : spaceValue === "ras" || spaceValue === "right-anterior-superior" ? "RAS" : null;
  const originMatch = fields.get("space origin")?.match(/\(([^)]+)\)/);
  const origin = originMatch?.[1].split(/[\s,]+/).map(Number) ?? [];
  const directions = Array.from((fields.get("space directions") ?? "").matchAll(/\(([^)]+)\)/g), (match) => match[1].split(/[\s,]+/).map(Number));
  const type = (fields.get("type") ?? "").toLowerCase().replaceAll("_", " ").replace(/\s+/g, " ");
  const bytesPerVoxel = bytesPerType[type];
  if (!space || sizes.length !== 3 || sizes.some((size) => !Number.isSafeInteger(size) || size < 1)
    || origin.length !== 3 || origin.some((coordinate) => !Number.isFinite(coordinate))
    || directions.length !== 3 || directions.some((vector) => vector.length !== 3 || vector.some((coordinate) => !Number.isFinite(coordinate)))
    || !bytesPerVoxel) throw new Error(`${filename} has unsupported or invalid physical NRRD metadata.`);
  const count = sizes.reduce((product, size) => product * size, 1);
  const encoding = (fields.get("encoding") ?? "raw").toLowerCase();
  let data;
  try {
    const payload = buffer.subarray(end + delimiter);
    data = encoding === "raw" ? payload : ["gzip", "gz"].includes(encoding) ? gunzipSync(payload) : null;
  } catch {
    throw new Error(`${filename} gzip data could not be decompressed.`);
  }
  if (!data || data.length !== count * bytesPerVoxel) throw new Error(`${filename} has an unsupported encoding or incomplete voxel data.`);
  return { sizes, space, origin, directions, data, type, fields, littleEndian: (fields.get("endian") ?? "little").toLowerCase() !== "big" };
}

function readVoxel(volume, index) {
  const offset = index * bytesPerType[volume.type];
  const data = volume.data;
  switch (volume.type) {
    case "char": case "signed char": return data.readInt8(offset);
    case "uchar": case "unsigned char": return data.readUInt8(offset);
    case "short": case "signed short": return volume.littleEndian ? data.readInt16LE(offset) : data.readInt16BE(offset);
    case "ushort": case "unsigned short": return volume.littleEndian ? data.readUInt16LE(offset) : data.readUInt16BE(offset);
    case "int": case "signed int": return volume.littleEndian ? data.readInt32LE(offset) : data.readInt32BE(offset);
    case "uint": case "unsigned int": return volume.littleEndian ? data.readUInt32LE(offset) : data.readUInt32BE(offset);
    case "float": return volume.littleEndian ? data.readFloatLE(offset) : data.readFloatBE(offset);
    case "double": return volume.littleEndian ? data.readDoubleLE(offset) : data.readDoubleBE(offset);
    default: throw new Error(`Unsupported NRRD type ${volume.type}.`);
  }
}

function sameGeometry(left, right) {
  const close = (a, b) => Math.abs(a - b) <= 1e-4;
  return left.space === right.space && left.sizes.every((value, index) => value === right.sizes[index])
    && left.origin.every((value, index) => close(value, right.origin[index]))
    && left.directions.every((vector, axis) => vector.every((value, component) => close(value, right.directions[axis][component])));
}

function inverseGeometryAffine(volume) {
  const [a, b, c] = volume.directions;
  const determinant = a[0] * (b[1] * c[2] - b[2] * c[1]) - b[0] * (a[1] * c[2] - a[2] * c[1]) + c[0] * (a[1] * b[2] - a[2] * b[1]);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) throw new Error("Source NRRD affine is singular.");
  const adjugate = [
    [b[1] * c[2] - c[1] * b[2], c[0] * b[2] - b[0] * c[2], b[0] * c[1] - c[0] * b[1]],
    [c[1] * a[2] - a[1] * c[2], a[0] * c[2] - c[0] * a[2], c[0] * a[1] - a[0] * c[1]],
    [a[1] * b[2] - b[1] * a[2], b[0] * a[2] - a[0] * b[2], a[0] * b[1] - b[0] * a[1]],
  ];
  const matrix = adjugate.map((row) => row.map((value) => value / determinant));
  const offset = matrix.map((row) => -(row[0] * volume.origin[0] + row[1] * volume.origin[1] + row[2] * volume.origin[2]));
  return { matrix, offset };
}

function invertGeometry(volume) {
  const { matrix, offset } = inverseGeometryAffine(volume);
  return (world) => matrix.map((row, axis) => row[0] * world[0] + row[1] * world[1] + row[2] * world[2] + offset[axis]);
}

function transformSpace(point, from, to) {
  return from === to ? point : [-point[0], -point[1], point[2]];
}

function sourceBounds(volume) {
  const points = [];
  for (const i of [0, volume.sizes[0] - 1]) for (const j of [0, volume.sizes[1] - 1]) for (const k of [0, volume.sizes[2] - 1]) {
    points.push([0, 1, 2].map((axis) => volume.origin[axis] + volume.directions[0][axis] * i + volume.directions[1][axis] * j + volume.directions[2][axis] * k));
  }
  return {
    min: [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis]))),
    max: [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis]))),
  };
}

export function assessMeshLabelAgreement(points, volume, labels, labelValue, meshSpace) {
  const worldToIndex = invertGeometry(volume);
  const bounds = sourceBounds(volume);
  const spacing = Math.max(...volume.directions.map((direction) => Math.hypot(...direction)));
  const margin = spacing * 1.5;
  const meshBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let index = 0; index < points.length; index += 3) {
    const world = transformSpace([points[index], points[index + 1], points[index + 2]], meshSpace, volume.space);
    for (let axis = 0; axis < 3; axis += 1) {
      meshBounds.min[axis] = Math.min(meshBounds.min[axis], world[axis]);
      meshBounds.max[axis] = Math.max(meshBounds.max[axis], world[axis]);
    }
  }
  const insideBounds = meshBounds.min.every((value, axis) => value >= bounds.min[axis] - margin && meshBounds.max[axis] <= bounds.max[axis] + margin);
  const pointCount = points.length / 3;
  const stride = Math.max(1, Math.floor(pointCount / 1800));
  let samples = 0;
  let matching = 0;
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += stride) {
    const base = pointIndex * 3;
    const world = transformSpace([points[base], points[base + 1], points[base + 2]], meshSpace, volume.space);
    const nearest = worldToIndex(world).map(Math.round);
    if (nearest.some((coordinate, axis) => coordinate < 0 || coordinate >= volume.sizes[axis])) continue;
    samples += 1;
    let found = false;
    for (let dz = -1; dz <= 1 && !found; dz += 1) for (let dy = -1; dy <= 1 && !found; dy += 1) for (let dx = -1; dx <= 1 && !found; dx += 1) {
      const x = nearest[0] + dx; const y = nearest[1] + dy; const z = nearest[2] + dz;
      if (x < 0 || y < 0 || z < 0 || x >= volume.sizes[0] || y >= volume.sizes[1] || z >= volume.sizes[2]) continue;
      if (readVoxel(labels, x + volume.sizes[0] * (y + volume.sizes[1] * z)) === labelValue) found = true;
    }
    if (found) matching += 1;
  }
  return { insideBounds, samples, agreement: samples ? matching / samples : 0 };
}

function collectLabelValues(labels) {
  const present = new Set();
  const count = labels.sizes.reduce((product, size) => product * size, 1);
  for (let index = 0; index < count; index += 1) {
    const value = readVoxel(labels, index);
    if (Number.isInteger(value) && value > 0) present.add(value);
  }
  return present;
}

function resampleSegmentationToImageGrid(image, segmentation, labelValues) {
  const inverse = inverseGeometryAffine(segmentation);
  const transform = [0, 1, 2].map((axis) => [0, 1, 2].map((imageAxis) => (
    inverse.matrix[axis][0] * image.directions[imageAxis][0]
    + inverse.matrix[axis][1] * image.directions[imageAxis][1]
    + inverse.matrix[axis][2] * image.directions[imageAxis][2]
  )));
  const deltaOrigin = image.origin.map((value, axis) => value - segmentation.origin[axis]);
  const offset = inverse.matrix.map((row) => row[0] * deltaOrigin[0] + row[1] * deltaOrigin[1] + row[2] * deltaOrigin[2]);
  const voxelCount = image.sizes.reduce((product, size) => product * size, 1);
  const bytesPerVoxel = bytesPerType[segmentation.type];
  const data = Buffer.alloc(voxelCount * bytesPerVoxel);
  let samplesInsideSource = 0;
  for (let k = 0; k < image.sizes[2]; k += 1) {
    const sourceK = [0, 1, 2].map((axis) => offset[axis] + transform[axis][2] * k);
    for (let j = 0; j < image.sizes[1]; j += 1) {
      const sourceJ = sourceK.map((value, axis) => value + transform[axis][1] * j);
      for (let i = 0; i < image.sizes[0]; i += 1) {
        const sourceI = sourceJ.map((value, axis) => value + transform[axis][0] * i).map(Math.round);
        const outputOffset = (i + image.sizes[0] * (j + image.sizes[1] * k)) * bytesPerVoxel;
        if (sourceI.some((coordinate, axis) => coordinate < 0 || coordinate >= segmentation.sizes[axis])) continue;
        samplesInsideSource += 1;
        const label = readVoxel(segmentation, sourceI[0] + segmentation.sizes[0] * (sourceI[1] + segmentation.sizes[1] * sourceI[2]));
        switch (segmentation.type) {
          case "char": case "signed char": data.writeInt8(label, outputOffset); break;
          case "uchar": case "unsigned char": data.writeUInt8(label, outputOffset); break;
          case "short": case "signed short": data.writeInt16LE(label, outputOffset); break;
          case "ushort": case "unsigned short": data.writeUInt16LE(label, outputOffset); break;
          case "int": case "signed int": data.writeInt32LE(label, outputOffset); break;
          case "uint": case "unsigned int": data.writeUInt32LE(label, outputOffset); break;
          case "float": data.writeFloatLE(label, outputOffset); break;
          case "double": data.writeDoubleLE(label, outputOffset); break;
          default: throw new Error(`Unsupported NRRD label type ${segmentation.type}.`);
        }
      }
    }
  }
  if (samplesInsideSource / voxelCount < 0.95) throw new Error("Image and segmentation physical fields of view overlap by less than 95%; refusing to resample labels.");
  const normalized = { ...segmentation, sizes: image.sizes, space: image.space, origin: image.origin, directions: image.directions, data, littleEndian: true };
  const normalizedValues = collectLabelValues(normalized);
  for (const value of labelValues) if (!normalizedValues.has(value)) throw new Error(`Nearest-neighbor label resampling lost declared structure value ${value}.`);
  return { volume: normalized, buffer: serializeNrrdLikeImage(normalized), coverage: samplesInsideSource / voxelCount };
}

function formatNrrdNumber(value) {
  return Number(value.toPrecision(12)).toString();
}

function serializeNrrdLikeImage(volume) {
  const space = volume.space === "LPS" ? "left-posterior-superior" : "right-anterior-superior";
  const directions = volume.directions.map((vector) => `(${vector.map(formatNrrdNumber).join(",")})`).join(" ");
  const origin = `(${volume.origin.map(formatNrrdNumber).join(",")})`;
  const header = [
    "NRRD0005",
    `type: ${volume.type}`,
    "dimension: 3",
    `space: ${space}`,
    `sizes: ${volume.sizes.join(" ")}`,
    `space directions: ${directions}`,
    "kinds: domain domain domain",
    "endian: little",
    "encoding: gzip",
    `space origin: ${origin}`,
    "",
    "",
  ].join("\n");
  return Buffer.concat([Buffer.from(header, "utf8"), gzipSync(volume.data)]);
}

function parseAtlasSource(atlasStructure) {
  if (!Array.isArray(atlasStructure)) throw new Error("Open Anatomy atlasStructure.json must contain a source array.");
  const groups = atlasStructure.filter((item) => item?.["@type"] === "Group");
  const sourceStructures = atlasStructure.filter((item) => item?.["@type"] === "Structure");
  const dataSources = new Map(atlasStructure.filter((item) => item?.["@type"] === "DataSource").map((item) => [item["@id"], item]));
  if (sourceStructures.length === 0) throw new Error("Open Anatomy source archive contains no anatomical structures.");
  const memberships = new Map();
  const parentGroups = new Map();
  for (const group of groups) {
    if (typeof group["@id"] !== "string" || !Array.isArray(group.member)) throw new Error("Open Anatomy group metadata is invalid.");
    const parentId = stableId(group["@id"], "group-");
    for (const member of group.member) {
      if (typeof member !== "string") throw new Error("Open Anatomy group member is invalid.");
      if (!memberships.has(member)) memberships.set(member, parentId);
      if (groups.some((candidate) => candidate["@id"] === member) && !parentGroups.has(member)) parentGroups.set(member, parentId);
    }
  }
  const groupEntries = groups.map((group) => ({
    id: stableId(group["@id"], "group-"),
    name: typeof group.annotation?.name === "string" ? group.annotation.name : String(group["@id"]).replace(/^#/, ""),
    category: "Atlas hierarchy",
    ...(parentGroups.has(group["@id"]) ? { parentId: parentGroups.get(group["@id"]) } : {}),
    synonyms: [],
    color: hexColor(group.renderOption?.color),
    note: "Source atlas structure group.",
  }));
  const structureEntries = sourceStructures.map((structure) => {
    if (typeof structure["@id"] !== "string" || !Array.isArray(structure.sourceSelector)) throw new Error("Open Anatomy structure metadata is invalid.");
    const labelSelector = structure.sourceSelector.find((selector) => containsType(selector?.["@type"], "LabelMapSelector"));
    const meshSelector = structure.sourceSelector.find((selector) => containsType(selector?.["@type"], "GeometrySelector"));
    const labelValue = Number(labelSelector?.dataKey);
    const dataSource = meshSelector ? dataSources.get(meshSelector.dataSource) : null;
    const sourceFile = typeof dataSource?.source === "string" ? safeRelativePath(dataSource.source, "Source model path") : undefined;
    const name = typeof structure.annotation?.name === "string" && structure.annotation.name.trim()
      ? structure.annotation.name.trim() : structure["@id"].replace(/^#/, "");
    const id = stableId(`${structure["@id"]}-${labelValue}`);
    return {
      id,
      sourceId: structure["@id"],
      labelValue,
      name,
      category: "Anatomical structures",
      ...(memberships.has(structure["@id"]) ? { parentId: memberships.get(structure["@id"]) } : {}),
      synonyms: [],
      color: hexColor(structure.renderOption?.color),
      ...(sourceFile ? { sourceFile } : {}),
      note: "",
    };
  });
  const seenLabels = new Set();
  const seenIds = new Set(groupEntries.map(({ id }) => id));
  for (const structure of structureEntries) {
    if (!Number.isSafeInteger(structure.labelValue) || structure.labelValue < 1 || seenLabels.has(structure.labelValue)) {
      throw new Error(`Open Anatomy source contains an invalid or duplicate segmentation value for ${structure.name}.`);
    }
    if (seenIds.has(structure.id)) throw new Error(`Open Anatomy source contains duplicate structure identifiers for ${structure.name}.`);
    if (!structure.sourceFile) throw new Error(`Open Anatomy source has no linked surface model for ${structure.name}.`);
    seenLabels.add(structure.labelValue);
    seenIds.add(structure.id);
  }
  return { groupEntries, structureEntries };
}

async function sha256File(filename) {
  const data = await readFile(filename);
  return { sizeBytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
}

function sha256Buffer(data) {
  return { sizeBytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
}

async function activateStage({ target, stage, backup }) {
  await mkdir(path.dirname(target), { recursive: true });
  await rm(backup, { recursive: true, force: true });
  let movedOld = false;
  try {
    try { await rename(target, backup); movedOld = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
    await rename(stage, target);
    if (movedOld) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (movedOld) {
      try { await stat(target); } catch { await rename(backup, target); }
    }
    throw error;
  }
}

async function loadLock() {
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  assertRecord(lock, "Open atlas source lock");
  if (lock.schemaVersion !== "1.0" || !Array.isArray(lock.openAnatomy)) throw new Error("Open atlas source lock has an unsupported schema.");
  return lock;
}

function validateSourceLock(entry) {
  if (!entry || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(entry.atlasId) || typeof entry.managedVersion !== "string"
    || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 1 || !/^[a-f0-9]{64}$/i.test(entry.sha256)
    || typeof entry.url !== "string" || new URL(entry.url).protocol !== "https:" || new URL(entry.url).hostname !== "www.openanatomy.org"
    || !["CT", "MRI"].includes(entry.modality)) throw new Error(`Open atlas lock entry ${String(entry?.atlasId)} is invalid.`);
  for (const key of ["archiveRoot", "imageFile", "segmentationFile", "structuresFile", "licenseFile", "readmeFile"]) safeRelativePath(entry[key], `Open atlas ${key}`);
  return entry;
}

export async function verifyInstalledOpenAtlas(targetRoot, entry) {
  const directory = path.join(path.resolve(targetRoot), entry.atlasId);
  try {
    const [metadata, manifest] = await Promise.all([
      readFile(path.join(directory, "installed-atlas.json"), "utf8").then(JSON.parse),
      readFile(path.join(directory, "manifest.json"), "utf8").then(JSON.parse),
    ]);
    if (metadata.atlasId !== entry.atlasId || metadata.managedVersion !== entry.managedVersion || metadata.sourceSha256 !== entry.sha256
      || manifest.atlasId !== entry.atlasId || manifest.spatialValidation?.status !== "passed" || !Array.isArray(manifest.structures)) return false;
    for (const asset of Object.values(manifest.assets ?? {})) {
      const integrity = asset.integrity;
      if (!integrity || !Number.isSafeInteger(integrity.sizeBytes) || !/^[a-f0-9]{64}$/.test(integrity.sha256)) return false;
      const actual = await sha256File(path.join(directory, asset.file));
      if (actual.sizeBytes !== integrity.sizeBytes || actual.sha256 !== integrity.sha256) return false;
    }
    return true;
  } catch { return false; }
}

export async function installOpenAnatomyAtlas({ atlasId, sourceDirectory, targetRoot, sourceSha256, now = () => new Date(), log = () => undefined }) {
  const lock = await loadLock();
  const entry = validateSourceLock(lock.openAnatomy.find((candidate) => candidate.atlasId === atlasId));
  if (sourceSha256 && sourceSha256.toLowerCase() !== entry.sha256.toLowerCase()) throw new Error(`${atlasId} source archive does not match its pinned SHA-256.`);
  const sourceRoot = resolveInside(sourceDirectory, entry.archiveRoot, "Open Anatomy archive root");
  const imageSource = resolveInside(sourceRoot, entry.imageFile, "Open Anatomy image volume");
  const segmentationSource = resolveInside(sourceRoot, entry.segmentationFile, "Open Anatomy segmentation volume");
  const structureSource = resolveInside(sourceRoot, entry.structuresFile, "Open Anatomy structure metadata");
  const licenseSource = resolveInside(sourceRoot, entry.licenseFile, "Open Anatomy license notice");
  const readmeSource = resolveInside(sourceRoot, entry.readmeFile, "Open Anatomy source readme");
  const [imageBuffer, sourceSegmentationBuffer, sourceMetadata, licenseText] = await Promise.all([
    readFile(imageSource), readFile(segmentationSource), readFile(structureSource, "utf8").then(JSON.parse), readFile(licenseSource, "utf8"),
  ]);
  await readFile(readmeSource);
  if (!/3d slicer/i.test(licenseText) || !/license/i.test(licenseText)) throw new Error(`${atlasId} archive does not include its expected upstream license notice.`);
  const image = parseSourceNrrd(imageBuffer, entry.imageFile);
  let segmentation = parseSourceNrrd(sourceSegmentationBuffer, entry.segmentationFile);
  const { groupEntries, structureEntries } = parseAtlasSource(sourceMetadata);
  const declaredLabels = new Set(structureEntries.map(({ labelValue }) => labelValue));
  const sourceLabelValues = collectLabelValues(segmentation);
  for (const value of declaredLabels) if (!sourceLabelValues.has(value)) throw new Error(`${atlasId} source segmentation does not contain the declared label ${value}.`);
  let segmentationBuffer = sourceSegmentationBuffer;
  let labelResampling = null;
  if (!sameGeometry(image, segmentation)) {
    if (entry.normalizeLabelMapToImageGrid !== true) throw new Error(`${atlasId} source image and label volumes do not have matching physical geometry.`);
    const sourceGeometry = { sizes: [...segmentation.sizes], space: segmentation.space, origin: [...segmentation.origin], directions: segmentation.directions.map((direction) => [...direction]) };
    const normalized = resampleSegmentationToImageGrid(image, segmentation, declaredLabels);
    segmentation = normalized.volume;
    segmentationBuffer = normalized.buffer;
    labelResampling = { coverage: normalized.coverage, sourceGeometry };
    if (!sameGeometry(image, segmentation)) throw new Error(`${atlasId} label-map resampling did not produce the image physical geometry.`);
  }
  const presentLabels = collectLabelValues(segmentation);
  for (const structure of structureEntries) {
    if (!presentLabels.has(structure.labelValue)) throw new Error(`${atlasId} normalized segmentation does not contain the declared label ${structure.labelValue} (${structure.name}).`);
  }

  const models = [];
  for (let index = 0; index < structureEntries.length; index += 1) {
    const structure = structureEntries[index];
    const modelPath = resolveInside(sourceRoot, structure.sourceFile, `Mesh for ${structure.name}`);
    const result = convertLegacyVtkPolyDataToBinaryStl(await readFile(modelPath));
    const agreementBySpace = Object.fromEntries(["LPS", "RAS"].map((space) => [space, assessMeshLabelAgreement(result.points, image, segmentation, structure.labelValue, space)]));
    models.push({ structure, sourceFile: modelPath, outputFile: `${structure.id}.stl`, agreementBySpace });
    if ((index + 1) % 20 === 0 || index + 1 === structureEntries.length) log(`[progress] ${atlasId}: spatially checked ${index + 1}/${structureEntries.length} meshes.`);
  }

  const candidates = ["LPS", "RAS"].map((space) => {
    const assessments = models.map(({ agreementBySpace }) => agreementBySpace[space]);
    const passing = assessments.filter((assessment) => assessment.insideBounds && assessment.samples > 0 && assessment.agreement >= minimumMeshLabelAgreement).length;
    const averageAgreement = assessments.reduce((sum, assessment) => sum + assessment.agreement, 0) / Math.max(1, assessments.length);
    return { space, assessments, passing, averageAgreement };
  }).sort((left, right) => right.passing - left.passing || right.averageAgreement - left.averageAgreement);
  const chosen = candidates[0];
  const requiredModels = Math.ceil(models.length * 0.8);
  if (chosen.passing < requiredModels || chosen.averageAgreement < minimumMeshLabelAgreement) {
    const report = candidates.map(({ space, passing, averageAgreement }) => `${space}: ${passing}/${models.length}, mean ${(averageAgreement * 100).toFixed(1)}%`).join("; ");
    throw new Error(`${atlasId} source meshes could not be spatially confirmed against their labels (${report}).`);
  }
  if (candidates[1].passing === chosen.passing && Math.abs(candidates[1].averageAgreement - chosen.averageAgreement) < 0.025) {
    throw new Error(`${atlasId} source mesh coordinate convention is ambiguous from image/label agreement.`);
  }

  const targetBase = path.resolve(targetRoot);
  await mkdir(targetBase, { recursive: true });
  const stage = path.join(targetBase, `.${atlasId}-stage-${process.pid}-${randomBytes(6).toString("hex")}`);
  const target = path.join(targetBase, atlasId);
  const backup = path.join(targetBase, `.${atlasId}-backup-${process.pid}-${randomBytes(6).toString("hex")}`);
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true, mode: 0o700 });
  let displayMeshCount = 0;
  try {
    const assets = {};
    const addBufferAsset = async (key, filename, mediaType, buffer, sourceFile) => {
      const destination = path.join(stage, filename);
      await writeFile(destination, buffer, { mode: 0o600 });
      assets[key] = { file: filename, sourceFile, mediaType, integrity: sha256Buffer(buffer) };
    };
    await addBufferAsset("primary-volume", `${atlasId}-image.nrrd`, "application/x-nrrd", imageBuffer, entry.imageFile);
    await addBufferAsset("segmentation", `${atlasId}-labels.nrrd`, "application/x-nrrd", segmentationBuffer, entry.segmentationFile);
    const meshAgreement = {};
    for (let index = 0; index < models.length; index += 1) {
      const model = models[index];
      const assessment = model.agreementBySpace[chosen.space];
      if (!assessment.insideBounds || assessment.samples === 0 || assessment.agreement < minimumMeshLabelAgreement) {
        model.structure.note = "The upstream surface did not meet the mesh-to-segmentation spatial agreement threshold, so RISpro does not display that mesh.";
        continue;
      }
      const assetKey = `mesh-${model.structure.id}`;
      const normalized = convertLegacyVtkPolyDataToBinaryStl(await readFile(model.sourceFile));
      await addBufferAsset(assetKey, model.outputFile, "model/stl", normalized.stl, model.structure.sourceFile);
      model.structure.meshAsset = assetKey;
      displayMeshCount += 1;
      meshAgreement[model.structure.id] = assessment.agreement;
      if ((index + 1) % 20 === 0 || index + 1 === models.length) log(`[progress] ${atlasId}: normalized ${index + 1}/${models.length} source meshes.`);
    }
    const structures = [
      ...groupEntries,
      ...structureEntries.map(({ sourceId, sourceFile, ...structure }) => structure),
    ];
    await copyFile(licenseSource, path.join(stage, "UPSTREAM-SOURCE-LICENSE.md"));
    await copyFile(readmeSource, path.join(stage, "UPSTREAM-README.md"));
    const slicerLicensePartB = await readFile(path.join(scriptDirectory, "slicer-license-part-b.txt"), "utf8");
    await writeFile(path.join(stage, "UPSTREAM-LICENSE.md"), `All or portions of this licensed product (such portions are the “Software”) have been obtained under license from The Brigham and Women's Hospital, Inc. and are subject to the following terms and conditions:\n\n${slicerLicensePartB}`, "utf8");
    if (labelResampling) await copyFile(segmentationSource, path.join(stage, "UPSTREAM-segmentation.nrrd"));
    await writeFile(path.join(stage, "SOURCE-ARCHIVE.json"), `${JSON.stringify({ sourceUrl: entry.url, archiveSha256: entry.sha256, archiveSizeBytes: entry.sizeBytes, managedVersion: entry.managedVersion, labelResampling }, null, 2)}\n`, "utf8");
    const manifest = {
      schemaVersion: "2.0",
      atlasId,
      title: entry.title,
      bodyRegion: entry.bodyRegion,
      organs: entry.organs,
      systems: entry.systems,
      modality: entry.modality,
      correlatedImaging: true,
      supportedPlanes: ["axial", "coronal", "sagittal"],
      initialSlice: { plane: "axial", index: Math.floor(image.sizes[2] / 2) },
      coordinateSystem: image.space,
      meshCoordinateSystem: chosen.space,
      volumes: {
        primary: {
          assetKey: "primary-volume",
          file: assets["primary-volume"].file,
          modality: entry.modality,
          ...(entry.modality === "CT" ? { windowLevel: { width: 400, level: 40 } } : { intensityRange: sampledIntensityRange(image) }),
        },
        segmentation: { assetKey: "segmentation", file: assets.segmentation.file },
      },
      assets,
      structures,
      provenance: {
        sourceRepository: entry.sourceRepository,
        project: entry.title,
        attribution: entry.attribution,
        license: `${entry.license}; the source package's LICENSE.md notice is preserved with the installed files.`,
        licenseUrl: "https://www.openanatomy.org/atlas-pages/slicer-license.html",
        use: "Adapted from the pinned Open Anatomy source archive as RISpro Teaching educational material. It is isolated from clinical workflows and patient-specific data.",
      },
      spatialValidation: {
        status: "passed",
        method: labelResampling
          ? "The source segmentation was nearest-neighbor resampled from its declared LPS physical affine onto the source image grid because the two source NRRDs had different spacing and voxel counts; 100% of declared labels were preserved and at least 95% of the image grid sampled inside the source label volume. Every displayed model was parsed from the source binary VTK surface, fit the image physical bounds, and deterministic mesh vertices were checked against its declared resampled label in a 3x3x3 voxel neighborhood. Unconfirmed upstream meshes are omitted from the 3D viewer."
          : "Image and segmentation NRRD physical spaces, dimensions, origins, and direction matrices matched within 0.0001 mm. Every displayed model was parsed from the source binary VTK surface, fit the image physical bounds, and deterministic mesh vertices were checked against its declared label in a 3x3x3 voxel neighborhood. Unconfirmed upstream meshes are omitted from the 3D viewer.",
        minimumMeshLabelAgreement,
        meshLabelAgreement: meshAgreement,
      },
    };
    await writeFile(path.join(stage, "NOTICE.txt"), `${entry.attribution}\n\n${entry.license}\n${manifest.provenance.licenseUrl}\n\nRISpro Teaching Anatomy educational adaptation. Preserve this notice, UPSTREAM-LICENSE.md, UPSTREAM-SOURCE-LICENSE.md, and UPSTREAM-README.md with these data.\n`, "utf8");
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(path.join(stage, "manifest.json"), manifestText, "utf8");
    await writeFile(path.join(stage, "installed-atlas.json"), `${JSON.stringify({ schemaVersion: "1.1", atlasId, managedVersion: entry.managedVersion, sourceUrl: entry.url, sourceSha256: entry.sha256, manifestSha256: sha256Buffer(Buffer.from(manifestText)).sha256, validationStatus: "passed", installedAt: now().toISOString(), assetCount: Object.keys(assets).length, displayedMeshCount: displayMeshCount, sourceMeshCount: models.length, labelResampling }, null, 2)}\n`, "utf8");
    await activateStage({ target, stage, backup });
    if (!await verifyInstalledOpenAtlas(targetBase, entry)) throw new Error(`${atlasId} failed its post-activation file integrity check.`);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  return { atlasId, structureCount: structureEntries.length + groupEntries.length, meshCount: displayMeshCount, meshCoordinateSystem: chosen.space };
}

function sampledIntensityRange(volume) {
  const voxelCount = volume.sizes.reduce((product, size) => product * size, 1);
  const stride = Math.max(1, Math.floor(voxelCount / 1_000_000));
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < voxelCount; index += stride) {
    const value = readVoxel(volume, index);
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) throw new Error("MRI image volume does not contain a usable intensity range.");
  return { min, max };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [atlasId, sourceDirectory, targetRoot, sourceSha256] = process.argv.slice(2);
    if (!atlasId || !sourceDirectory || !targetRoot) throw new Error("Usage: node install-open-anatomy-atlas.mjs <atlasId> <source-directory> <asset-root> [source-sha256]");
    const result = await installOpenAnatomyAtlas({ atlasId, sourceDirectory, targetRoot, sourceSha256, log: (message) => process.stdout.write(`${message}\n`) });
    process.stdout.write(`Installed ${result.atlasId}: ${result.structureCount} structures, ${result.meshCount} spatially validated meshes, ${result.meshCoordinateSystem} mesh coordinates.\n`);
  } catch (error) {
    process.stderr.write(`Open Anatomy atlas installation failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  }
}
