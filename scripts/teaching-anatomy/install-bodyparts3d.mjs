#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const lockPath = path.join(scriptDirectory, "open-atlas-sources.lock.json");
const archiveRoot = "partof_BP3D_4.0_obj_99";
const expectedAttribution = "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International";

function safeRelativePath(value, name) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.startsWith("/")) throw new Error(`${name} must be a safe POSIX relative path.`);
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /^[A-Za-z]:/.test(part))) throw new Error(`${name} contains an unsafe path component.`);
  return value;
}

function inside(root, relativePath, name) {
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, ...safeRelativePath(relativePath, name).split("/"));
  if (!target.startsWith(`${absoluteRoot}${path.sep}`)) throw new Error(`${name} resolves outside its expected directory.`);
  return target;
}

function slug(value) {
  const normalized = String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 68);
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(normalized)) throw new Error(`BodyParts3D structure ID cannot be normalized: ${value}`);
  return normalized;
}

function parseTsv(text, expectedColumns, filename) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length > 0);
  if (!lines.length || lines[0].split("\t").length !== expectedColumns) throw new Error(`${filename} has an unsupported tab-separated header.`);
  const header = lines[0].split("\t");
  if (lines.slice(1).some((line) => line.split("\t").length !== expectedColumns)) throw new Error(`${filename} contains an incomplete tab-separated row.`);
  return { header, rows: lines.slice(1).map((line) => line.split("\t")) };
}

