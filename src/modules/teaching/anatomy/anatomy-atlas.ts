import path from "node:path";

export interface AnatomyAsset {
  file: string;
  mediaType: string;
  sourceFile?: string;
}

export interface AnatomyStructure {
  id: string;
  labelValue: number;
  name: string;
  category: string;
  color: string;
  meshAsset: string;
  note: string;
}

export interface AnatomyAtlasManifest {
  schemaVersion: "1.0";
  atlasId: string;
  title: string;
  modality: string;
  coordinateSystem: "LPS" | "RAS";
  meshCoordinateSystem: "LPS" | "RAS";
  volumes: {
    ct: { assetKey: string; file: string };
    segmentation: { assetKey: string; file: string };
  };
  assets: Record<string, AnatomyAsset>;
  structures: AnatomyStructure[];
  provenance: {
    sourceRepository: string;
    project: string;
    attribution: string;
    license: string;
    licenseUrl: string;
    use: string;
  };
  spatialValidation: {
    status: "passed";
    method: string;
    minimumMeshLabelAgreement: number;
    meshLabelAgreement: Record<string, number>;
  };
}

const assetKeyPattern = /^[a-z0-9][a-z0-9-]{0,79}$/;
const assetFilenamePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/;
const structureIdPattern = /^[a-z0-9][a-z0-9-]{0,79}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeAssetFilename(value: unknown, expectedExtension: ".nrrd" | ".stl" | ".ctbl"): value is string {
  return typeof value === "string"
    && assetFilenamePattern.test(value)
    && value !== "."
    && value !== ".."
    && !value.includes("..")
    && value.toLowerCase().endsWith(expectedExtension);
}

