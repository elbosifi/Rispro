import type { TeachingAnatomyManifest, TeachingAnatomyStructure } from "../api/teaching-api";

const MAX_LAZY_GROUP_MESHES = 64;
const MAX_LAZY_GROUP_BYTES = 16 * 1024 * 1024;

export function isInAnatomyStructureSubtree(structureId: string, rootId: string, structuresById: Map<string, TeachingAnatomyStructure>): boolean {
  let current = structuresById.get(structureId);
  while (current) {
    if (current.id === rootId) return true;
    current = current.parentId ? structuresById.get(current.parentId) : undefined;
  }
  return false;
}

export function anatomyStructureMeshGroup(manifest: TeachingAnatomyManifest, structureId: string): TeachingAnatomyStructure[] {
  const selected = manifest.structures.find((structure) => structure.id === structureId);
  if (!selected) return [];
  if (selected.meshAsset) return [selected];
  const structuresById = new Map(manifest.structures.map((structure) => [structure.id, structure]));
  const descendants = manifest.structures.filter((structure) => structure.meshAsset && isInAnatomyStructureSubtree(structure.id, structureId, structuresById));
  const bytes = descendants.reduce((total, structure) => {
    const asset = manifest.assets[structure.meshAsset!];
    return total + (asset?.integrity?.sizeBytes ?? Number.POSITIVE_INFINITY);
  }, 0);
  return descendants.length > 0 && descendants.length <= MAX_LAZY_GROUP_MESHES && bytes <= MAX_LAZY_GROUP_BYTES ? descendants : [];
}

export function canRenderAnatomyStructure(manifest: TeachingAnatomyManifest, structureId: string): boolean {
  return anatomyStructureMeshGroup(manifest, structureId).length > 0;
}

export function isAnatomyStructureVisible(structureId: string, hiddenStructureIds: string[], isolatedStructureId: string | null, structuresById: Map<string, TeachingAnatomyStructure>): boolean {
  const hidden = new Set(hiddenStructureIds);
  let current = structuresById.get(structureId);
  while (current) {
    if (hidden.has(current.id)) return false;
    current = current.parentId ? structuresById.get(current.parentId) : undefined;
  }
  return !isolatedStructureId || isInAnatomyStructureSubtree(structureId, isolatedStructureId, structuresById);
}