function parseObjGeometry(buffer, filename) {
  const text = buffer.toString("utf8");
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  let vertices = 0;
  let faces = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const tokens = line.split(/\s+/);
    if (tokens[0] === "v") {
      if (tokens.length < 4) throw new Error(`${filename} contains an incomplete OBJ vertex.`);
      const point = tokens.slice(1, 4).map(Number);
      if (point.some((coordinate) => !Number.isFinite(coordinate))) throw new Error(`${filename} contains a non-finite coordinate.`);
      for (let axis = 0; axis < 3; axis += 1) {
        bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
        bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
      }
      vertices += 1;
    } else if (tokens[0] === "f") {
      if (tokens.length < 4) throw new Error(`${filename} contains a face with fewer than three vertices.`);
      for (const token of tokens.slice(1)) {
        const rawIndex = Number(token.split("/", 1)[0]);
        if (!Number.isInteger(rawIndex) || rawIndex === 0 || (rawIndex > 0 && rawIndex > vertices) || (rawIndex < 0 && Math.abs(rawIndex) > vertices)) {
          throw new Error(`${filename} contains an OBJ face index outside its vertex list.`);
        }
      }
      faces += 1;
    }
  }
  if (vertices < 3 || faces === 0 || bounds.min.some((coordinate) => !Number.isFinite(coordinate))) throw new Error(`${filename} contains no usable polygon surface.`);
  if (bounds.min.some((coordinate, axis) => Math.abs(coordinate) > 2000 || Math.abs(bounds.max[axis]) > 2000)) throw new Error(`${filename} is outside the BodyParts3D millimeter coordinate range.`);
  return { bounds, vertices, faces };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function activateStage(target, stage, backup) {
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

async function sourceLock() {
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const source = lock.bodyParts3d;
  if (lock.schemaVersion !== "1.0" || source?.atlasId !== "bodyparts3d" || source.attribution !== expectedAttribution
    || !Number.isSafeInteger(source.archive?.sizeBytes) || !/^[a-f0-9]{64}$/.test(source.archive?.sha256 ?? "")
    || !Array.isArray(source.metadata) || source.metadata.length !== 3) throw new Error("BodyParts3D pinned source lock is invalid.");
  return source;
}

export async function verifyInstalledBodyParts3d(targetRoot, source) {
  const directory = path.join(path.resolve(targetRoot), source.atlasId);
  try {
    const [metadata, manifest] = await Promise.all([
      readFile(path.join(directory, "installed-atlas.json"), "utf8").then(JSON.parse),
      readFile(path.join(directory, "manifest.json"), "utf8").then(JSON.parse),
    ]);
    if (metadata.atlasId !== source.atlasId || metadata.managedVersion !== source.managedVersion || metadata.sourceSha256 !== source.archive.sha256
      || manifest.atlasId !== source.atlasId || manifest.spatialValidation?.status !== "not-applicable") return false;
    for (const asset of Object.values(manifest.assets ?? {})) {
      if (!asset.integrity || !/^[a-f0-9]{64}$/.test(asset.integrity.sha256)) return false;
      const buffer = await readFile(inside(directory, asset.file, "Installed BodyParts3D mesh"));
      if (buffer.length !== asset.integrity.sizeBytes || sha256(buffer) !== asset.integrity.sha256) return false;
    }
    return true;
  } catch { return false; }
}

export async function installBodyParts3d({ sourceDirectory, targetRoot, sourceSha256, now = () => new Date(), log = () => undefined }) {
  const source = await sourceLock();
  if (sourceSha256 && sourceSha256.toLowerCase() !== source.archive.sha256) throw new Error("BodyParts3D archive does not match its pinned SHA-256.");
  const modelDirectory = inside(sourceDirectory, archiveRoot, "BodyParts3D OBJ archive root");
  const metadataBuffers = await Promise.all(source.metadata.map(async (item) => {
    safeRelativePath(item.name, "BodyParts3D metadata filename");
    const buffer = await readFile(inside(sourceDirectory, item.name, "BodyParts3D metadata"));
    if (buffer.length !== item.sizeBytes || sha256(buffer) !== item.sha256) throw new Error(`BodyParts3D metadata checksum failed for ${item.name}.`);
    return { name: item.name, buffer };
  }));
  const metadata = new Map(metadataBuffers.map(({ name, buffer }) => [name, buffer.toString("utf8")]));
  const conceptTable = parseTsv(metadata.get("partof_parts_list_e.txt"), 3, "partof_parts_list_e.txt");
  const relationTable = parseTsv(metadata.get("partof_inclusion_relation_list.txt"), 4, "partof_inclusion_relation_list.txt");
  const elementTable = parseTsv(metadata.get("partof_element_parts.txt"), 3, "partof_element_parts.txt");
  if (conceptTable.header.join("\t") !== "concept id\trepresentation id\ten"
    || relationTable.header.join("\t") !== "parent id\tparent name\tchild id\tchild name"
    || elementTable.header.join("\t") !== "concept id\tname\telement file id") throw new Error("BodyParts3D metadata headers changed from their pinned PART-OF schema.");

  const concepts = new Map();
  for (const [conceptId, _representationId, name] of conceptTable.rows) {
    if (!/^FMA\d+$/.test(conceptId) || !name.trim() || concepts.has(conceptId)) throw new Error(`BodyParts3D concept row ${conceptId} is invalid or duplicated.`);
    concepts.set(conceptId, { conceptId, name: name.trim(), elementIds: new Set() });
  }
  const parentByChild = new Map();
  for (const [parentId, parentName, childId, childName] of relationTable.rows) {
    if (!concepts.has(parentId) || !concepts.has(childId) || concepts.get(parentId).name !== parentName || concepts.get(childId).name !== childName
      || parentByChild.has(childId)) throw new Error(`BodyParts3D PART-OF relationship ${parentId} -> ${childId} is invalid or ambiguous.`);
    parentByChild.set(childId, parentId);
  }
  const elementConceptsById = new Map();
  for (const [conceptId, name, elementId] of elementTable.rows) {
    if (!concepts.has(conceptId) || concepts.get(conceptId).name !== name || !/^FJ\d+M?$/.test(elementId)) throw new Error(`BodyParts3D element mapping for ${elementId} is invalid.`);
    concepts.get(conceptId).elementIds.add(elementId);
    if (!elementConceptsById.has(elementId)) elementConceptsById.set(elementId, new Set());
    elementConceptsById.get(elementId).add(conceptId);
  }

  const depthMemo = new Map();
  const conceptDepth = (conceptId, active = new Set()) => {
    if (depthMemo.has(conceptId)) return depthMemo.get(conceptId);
    if (active.has(conceptId)) throw new Error("BodyParts3D PART-OF relationships contain a cycle.");
    const parent = parentByChild.get(conceptId);
    const depth = parent ? conceptDepth(parent, new Set([...active, conceptId])) + 1 : 0;
    depthMemo.set(conceptId, depth);
    return depth;
  };
  for (const conceptId of concepts.keys()) conceptDepth(conceptId);

  const entries = await readdir(modelDirectory, { withFileTypes: true });
  const modelNames = entries.filter((item) => item.isFile() && /^FJ\d+M?\.obj$/i.test(item.name)).map((item) => item.name).sort();
  const modelIds = new Set(modelNames.map((name) => path.parse(name).name));
  if (modelNames.length !== elementConceptsById.size || [...elementConceptsById.keys()].some((elementId) => !modelIds.has(elementId))) {
    throw new Error("BodyParts3D OBJ files and the official element mapping table do not contain the same model IDs.");
  }

  const targetRootAbsolute = path.resolve(targetRoot);
  await mkdir(targetRootAbsolute, { recursive: true });
  const stage = path.join(targetRootAbsolute, `.bodyparts3d-stage-${process.pid}-${randomBytes(6).toString("hex")}`);
  const target = path.join(targetRootAbsolute, source.atlasId);
  const backup = path.join(targetRootAbsolute, `.bodyparts3d-backup-${process.pid}-${randomBytes(6).toString("hex")}`);
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true, mode: 0o700 });
  try {
    const assets = {};
    const fmaStructureIds = new Map([...concepts.keys()].map((conceptId) => [conceptId, `fma-${conceptId.slice(3)}`]));
    const chosenConceptByElement = new Map();
    for (const [elementId, candidateSet] of elementConceptsById) {
      const chosenConceptId = [...candidateSet].sort((left, right) => conceptDepth(right) - conceptDepth(left) || left.localeCompare(right))[0];
      chosenConceptByElement.set(elementId, chosenConceptId);
    }
    const structureByConcept = new Map();
    const structures = [];
    for (const [conceptId, concept] of concepts) {
      const meshIds = [...concept.elementIds];
      const singleElement = meshIds.length === 1 ? meshIds[0] : null;
      const ownsSingleElement = singleElement && chosenConceptByElement.get(singleElement) === conceptId;
      const structure = {
        id: fmaStructureIds.get(conceptId),
        name: concept.name,
        category: "BodyParts3D PART-OF anatomy",
        ...(parentByChild.has(conceptId) ? { parentId: fmaStructureIds.get(parentByChild.get(conceptId)) } : {}),
        synonyms: [],
        color: "#b9c3d1",
        ...(ownsSingleElement ? { meshAsset: `model-${singleElement.toLowerCase()}` } : {}),
        note: ownsSingleElement ? `Source geometry ${singleElement} is one PART-OF surface for this anatomical concept.` : "PART-OF anatomical concept; select a child surface model to view geometry.",
      };
      structureByConcept.set(conceptId, structure);
      structures.push(structure);
    }

    const allBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    let totalVertices = 0;
    let totalFaces = 0;
    for (let index = 0; index < modelNames.length; index += 1) {
      const modelName = modelNames[index];
      const elementId = path.parse(modelName).name;
      const buffer = await readFile(inside(sourceDirectory, `${archiveRoot}/${modelName}`, "BodyParts3D OBJ model"));
      const geometry = parseObjGeometry(buffer, modelName);
      const assetKey = `model-${elementId.toLowerCase()}`;
      assets[assetKey] = { file: modelName, sourceFile: `${archiveRoot}/${modelName}`, mediaType: "model/obj", integrity: { sizeBytes: buffer.length, sha256: sha256(buffer) } };
      await writeFile(path.join(stage, modelName), buffer, { mode: 0o600 });
      for (let axis = 0; axis < 3; axis += 1) {
        allBounds.min[axis] = Math.min(allBounds.min[axis], geometry.bounds.min[axis]);
        allBounds.max[axis] = Math.max(allBounds.max[axis], geometry.bounds.max[axis]);
      }
      totalVertices += geometry.vertices;
      totalFaces += geometry.faces;

      const conceptId = chosenConceptByElement.get(elementId);
      if (!conceptId) throw new Error(`BodyParts3D mesh ${elementId} has no official anatomical concept mapping.`);
      if (structureByConcept.get(conceptId).meshAsset === assetKey) {
        // The one-mesh concept node already represents this OBJ.
      } else {
        const concept = concepts.get(conceptId);
        const allNames = [...elementConceptsById.get(elementId)].map((id) => concepts.get(id).name).filter((name) => name !== concept.name);
        structures.push({
          id: `element-${elementId.toLowerCase()}`,
          name: `${concept.name} surface (${elementId})`,
          category: "BodyParts3D component surfaces",
          parentId: fmaStructureIds.get(conceptId),
          synonyms: [...new Set([elementId, ...allNames])].slice(0, 40),
          color: "#a7b4c5",
          meshAsset: assetKey,
          note: `This OBJ surface ${elementId} is listed under ${concept.name} in the official BodyParts3D PART-OF element mapping table.`,
        });
      }
      if ((index + 1) % 100 === 0 || index + 1 === modelNames.length) log(`[progress] BodyParts3D: validated and staged ${index + 1}/${modelNames.length} OBJ surfaces.`);
    }
    if (allBounds.min[2] < -250 || allBounds.max[2] < 1000 || allBounds.max[2] > 2500) throw new Error("BodyParts3D global millimeter bounds do not match the upright whole-body coordinate range.");
    const bodyRoot = [...concepts.values()].find((concept) => concept.name.toLocaleLowerCase() === "human body");
    if (!bodyRoot || structures.length < modelNames.length) throw new Error("BodyParts3D model hierarchy is incomplete.");

    const [partsList, relationships, elementParts] = metadataBuffers;
    for (const [filename, buffer] of [["partof_parts_list_e.txt", partsList.buffer], ["partof_inclusion_relation_list.txt", relationships.buffer], ["partof_element_parts.txt", elementParts.buffer]]) {
      await writeFile(path.join(stage, `UPSTREAM-${filename}`), buffer, { mode: 0o600 });
    }
    const manifest = {
      schemaVersion: "2.0",
      atlasId: source.atlasId,
      title: source.title,
      bodyRegion: "Whole body",
      organs: ["Brain", "Heart", "Lung", "Liver", "Kidney", "Pancreas", "Prostate", "Knee"],
      systems: ["Nervous", "Cardiovascular", "Respiratory", "Digestive", "Urinary", "Reproductive", "Skeletal", "Muscular"],
      modality: "3D",
      correlatedImaging: false,
      supportedPlanes: [],
      coordinateSystem: "LPS",
      meshCoordinateSystem: "LPS",
      volumes: {},
      assets,
      structures,
      provenance: {
        sourceRepository: source.sourceRepository,
        project: "BodyParts3D 4.0 PART-OF tree, 99% reduced Wavefront OBJ surfaces",
        attribution: source.attribution,
        license: "Creative Commons Attribution 4.0 International (CC BY 4.0). The exact attribution is required when this dataset or adapted material is distributed.",
        licenseUrl: source.licenseUrl,
        use: "Adapted as an internal RISpro Teaching educational reference. These healthy adult male reference surfaces are not patient-specific and are not registered to the regional CT/MRI atlases.",
        citation: source.citation,
      },
      spatialValidation: {
        status: "not-applicable",
        method: `BodyParts3D release 4.0 source coordinates are preserved as LPS millimeters: positive X is left, positive Y is posterior, positive Z is superior, and the body centerline follows Z. The official diagram's note that every Z coordinate is positive does not match some source OBJ headers near the feet, so RISpro preserves source coordinates without rebasing. ${modelNames.length} OBJ IDs were matched one-to-one with the official PART-OF element table; each model's finite vertices and polygon indices were validated. Global bounds were X ${allBounds.min[0].toFixed(1)}..${allBounds.max[0].toFixed(1)} mm, Y ${allBounds.min[1].toFixed(1)}..${allBounds.max[1].toFixed(1)} mm, Z ${allBounds.min[2].toFixed(1)}..${allBounds.max[2].toFixed(1)} mm, with ${totalVertices} vertices and ${totalFaces} polygon faces. This independent whole-body model has no image/segmentation registration.`,
      },
    };
    await writeFile(path.join(stage, "NOTICE.txt"), `${source.attribution}\n\n${source.license}\n${source.licenseUrl}\n\nDataset: ${source.managedVersion}. Preserve this notice and the UPSTREAM metadata tables with any copy of these data.\n`, "utf8");
    await writeFile(path.join(stage, "UPSTREAM-LICENSE.txt"), `BodyParts3D is licensed under CC BY 4.0. Terms and required attribution: ${source.licenseUrl}\nRequired attribution: ${source.attribution}\n`, "utf8");
    await writeFile(path.join(stage, "SOURCE-ARCHIVE.json"), `${JSON.stringify({ sourceUrl: source.archive.url, archiveSha256: source.archive.sha256, archiveSizeBytes: source.archive.sizeBytes, managedVersion: source.managedVersion, coordinateSystem: "LPS millimeters" }, null, 2)}\n`, "utf8");
    await writeFile(path.join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeFile(path.join(stage, "installed-atlas.json"), `${JSON.stringify({ schemaVersion: "1.0", atlasId: source.atlasId, managedVersion: source.managedVersion, sourceUrl: source.archive.url, sourceSha256: source.archive.sha256, installedAt: now().toISOString(), meshCount: modelNames.length, structureCount: structures.length, vertexCount: totalVertices, faceCount: totalFaces }, null, 2)}\n`, "utf8");
    await activateStage(target, stage, backup);
    if (!await verifyInstalledBodyParts3d(targetRootAbsolute, source)) throw new Error("BodyParts3D failed its post-activation file integrity check.");
    return { atlasId: source.atlasId, meshCount: modelNames.length, structureCount: structures.length, totalVertices, totalFaces, bounds: allBounds };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [sourceDirectory, targetRoot, sourceSha256] = process.argv.slice(2);
    if (!sourceDirectory || !targetRoot) throw new Error("Usage: node install-bodyparts3d.mjs <source-directory> <asset-root> [source-sha256]");
    const result = await installBodyParts3d({ sourceDirectory, targetRoot, sourceSha256, log: (message) => process.stdout.write(`${message}\n`) });
    process.stdout.write(`Installed ${result.atlasId}: ${result.meshCount} models, ${result.structureCount} searchable structures, ${result.totalVertices} vertices, ${result.totalFaces} faces.\n`);
  } catch (error) {
    process.stderr.write(`BodyParts3D installation failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  }
}
