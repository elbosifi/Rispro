import { describe, expect, it } from "vitest";
import type { TeachingAnatomyManifest, TeachingAnatomyStructure } from "../api/teaching-api";
import { anatomyStructureMeshGroup, canRenderAnatomyStructure, isAnatomyStructureVisible } from "../anatomy/anatomy-structure-mesh-selection";

function makeStructure(id: string, parentId?: string, meshAsset?: string): TeachingAnatomyStructure {
  return { id, ...(parentId ? { parentId } : {}), name: id, category: "Fixture", synonyms: [], color: "#aabbcc", ...(meshAsset ? { meshAsset } : {}), note: "" };
}

function makeManifest(structures: TeachingAnatomyStructure[], assetSizes: Record<string, number>): TeachingAnatomyManifest {
  const assets = Object.fromEntries(Object.entries(assetSizes).map(([key, sizeBytes]) => [key, {
    file: `${key}.obj`, mediaType: "model/obj", integrity: { sizeBytes, sha256: "a".repeat(64) },
  }]));
  return {
    schemaVersion: "2.0", atlasId: "bodyparts3d", title: "Fixture", bodyRegion: "Whole body", organs: [], systems: [],
    modality: "3D", correlatedImaging: false, supportedPlanes: [], coordinateSystem: "LPS", meshCoordinateSystem: "LPS",
    volumes: {}, assets, structures,
    provenance: { sourceRepository: "https://example.org/source", project: "Fixture", attribution: "Fixture.", license: "CC BY 4.0", licenseUrl: "https://example.org/license", use: "Testing." },
    spatialValidation: { status: "not-applicable", method: "Fixture." },
  };
}

describe("anatomy source-surface groups", () => {
  it("selects only real mesh descendants and applies hidden/isolation state to the hierarchy", () => {
    const manifest = makeManifest([
      makeStructure("liver"), makeStructure("lobe", "liver", "lobe-mesh"), makeStructure("segment", "lobe", "segment-mesh"),
      makeStructure("kidney", undefined, "kidney-mesh"),
    ], { "lobe-mesh": 1024, "segment-mesh": 2048, "kidney-mesh": 512 });
    const selectedIds = anatomyStructureMeshGroup(manifest, "liver").map(({ id }) => id);
    expect(selectedIds).toEqual(["lobe", "segment"]);
    expect(canRenderAnatomyStructure(manifest, "liver")).toBe(true);
    expect(isAnatomyStructureVisible("segment", [], "liver", new Map(manifest.structures.map((item) => [item.id, item])))).toBe(true);
    expect(isAnatomyStructureVisible("segment", ["liver"], null, new Map(manifest.structures.map((item) => [item.id, item])))).toBe(false);
    expect(isAnatomyStructureVisible("kidney", [], "liver", new Map(manifest.structures.map((item) => [item.id, item])))).toBe(false);
  });

  it("declines unbounded, oversized, and unversioned hierarchy geometry", () => {
    const tooMany = [makeStructure("group"), ...Array.from({ length: 65 }, (_, index) => makeStructure(`mesh-${index}`, "group", `asset-${index}`))];
    expect(anatomyStructureMeshGroup(makeManifest(tooMany, Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`asset-${index}`, 1]))), "group")).toEqual([]);

    const tooLarge = makeManifest([makeStructure("group"), makeStructure("mesh", "group", "large")], { large: 16 * 1024 * 1024 + 1 });
    expect(canRenderAnatomyStructure(tooLarge, "group")).toBe(false);

    const unversioned = makeManifest([makeStructure("group"), makeStructure("mesh", "group", "legacy")], {});
    expect(canRenderAnatomyStructure(unversioned, "group")).toBe(false);
  });
});
