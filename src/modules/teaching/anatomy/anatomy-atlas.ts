import path from "node:path";

export type AnatomyModality = "CT" | "MRI" | "3D";
export type AnatomyPlane = "axial" | "coronal" | "sagittal";
export type AnatomySpatialValidationStatus = "passed" | "not-applicable";

export interface AnatomyAsset {
  file: string;
  mediaType: string;
  sourceFile?: string;
  integrity?: { sizeBytes: number; sha256: string };
}

export interface AnatomyImagingVolume {
  assetKey: string;
  file: string;
  modality: "CT" | "MRI";
  windowLevel?: { width: number; level: number };
  intensityRange?: { min: number; max: number };
  displayPresets?: Array<{ id: string; label: string; windowLevel?: { width: number; level: number }; intensityRange?: { min: number; max: number } }>;
}

export interface AnatomyStructure {
  id: string;
  labelValue?: number;
  name: string;
  category: string;
  parentId?: string;
  synonyms: string[];
  organ?: string;
  bodyRegion?: string;
  system?: string;
  color: string;
  meshAsset?: string;
  /** Stable atlas links, never inferred from a display name. */
  relatedAtlasIds?: string[];
  /** Precomputed during installation in LPS millimetres. */
  representativePointLps?: [number, number, number];
  sourceConceptId?: string;
  note: string;
}

export interface AnatomyAtlasManifest {
  schemaVersion: "2.0";
  atlasId: string;
  title: string;
  bodyRegion: string;
  organs: string[];
  systems: string[];
  modality: AnatomyModality;
  correlatedImaging: boolean;
  supportedPlanes: AnatomyPlane[];
  initialSlice?: { plane: AnatomyPlane; index: number };
  coordinateSystem: "LPS" | "RAS";
  meshCoordinateSystem: "LPS" | "RAS";
  volumes: {
    primary?: AnatomyImagingVolume;
    segmentation?: { assetKey: string; file: string };
  };
  assets: Record<string, AnatomyAsset>;
  /** Small context geometry for progressive whole-body reference atlases. */
  overviewAsset?: string;
  structures: AnatomyStructure[];
  provenance: {
    sourceRepository: string;
    project: string;
    attribution: string;
    license: string;
    licenseUrl: string;
    use: string;
    citation?: string;
  };
  spatialValidation: {
    status: AnatomySpatialValidationStatus;
    method: string;
    minimumMeshLabelAgreement?: number;
    meshLabelAgreement?: Record<string, number>;
  };
}

