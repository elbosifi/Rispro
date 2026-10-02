import { fetchTeachingAnatomyAsset, type TeachingAnatomyManifest } from "../api/teaching-api";
import { parseAnatomyNrrd, validateAxialAnatomyGeometry, validateCompatibleAnatomyGeometry, validateStructureLabels, type ParsedAnatomyNrrd } from "./anatomy-nrrd";

export interface LoadedAnatomyVolumes {
  ct: ParsedAnatomyNrrd;
  segmentation: ParsedAnatomyNrrd;
}

export async function loadTeachingAnatomyVolumes(manifest: TeachingAnatomyManifest, signal?: AbortSignal): Promise<LoadedAnatomyVolumes> {
  const ctBuffer = await fetchTeachingAnatomyAsset(manifest.volumes.ct.assetKey, signal);
  const ct = await parseAnatomyNrrd(ctBuffer);
  const labelBuffer = await fetchTeachingAnatomyAsset(manifest.volumes.segmentation.assetKey, signal);
  const segmentation = await parseAnatomyNrrd(labelBuffer);
  validateCompatibleAnatomyGeometry(ct.geometry, segmentation.geometry);
  if (ct.geometry.coordinateSystem !== manifest.coordinateSystem) {
    throw new Error(`The CT declares ${ct.geometry.coordinateSystem} coordinates but the manifest declares ${manifest.coordinateSystem}.`);
  }
  validateAxialAnatomyGeometry(ct.geometry);
  validateStructureLabels(segmentation.data, manifest.structures);
  return { ct, segmentation };
}