export function parseAnatomyAtlasManifest(value: unknown): AnatomyAtlasManifest {
  if (!isRecord(value) || value.schemaVersion !== "1.0" || typeof value.atlasId !== "string"
    || typeof value.title !== "string" || typeof value.modality !== "string"
    || (value.coordinateSystem !== "LPS" && value.coordinateSystem !== "RAS")
    || (value.meshCoordinateSystem !== "LPS" && value.meshCoordinateSystem !== "RAS")
    || !isRecord(value.volumes) || !isRecord(value.volumes.ct) || !isRecord(value.volumes.segmentation)
    || !isRecord(value.assets) || !Array.isArray(value.structures) || !isRecord(value.provenance)
    || !isRecord(value.spatialValidation)) {
    throw new Error("The anatomy atlas manifest is missing required fields or has an unsupported schema version.");
  }

  const assets: Record<string, AnatomyAsset> = {};
  for (const [key, rawAsset] of Object.entries(value.assets)) {
    if (!assetKeyPattern.test(key) || !isRecord(rawAsset) || typeof rawAsset.mediaType !== "string") {
      throw new Error(`The anatomy atlas manifest contains an invalid asset entry: ${key}.`);
    }
    const extension = key === "ct" || key === "labels" ? ".nrrd" : key === "colors" ? ".ctbl" : ".stl";
    if (!safeAssetFilename(rawAsset.file, extension)) {
      throw new Error(`The anatomy atlas manifest contains an unsafe asset filename for ${key}.`);
    }
    if (rawAsset.sourceFile !== undefined && !safeAssetFilename(rawAsset.sourceFile, extension)) {
      throw new Error(`The anatomy atlas manifest contains an unsafe source filename for ${key}.`);
    }
    assets[key] = {
      file: rawAsset.file,
      mediaType: rawAsset.mediaType,
      ...(typeof rawAsset.sourceFile === "string" ? { sourceFile: rawAsset.sourceFile } : {}),
    };
  }

  const ctVolume = value.volumes.ct;
  const labelVolume = value.volumes.segmentation;
  if (typeof ctVolume.assetKey !== "string" || typeof labelVolume.assetKey !== "string"
    || !assets[ctVolume.assetKey] || !assets[labelVolume.assetKey]
    || assets[ctVolume.assetKey]?.file !== ctVolume.file || assets[labelVolume.assetKey]?.file !== labelVolume.file
    || ctVolume.assetKey !== "ct" || labelVolume.assetKey !== "labels") {
    throw new Error("The anatomy atlas manifest does not declare its CT and segmentation assets consistently.");
  }

  const seenIds = new Set<string>();
  const seenLabels = new Set<number>();
  const structures = value.structures.map((rawStructure): AnatomyStructure => {
    if (!isRecord(rawStructure) || typeof rawStructure.id !== "string" || !structureIdPattern.test(rawStructure.id)
      || seenIds.has(rawStructure.id) || !Number.isSafeInteger(rawStructure.labelValue) || Number(rawStructure.labelValue) < 1
      || seenLabels.has(Number(rawStructure.labelValue)) || typeof rawStructure.name !== "string"
      || typeof rawStructure.category !== "string" || typeof rawStructure.color !== "string"
      || !/^#[0-9a-f]{6}$/i.test(rawStructure.color) || typeof rawStructure.meshAsset !== "string"
      || !assets[rawStructure.meshAsset] || assets[rawStructure.meshAsset]?.mediaType !== "model/stl"
      || typeof rawStructure.note !== "string") {
      throw new Error("The anatomy atlas manifest contains an invalid or duplicate structure entry.");
    }
    seenIds.add(rawStructure.id);
    seenLabels.add(Number(rawStructure.labelValue));
    return {
      id: rawStructure.id,
      labelValue: Number(rawStructure.labelValue),
      name: rawStructure.name,
      category: rawStructure.category,
      color: rawStructure.color,
      meshAsset: rawStructure.meshAsset,
      note: rawStructure.note,
    };
  });
  if (structures.length === 0) throw new Error("The anatomy atlas manifest does not declare any structures.");

  const provenance = value.provenance;
  for (const field of ["sourceRepository", "project", "attribution", "license", "licenseUrl", "use"] as const) {
    if (typeof provenance[field] !== "string" || provenance[field].trim().length === 0) {
      throw new Error(`The anatomy atlas manifest is missing provenance field ${field}.`);
    }
  }
  const minimumAgreement = value.spatialValidation.minimumMeshLabelAgreement;
  const agreements = value.spatialValidation.meshLabelAgreement;
  if (value.spatialValidation.status !== "passed" || typeof value.spatialValidation.method !== "string"
    || typeof minimumAgreement !== "number" || minimumAgreement < 0 || minimumAgreement > 1
    || !isRecord(agreements) || structures.some((structure) => typeof agreements[structure.id] !== "number"
      || Number(agreements[structure.id]) < minimumAgreement || Number(agreements[structure.id]) > 1)) {
    throw new Error("The atlas installer has not recorded successful CT, label-map, and mesh spatial validation.");
  }

  return {
    schemaVersion: "1.0",
    atlasId: String(value.atlasId),
    title: String(value.title),
    modality: String(value.modality),
    coordinateSystem: value.coordinateSystem,
    meshCoordinateSystem: value.meshCoordinateSystem,
    volumes: {
      ct: { assetKey: ctVolume.assetKey, file: ctVolume.file },
      segmentation: { assetKey: labelVolume.assetKey, file: labelVolume.file },
    },
    assets,
    structures,
    provenance: provenance as AnatomyAtlasManifest["provenance"],
    spatialValidation: value.spatialValidation as AnatomyAtlasManifest["spatialValidation"],
  };
}

export function anatomyAssetPath(root: string, manifest: AnatomyAtlasManifest, assetKey: string): string {
  if (!assetKeyPattern.test(assetKey) || assetKey.includes("..")) {
    throw new Error("Invalid anatomy asset key.");
  }
  const asset = manifest.assets[assetKey];
  const extension = assetKey === "ct" || assetKey === "labels" ? ".nrrd" : assetKey === "colors" ? ".ctbl" : ".stl";
  if (!asset || !safeAssetFilename(asset.file, extension)) {
    throw new Error("Anatomy asset is not declared in the atlas manifest.");
  }
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, asset.file);
  if (path.dirname(target) !== resolvedRoot) throw new Error("Anatomy asset path is outside the atlas directory.");
  return target;
}