const assetKeyPattern = /^[a-z0-9][a-z0-9-]{0,79}$/;
const assetFilenamePattern = /^[A-Za-z0-9][A-Za-z0-9_. -]{0,159}$/;
const structureIdPattern = /^[a-z0-9][a-z0-9-]{0,79}$/;
const supportedExtensions = new Set([".nrrd", ".nii", ".gz", ".stl", ".glb", ".gltf", ".obj", ".ctbl", ".bin", ".json", ".txt"]);
const planes = new Set<AnatomyPlane>(["axial", "coronal", "sagittal"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { return new URL(value).protocol === "https:"; }
  catch { return false; }
}

export function isSafeAnatomyAtlasId(value: unknown): value is string {
  return typeof value === "string" && assetKeyPattern.test(value) && !value.includes("..");
}

function safeAssetFilename(value: unknown): value is string {
  if (typeof value !== "string" || !assetFilenamePattern.test(value) || value.includes("..") || path.basename(value) !== value) return false;
  const extension = path.extname(value).toLowerCase();
  return supportedExtensions.has(extension) || value.toLowerCase().endsWith(".nii.gz");
}

function parseAsset(value: unknown, key: string): AnatomyAsset {
  if (!assetKeyPattern.test(key) || !isRecord(value) || typeof value.mediaType !== "string" || !value.mediaType.trim() || !safeAssetFilename(value.file)) {
    throw new Error(`The anatomy atlas manifest contains an unsafe or invalid asset entry for ${key}.`);
  }
  if (value.sourceFile !== undefined && (typeof value.sourceFile !== "string" || !assetFilenamePattern.test(value.sourceFile) || value.sourceFile.includes("..") || path.basename(value.sourceFile) !== value.sourceFile)) {
    throw new Error(`The anatomy atlas manifest contains an unsafe source filename for ${key}.`);
  }
  let integrity: AnatomyAsset["integrity"];
  if (value.integrity !== undefined) {
    if (!isRecord(value.integrity) || !Number.isSafeInteger(value.integrity.sizeBytes) || Number(value.integrity.sizeBytes) < 1
      || typeof value.integrity.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(value.integrity.sha256)) {
      throw new Error(`The anatomy atlas manifest contains invalid integrity metadata for ${key}.`);
    }
    integrity = { sizeBytes: Number(value.integrity.sizeBytes), sha256: value.integrity.sha256.toLowerCase() };
  }
  return {
    file: value.file,
    mediaType: value.mediaType,
    ...(typeof value.sourceFile === "string" ? { sourceFile: value.sourceFile } : {}),
    ...(integrity ? { integrity } : {}),
  };
}

function parseImageVolume(value: unknown, assets: Record<string, AnatomyAsset>): AnatomyImagingVolume {
  if (!isRecord(value) || typeof value.assetKey !== "string" || !assets[value.assetKey]
    || assets[value.assetKey]?.file !== value.file || typeof value.file !== "string"
    || (value.modality !== "CT" && value.modality !== "MRI")) {
    throw new Error("The anatomy atlas manifest does not declare its primary image volume consistently.");
  }
  const output: AnatomyImagingVolume = {
    assetKey: value.assetKey,
    file: value.file,
    modality: value.modality,
  };
  if (value.windowLevel !== undefined) {
    if (!isRecord(value.windowLevel) || typeof value.windowLevel.width !== "number" || !Number.isFinite(value.windowLevel.width) || value.windowLevel.width <= 0
      || typeof value.windowLevel.level !== "number" || !Number.isFinite(value.windowLevel.level)) {
      throw new Error("The primary image volume has an invalid window and level configuration.");
    }
    output.windowLevel = { width: value.windowLevel.width, level: value.windowLevel.level };
  }
  if (value.intensityRange !== undefined) {
    if (!isRecord(value.intensityRange) || typeof value.intensityRange.min !== "number" || !Number.isFinite(value.intensityRange.min)
      || typeof value.intensityRange.max !== "number" || !Number.isFinite(value.intensityRange.max) || value.intensityRange.max <= value.intensityRange.min) {
      throw new Error("The primary image volume has an invalid intensity range.");
    }
    output.intensityRange = { min: value.intensityRange.min, max: value.intensityRange.max };
  }
  if (value.displayPresets !== undefined) {
    if (!Array.isArray(value.displayPresets) || value.displayPresets.some((preset) => !isRecord(preset) || typeof preset.id !== "string" || !assetKeyPattern.test(preset.id) || typeof preset.label !== "string" || !preset.label.trim())) throw new Error("The primary image volume has invalid display presets.");
    output.displayPresets = value.displayPresets.map((preset) => ({
      id: preset.id as string, label: preset.label as string,
      ...(isRecord(preset.windowLevel) && typeof preset.windowLevel.width === "number" && typeof preset.windowLevel.level === "number" ? { windowLevel: { width: preset.windowLevel.width, level: preset.windowLevel.level } } : {}),
      ...(isRecord(preset.intensityRange) && typeof preset.intensityRange.min === "number" && typeof preset.intensityRange.max === "number" ? { intensityRange: { min: preset.intensityRange.min, max: preset.intensityRange.max } } : {}),
    }));
  }
  if (value.modality === "CT" && output.intensityRange) throw new Error("CT display settings must use Hounsfield window and level values.");
  if (value.modality === "MRI" && output.windowLevel) throw new Error("MRI display settings must use an intensity range, not CT window and level values.");
  return output;
}

function parseStrings(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`The anatomy atlas manifest contains an invalid ${field} list.`);
  }
  const unique = new Set(value.map((item) => item.trim()));
  if (unique.size !== value.length) throw new Error(`The anatomy atlas manifest contains duplicate values in ${field}.`);
  return [...unique];
}

