import { fetchTeachingAnatomyAtlasAsset, type TeachingAnatomyManifest } from "../api/teaching-api";
import { parseAnatomyNrrd, validateAnatomyGeometry, validateCompatibleAnatomyGeometry, validateStructureLabels, type ParsedAnatomyNrrd } from "./anatomy-nrrd";

export interface LoadedAnatomyVolumes {
  primary: ParsedAnatomyNrrd | null;
  segmentation: ParsedAnatomyNrrd | null;
}

export async function loadTeachingAnatomyVolumes(manifest: TeachingAnatomyManifest, signal?: AbortSignal): Promise<LoadedAnatomyVolumes> {
  const primaryVolume = manifest.volumes.primary;
  const segmentationVolume = manifest.volumes.segmentation;
  if (!primaryVolume) return { primary: null, segmentation: null };
  const primaryBuffer = await fetchTeachingAnatomyAtlasAsset(manifest.atlasId, primaryVolume.assetKey, signal, manifest.assets[primaryVolume.assetKey]?.integrity?.sha256);
  const primary = await parseAnatomyNrrd(primaryBuffer);
  validateAnatomyGeometry(primary.geometry);
  if (primary.geometry.coordinateSystem !== manifest.coordinateSystem) {
    throw new Error(`The ${primaryVolume.modality} volume declares ${primary.geometry.coordinateSystem} coordinates but the manifest declares ${manifest.coordinateSystem}.`);
  }
  if (!segmentationVolume) return { primary, segmentation: null };
  const labelBuffer = await fetchTeachingAnatomyAtlasAsset(manifest.atlasId, segmentationVolume.assetKey, signal, manifest.assets[segmentationVolume.assetKey]?.integrity?.sha256);
  const segmentation = await parseAnatomyNrrd(labelBuffer);
  validateCompatibleAnatomyGeometry(primary.geometry, segmentation.geometry);
  const labeledStructures = manifest.structures.filter((structure): structure is typeof structure & { labelValue: number } => structure.labelValue !== undefined);
  validateStructureLabels(segmentation.data, labeledStructures);
  return { primary, segmentation };
}