function parseSpatialValidation(value: unknown, structures: AnatomyStructure[], correlatedImaging: boolean): AnatomyAtlasManifest["spatialValidation"] {
  if (!isRecord(value) || typeof value.method !== "string" || !value.method.trim()) {
    throw new Error("The anatomy atlas manifest is missing spatial validation details.");
  }
  if (correlatedImaging) {
    const agreements = value.meshLabelAgreement;
    const minimumAgreement = value.minimumMeshLabelAgreement;
    const invalidMinimum = minimumAgreement !== undefined && (typeof minimumAgreement !== "number" || !Number.isFinite(minimumAgreement) || minimumAgreement < 0 || minimumAgreement > 1);
    const invalidAgreementMap = agreements !== undefined && (!isRecord(agreements)
      || structures.some((structure) => structure.labelValue !== undefined && (
        typeof agreements[structure.id] !== "number" || !Number.isFinite(agreements[structure.id])
        || Number(agreements[structure.id]) < Number(minimumAgreement ?? 0) || Number(agreements[structure.id]) > 1
      ))
      || (isRecord(agreements) && Object.keys(agreements).some((id) => !structures.some((structure) => structure.id === id))));
    if (value.status !== "passed" || invalidMinimum || (minimumAgreement !== undefined && agreements === undefined) || invalidAgreementMap) {
      throw new Error("The correlated anatomy atlas has not recorded successful image, segmentation, and structure spatial validation.");
    }
    return {
      status: "passed",
      method: value.method,
      ...(typeof minimumAgreement === "number" ? { minimumMeshLabelAgreement: minimumAgreement } : {}),
      ...(isRecord(agreements) ? { meshLabelAgreement: agreements as Record<string, number> } : {}),
    };
  }
  if (value.status !== "not-applicable") throw new Error("A 3D reference atlas must identify cross-sectional spatial validation as not applicable.");
  return { status: "not-applicable", method: value.method };
}

function parseV1(value: Record<string, unknown>): AnatomyAtlasManifest {
  if (!isRecord(value.volumes) || !isRecord(value.volumes.ct) || !isRecord(value.volumes.segmentation)) {
    throw new Error("The V1 anatomy atlas does not declare its CT and segmentation volumes.");
  }
  const volumes = value.volumes;
  const ct = volumes.ct;
  const assetsValue = value.assets;
  if (!isRecord(assetsValue)) throw new Error("The V1 anatomy atlas does not declare its assets.");
  const assets = Object.fromEntries(Object.entries(assetsValue).map(([key, asset]) => [key, parseAsset(asset, key)]));
  const modality = value.modality === "CT" ? "CT" : null;
  if (!modality) throw new Error("Only the installed liver V1 CT manifest is supported for backwards compatibility.");
  const oldStructures = Array.isArray(value.structures) ? value.structures : [];
  const legacy = {
    ...value,
    schemaVersion: "2.0",
    modality,
    bodyRegion: "Abdomen",
    organs: ["Liver"],
    systems: ["Gastrointestinal", "Vascular"],
    correlatedImaging: true,
    supportedPlanes: ["axial", "coronal", "sagittal"],
    volumes: {
      primary: {
        assetKey: isRecord(ct) ? ct.assetKey : undefined,
        file: isRecord(ct) ? ct.file : undefined,
        modality,
        windowLevel: { width: 400, level: 40 },
      },
      segmentation: volumes.segmentation,
    },
    structures: oldStructures.map((item) => isRecord(item) ? {
      ...item,
      synonyms: [],
    } : item),
  };
  return parseV2(legacy, assets);
}

function parseV2(value: Record<string, unknown>, suppliedAssets?: Record<string, AnatomyAsset>): AnatomyAtlasManifest {
  if (!isSafeAnatomyAtlasId(value.atlasId) || typeof value.title !== "string" || !value.title.trim()
    || (value.coordinateSystem !== "LPS" && value.coordinateSystem !== "RAS")
    || (value.meshCoordinateSystem !== "LPS" && value.meshCoordinateSystem !== "RAS")
    || !isRecord(value.volumes) || !Array.isArray(value.structures) || !isRecord(value.provenance)) {
    throw new Error("The anatomy atlas manifest is missing required fields or has an unsupported schema version.");
  }
  const modality: AnatomyModality | null = value.modality === "CT" || value.modality === "MRI" || value.modality === "3D" ? value.modality : null;
  if (!modality) throw new Error("The anatomy atlas manifest declares an unsupported modality.");
  const assets = suppliedAssets ?? Object.fromEntries(Object.entries(isRecord(value.assets) ? value.assets : {}).map(([key, asset]) => [key, parseAsset(asset, key)]));
  if (Object.keys(assets).length === 0) throw new Error("The anatomy atlas manifest does not declare any assets.");
  const primary = value.volumes.primary === undefined ? undefined : parseImageVolume(value.volumes.primary, assets);
  let segmentation: AnatomyAtlasManifest["volumes"]["segmentation"];
  if (value.volumes.segmentation !== undefined) {
    const candidate = value.volumes.segmentation;
    if (!isRecord(candidate) || typeof candidate.assetKey !== "string" || !assets[candidate.assetKey]
      || typeof candidate.file !== "string" || assets[candidate.assetKey]?.file !== candidate.file) {
      throw new Error("The anatomy atlas manifest does not declare its segmentation volume consistently.");
    }
    segmentation = { assetKey: candidate.assetKey, file: candidate.file };
  }
  const correlatedImaging = value.correlatedImaging === true;
  if (correlatedImaging && (!primary || !segmentation || (modality !== "CT" && modality !== "MRI"))) {
    throw new Error("A correlated anatomy atlas must declare an image volume, segmentation, and CT or MRI modality.");
  }
  if (!primary && modality !== "3D") throw new Error("A CT or MRI anatomy atlas must declare its primary image volume.");
  if (primary && primary.modality !== modality) throw new Error("The atlas modality does not match its primary image volume.");
  const supportedPlanes = parseStrings(value.supportedPlanes, "supported plane") as AnatomyPlane[];
  if (supportedPlanes.some((plane) => !planes.has(plane))) throw new Error("The anatomy atlas manifest contains an unsupported cross-section plane.");
  if (primary && supportedPlanes.length === 0) throw new Error("An imaging atlas must declare at least one supported cross-section plane.");
  let initialSlice: AnatomyAtlasManifest["initialSlice"];
  if (value.initialSlice !== undefined) {
    if (!isRecord(value.initialSlice) || !planes.has(value.initialSlice.plane as AnatomyPlane)
      || !supportedPlanes.includes(value.initialSlice.plane as AnatomyPlane) || !Number.isSafeInteger(value.initialSlice.index)
      || Number(value.initialSlice.index) < 0) {
      throw new Error("The anatomy atlas manifest contains an invalid initial slice.");
    }
    initialSlice = { plane: value.initialSlice.plane as AnatomyPlane, index: Number(value.initialSlice.index) };
  }

  const seenIds = new Set<string>();
  const seenLabels = new Set<number>();
  const structures = value.structures.map((rawStructure): AnatomyStructure => {
    if (!isRecord(rawStructure) || typeof rawStructure.id !== "string" || !structureIdPattern.test(rawStructure.id)
      || seenIds.has(rawStructure.id) || typeof rawStructure.name !== "string" || !rawStructure.name.trim()
      || typeof rawStructure.category !== "string" || !rawStructure.category.trim()
      || typeof rawStructure.color !== "string" || !/^#[0-9a-f]{6}$/i.test(rawStructure.color)
      || (rawStructure.labelValue !== undefined && (!Number.isSafeInteger(rawStructure.labelValue) || Number(rawStructure.labelValue) < 1 || seenLabels.has(Number(rawStructure.labelValue))))
      || (rawStructure.meshAsset !== undefined && (typeof rawStructure.meshAsset !== "string" || !assets[rawStructure.meshAsset] || !assets[rawStructure.meshAsset]?.mediaType.startsWith("model/")))
      || (rawStructure.parentId !== undefined && (typeof rawStructure.parentId !== "string" || !structureIdPattern.test(rawStructure.parentId)))
      || (rawStructure.note !== undefined && typeof rawStructure.note !== "string")) {
      throw new Error("The anatomy atlas manifest contains an invalid or duplicate structure entry.");
    }
    seenIds.add(rawStructure.id);
    if (rawStructure.labelValue !== undefined) seenLabels.add(Number(rawStructure.labelValue));
    return {
      id: rawStructure.id,
      ...(rawStructure.labelValue !== undefined ? { labelValue: Number(rawStructure.labelValue) } : {}),
      name: rawStructure.name,
      category: rawStructure.category,
      ...(typeof rawStructure.parentId === "string" ? { parentId: rawStructure.parentId } : {}),
      synonyms: parseStrings(rawStructure.synonyms, `synonyms for ${rawStructure.id}`),
      ...(typeof rawStructure.organ === "string" ? { organ: rawStructure.organ } : {}),
      ...(typeof rawStructure.bodyRegion === "string" ? { bodyRegion: rawStructure.bodyRegion } : {}),
      ...(typeof rawStructure.system === "string" ? { system: rawStructure.system } : {}),
      color: rawStructure.color,
      ...(typeof rawStructure.meshAsset === "string" ? { meshAsset: rawStructure.meshAsset } : {}),
      ...(rawStructure.relatedAtlasIds === undefined ? {} : { relatedAtlasIds: parseStrings(rawStructure.relatedAtlasIds, `related atlas IDs for ${rawStructure.id}`).map((atlasId) => {
        if (!isSafeAnatomyAtlasId(atlasId)) throw new Error(`The anatomy structure ${rawStructure.id} has an invalid related atlas ID.`);
        return atlasId;
      }) }),
      ...(rawStructure.representativePointLps === undefined ? {} : { representativePointLps: (() => {
        if (!Array.isArray(rawStructure.representativePointLps) || rawStructure.representativePointLps.length !== 3 || rawStructure.representativePointLps.some((point) => typeof point !== "number" || !Number.isFinite(point))) throw new Error(`The anatomy structure ${rawStructure.id} has an invalid representative LPS point.`);
        return rawStructure.representativePointLps as [number, number, number];
      })() }),
      ...(typeof rawStructure.sourceConceptId === "string" && rawStructure.sourceConceptId.trim() ? { sourceConceptId: rawStructure.sourceConceptId } : {}),
      note: typeof rawStructure.note === "string" ? rawStructure.note : "",
    };
  });
  if (structures.length === 0) throw new Error("The anatomy atlas manifest does not declare any structures.");
  const structureById = new Map(structures.map((structure) => [structure.id, structure]));
  for (const structure of structures) {
    if (structure.parentId && !seenIds.has(structure.parentId)) throw new Error(`The anatomy structure ${structure.id} references an unknown parent.`);
    const visited = new Set([structure.id]);
    let parentId = structure.parentId;
    while (parentId) {
      if (visited.has(parentId)) throw new Error("The anatomy structure hierarchy contains a cycle.");
      visited.add(parentId);
      parentId = structureById.get(parentId)?.parentId;
    }
    if (correlatedImaging && structure.meshAsset && structure.labelValue === undefined) throw new Error(`The correlated atlas mesh ${structure.id} has no segmentation label value.`);
    if (structure.meshAsset && !assets[structure.meshAsset]) throw new Error(`The anatomy structure ${structure.id} references an undeclared mesh.`);
  }

  for (const field of ["sourceRepository", "project", "attribution", "license", "licenseUrl", "use"] as const) {
    if (typeof value.provenance[field] !== "string" || !value.provenance[field].trim()) {
      throw new Error(`The anatomy atlas manifest is missing provenance field ${field}.`);
    }
  }
  const provenance = {
    sourceRepository: value.provenance.sourceRepository as string,
    project: value.provenance.project as string,
    attribution: value.provenance.attribution as string,
    license: value.provenance.license as string,
    licenseUrl: value.provenance.licenseUrl as string,
    use: value.provenance.use as string,
    ...(typeof value.provenance.citation === "string" ? { citation: value.provenance.citation } : {}),
  };
  if (!isHttpsUrl(provenance.sourceRepository) || !isHttpsUrl(provenance.licenseUrl)
    || (provenance.citation !== undefined && !isHttpsUrl(provenance.citation))) {
    throw new Error("The anatomy atlas manifest provenance links must use HTTPS.");
  }
  const spatialValidation = parseSpatialValidation(value.spatialValidation, structures, correlatedImaging);
  const overviewAsset = typeof value.overviewAsset === "string" ? value.overviewAsset : undefined;
  if (overviewAsset && (!assets[overviewAsset] || !assets[overviewAsset].mediaType.startsWith("model/"))) throw new Error("The anatomy overview asset is not declared as a model.");

  return {
    schemaVersion: "2.0",
    atlasId: value.atlasId,
    title: value.title,
    bodyRegion: typeof value.bodyRegion === "string" ? value.bodyRegion : "Unspecified",
    organs: parseStrings(value.organs, "organ"),
    systems: parseStrings(value.systems, "system"),
    modality,
    correlatedImaging,
    supportedPlanes,
    ...(initialSlice ? { initialSlice } : {}),
    coordinateSystem: value.coordinateSystem,
    meshCoordinateSystem: value.meshCoordinateSystem,
    volumes: { ...(primary ? { primary } : {}), ...(segmentation ? { segmentation } : {}) },
    assets,
    ...(overviewAsset ? { overviewAsset } : {}),
    structures,
    provenance,
    spatialValidation,
  };
}

export function parseAnatomyAtlasManifest(value: unknown): AnatomyAtlasManifest {
  if (!isRecord(value)) throw new Error("The anatomy atlas manifest is not a JSON object.");
  if (value.schemaVersion === "1.0") return parseV1(value);
  if (value.schemaVersion === "2.0") return parseV2(value);
  throw new Error("The anatomy atlas manifest is missing required fields or has an unsupported schema version.");
}

export function anatomyAssetPath(root: string, manifest: AnatomyAtlasManifest, assetKey: string): string {
  if (!assetKeyPattern.test(assetKey) || assetKey.includes("..")) throw new Error("Invalid anatomy asset key.");
  const asset = manifest.assets[assetKey];
  if (!asset || !safeAssetFilename(asset.file)) throw new Error("Anatomy asset is not declared in the atlas manifest.");
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, asset.file);
  if (path.dirname(target) !== resolvedRoot) throw new Error("Anatomy asset path is outside the atlas directory.");
  return target;
}
